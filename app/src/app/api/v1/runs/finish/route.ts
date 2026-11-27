import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest, resolveUserProject } from "@/lib/api-auth";
import { deriveEpicStatus, epicIssueKey } from "@/lib/epics";
import { emitFactoryEvent } from "@/lib/events";
import { prisma } from "@/lib/prisma";

const VALID_OUTCOMES = new Set(["passed", "failed", "blocked"]);
const VALID_RISKS = new Set(["low", "medium", "high"]);
const VALID_MERGE = new Set(["auto", "person"]);

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
  const outcomeRaw = str(body.outcome || body.status);
  if (!runKey) return NextResponse.json({ error: "run is required" }, { status: 400 });
  if (!VALID_OUTCOMES.has(outcomeRaw)) {
    return NextResponse.json(
      { error: "outcome must be one of passed, failed, blocked" },
      { status: 400 },
    );
  }

  const project = await resolveUserProject(
    auth.user.id,
    {
      projectId: str(body.projectId) || undefined,
      project: str(body.project) || undefined,
      localPath: str(body.repo || body.localPath) || undefined,
      runKey,
    },
    { write: true },
  );
  if (!project) {
    return NextResponse.json(
      { error: "Project not found for this user. Pass --project or --repo." },
      { status: 404 },
    );
  }

  const summary = str(body.summary || body.reason).slice(0, 200_000) || null;
  const skipVerdictStep = body.skipVerdictStep === true;
  const respectPendingInteraction = body.respectPendingInteraction === true;
  const riskRaw = str(body.risk);
  const risk = VALID_RISKS.has(riskRaw) ? riskRaw : undefined;
  const mergeRaw = str(body.merge || body.mergeDecision);
  const mergeDecision = VALID_MERGE.has(mergeRaw) ? mergeRaw : undefined;
  const mergedCommit = str(body.merged || body.mergedCommit) || undefined;
  const durationMs = intOrNull(body.durationMs);
  const prNumber = intOrNull(body.prNumber);
  const prUrl = str(body.prUrl) || undefined;
  const now = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    const run = await tx.factoryRun.findUnique({
      where: { projectId_runKey: { projectId: project.id, runKey } },
    });
    if (!run) {
      return null;
    }

    const computedDuration = durationMs ?? Math.max(0, now.getTime() - run.startedAt.getTime());
    let effectiveOutcome = outcomeRaw;
    // A BA turn that ends with a question waiting for the user keeps the session open.
    if (run.mode !== "epic" && respectPendingInteraction && outcomeRaw === "passed") {
      const pendingCount = await tx.runInteraction.count({
        where: { runId: run.id, status: "pending", type: { not: "decision" } },
      });
      if (pendingCount > 0) effectiveOutcome = "awaiting_input";
    }
    const finalPhase = run.mode === "epic" ? "Report" : "BA";
    const effectiveSummary = summary ?? run.summary;

    const finalRun = await tx.factoryRun.update({
      where: { id: run.id },
      data: {
        status: effectiveOutcome,
        currentPhase: effectiveOutcome === "awaiting_input" ? run.currentPhase : finalPhase,
        summary: effectiveSummary,
        risk: risk ?? run.risk,
        mergeDecision: mergeDecision ?? run.mergeDecision ?? undefined,
        mergedCommit: mergedCommit ?? run.mergedCommit,
        prNumber: prNumber ?? run.prNumber,
        prUrl: prUrl ?? run.prUrl,
        durationMs: computedDuration,
        lastHeartbeatAt: now,
        finishedAt: effectiveOutcome === "awaiting_input" ? null : now,
      },
    });

    await tx.runAgent.updateMany({
      where:
        effectiveOutcome === "passed" && run.mode !== "epic"
          ? { runId: run.id, status: { in: ["working", "failed", "idle", "waiting_on_you"] } }
          : { runId: run.id, status: "working" },
      data: {
        status:
          effectiveOutcome === "passed"
            ? "passed"
            : effectiveOutcome === "failed"
              ? "failed"
              : effectiveOutcome === "awaiting_input"
                ? "waiting_on_you"
                : "idle",
        finishedAt: effectiveOutcome === "awaiting_input" ? null : now,
      },
    });

    // The epic row on the board follows its tickets once the run ends.
    if (run.mode === "epic" && run.epicNumber) {
      const epicKey = epicIssueKey(run.epicNumber);
      const tickets = await tx.projectIssue.findMany({
        where: { projectId: project.id, epicNumber: run.epicNumber, NOT: { issueKey: epicKey } },
        select: { status: true },
      });
      const otherActive = await tx.factoryRun.count({
        where: {
          projectId: project.id,
          mode: "epic",
          epicNumber: run.epicNumber,
          id: { not: run.id },
          status: { in: ["queued", "running", "awaiting_input"] },
        },
      });
      let epicStatus = deriveEpicStatus(
        tickets.map((t) => t.status),
        otherActive > 0,
      );
      if (tickets.length === 0 && effectiveOutcome !== "passed") epicStatus = "blocked";
      await tx.projectIssue
        .update({
          where: { projectId_issueKey: { projectId: project.id, issueKey: epicKey } },
          data: {
            status: epicStatus,
            currentPhase: finalPhase,
            summary: effectiveSummary ? effectiveSummary.slice(0, 1500) : undefined,
          },
        })
        .catch(() => {});
    }

    if (!skipVerdictStep && effectiveOutcome !== "awaiting_input") {
      const last = await tx.runStep.findFirst({
        where: { runId: run.id },
        orderBy: { seq: "desc" },
        select: { seq: true },
      });

      await tx.runStep.create({
        data: {
          runId: run.id,
          seq: (last?.seq ?? 0) + 1,
          step: "verdict",
          phase: finalPhase,
          status: effectiveOutcome,
          durationMs: computedDuration,
          summary: effectiveSummary || `Run finished with outcome: ${effectiveOutcome}`,
          dataJson: JSON.stringify({ kind: "lifecycle", event: "finished", outcome: effectiveOutcome }),
        },
      });
    }

    return finalRun;
  });

  if (!updated) {
    return NextResponse.json(
      {
        error:
          "Run not found. Only sessions and runs created on Software Factory Web can be finished.",
      },
      { status: 404 },
    );
  }

  if (updated.issueId) {
    emitFactoryEvent({
      type: "issue:updated",
      userId: auth.user.id,
      projectId: project.id,
      runId: updated.id,
      payload: { issueId: updated.issueId, status: updated.status },
    });
  }

  emitFactoryEvent({
    type: "run:updated",
    userId: auth.user.id,
    projectId: project.id,
    runId: updated.id,
    payload: { status: updated.status, durationMs: updated.durationMs },
  });

  return NextResponse.json({
    ok: true,
    run: {
      id: updated.id,
      runKey: updated.runKey,
      status: updated.status,
      durationMs: updated.durationMs,
    },
  });
}
