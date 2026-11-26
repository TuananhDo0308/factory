import { type NextRequest, NextResponse } from "next/server";
import { randomToken, sha256Hex } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/session";

export async function GET() {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tokens = await prisma.apiToken.findMany({
    where: { userId: session.user.id, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      label: true,
      prefix: true,
      lastUsedAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    tokens: tokens.map((t) => ({
      ...t,
      lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
    })),
  });
}

export async function POST(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let label = "CLI Token";
  try {
    const body = (await request.json()) as { label?: unknown };
    if (typeof body?.label === "string" && body.label.trim() !== "") {
      label = body.label.trim().slice(0, 80);
    }
  } catch {
    // Default label is fine when body is empty.
  }

  const rawToken = `sf_${randomToken(28)}`;
  const created = await prisma.apiToken.create({
    data: {
      userId: session.user.id,
      label,
      prefix: rawToken.slice(0, 11),
      tokenHash: sha256Hex(rawToken),
    },
    select: {
      id: true,
      label: true,
      prefix: true,
      lastUsedAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json(
    {
      token: rawToken,
      record: {
        ...created,
        lastUsedAt: created.lastUsedAt?.toISOString() ?? null,
        createdAt: created.createdAt.toISOString(),
      },
    },
    { status: 201 },
  );
}
