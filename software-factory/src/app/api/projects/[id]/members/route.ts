import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { emitFactoryEvent } from "@/lib/events";
import { prisma } from "@/lib/prisma";
import {
  getAccessibleRunners,
  getProjectAccess,
  normalizeHandle,
} from "@/lib/team-access";

const VALID_ROLES = new Set(["member", "viewer"]);

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const access = await getProjectAccess(auth.user, id);
  if (!access) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const [owner, members, invites, runners] = await Promise.all([
    prisma.user.findUnique({
      where: { id: access.project.userId },
      select: { id: true, githubLogin: true, name: true, avatarUrl: true },
    }),
    prisma.projectMember.findMany({
      where: { projectId: access.project.id },
      include: {
        user: { select: { id: true, githubLogin: true, name: true, avatarUrl: true } },
      },
      orderBy: { joinedAt: "asc" },
    }),
    access.isOwner
      ? prisma.projectInvite.findMany({
          where: { projectId: access.project.id, revokedAt: null },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
    getAccessibleRunners(auth.user.id, {
      projectId: access.project.id,
      githubLogin: auth.user.githubLogin,
    }),
  ]);

  const now = Date.now();
  return NextResponse.json({
    ok: true,
    myRole: access.role,
    owner,
    members: members.map((m) => ({
      id: m.id,
      userId: m.userId,
      githubLogin: m.user?.githubLogin ?? m.githubLogin,
      name: m.user?.name ?? null,
      avatarUrl: m.user?.avatarUrl ?? null,
      role: m.role,
      pending: !m.userId,
      joinedAt: m.joinedAt.toISOString(),
    })),
    invites: invites.map((inv) => ({
      id: inv.id,
      token: inv.token,
      role: inv.role,
      usesCount: inv.usesCount,
      expiresAt: inv.expiresAt?.toISOString() ?? null,
      createdAt: inv.createdAt.toISOString(),
    })),
    runners: runners.map((r) => ({
      id: r.id,
      name: r.name,
      hostname: r.hostname,
      os: r.os,
      visibility: r.visibility,
      isOwn: r.userId === auth.user.id,
      ownerLogin: r.user?.githubLogin ?? "local",
      status:
        r.status === "online" && now - r.lastHeartbeatAt.getTime() < 65_000
          ? "online"
          : "offline",
      lastHeartbeatAt: r.lastHeartbeatAt.toISOString(),
    })),
  });
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
  if (!access.isOwner) {
    return NextResponse.json(
      { error: "Only the project owner can add team members" },
      { status: 403 },
    );
  }

  let body: { githubLogin?: unknown; role?: unknown };
  try {
    body = (await request.json()) as { githubLogin?: unknown; role?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const handle = normalizeHandle(typeof body.githubLogin === "string" ? body.githubLogin : "");
  if (!handle || !/^[a-z0-9](?:[a-z0-9-]{0,38})$/i.test(handle)) {
    return NextResponse.json(
      { error: "Enter a valid GitHub username (e.g. octocat)" },
      { status: 400 },
    );
  }
  const role =
    typeof body.role === "string" && VALID_ROLES.has(body.role) ? body.role : "member";

  const owner = await prisma.user.findUnique({
    where: { id: access.project.userId },
    select: { githubLogin: true },
  });
  if (owner && normalizeHandle(owner.githubLogin) === handle) {
    return NextResponse.json({ error: "Project owner is already in the team" }, { status: 409 });
  }

  // Case-insensitive lookup for existing user in SQLite
  const allMatching = await prisma.user.findMany({
    select: { id: true, githubLogin: true, name: true, avatarUrl: true },
  });
  const matchedUser = allMatching.find((u) => normalizeHandle(u.githubLogin) === handle) ?? null;

  const member = await prisma.projectMember.upsert({
    where: {
      projectId_githubLogin: {
        projectId: access.project.id,
        githubLogin: handle,
      },
    },
    update: {
      role,
      userId: matchedUser?.id ?? undefined,
    },
    create: {
      projectId: access.project.id,
      githubLogin: handle,
      userId: matchedUser?.id ?? null,
      role,
      invitedById: auth.user.id,
    },
    include: {
      user: { select: { id: true, githubLogin: true, name: true, avatarUrl: true } },
    },
  });

  emitFactoryEvent({
    type: "project:updated",
    userId: auth.user.id,
    projectId: access.project.id,
  });

  return NextResponse.json(
    {
      ok: true,
      member: {
        id: member.id,
        userId: member.userId,
        githubLogin: member.user?.githubLogin ?? member.githubLogin,
        name: member.user?.name ?? null,
        avatarUrl: member.user?.avatarUrl ?? null,
        role: member.role,
        pending: !member.userId,
        joinedAt: member.joinedAt.toISOString(),
      },
    },
    { status: 201 },
  );
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const access = await getProjectAccess(auth.user, id);
  if (!access) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (!access.isOwner) {
    return NextResponse.json({ error: "Only the project owner can change roles" }, { status: 403 });
  }

  let body: { memberId?: unknown; role?: unknown };
  try {
    body = (await request.json()) as { memberId?: unknown; role?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const memberId = typeof body.memberId === "string" ? body.memberId.trim() : "";
  const role = typeof body.role === "string" && VALID_ROLES.has(body.role) ? body.role : "";
  if (!memberId || !role) {
    return NextResponse.json({ error: "memberId and valid role are required" }, { status: 400 });
  }

  const existing = await prisma.projectMember.findFirst({
    where: { id: memberId, projectId: access.project.id },
  });
  if (!existing) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  const updated = await prisma.projectMember.update({
    where: { id: existing.id },
    data: { role },
  });

  emitFactoryEvent({
    type: "project:updated",
    userId: auth.user.id,
    projectId: access.project.id,
  });

  return NextResponse.json({ ok: true, role: updated.role });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const access = await getProjectAccess(auth.user, id);
  if (!access) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  let memberId = request.nextUrl.searchParams.get("memberId")?.trim() || "";
  if (!memberId) {
    try {
      const body = (await request.json()) as { memberId?: unknown };
      if (typeof body.memberId === "string") memberId = body.memberId.trim();
    } catch {
      // ignore
    }
  }
  if (!memberId) {
    return NextResponse.json({ error: "memberId is required" }, { status: 400 });
  }

  const existing = await prisma.projectMember.findFirst({
    where: { id: memberId, projectId: access.project.id },
  });
  if (!existing) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  const isSelf =
    existing.userId === auth.user.id ||
    normalizeHandle(existing.githubLogin) === normalizeHandle(auth.user.githubLogin);
  if (!access.isOwner && !isSelf) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.projectMember.delete({ where: { id: existing.id } });
  emitFactoryEvent({
    type: "project:updated",
    userId: auth.user.id,
    projectId: access.project.id,
  });

  return NextResponse.json({ ok: true });
}
