import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { emitFactoryEvent } from "@/lib/events";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const pr = await prisma.pullRequest.findFirst({
    where: { id, project: { userId: auth.user.id } },
    include: { project: true },
  });
  if (!pr) return NextResponse.json({ error: "Pull request not found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (typeof body.autoFix === "boolean") data.autoFix = body.autoFix;
  if (typeof body.state === "string") data.state = body.state;
  if (typeof body.queueStatus === "string") data.queueStatus = body.queueStatus;

  const action = typeof body.action === "string" ? body.action : "";
  if (action === "enqueue_merge") {
    data.queueStatus = "queued";
    await prisma.runnerCommand.create({
      data: {
        userId: auth.user.id,
        projectId: pr.projectId,
        runId: pr.runId,
        type: "merge_pr",
        payloadJson: JSON.stringify({
          prId: pr.id,
          number: pr.number,
          headBranch: pr.headBranch,
          baseBranch: pr.baseBranch,
          localPath: pr.project.localPath,
        }),
        status: "pending",
      },
    });
  } else if (action === "run_pr_judge") {
    await prisma.runnerCommand.create({
      data: {
        userId: auth.user.id,
        projectId: pr.projectId,
        runId: pr.runId,
        type: "run_pr_judge",
        payloadJson: JSON.stringify({
          prId: pr.id,
          number: pr.number,
          localPath: pr.project.localPath,
        }),
        status: "pending",
      },
    });
  } else if (action === "mark_merged") {
    data.state = "merged";
    data.queueStatus = "merged";
  }

  const updated = await prisma.pullRequest.update({
    where: { id: pr.id },
    data,
  });

  emitFactoryEvent({
    type: "pr:updated",
    userId: auth.user.id,
    projectId: pr.projectId,
    runId: pr.runId,
    payload: { prId: pr.id, state: updated.state, queueStatus: updated.queueStatus },
  });

  return NextResponse.json({ ok: true, pullRequest: updated });
}
