import { NextResponse } from "next/server";
import { emitFactoryEvent } from "@/lib/events";
import { prisma } from "@/lib/prisma";
import { getProjectDashboardData } from "@/lib/project-stats";
import { getCurrentSession } from "@/lib/session";
import { getProjectAccess } from "@/lib/team-access";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const data = await getProjectDashboardData(session.user.id, id);
  if (!data) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  return NextResponse.json(data);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const access = await getProjectAccess(session.user, id);
  if (!access) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (!access.canWrite) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    initStatus?: unknown;
  } | null;

  const initStatusRaw = typeof body?.initStatus === "string" ? body.initStatus.trim() : "";
  if (initStatusRaw !== "complete" && initStatusRaw !== "none") {
    return NextResponse.json(
      { error: "initStatus must be 'complete' or 'none'" },
      { status: 400 },
    );
  }

  const now = new Date();
  const updated = await prisma.project.update({
    where: { id: access.project.id },
    data: { initStatus: initStatusRaw },
    select: { id: true, initStatus: true },
  });

  if (initStatusRaw === "complete") {
    await prisma.factoryRun.updateMany({
      where: {
        projectId: access.project.id,
        mode: "init",
        status: { in: ["queued", "running", "awaiting_input"] },
      },
      data: {
        status: "passed",
        currentPhase: "Verdict",
        summary: "Project Factory Init marked complete.",
        finishedAt: now,
        lastHeartbeatAt: now,
      },
    });
  }

  emitFactoryEvent({
    type: "project:updated",
    userId: access.project.userId,
    projectId: access.project.id,
    payload: { initStatus: updated.initStatus },
  });

  return NextResponse.json({ ok: true, project: updated });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const existing = await prisma.project.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  await prisma.project.delete({ where: { id: existing.id } });
  return NextResponse.json({ ok: true });
}
