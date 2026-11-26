import { type NextRequest, NextResponse } from "next/server";
import { sha256Hex, unsealToken } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";

function getSealSecret(): string {
  return process.env.SESSION_SECRET || "software-factory-local-dev-secret";
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const deviceCode = typeof body.deviceCode === "string" ? body.deviceCode.trim() : "";
  if (!deviceCode) {
    return NextResponse.json({ error: "deviceCode is required" }, { status: 400 });
  }

  const record = await prisma.deviceAuthCode.findUnique({
    where: { deviceCodeHash: sha256Hex(deviceCode) },
  });
  if (!record) {
    return NextResponse.json({ status: "not_found", error: "Invalid device code" }, { status: 404 });
  }

  const now = new Date();
  if (record.expiresAt < now && record.status === "pending") {
    await prisma.deviceAuthCode.update({
      where: { id: record.id },
      data: { status: "expired" },
    });
    return NextResponse.json({ status: "expired" });
  }

  if (record.status === "pending") {
    return NextResponse.json({ status: "pending" });
  }

  if (record.status === "denied" || record.status === "expired" || record.status === "consumed") {
    return NextResponse.json({ status: record.status });
  }

  if (record.status === "approved" && record.plainTokenEnc && record.userId) {
    const token = unsealToken(record.plainTokenEnc, getSealSecret());
    // One-time atomic handoff: wipe encrypted token immediately upon retrieval.
    await prisma.deviceAuthCode.update({
      where: { id: record.id },
      data: {
        status: "consumed",
        plainTokenEnc: null,
        consumedAt: now,
      },
    });
    const user = await prisma.user.findUnique({
      where: { id: record.userId },
      select: { githubLogin: true, name: true },
    });
    return NextResponse.json({
      status: "approved",
      token,
      user: user ?? { githubLogin: "operator", name: "Operator" },
    });
  }

  return NextResponse.json({ status: "expired" });
}
