import { type NextRequest, NextResponse } from "next/server";
import {
  normalizeCriteria,
  normalizeDependsOn,
  normalizeIssueStatus,
  normalizePriority,
  normalizeSize,
} from "@/lib/epics";
import { emitFactoryEvent } from "@/lib/events";
import { prisma } from "@/lib/prisma";
import { serializeProjectIssue } from "@/lib/project-stats";
import { getCurrentSession } from "@/lib/session";
import { getProjectAccess } from "@/lib/team-access";

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
  if (body.complexity !== undefined || body.size !== undefined) {
    const size = normalizeSize(body.complexity ?? body.size);
    if (size) data.complexity = size;
  }
  if (body.status !== undefined) {
    const s = normalizeIssueStatus(body.status);
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
  const updated = await prisma.projectIssue.update({
    where: { id: existing.id },
    data,
  });

  emitFactoryEvent({ type: "issue:updated", userId: session.user.id, projectId: project.id });

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
