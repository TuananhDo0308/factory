import { NextResponse } from "next/server";
import {
  ensureLocalOperatorUser,
  getCookieBase,
  isLocalAutoAuthEnabled,
  SIGNED_OUT_COOKIE,
} from "@/lib/session";

export async function POST() {
  if (!isLocalAutoAuthEnabled()) {
    return NextResponse.json(
      { error: "Local mode is disabled (SF_REQUIRE_OAUTH=true)" },
      { status: 403 },
    );
  }
  const user = await ensureLocalOperatorUser();
  const cookieBase = getCookieBase();
  const res = NextResponse.json({
    ok: true,
    user: { id: user.id, githubLogin: user.githubLogin, name: user.name },
  });
  res.cookies.delete({ name: SIGNED_OUT_COOKIE, path: cookieBase.path });
  return res;
}
