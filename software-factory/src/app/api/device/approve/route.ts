import { type NextRequest, NextResponse } from "next/server";
import { randomToken, sealToken, sha256Hex } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/session";

function getSealSecret(): string {
  return process.env.SESSION_SECRET || "software-factory-local-dev-secret";
}

export async function POST(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Please sign in first" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const userCode =
    typeof body.userCode === "string" ? body.userCode.trim().toUpperCase() : "";
  const decision = body.decision === "deny" ? "deny" : "approve";

  if (!userCode) {
    return NextResponse.json({ error: "Verification code is required" }, { status: 400 });
  }

  const record = await prisma.deviceAuthCode.findUnique({ where: { userCode } });
  if (!record) {
    return NextResponse.json({ error: "Code not found. Restart `sf setup` on your machine." }, { status: 404 });
  }

  const now = new Date();
  if (record.expiresAt < now) {
    await prisma.deviceAuthCode.update({
      where: { id: record.id },
      data: { status: "expired" },
    });
    return NextResponse.json({ error: "This code has expired. Restart `sf setup`." }, { status: 410 });
  }

  if (record.status !== "pending") {
    return NextResponse.json(
      { error: `Code already ${record.status}` },
      { status: 409 },
    );
  }

  if (decision === "deny") {
    await prisma.deviceAuthCode.update({
      where: { id: record.id },
      data: { status: "denied", userId: session.user.id },
    });
    return NextResponse.json({ ok: true, status: "denied" });
  }

  // Mint a dedicated machine-scoped API token and hand it off once via AES-256-GCM.
  const plain = `sf_${randomToken(24)}`;
  const prefix = plain.slice(0, 11);
  const label = `Runner: ${record.runnerName}`.slice(0, 80);

  await prisma.$transaction(async (tx) => {
    await tx.apiToken.create({
      data: {
        userId: session.user.id,
        label,
        prefix,
        tokenHash: sha256Hex(plain),
      },
    });
    await tx.deviceAuthCode.update({
      where: { id: record.id },
      data: {
        status: "approved",
        userId: session.user.id,
        plainTokenEnc: sealToken(plain, getSealSecret()),
        approvedAt: now,
      },
    });
  });

  return NextResponse.json({
    ok: true,
    status: "approved",
    runnerName: record.runnerName,
    user: {
      githubLogin: session.user.githubLogin,
      name: session.user.name,
    },
  });
}
