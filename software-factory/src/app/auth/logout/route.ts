import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { sha256Hex } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import {
  getCookieBase,
  SESSION_COOKIE,
  SIGNED_OUT_COOKIE,
} from "@/lib/session";

export async function POST() {
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(SESSION_COOKIE)?.value;
  if (rawToken) {
    await prisma.session
      .deleteMany({ where: { id: sha256Hex(rawToken) } })
      .catch(() => {});
  }

  const cookieBase = getCookieBase();
  const response = NextResponse.json({ ok: true });
  response.cookies.delete({ name: SESSION_COOKIE, path: cookieBase.path });
  response.cookies.set(SIGNED_OUT_COOKIE, "1", {
    ...cookieBase,
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}
