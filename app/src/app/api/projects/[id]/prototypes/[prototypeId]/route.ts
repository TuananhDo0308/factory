import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { emitFactoryEvent } from "@/lib/events";
import { prisma } from "@/lib/prisma";
import { serializePrototype } from "@/lib/prototype-server";
import { getProjectAccess } from "@/lib/team-access";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string; prototypeId: string }> },
) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, prototypeId } = await context.params;
  const access = await getProjectAccess(auth.user, id);
  if (!access) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const row = await prisma.projectPrototype.findFirst({
    where: { id: prototypeId, projectId: access.project.id },
  });
  if (!row) return NextResponse.json({ error: "Prototype not found" }, { status: 404 });

  return NextResponse.json({ ok: true, prototype: serializePrototype(row) });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; prototypeId: string }> },
) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, prototypeId } = await context.params;
  const access = await getProjectAccess(auth.user, id);
  if (!access) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (!access.canWrite) {
    return NextResponse.json({ error: "Viewer role cannot edit prototypes" }, { status: 403 });
  }

  const existing = await prisma.projectPrototype.findFirst({
    where: { id: prototypeId, projectId: access.project.id },
  });
  if (!existing) return NextResponse.json({ error: "Prototype not found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (body.binding === "flow" || body.binding === "look") {
    data.binding = body.binding;
  }
  if (body.status === "draft" || body.status === "approved" || body.status === "superseded") {
    data.status = body.status;
  }
  if (str(body.title)) {
    data.title = str(body.title).slice(0, 180);
  }
  if (Array.isArray(body.issueKeys)) {
    const cleanKeys = Array.from(
      new Set(body.issueKeys.map((k) => str(k)).filter(Boolean)),
    );
    data.issueKeysJson = JSON.stringify(cleanKeys);
  }

  const updated = await prisma.projectPrototype.update({
    where: { id: existing.id },
    data,
  });

  emitFactoryEvent({
    type: "prototype:updated",
    userId: auth.user.id,
    projectId: access.project.id,
    runId: updated.runId,
    payload: {
      prototypeId: updated.id,
      slug: updated.slug,
      binding: updated.binding,
      status: updated.status,
    },
  });

  return NextResponse.json({ ok: true, prototype: serializePrototype(updated) });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; prototypeId: string }> },
) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, prototypeId } = await context.params;
  const access = await getProjectAccess(auth.user, id);
  if (!access) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (!access.canWrite) {
    return NextResponse.json({ error: "Viewer role cannot delete prototypes" }, { status: 403 });
  }

  const existing = await prisma.projectPrototype.findFirst({
    where: { id: prototypeId, projectId: access.project.id },
  });
  if (!existing) return NextResponse.json({ error: "Prototype not found" }, { status: 404 });

  await prisma.projectPrototype.delete({ where: { id: existing.id } });
  emitFactoryEvent({
    type: "prototype:updated",
    userId: auth.user.id,
    projectId: access.project.id,
    runId: existing.runId,
    payload: { prototypeId: existing.id, deleted: true },
  });

  return NextResponse.json({ ok: true });
}
