import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { emitFactoryEvent } from "@/lib/events";
import { prisma } from "@/lib/prisma";
import { findAccessibleRun } from "@/lib/team-access";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const found = await findAccessibleRun(auth.user, id);
  if (!found) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  if (!found.canWrite) {
    return NextResponse.json({ error: "Viewer role cannot retry runs" }, { status: 403 });
  }
  const run = found.run;

  let phase = run.currentPhase || "Build";
  let specId: string | null = null;
  try {
    const body = (await request.json()) as { phase?: unknown; specId?: unknown };
    if (typeof body.phase === "string" && body.phase.trim()) phase = body.phase.trim();
    if (typeof body.specId === "string" && body.specId.trim()) specId = body.specId.trim();
  } catch {
    // Default retry from currentPhase.
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const lastStep = await tx.runStep.findFirst({
      where: { runId: run.id },
      orderBy: { seq: "desc" },
      select: { seq: true },
    });

    await tx.factoryRun.update({
      where: { id: run.id },
      data: {
        status: "queued",
        currentPhase: phase,
        finishedAt: null,
        lastHeartbeatAt: now,
        humanInterventions: { increment: 1 },
      },
    });

    if (run.issueId) {
      await tx.projectIssue
        .update({
          where: { id: run.issueId },
          data: { status: "in_progress", currentPhase: phase },
        })
        .catch(() => {});
    }

    await tx.runStep.create({
      data: {
        runId: run.id,
        seq: (lastStep?.seq ?? 0) + 1,
        step: `retry-${phase.toLowerCase()}`,
        phase,
        status: "started",
        spec: specId,
        role: "orchestrator",
        label: `Retry (${run.mode})`,
        summary: `Retry requested by @${auth.user.githubLogin}`,
      },
    });

    await tx.runnerCommand.create({
      data: {
        userId: run.runner?.userId ?? run.project.userId,
        runnerMachineId: run.runnerMachineId,
        projectId: run.projectId,
        runId: run.id,
        type: "retry_phase",
        payloadJson: JSON.stringify({
          runKey: run.runKey,
          projectId: run.projectId,
          prompt: run.prompt || run.title,
          mode: run.mode,
          engine: run.engine,
          model: run.model,
          autonomy: run.autonomy,
          branch: run.targetBranch || run.project.defaultBranch || "main",
          useWorktree:
            run.mode === "ba"
              ? false
              : Boolean(run.worktreePath && run.worktreePath !== run.project.localPath),
          localPath: run.project.localPath,
          issueId: run.issueId,
          missionId: run.missionId,
          fromPhase: phase,
          specId,
          checkpoint: run.checkpointJson ? JSON.parse(run.checkpointJson) : null,
        }),
        status: "pending",
      },
    });
  });

  if (run.issueId) {
    emitFactoryEvent({
      type: "issue:updated",
      userId: auth.user.id,
      projectId: run.projectId,
      runId: run.id,
      payload: { issueId: run.issueId, status: "in_progress", phase },
    });
  }

  emitFactoryEvent({
    type: "run:updated",
    userId: auth.user.id,
    projectId: run.projectId,
    runId: run.id,
    payload: { status: "queued", currentPhase: phase },
  });

  return NextResponse.json({ ok: true, phase });
}
