import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { emitFactoryEvent } from "@/lib/events";
import { prisma } from "@/lib/prisma";
import { normalizeHandle } from "@/lib/team-access";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const invite = await prisma.projectInvite.findUnique({
    where: { token },
    include: {
      project: {
        select: {
          id: true,
          name: true,
          engine: true,
          user: { select: { githubLogin: true, name: true } },
        },
      },
    },
  });
  if (!invite) return NextResponse.json({ error: "Invite not found" }, { status: 404 });

  const expired = Boolean(invite.expiresAt && invite.expiresAt < new Date());
  const revoked = Boolean(invite.revokedAt);

  return NextResponse.json({
    ok: true,
    invite: {
      projectId: invite.project.id,
      projectName: invite.project.name,
      engine: invite.project.engine,
      ownerLogin: invite.project.user.githubLogin,
      ownerName: invite.project.user.name,
      role: invite.role,
      expired,
      revoked,
    },
  });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { token } = await context.params;
  const invite = await prisma.projectInvite.findUnique({
    where: { token },
    include: { project: true },
  });
  if (!invite) return NextResponse.json({ error: "Invite link not found" }, { status: 404 });
  if (invite.revokedAt) {
    return NextResponse.json({ error: "This invite link has been revoked" }, { status: 410 });
  }
  if (invite.expiresAt && invite.expiresAt < new Date()) {
    return NextResponse.json({ error: "This invite link has expired" }, { status: 410 });
  }

  if (invite.project.userId === auth.user.id) {
    return NextResponse.json({
      ok: true,
      projectId: invite.project.id,
      role: "owner",
      alreadyMember: true,
    });
  }

  const handle = normalizeHandle(auth.user.githubLogin || auth.user.id);
  const member = await prisma.$transaction(async (tx) => {
    const upserted = await tx.projectMember.upsert({
      where: {
        projectId_githubLogin: {
          projectId: invite.project.id,
          githubLogin: handle,
        },
      },
      update: {
        userId: auth.user.id,
        role: invite.role,
      },
      create: {
        projectId: invite.project.id,
        userId: auth.user.id,
        githubLogin: handle,
        role: invite.role,
        invitedById: invite.createdById,
      },
    });
    await tx.projectInvite.update({
      where: { id: invite.id },
      data: { usesCount: { increment: 1 } },
    });
    return upserted;
  });

  emitFactoryEvent({
    type: "project:updated",
    userId: invite.project.userId,
    projectId: invite.project.id,
  });

  return NextResponse.json({
    ok: true,
    projectId: invite.project.id,
    role: member.role,
  });
}
