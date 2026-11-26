import { type NextRequest, NextResponse } from "next/server";
import { dispatchReadyIssuesForProject } from "@/lib/auto-dispatch";
import { emitFactoryEvent } from "@/lib/events";
import { isFactoryInitIssue } from "@/lib/init-issue";
import { prisma } from "@/lib/prisma";
import { serializeProjectIssue } from "@/lib/project-stats";
import { getCurrentSession } from "@/lib/session";
import { getProjectAccess } from "@/lib/team-access";
import {
  defaultModelPlanForTier,
  normalizeAutonomy,
  normalizeComplexity,
  normalizeCriteria,
  normalizeDependsOn,
  normalizePriority,
  normalizeStatus,
  normalizeTier,
} from "@/lib/triage";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; issueId: string }> },
) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, issueId } = await context.params;
  const access = await getProjectAccess(session.user, id);
  if (!access) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (!access.canWrite) {
    return NextResponse.json({ error: "Viewer role cannot edit issues" }, { status: 403 });
  }
  const project = access.project;

  const existing = await prisma.projectIssue.findFirst({
    where: { id: issueId, projectId: project.id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
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

  const data: Record<string, unknown> = {};

  if (typeof body.title === "string" && body.title.trim()) {
    data.title = body.title.trim().slice(0, 240);
  }
  if (typeof body.goal === "string") {
    data.goal = body.goal.trim().slice(0, 500);
  }
  if (typeof body.body === "string") {
    data.body = body.body.trim();
  }
  if (body.criteria !== undefined) {
    data.criteriaJson = JSON.stringify(normalizeCriteria(body.criteria));
  }
  if (body.dependsOn !== undefined) {
    data.dependsOnJson = JSON.stringify(normalizeDependsOn(body.dependsOn));
  }
  if (body.priority !== undefined) {
    data.priority = normalizePriority(body.priority);
  }
  if (body.complexity !== undefined) {
    data.complexity = normalizeComplexity(body.complexity, 3);
  }
  if (body.tier !== undefined) {
    const t = normalizeTier(body.tier);
    if (t) {
      data.tier = t;
      data.modelPlanJson = JSON.stringify(defaultModelPlanForTier(t, project.engine || "antigravity"));
    }
  }
  if (body.autonomy !== undefined) {
    const a = normalizeAutonomy(body.autonomy);
    if (a) data.autonomy = a;
  }
  if (body.status !== undefined) {
    const s = normalizeStatus(body.status);
    if (!s) {
      return NextResponse.json({ error: "Invalid issue status" }, { status: 400 });
    }
    data.status = s;
  }
  if (body.currentPhase !== undefined) {
    data.currentPhase = str(body.currentPhase) || null;
  }
  if (body.summary !== undefined) {
    data.summary = str(body.summary) || null;
  }
  if (body.thinking !== undefined) {
    data.thinking = str(body.thinking) || null;
  }
  if (body.missionId !== undefined) {
    const mid = str(body.missionId);
    if (!mid || mid === "none") {
      data.missionId = null;
    } else {
      const m = await prisma.mission.findFirst({
        where: { id: mid, projectId: project.id },
        select: { id: true },
      });
      if (m) data.missionId = m.id;
    }
  }

  const updated = await prisma.projectIssue.update({
    where: { id: existing.id },
    data,
  });

  // Legacy `I0` support + closing active Clarify sessions once a ticket is approved to Ready.
  if (isFactoryInitIssue(existing) && updated.status === "passed") {
    await Promise.all([
      prisma.project
        .update({
          where: { id: project.id },
          data: { initStatus: "complete" },
        })
        .catch(() => {}),
      prisma.factoryRun
        .updateMany({
          where: {
            projectId: project.id,
            issueId: existing.id,
            mode: "init",
            status: { in: ["running", "queued", "awaiting_input"] },
          },
          data: {
            status: "passed",
            finishedAt: new Date(),
          },
        })
        .catch(() => {}),
    ]);
    emitFactoryEvent({
      type: "project:updated",
      userId: session.user.id,
      projectId: project.id,
      payload: { initStatus: "complete" },
    });
  } else if (updated.status === "ready") {
    // Moving a ticket to `ready` finalizes any interactive `/factory clarify` chat for it.
    await prisma.factoryRun
      .updateMany({
        where: {
          projectId: project.id,
          issueId: existing.id,
          mode: "clarify",
          status: { in: ["running", "queued", "awaiting_input"] },
        },
        data: {
          status: "passed",
          finishedAt: new Date(),
        },
      })
      .catch(() => {});
  }

  emitFactoryEvent({ type: "issue:updated", userId: session.user.id, projectId: project.id });

  if (
    project.autoDispatch &&
    (updated.status === "ready" || updated.status === "passed")
  ) {
    await dispatchReadyIssuesForProject({
      projectId: project.id,
      actorUserId: session.user.id,
      actorGithubLogin: session.user.githubLogin,
    }).catch(() => {});
  }

  return NextResponse.json({ issue: serializeProjectIssue(updated) });
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string; issueId: string }> },
) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, issueId } = await context.params;
  const access = await getProjectAccess(session.user, id);
  if (!access) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (!access.canWrite) {
    return NextResponse.json({ error: "Viewer role cannot delete issues" }, { status: 403 });
  }
  const project = access.project;

  const existing = await prisma.projectIssue.findFirst({
    where: { id: issueId, projectId: project.id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }

  await prisma.projectIssue.delete({ where: { id: existing.id } });
  emitFactoryEvent({ type: "issue:updated", userId: session.user.id, projectId: project.id });
  return NextResponse.json({ ok: true });
}
