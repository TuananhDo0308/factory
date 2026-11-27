import { type NextRequest, NextResponse } from "next/server";
import { authenticateBearer, resolveUserProject } from "@/lib/api-auth";
import { normalizeIssueStatus, normalizePriority } from "@/lib/epics";
import { emitFactoryEvent } from "@/lib/events";
import { prisma } from "@/lib/prisma";
import { serializeProjectIssue } from "@/lib/project-stats";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ issueKey: string }> },
) {
  const auth = await authenticateBearer(request);
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

  const project = await resolveUserProject(
    auth.user.id,
    {
      projectId: str(body.projectId) || undefined,
      project: str(body.project) || undefined,
      localPath: str(body.repo || body.localPath) || undefined,
    },
    { write: true },
  );
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const { issueKey: rawKey } = await context.params;
  const issueKey = decodeURIComponent(rawKey).trim();
  const existing = await prisma.projectIssue.findUnique({
    where: { projectId_issueKey: { projectId: project.id, issueKey } },
  });
  if (!existing) {
    return NextResponse.json({ error: `Issue ${issueKey} not found` }, { status: 404 });
  }

  const data: Record<string, unknown> = {};
  if (body.status !== undefined) {
    const s = normalizeIssueStatus(body.status);
    if (!s) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    data.status = s;
  }
  if (body.phase !== undefined || body.currentPhase !== undefined) {
    data.currentPhase = str(body.currentPhase ?? body.phase) || null;
  }
  if (body.run !== undefined || body.runKey !== undefined) {
    data.runKey = str(body.runKey ?? body.run) || null;
  }
  if (body.summary !== undefined) {
    data.summary = str(body.summary) || null;
  }
  if (body.priority !== undefined) {
    data.priority = normalizePriority(body.priority);
  }
  const updated = await prisma.projectIssue.update({
    where: { id: existing.id },
    data,
  });

  emitFactoryEvent({
    type: "issue:updated",
    userId: auth.user.id,
    projectId: project.id,
    payload: { issueId: updated.id, issueKey: updated.issueKey, status: updated.status },
  });

  return NextResponse.json({
    ok: true,
    issue: serializeProjectIssue(updated),
  });
}
