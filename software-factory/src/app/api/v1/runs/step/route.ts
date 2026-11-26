import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest, resolveUserProject } from "@/lib/api-auth";
import { emitFactoryEvent } from "@/lib/events";
import { prisma } from "@/lib/prisma";

const VALID_STEP_STATUSES = new Set([
  "started",
  "passed",
  "failed",
  "blocked",
  "skipped",
  "info",
]);

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function intOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.round(n);
  }
  return null;
}
function floatOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const runKey = str(body.run || body.runKey);
  const stepName = str(body.step);
  const phase = str(body.phase) || "Step";
  const statusRaw = str(body.status) || "info";
  const status = VALID_STEP_STATUSES.has(statusRaw) ? statusRaw : "info";

  if (!runKey) return NextResponse.json({ error: "run is required" }, { status: 400 });
  if (!stepName) return NextResponse.json({ error: "step is required" }, { status: 400 });

  const project = await resolveUserProject(auth.user.id, {
    projectId: str(body.projectId) || undefined,
    project: str(body.project) || undefined,
    localPath: str(body.repo || body.localPath) || undefined,
    runKey,
  });
  if (!project) {
    return NextResponse.json(
      { error: "Project not found for this user. Pass --project or --repo." },
      { status: 404 },
    );
  }

  const inputTokens = intOrNull(body.inputTokens);
  const outputTokens = intOrNull(body.outputTokens);
  const cacheReadTokens = intOrNull(body.cacheReadTokens);
  const costUsd = floatOrNull(body.costUsd);
  const durationMs = intOrNull(body.durationMs);
  const round = intOrNull(body.round);
  const model = str(body.model) || null;
  const spec = str(body.spec) || null;
  const role = str(body.role) || null;
  const agentId = str(body.agent || body.agentId) || null;
  const agentName = str(body.agentName) || null;
  const label = str(body.label) || null;
  const summary = str(body.summary).slice(0, 200_000) || null;
  const upsert = body.upsert === true;
  const idempotent = body.idempotent === true;
  const keepAgentStatus = body.keepAgentStatus === true;
  const rawCreatedAt = str(body.createdAt);
  const parsedCreatedAt = rawCreatedAt ? new Date(rawCreatedAt) : null;
  const stepCreatedAt =
    parsedCreatedAt && Number.isFinite(parsedCreatedAt.getTime()) ? parsedCreatedAt : undefined;
  const now = new Date();

  let dataJson: string | null = null;
  if (body.data !== undefined && body.data !== null) {
    try {
      dataJson =
        typeof body.data === "string"
          ? body.data.slice(0, 64_000)
          : JSON.stringify(body.data).slice(0, 64_000);
    } catch {
      dataJson = null;
    }
  }

  const FACTORY_PHASES = new Set([
    "Spec",
    "Build",
    "Check",
    "Review",
    "QC",
    "Repair",
    "Verdict",
    "BA Planning",
    "Clarify",
    "Refine",
    "Judge",
  ]);

  const result = await prisma.$transaction(async (tx) => {
    const run = await tx.factoryRun.findUnique({
      where: { projectId_runKey: { projectId: project.id, runKey } },
    });

    if (!run) {
      return { notFound: true as const };
    }

    const stepKey = stepName.slice(0, 80);
    if (idempotent && !upsert) {
      const alreadyRecorded = await tx.runStep.findFirst({
        where: { runId: run.id, step: stepKey },
      });
      if (alreadyRecorded) {
        if (
          stepCreatedAt &&
          stepCreatedAt.getTime() < alreadyRecorded.createdAt.getTime() - 2000
        ) {
          const patched = await tx.runStep.update({
            where: { id: alreadyRecorded.id },
            data: { createdAt: stepCreatedAt },
          });
          return { notFound: false as const, step: patched, run, skipped: true };
        }
        return { notFound: false as const, step: alreadyRecorded, run, skipped: true };
      }
    }

    // Automatically track per-agent state whenever role/spec/agentId is supplied.
    // A single failed tool call shouldn't permanently mark the whole agent failed —
    // the agent can recover or retry; final status is set by /api/v1/runs/finish.
    const dataKind =
      body.data && typeof body.data === "object" && !Array.isArray(body.data)
        ? String((body.data as Record<string, unknown>).kind || "")
        : "";
    const isToolStep = dataKind === "tool_call";
    const isStreamingDraft = upsert && status === "started";
    const isSubagent = Boolean(agentId && agentId !== "orchestrator");

    const existingForUpsert = upsert
      ? await tx.runStep.findFirst({
          where: { runId: run.id, step: stepKey },
          orderBy: { seq: "desc" },
        })
      : null;

    // Never duplicate or double-increment tokens/cost if a finalized upserted step is retried/replayed.
    if (existingForUpsert && existingForUpsert.status !== "started") {
      return { notFound: false as const, step: existingForUpsert, run, skipped: true };
    }

    let runAgentId: string | null = null;
    if (role || agentId || spec) {
      const agentKey = agentId || (spec && role ? `${spec}-${role}` : role || spec || "worker");
      const existingAgent = keepAgentStatus
        ? await tx.runAgent.findUnique({
            where: { runId_agentKey: { runId: run.id, agentKey } },
            select: { status: true, activity: true, finishedAt: true },
          })
        : null;
      const agentAlreadyFinished =
        keepAgentStatus &&
        existingAgent &&
        (existingAgent.status === "passed" || existingAgent.status === "failed");

      const agentStatus =
        status === "started"
          ? "working"
          : status === "passed"
            ? isToolStep
              ? "working"
              : "passed"
            : status === "failed"
              ? isToolStep
                ? "working"
                : "failed"
              : status === "blocked"
                ? "waiting_on_you"
                : "working";
      // Once a tool call finishes, reset live activity to "Thinking..." so the UI
      // never appears stuck on an already-completed shell command while the model generates.
      const nextActivity =
        isToolStep && (status === "passed" || status === "failed")
          ? "Thinking…"
          : (label || summary || stepName).slice(0, 160);
      const upsertedAgent = await tx.runAgent.upsert({
        where: { runId_agentKey: { runId: run.id, agentKey } },
        update: {
          status: agentAlreadyFinished ? undefined : agentStatus,
          model: model ?? undefined,
          activity: agentAlreadyFinished ? undefined : nextActivity,
          summary:
            !isStreamingDraft &&
            !agentAlreadyFinished &&
            summary &&
            dataKind !== "assistant_message" &&
            dataKind !== "thinking"
              ? summary.slice(0, 1000)
              : undefined,
          inputTokens: !isStreamingDraft && inputTokens ? { increment: inputTokens } : undefined,
          outputTokens: !isStreamingDraft && outputTokens ? { increment: outputTokens } : undefined,
          cacheReadTokens:
            !isStreamingDraft && cacheReadTokens ? { increment: cacheReadTokens } : undefined,
          costUsd: !isStreamingDraft && costUsd ? { increment: costUsd } : undefined,
          finishedAt: agentAlreadyFinished
            ? undefined
            : agentStatus === "passed" || agentStatus === "failed"
              ? now
              : null,
        },
        create: {
          runId: run.id,
          agentKey: agentKey.slice(0, 80),
          name: (agentName || label || (spec ? `${spec} ${role || ""}`.trim() : role || agentKey)).slice(
            0,
            140,
          ),
          role: role || "worker",
          specId: spec,
          model,
          status: agentStatus,
          activity: nextActivity,
          summary:
            !isStreamingDraft && summary && dataKind !== "thinking" ? summary.slice(0, 1000) : null,
          inputTokens: !isStreamingDraft ? (inputTokens ?? 0) : 0,
          outputTokens: !isStreamingDraft ? (outputTokens ?? 0) : 0,
          cacheReadTokens: !isStreamingDraft ? (cacheReadTokens ?? 0) : 0,
          costUsd: !isStreamingDraft ? (costUsd ?? 0) : 0,
        },
      });
      runAgentId = upsertedAgent.id;
    }

    let createdStep: Awaited<ReturnType<typeof tx.runStep.create>>;

    if (existingForUpsert && existingForUpsert.status === "started") {
      createdStep = await tx.runStep.update({
        where: { id: existingForUpsert.id },
        data: {
          status,
          phase: phase.slice(0, 60),
          label: label?.slice(0, 160) ?? existingForUpsert.label,
          model: model ?? existingForUpsert.model,
          durationMs: durationMs ?? existingForUpsert.durationMs,
          inputTokens: inputTokens ?? existingForUpsert.inputTokens,
          outputTokens: outputTokens ?? existingForUpsert.outputTokens,
          cacheReadTokens: cacheReadTokens ?? existingForUpsert.cacheReadTokens,
          costUsd: costUsd ?? existingForUpsert.costUsd,
          summary: summary ?? existingForUpsert.summary,
          dataJson: dataJson ?? existingForUpsert.dataJson,
        },
      });
    } else if (existingForUpsert && isStreamingDraft) {
      // Ignore a stale streaming chunk if this step was already finalized.
      createdStep = existingForUpsert;
    } else {
      const last = await tx.runStep.findFirst({
        where: { runId: run.id },
        orderBy: { seq: "desc" },
        select: { seq: true },
      });
      const nextSeq = (last?.seq ?? 0) + 1;

      createdStep = await tx.runStep.create({
        data: {
          runId: run.id,
          runAgentId,
          seq: nextSeq,
          step: stepKey,
          phase: phase.slice(0, 60),
          status,
          round,
          spec,
          role,
          agentId,
          label: label?.slice(0, 160) ?? null,
          model,
          durationMs,
          inputTokens,
          outputTokens,
          cacheReadTokens,
          costUsd,
          summary,
          dataJson,
          ...(stepCreatedAt ? { createdAt: stepCreatedAt } : {}),
        },
      });
    }

    const isTerminalRun =
      run.status === "passed" ||
      run.status === "failed" ||
      run.status === "blocked" ||
      run.status === "cancelled" ||
      Boolean(run.finishedAt);
    const nextRunStatus =
      isTerminalRun ? run.status : status === "blocked" ? "blocked" : "running";
    const shouldUpdatePhase = !isSubagent || FACTORY_PHASES.has(phase);
    const shouldUpdateRunSummary =
      !isSubagent &&
      !isStreamingDraft &&
      dataKind !== "assistant_message" &&
      dataKind !== "thinking" &&
      Boolean(summary);

    const clearStaleWatchdogSummary =
      nextRunStatus === "running" &&
      Boolean(run.summary?.startsWith("No agent activity received for "));

    const updatedRun = await tx.factoryRun.update({
      where: { id: run.id },
      data: {
        status: nextRunStatus,
        currentPhase: shouldUpdatePhase ? phase.slice(0, 60) : run.currentPhase,
        model: !isSubagent ? (model ?? run.model) : run.model,
        summary: shouldUpdateRunSummary
          ? summary
          : clearStaleWatchdogSummary
            ? null
            : run.summary,
        inputTokens: !isStreamingDraft && inputTokens ? { increment: inputTokens } : undefined,
        outputTokens: !isStreamingDraft && outputTokens ? { increment: outputTokens } : undefined,
        cacheReadTokens:
          !isStreamingDraft && cacheReadTokens ? { increment: cacheReadTokens } : undefined,
        costUsd: !isStreamingDraft && costUsd ? { increment: costUsd } : undefined,
        workMs: !isStreamingDraft && durationMs ? { increment: durationMs } : undefined,
        lastHeartbeatAt: now,
      },
    });

    if (run.issueId && shouldUpdatePhase && run.currentPhase !== phase.slice(0, 60)) {
      await tx.projectIssue
        .update({
          where: { id: run.issueId },
          data: { currentPhase: phase.slice(0, 60) },
        })
        .catch(() => {});
    }

    return { notFound: false as const, step: createdStep, run: updatedRun, skipped: false };
  });

  if (result.notFound) {
    return NextResponse.json(
      {
        error:
          "Run not found. Only sessions and runs created on Software Factory Web can be tracked.",
      },
      { status: 404 },
    );
  }

  if (result.skipped) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      run: {
        id: result.run.id,
        runKey: result.run.runKey,
        currentPhase: result.run.currentPhase,
        status: result.run.status,
      },
      step: { id: result.step.id, seq: result.step.seq },
    });
  }

  if (result.run.issueId) {
    emitFactoryEvent({
      type: "issue:updated",
      userId: auth.user.id,
      projectId: project.id,
      runId: result.run.id,
      payload: { issueId: result.run.issueId, phase: result.step.phase },
    });
  }

  emitFactoryEvent({
    type: "step:created",
    userId: auth.user.id,
    projectId: project.id,
    runId: result.run.id,
    payload: {
      seq: result.step.seq,
      phase: result.step.phase,
      status: result.step.status,
      role: result.step.role,
    },
  });

  return NextResponse.json({
    ok: true,
    run: {
      id: result.run.id,
      runKey: result.run.runKey,
      currentPhase: result.run.currentPhase,
      status: result.run.status,
    },
    step: { id: result.step.id, seq: result.step.seq },
  });
}
