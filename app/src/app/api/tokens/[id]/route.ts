import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/session";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const existing = await prisma.apiToken.findFirst({
    where: { id, userId: session.user.id, revokedAt: null },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Token not found" }, { status: 404 });
  }

  await prisma.apiToken.update({
    where: { id: existing.id },
    data: { revokedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
