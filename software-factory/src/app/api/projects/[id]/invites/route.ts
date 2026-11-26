import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { randomToken } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import { getProjectAccess } from "@/lib/team-access";

const VALID_ROLES = new Set(["member", "viewer"]);

function getOrigin(request: NextRequest): string {
  const explicit = (process.env.NEXT_PUBLIC_APP_URL || process.env.PUBLIC_URL || "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const fwdHost = request.headers.get("x-forwarded-host");
  const fwdProto = request.headers.get("x-forwarded-proto") || "https";
  if (fwdHost) return `${fwdProto}://${fwdHost}`;
  return request.nextUrl.origin;
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
      { error: "Only the project owner can generate invite links" },
      { status: 403 },
    );
  }

  let body: { role?: unknown; expiresInDays?: unknown } = {};
  try {
    body = (await request.json()) as { role?: unknown; expiresInDays?: unknown };
  } catch {
    // defaults
  }

  const role =
    typeof body.role === "string" && VALID_ROLES.has(body.role) ? body.role : "member";
  const days = Math.max(1, Math.min(30, Number(body.expiresInDays) || 7));
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const token = randomToken(18);

  const invite = await prisma.projectInvite.create({
    data: {
      projectId: access.project.id,
      token,
      role,
      createdById: auth.user.id,
      expiresAt,
    },
  });

  const inviteUrl = `${getOrigin(request)}/invite/${invite.token}`;

  return NextResponse.json(
    {
      ok: true,
      invite: {
        id: invite.id,
        token: invite.token,
        role: invite.role,
        usesCount: invite.usesCount,
        expiresAt: invite.expiresAt?.toISOString() ?? null,
        createdAt: invite.createdAt.toISOString(),
      },
      inviteUrl,
    },
    { status: 201 },
  );
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
  if (!access.isOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const inviteId = request.nextUrl.searchParams.get("inviteId")?.trim() || "";
  if (!inviteId) {
    return NextResponse.json({ error: "inviteId is required" }, { status: 400 });
  }

  await prisma.projectInvite.updateMany({
    where: { id: inviteId, projectId: access.project.id },
    data: { revokedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
