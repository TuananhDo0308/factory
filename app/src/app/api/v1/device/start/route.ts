import { randomBytes } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { randomToken, sha256Hex } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateUserCode(): string {
  const bytes = randomBytes(4);
  let suffix = "";
  for (let i = 0; i < 4; i += 1) {
    suffix += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return `FCTY-${suffix}`;
}

function getRequestOrigin(request: NextRequest): string {
  const explicit = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_PUBLIC_URL || process.env.PUBLIC_URL || "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const fwdHost = request.headers.get("x-forwarded-host");
  const fwdProto = request.headers.get("x-forwarded-proto") || "https";
  // Request headers become the sign-in link shown to the user: accept only a plain scheme, host and port.
  const safe = (origin: string) => (/^https?:\/\/[a-z0-9.-]+(?::\d{1,5})?$/i.test(origin) ? origin : null);
  if (fwdHost) {
    const fromProxy = safe(`${fwdProto === "http" ? "http" : "https"}://${fwdHost}`);
    if (fromProxy) return fromProxy;
  }
  const host = request.headers.get("host");
  if (host) {
    const proto = host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
    const fromHost = safe(`${proto}://${host}`);
    if (fromHost) return fromHost;
  }
  return request.nextUrl.origin;
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    const parsed = await request.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    // Allow empty body.
  }

  const hostname =
    typeof body.hostname === "string" && body.hostname.trim()
      ? body.hostname.trim().slice(0, 120)
      : "local-machine";
  const runnerName =
    typeof body.runnerName === "string" && body.runnerName.trim()
      ? body.runnerName.trim().slice(0, 100)
      : hostname;
  const os =
    typeof body.os === "string" && body.os.trim() ? body.os.trim().slice(0, 40) : "darwin";

  const deviceCode = randomToken(32);
  const deviceCodeHash = sha256Hex(deviceCode);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  // Clean up expired rows opportunistically.
  await prisma.deviceAuthCode
    .deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 3600_000) } } })
    .catch(() => {});

  let userCode = generateUserCode();
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const clash = await prisma.deviceAuthCode.findUnique({ where: { userCode } });
    if (!clash) break;
    userCode = generateUserCode();
  }

  await prisma.deviceAuthCode.create({
    data: {
      deviceCodeHash,
      userCode,
      runnerName,
      hostname,
      os,
      status: "pending",
      expiresAt,
    },
  });

  const origin = getRequestOrigin(request);
  const verificationUrl = `${origin}/device?code=${encodeURIComponent(userCode)}`;

  return NextResponse.json(
    {
      ok: true,
      deviceCode,
      userCode,
      verificationUrl,
      expiresInSeconds: 300,
      intervalSeconds: 2,
    },
    { status: 201 },
  );
}
