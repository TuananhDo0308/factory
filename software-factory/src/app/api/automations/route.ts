import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import {
  autoApproveInReviewIssues,
  dispatchReadyIssuesForProject,
  getProjectAutoApprove,
  getProjectAutoApproveMap,
  setProjectDispatchPolicy,
} from "@/lib/auto-dispatch";
import { emitFactoryEvent } from "@/lib/events";
import { prisma } from "@/lib/prisma";
import { runStallWatchdog, safeJsonParse } from "@/lib/workspace-data";

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await runStallWatchdog(auth.user.id).catch(() => {});

  const [projects, runners, commands, mergeQueue] = await Promise.all([
    prisma.project.findMany({
      where: { userId: auth.user.id },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        slug: true,
        engine: true,
        localPath: true,
        autoDispatch: true,
        maxConcurrency: true,
        stallTimeoutMinutes: true,
        _count: {
          select: {
            issues: { where: { status: "ready" } },
            runs: { where: { status: { in: ["running", "queued"] } } },
          },
        },
      },
    }),
    prisma.runnerMachine.findMany({
      where: { userId: auth.user.id },
      orderBy: { lastHeartbeatAt: "desc" },
    }),
    prisma.runnerCommand.findMany({
      where: { userId: auth.user.id },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: {
        project: { select: { name: true, slug: true } },
        run: { select: { runKey: true, title: true } },
      },
    }),
    prisma.pullRequest.findMany({
      where: {
        project: { userId: auth.user.id },
        queueStatus: { in: ["queued", "rebasing", "verifying", "conflict"] },
      },
      orderBy: { updatedAt: "asc" },
      include: {
        project: { select: { name: true, slug: true } },
      },
    }),
  ]);

  const autoApproveMap = await getProjectAutoApproveMap(projects.map((p) => p.id));

  const now = Date.now();
  return NextResponse.json({
    ok: true,
    projects: projects.map((p) => ({
      ...p,
      autoApprove: autoApproveMap.get(p.id) ?? false,
      readyIssues: p._count.issues,
      activeRuns: p._count.runs,
    })),
    runners: runners.map((r) => ({
      id: r.id,
      name: r.name,
      hostname: r.hostname,
      os: r.os,
      engines: safeJsonParse<string[]>(r.enginesJson, ["antigravity", "claude"]),
      worktrees: safeJsonParse<string[]>(r.worktreesJson, []),
      status:
        r.status === "online" && now - r.lastHeartbeatAt.getTime() < 65_000
          ? "online"
          : "offline",
      maxConcurrency: r.maxConcurrency,
      activeRuns: r.activeRuns,
      lastHeartbeatAt: r.lastHeartbeatAt.toISOString(),
    })),
    commands: commands.map((c) => ({
      id: c.id,
      type: c.type,
      status: c.status,
      error: c.error,
      projectName: c.project?.name ?? null,
      runKey: c.run?.runKey ?? null,
      runTitle: c.run?.title ?? null,
      createdAt: c.createdAt.toISOString(),
    })),
    mergeQueue: mergeQueue.map((pr) => ({
      id: pr.id,
      number: pr.number,
      title: pr.title,
      headBranch: pr.headBranch,
      baseBranch: pr.baseBranch,
      ciStatus: pr.ciStatus,
      queueStatus: pr.queueStatus,
      projectName: pr.project.name,
      updatedAt: pr.updatedAt.toISOString(),
    })),
  });
}

export async function PATCH(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.action === "run_watchdog") {
    const stalled = await runStallWatchdog(auth.user.id);
    return NextResponse.json({ ok: true, stalled });
  }

  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: auth.user.id },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const data: Record<string, unknown> = {};
  if (typeof body.autoDispatch === "boolean") data.autoDispatch = body.autoDispatch;
  if (typeof body.maxConcurrency === "number" && body.maxConcurrency >= 1 && body.maxConcurrency <= 10) {
    data.maxConcurrency = Math.round(body.maxConcurrency);
  }
  if (
    typeof body.stallTimeoutMinutes === "number" &&
    body.stallTimeoutMinutes >= 5 &&
    body.stallTimeoutMinutes <= 180
  ) {
    data.stallTimeoutMinutes = Math.round(body.stallTimeoutMinutes);
  }

  const updated =
    Object.keys(data).length > 0
      ? await prisma.project.update({ where: { id: project.id }, data })
      : project;

  const hasAutoApprove = typeof body.autoApprove === "boolean";
  if (hasAutoApprove) {
    await setProjectDispatchPolicy(project.id, { autoApprove: body.autoApprove as boolean });
  }
  const effectiveAutoApprove = hasAutoApprove
    ? (body.autoApprove as boolean)
    : await getProjectAutoApprove(project.id);

  let approvedCount = 0;
  if (hasAutoApprove && body.autoApprove === true) {
    approvedCount = await autoApproveInReviewIssues(project.id);
  }

  let dispatched: Array<{ issueId: string; issueKey: string; runId: string; runKey: string }> = [];
  if (
    updated.autoDispatch &&
    (body.autoDispatch === true || (hasAutoApprove && body.autoApprove === true))
  ) {
    const dispatchRes = await dispatchReadyIssuesForProject({
      projectId: project.id,
      actorUserId: auth.user.id,
      actorGithubLogin: auth.user.githubLogin,
      force: true,
    });
    dispatched = dispatchRes.dispatched;
  }

  emitFactoryEvent({
    type: "project:updated",
    userId: auth.user.id,
    projectId: project.id,
    payload: {
      autoDispatch: updated.autoDispatch,
      autoApprove: effectiveAutoApprove,
      approvedCount,
    },
  });
  if (approvedCount > 0) {
    emitFactoryEvent({
      type: "issue:updated",
      userId: auth.user.id,
      projectId: project.id,
      payload: { approvedCount },
    });
  }

  return NextResponse.json({
    ok: true,
    project: { ...updated, autoApprove: effectiveAutoApprove },
    approvedCount,
    dispatched,
  });
}
