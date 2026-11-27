import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import {
  validateIncomingAttachments,
  type StoredAttachmentRef,
} from "@/lib/attachments";
import { newRunKey, pickOnlineRunner } from "@/lib/dispatch";
import { emitFactoryEvent } from "@/lib/events";
import { DEFAULT_MODEL, findModelChoice } from "@/lib/models";
import { prisma } from "@/lib/prisma";
import { detectSkillFromPrompt, toBaPrompt } from "@/lib/skills";
import { accessibleProjectsWhere, getProjectAccess } from "@/lib/team-access";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectId = request.nextUrl.searchParams.get("projectId") || undefined;
  const status = request.nextUrl.searchParams.get("status") || undefined;

  const runs = await prisma.factoryRun.findMany({
    where: {
      project: accessibleProjectsWhere(auth.user.id, auth.user.githubLogin),
      ...(projectId ? { projectId } : {}),
      ...(status ? { status } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 60,
    include: {
      project: { select: { id: true, name: true, slug: true, engine: true } },
      agents: { select: { id: true, role: true, status: true } },
      _count: { select: { steps: true, interactions: { where: { status: "pending" } } } },
    },
  });

  return NextResponse.json({
    ok: true,
    runs: runs.map((r) => ({
      id: r.id,
      runKey: r.runKey,
      title: r.title,
      mode: r.mode,
      autonomy: r.autonomy,
      engine: r.engine,
      status: r.status,
      currentPhase: r.currentPhase,
      model: r.model,
      risk: r.risk,
      epicNumber: r.epicNumber,
      costUsd: r.costUsd,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      cacheReadTokens: r.cacheReadTokens,
      durationMs: r.durationMs,
      project: r.project,
      agentCount: r.agents.length,
      waitingCount: r._count.interactions,
      stepCount: r._count.steps,
      startedAt: r.startedAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  });
}

/**
 * Starts a BA session: `/new-ba <request>` in the project's local clone, on the project's daemon.
 * Epic runs start from the Kanban board (`POST /api/projects/[id]/epics/[number]/run`).
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rawPrompt = str(body.prompt);
  const explicitTitle = str(body.title);
  const { attachments: validatedAttachments, error: attachmentError } = validateIncomingAttachments(
    body.attachments,
  );
  if (attachmentError) {
    return NextResponse.json({ error: attachmentError }, { status: 400 });
  }
  const typed = detectSkillFromPrompt(rawPrompt)?.body.trim() ?? rawPrompt;
  const requestText =
    typed ||
    (validatedAttachments.length > 0
      ? `Use the attached file${validatedAttachments.length === 1 ? "" : "s"} (${validatedAttachments.map((a) => a.name).join(", ")}).`
      : "");
  if (!requestText && !explicitTitle) {
    return NextResponse.json({ error: "Prompt, title, or attachment is required" }, { status: 400 });
  }
  const prompt = toBaPrompt(requestText || explicitTitle);

  const projectId = str(body.projectId);
  let project = null as Awaited<ReturnType<typeof prisma.project.findFirst>>;
  if (projectId) {
    const access = await getProjectAccess(auth.user, projectId);
    if (!access) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    if (!access.canWrite) {
      return NextResponse.json(
        { error: "Viewer role cannot launch sessions on this project" },
        { status: 403 },
      );
    }
    project = access.project;
  } else {
    project = await prisma.project.findFirst({
      where: accessibleProjectsWhere(auth.user.id, auth.user.githubLogin),
      orderBy: { updatedAt: "desc" },
    });
    if (project) {
      const access = await getProjectAccess(auth.user, project.id);
      if (access && !access.canWrite) {
        return NextResponse.json(
          { error: "Viewer role cannot launch sessions on this project" },
          { status: 403 },
        );
      }
    }
  }
  if (!project) {
    return NextResponse.json(
      { error: "Create or connect a project first: a BA session runs in the project's local clone." },
      { status: 400 },
    );
  }

  const model = findModelChoice(str(body.model) || DEFAULT_MODEL).value;
  const title = (explicitTitle || `BA: ${(requestText || "New request").split(/\r?\n/)[0]}`).slice(0, 140);
  const runKey = newRunKey("ba");

  const onlineRunner = await pickOnlineRunner({
    user: auth.user,
    projectId: project.id,
    requestedRunnerId: str(body.runnerId) || null,
    projectDefaultRunnerId: project.defaultRunnerId,
  });
  if (!onlineRunner && body.allowOfflineQueue !== true) {
    return NextResponse.json(
      {
        error:
          "No local daemon is connected. Start `sf daemon` on your machine (or connect a runner in Settings → Runners) before sending.",
        code: "NO_RUNNER_ONLINE",
      },
      { status: 503 },
    );
  }
  const phase = "BA";
  const projectRef = project;

  const created = await prisma.$transaction(async (tx) => {
    const run = await tx.factoryRun.create({
      data: {
        projectId: projectRef.id,
        userId: projectRef.userId,
        triggeredById: auth.user.id,
        runnerMachineId: onlineRunner?.id ?? null,
        runKey,
        title,
        prompt,
        mode: "ba",
        autonomy: "medium",
        engine: "claude",
        status: "queued",
        currentPhase: phase,
        targetBranch: projectRef.defaultBranch || "main",
        worktreePath: projectRef.localPath,
        model,
        lastHeartbeatAt: new Date(),
      },
    });

    const orch = await tx.runAgent.create({
      data: {
        runId: run.id,
        agentKey: "orchestrator",
        name: "BA",
        role: "orchestrator",
        level: 0,
        model,
        status: onlineRunner ? "working" : "waiting_on_you",
        activity: onlineRunner
          ? `Dispatched to runner "${onlineRunner.name}"`
          : "Waiting for a local `sf daemon`",
      },
    });

    const storedAttachments: StoredAttachmentRef[] = [];
    for (let idx = 0; idx < validatedAttachments.length; idx += 1) {
      const att = validatedAttachments[idx];
      const artifact = await tx.runArtifact.create({
        data: {
          runId: run.id,
          kind: "attachment",
          title: att.name.slice(0, 180),
          pathOrUrl: `.factory/attachments/${runKey}/${idx + 1}-${att.name}`,
          mimeType: att.mimeType,
          contentText: att.isText ? att.textContent : null,
          contentBase64: att.isText ? null : att.base64,
          metaJson: JSON.stringify({ size: att.bytes, source: "session_prompt" }),
        },
      });
      storedAttachments.push({
        artifactId: artifact.id,
        name: att.name,
        mimeType: att.mimeType,
        size: att.bytes,
      });
    }

    await tx.runStep.create({
      data: {
        runId: run.id,
        runAgentId: orch.id,
        seq: 1,
        step: "session-created",
        phase,
        status: "started",
        role: "orchestrator",
        model,
        label: "BA session",
        summary: prompt.slice(0, 500),
        dataJson:
          storedAttachments.length > 0
            ? JSON.stringify({ kind: "session_created", attachments: storedAttachments })
            : null,
      },
    });

    await tx.runnerCommand.create({
      data: {
        userId: onlineRunner?.userId ?? projectRef.userId,
        runnerMachineId: onlineRunner?.id ?? null,
        projectId: projectRef.id,
        runId: run.id,
        type: "start_run",
        payloadJson: JSON.stringify({
          runKey,
          projectId: projectRef.id,
          projectSlug: projectRef.slug,
          mode: "ba",
          engine: "claude",
          model,
          prompt,
          localPath: projectRef.localPath,
          ...(storedAttachments.length > 0 ? { attachments: storedAttachments } : {}),
        }),
        status: "pending",
      },
    });

    return run;
  });

  emitFactoryEvent({
    type: "run:updated",
    userId: auth.user.id,
    projectId: project.id,
    runId: created.id,
    payload: { status: created.status, mode: "ba" },
  });

  return NextResponse.json(
    {
      ok: true,
      run: { id: created.id, runKey: created.runKey, status: created.status },
      dispatchedToRunner: onlineRunner?.name ?? null,
    },
    { status: 201 },
  );
}
