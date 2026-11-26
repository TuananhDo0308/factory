import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import {
  autoApproveInReviewIssues,
  dispatchReadyIssuesForProject,
  getProjectAutoApprove,
  launchIssueClarifyRun,
  launchIssueFactoryRun,
  launchProjectInitRun,
  setProjectDispatchPolicy,
} from "@/lib/auto-dispatch";
import { emitFactoryEvent } from "@/lib/events";
import { syncProjectInitStatus } from "@/lib/init-issue";
import { prisma } from "@/lib/prisma";
import { getProjectAccess } from "@/lib/team-access";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const access = await getProjectAccess(auth.user, id);
  if (!access) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (!access.canWrite) {
    return NextResponse.json(
      { error: "Viewer role cannot dispatch runs on this project" },
      { status: 403 },
    );
  }
  const project = access.project;

  let body: Record<string, unknown> = {};
  try {
    const parsed = await request.json();
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    // Allow empty body -> defaults to start_auto
  }

  const action = str(body.action) || "start_auto";
  const issueIds = Array.isArray(body.issueIds)
    ? body.issueIds.map((v) => str(v)).filter(Boolean)
    : [];

  // 0a. Stage 1 (Once per project, interactive): launch `/factory init`
  if (action === "run_init") {
    const res = await launchProjectInitRun({
      projectId: project.id,
      triggeredByUserId: auth.user.id,
      triggeredByGithubLogin: auth.user.githubLogin,
      runnerId: str(body.runnerId) || undefined,
      engine: str(body.engine) || undefined,
      model: str(body.model) || undefined,
    });
    if (!res.ok) {
      return NextResponse.json({ error: res.error }, { status: res.status });
    }
    return NextResponse.json({
      ok: true,
      reused: res.reused,
      run: { id: res.run.id, runKey: res.run.runKey, status: res.run.status, mode: res.run.mode },
      dispatchedToRunner: res.dispatchedToRunner,
    });
  }

  // 0b. Stage 2 (Per feature, interactive): launch `/factory clarify` on a ticket
  if (action === "clarify_issue") {
    const issueId = str(body.issueId);
    if (!issueId) {
      return NextResponse.json({ error: "issueId is required" }, { status: 400 });
    }
    const res = await launchIssueClarifyRun({
      projectId: project.id,
      issueId,
      triggeredByUserId: auth.user.id,
      triggeredByGithubLogin: auth.user.githubLogin,
      runnerId: str(body.runnerId) || undefined,
      engine: str(body.engine) || undefined,
      model: str(body.model) || undefined,
    });
    if (!res.ok) {
      return NextResponse.json({ error: res.error }, { status: res.status });
    }
    return NextResponse.json({
      ok: true,
      reused: res.reused,
      run: { id: res.run.id, runKey: res.run.runKey, status: res.run.status, mode: res.run.mode },
      issueKey: res.issueKey,
      dispatchedToRunner: res.dispatchedToRunner,
    });
  }

  // 1. Stage 3 (Unattended Build Loop): run a single Ready issue directly
  if (action === "run_issue") {
    const issueId = str(body.issueId);
    if (!issueId) {
      return NextResponse.json({ error: "issueId is required" }, { status: 400 });
    }
    const res = await launchIssueFactoryRun({
      projectId: project.id,
      issueId,
      triggeredByUserId: auth.user.id,
      triggeredByGithubLogin: auth.user.githubLogin,
      runnerId: str(body.runnerId) || undefined,
      engine: str(body.engine) || undefined,
      model: str(body.model) || undefined,
    });
    if (!res.ok) {
      return NextResponse.json(
        {
          error: res.error,
          code: "code" in res ? res.code : undefined,
          activeRunId: "activeRunId" in res ? res.activeRunId : undefined,
        },
        { status: res.status },
      );
    }
    return NextResponse.json({
      ok: true,
      run: { id: res.run.id, runKey: res.run.runKey, status: res.run.status, mode: res.run.mode },
      issueKey: res.issueKey,
      dispatchedToRunner: res.dispatchedToRunner,
    });
  }

  // 2. Toggle Full-Auto (no-approval) policy independently
  if (action === "set_auto_approve") {
    const nextAutoApprove = body.autoApprove === true;
    await setProjectDispatchPolicy(project.id, { autoApprove: nextAutoApprove });
    let approvedCount = 0;
    let dispatched: Array<{ issueId: string; issueKey: string; runId: string; runKey: string }> = [];
    let skippedReason: string | null = null;
    if (nextAutoApprove) {
      approvedCount = await autoApproveInReviewIssues(project.id);
      if (project.autoDispatch) {
        const dispatchRes = await dispatchReadyIssuesForProject({
          projectId: project.id,
          actorUserId: auth.user.id,
          actorGithubLogin: auth.user.githubLogin,
          force: true,
          preferredRunnerId: str(body.runnerId) || undefined,
        });
        dispatched = dispatchRes.dispatched;
        skippedReason = dispatchRes.skippedReason;
      }
    }
    emitFactoryEvent({
      type: "project:updated",
      userId: auth.user.id,
      projectId: project.id,
      payload: { autoApprove: nextAutoApprove, approvedCount },
    });
    if (approvedCount > 0) {
      emitFactoryEvent({
        type: "issue:updated",
        userId: auth.user.id,
        projectId: project.id,
        payload: { approvedCount, action },
      });
    }
    return NextResponse.json({
      ok: true,
      autoDispatch: project.autoDispatch,
      autoApprove: nextAutoApprove,
      approvedCount,
      dispatched,
      skippedReason,
    });
  }

  // 3. Stop Auto-Run loop
  if (action === "stop_auto") {
    await setProjectDispatchPolicy(project.id, { autoDispatch: false });
    emitFactoryEvent({
      type: "project:updated",
      userId: auth.user.id,
      projectId: project.id,
      payload: { autoDispatch: false },
    });
    return NextResponse.json({ ok: true, autoDispatch: false, dispatched: [] });
  }

  // 3. Confirm clarified / drafted tickets (backlog / needs_human -> ready)
  let confirmedCount = 0;
  const initComplete = await syncProjectInitStatus(project);
  const needsInit = !initComplete;
  if (action === "confirm_all" || action === "confirm_and_run") {
    const whereClause =
      issueIds.length > 0
        ? { projectId: project.id, id: { in: issueIds } }
        : { projectId: project.id, status: { in: ["backlog", "needs_human"] } };

    const updated = await prisma.projectIssue.updateMany({
      where: whereClause,
      data: { status: "ready" },
    });
    confirmedCount = updated.count;

    // Resolve any pending BA / Clarify approval interactions on this project
    await prisma.runInteraction.updateMany({
      where: {
        status: "pending",
        type: "plan_approval",
        run: { projectId: project.id, mode: { in: ["ba", "clarify"] } },
      },
      data: {
        status: "resolved",
        responseJson: JSON.stringify({
          decision: "approved",
          confirmedCount,
          by: auth.user.githubLogin,
        }),
        resolvedAt: new Date(),
      },
    });
    await prisma.factoryRun.updateMany({
      where: {
        projectId: project.id,
        mode: { in: ["ba", "clarify"] },
        status: "awaiting_input",
      },
      data: {
        status: "passed",
        finishedAt: new Date(),
      },
    });

    emitFactoryEvent({
      type: "issue:updated",
      userId: auth.user.id,
      projectId: project.id,
      payload: { confirmedCount, action },
    });
    emitFactoryEvent({
      type: "interaction:updated",
      userId: auth.user.id,
      projectId: project.id,
      payload: { action },
    });

    if (action === "confirm_all") {
      return NextResponse.json({
        ok: true,
        confirmedCount,
        needsInit,
        autoDispatch: project.autoDispatch,
        dispatched: [],
      });
    }
  }

  // 4. Enable Auto-Dispatch (& optional No-Approval mode) and launch eligible ready issues
  const requestedAutoApprove =
    action === "start_auto_no_approve"
      ? true
      : typeof body.autoApprove === "boolean"
        ? body.autoApprove
        : undefined;
  const effectiveAutoApprove =
    requestedAutoApprove ?? (await getProjectAutoApprove(project.id));

  await setProjectDispatchPolicy(project.id, {
    autoDispatch: true,
    ...(requestedAutoApprove !== undefined ? { autoApprove: requestedAutoApprove } : {}),
  });

  let approvedCount = 0;
  if (effectiveAutoApprove) {
    approvedCount = await autoApproveInReviewIssues(project.id);
    if (approvedCount > 0) {
      emitFactoryEvent({
        type: "issue:updated",
        userId: auth.user.id,
        projectId: project.id,
        payload: { approvedCount, action },
      });
    }
  }

  emitFactoryEvent({
    type: "project:updated",
    userId: auth.user.id,
    projectId: project.id,
    payload: { autoDispatch: true, autoApprove: effectiveAutoApprove },
  });

  const dispatchRes = await dispatchReadyIssuesForProject({
    projectId: project.id,
    actorUserId: auth.user.id,
    actorGithubLogin: auth.user.githubLogin,
    force: true,
    preferredRunnerId: str(body.runnerId) || undefined,
  });

  return NextResponse.json({
    ok: true,
    autoDispatch: true,
    autoApprove: effectiveAutoApprove,
    confirmedCount,
    approvedCount,
    needsInit: needsInit || dispatchRes.skippedReason === "project_not_initialized",
    dispatched: dispatchRes.dispatched,
    skippedReason: dispatchRes.skippedReason,
  });
}
