import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { emitFactoryEvent } from "@/lib/events";
import { prisma } from "@/lib/prisma";

const VALID_STATUSES = new Set(["proposed", "accepted", "rejected", "done"]);

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const existing = await prisma.lesson.findFirst({
    where: { id, userId: auth.user.id },
  });
  if (!existing) return NextResponse.json({ error: "Lesson not found" }, { status: 404 });

  let body: { status?: unknown; proposal?: unknown };
  try {
    body = (await request.json()) as { status?: unknown; proposal?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (typeof body.status === "string" && VALID_STATUSES.has(body.status)) {
    data.status = body.status;
  }
  if (typeof body.proposal === "string" && body.proposal.trim()) {
    data.proposal = body.proposal.trim();
  }

  const updated = await prisma.lesson.update({ where: { id: existing.id }, data });
  emitFactoryEvent({
    type: "lesson:updated",
    userId: auth.user.id,
    projectId: updated.projectId,
    payload: { lessonId: updated.id, status: updated.status },
  });

  return NextResponse.json({ ok: true, lesson: updated });
}
