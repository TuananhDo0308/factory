import { NextResponse } from "next/server";
import { emitFactoryEvent } from "@/lib/events";
import { prisma } from "@/lib/prisma";
import { getProjectDashboardData } from "@/lib/project-stats";
import { getCurrentSession } from "@/lib/session";
import { getAccessibleRunners, getProjectAccess } from "@/lib/team-access";

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
    defaultRunnerId?: unknown;
    githubFullName?: unknown;
  } | null;

  const hasDefaultRunnerId =
    body !== null && "defaultRunnerId" in body && body.defaultRunnerId !== undefined;
  const hasGithubFullName =
    body !== null && "githubFullName" in body && body.githubFullName !== undefined;

  if (!hasDefaultRunnerId && !hasGithubFullName) {
    return NextResponse.json(
      { error: "Provide defaultRunnerId or githubFullName to update" },
      { status: 400 },
    );
  }

  const updateData: { defaultRunnerId?: string | null; githubFullName?: string | null } = {};

  if (hasGithubFullName) {
    const raw = typeof body?.githubFullName === "string" ? body.githubFullName.trim() : "";
    if (raw && !/^[\w.-]+\/[\w.-]+$/.test(raw)) {
      return NextResponse.json(
        { error: "githubFullName must look like owner/name" },
        { status: 400 },
      );
    }
    updateData.githubFullName = raw || null;
  }

  if (hasDefaultRunnerId) {
    const rawRunner = body?.defaultRunnerId;
    if (rawRunner === null || rawRunner === "") {
      updateData.defaultRunnerId = null;
    } else if (typeof rawRunner === "string" && rawRunner.trim()) {
      const candidateId = rawRunner.trim();
      const accessible = await getAccessibleRunners(session.user.id, {
        projectId: access.project.id,
        githubLogin: session.user.githubLogin,
      });
      const matched = accessible.find((r) => r.id === candidateId);
      if (!matched) {
        return NextResponse.json(
          { error: "Selected daemon is not accessible for this project" },
          { status: 404 },
        );
      }
      updateData.defaultRunnerId = matched.id;
    } else {
      return NextResponse.json(
        { error: "defaultRunnerId must be a runner ID or null" },
        { status: 400 },
      );
    }
  }

  const updated = await prisma.project.update({
    where: { id: access.project.id },
    data: updateData,
    select: { id: true, defaultRunnerId: true, githubFullName: true },
  });

  emitFactoryEvent({
    type: "project:updated",
    userId: access.project.userId,
    projectId: access.project.id,
    payload: {
      defaultRunnerId: updated.defaultRunnerId,
      githubFullName: updated.githubFullName,
    },
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
