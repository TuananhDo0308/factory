import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { emitFactoryEvent } from "@/lib/events";
import { prisma } from "@/lib/prisma";
import { safeJsonParse } from "@/lib/workspace-data";

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const lessons = await prisma.lesson.findMany({
    where: { userId: auth.user.id },
    orderBy: [{ status: "asc" }, { occurrences: "desc" }, { updatedAt: "desc" }],
    include: { project: { select: { id: true, name: true, slug: true } } },
  });

  return NextResponse.json({
    ok: true,
    lessons: lessons.map((l) => ({
      id: l.id,
      patternKey: l.patternKey,
      title: l.title,
      occurrences: l.occurrences,
      target: l.target,
      proposal: l.proposal,
      evidence: safeJsonParse<string[]>(l.evidenceJson, []),
      status: l.status,
      project: l.project,
      createdAt: l.createdAt.toISOString(),
      updatedAt: l.updatedAt.toISOString(),
    })),
  });
}

export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const patternKey =
    typeof body.patternKey === "string" && body.patternKey.trim()
      ? body.patternKey.trim()
      : `lesson-${Date.now().toString(36)}`;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const proposal = typeof body.proposal === "string" ? body.proposal.trim() : "";
  if (!title || !proposal) {
    return NextResponse.json({ error: "title and proposal are required" }, { status: 400 });
  }

  const lesson = await prisma.lesson.upsert({
    where: { userId_patternKey: { userId: auth.user.id, patternKey } },
    update: {
      title,
      proposal,
      occurrences: Number.isFinite(Number(body.occurrences)) ? Number(body.occurrences) : undefined,
      target: typeof body.target === "string" ? body.target : undefined,
      evidenceJson: Array.isArray(body.evidence) ? JSON.stringify(body.evidence) : undefined,
    },
    create: {
      userId: auth.user.id,
      projectId: typeof body.projectId === "string" ? body.projectId : null,
      patternKey,
      title,
      occurrences: Number.isFinite(Number(body.occurrences)) ? Number(body.occurrences) : 3,
      target: typeof body.target === "string" ? body.target : "role_brief",
      proposal,
      evidenceJson: Array.isArray(body.evidence) ? JSON.stringify(body.evidence) : null,
      status: "proposed",
    },
  });

  emitFactoryEvent({
    type: "lesson:updated",
    userId: auth.user.id,
    projectId: lesson.projectId,
    payload: { lessonId: lesson.id, status: lesson.status },
  });

  return NextResponse.json({ ok: true, lesson }, { status: 201 });
}
