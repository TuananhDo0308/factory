import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { isUnattendedFactoryMode } from "@/lib/auto-dispatch";
import { emitFactoryEvent } from "@/lib/events";
import { prisma } from "@/lib/prisma";
import { findAccessibleRun, getAccessibleRunners } from "@/lib/team-access";
import { getRunDetail } from "@/lib/workspace-data";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const detail = await getRunDetail(auth.user.id, id);
  if (!detail) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  return NextResponse.json({ ok: true, run: detail });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const found = await findAccessibleRun(auth.user, id);
  if (!found) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  if (!found.canWrite) {
    return NextResponse.json({ error: "Viewer role cannot modify sessions" }, { status: 403 });
  }
  const existing = found.run;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (
    isUnattendedFactoryMode(existing.mode) &&
    (body.action === "pause" || body.action === "resume" || body.status === "awaiting_input")
  ) {
    return NextResponse.json(
      {
        error:
          "Factory build runs are unattended and cannot be paused or resumed mid-loop. Cancel or wait for completion, then Retry or Clarify.",
      },
      { status: 409 },
    );
  }

  let targetResumeRunner:
    | Awaited<ReturnType<typeof getAccessibleRunners>>[number]
    | null = null;
  if (body.action === "resume") {
    const cutoffMs = Date.now() - 65_000;
    const onlineRunners = (
      await getAccessibleRunners(auth.user.id, {
        projectId: existing.projectId,
        githubLogin: auth.user.githubLogin,
      })
    ).filter((r) => r.status === "online" && r.lastHeartbeatAt.getTime() > cutoffMs);
    targetResumeRunner =
      (existing.runnerMachineId
        ? onlineRunners.find((r) => r.id === existing.runnerMachineId) ?? null
        : null) ??
      onlineRunners
        .filter((r) => r.userId === auth.user.id)
        .sort((a, b) => a.activeRuns - b.activeRuns)[0] ??
      onlineRunners
        .filter((r) => r.visibility === "team")
        .sort((a, b) => a.activeRuns - b.activeRuns)[0] ??
      null;
    if (!targetResumeRunner) {
      return NextResponse.json(
        {
          error:
            "No local daemon is connected. Start `sf daemon` on your machine before resuming.",
          code: "NO_RUNNER_ONLINE",
        },
        { status: 503 },
      );
    }
  }

  const data: Record<string, unknown> = {};
  if (typeof body.status === "string" && body.status.trim()) {
    data.status = body.status.trim();
    if (body.status === "cancelled" || body.status === "passed" || body.status === "failed") {
      data.finishedAt = new Date();
    }
  }
  if (targetResumeRunner) {
    data.runnerMachineId = targetResumeRunner.id;
  }
  if (typeof body.model === "string" && body.model.trim()) {
    data.model = body.model.trim();
  }
  if (typeof body.autonomy === "string" && body.autonomy.trim()) {
    data.autonomy = body.autonomy.trim();
  }
  if (typeof body.title === "string" && body.title.trim()) {
    data.title = body.title.trim().slice(0, 240);
  }

  const updated = await prisma.factoryRun.update({
    where: { id: existing.id },
    data,
  });

  if (data.status === "cancelled") {
    const now = new Date();
    await Promise.all([
      prisma.runnerCommand.updateMany({
        where: { runId: existing.id, status: "pending" },
        data: { status: "failed", error: "Session cancelled by user" },
      }),
      prisma.runAgent.updateMany({
        where: { runId: existing.id, status: { in: ["working", "waiting_on_you"] } },
        data: { status: "idle", activity: "Cancelled by operator", finishedAt: now },
      }),
    ]);
  }

  if (body.action === "pause" || body.action === "resume") {
    await prisma.runnerCommand.create({
      data: {
        userId: targetResumeRunner?.userId ?? existing.runner?.userId ?? existing.project.userId,
        runnerMachineId: targetResumeRunner?.id ?? existing.runnerMachineId,
        projectId: existing.projectId,
        runId: existing.id,
        type: body.action === "pause" ? "pause_run" : "resume_run",
        payloadJson: JSON.stringify({
          runKey: existing.runKey,
          projectId: existing.projectId,
          ...(body.action === "resume"
            ? {
                decision: "resumed",
                message: "Operator resumed the session. Please continue from where you paused.",
                engine: existing.engine,
                model: existing.model,
                autonomy: existing.autonomy,
                mode: existing.mode,
                localPath: existing.project.localPath,
              }
            : {}),
        }),
        status: "pending",
      },
    });
  }

  emitFactoryEvent({
    type: "run:updated",
    userId: auth.user.id,
    projectId: existing.projectId,
    runId: existing.id,
    payload: { status: updated.status },
  });

  return NextResponse.json({ ok: true, run: updated });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const found = await findAccessibleRun(auth.user, id);
  if (!found) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  if (!found.isOwner && found.run.triggeredById !== auth.user.id) {
    return NextResponse.json({ error: "Only owner or run creator can delete" }, { status: 403 });
  }
  const existing = found.run;

  await prisma.factoryRun.delete({ where: { id: existing.id } });
  emitFactoryEvent({
    type: "run:updated",
    userId: auth.user.id,
    projectId: existing.projectId,
    runId: existing.id,
    payload: { deleted: true },
  });

  return NextResponse.json({ ok: true });
}
