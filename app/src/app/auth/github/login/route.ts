import { type NextRequest, NextResponse } from "next/server";
import { randomToken } from "@/lib/crypto";
import { buildAuthorizeUrl, getOAuthConfig } from "@/lib/github";
import { getCookieBase, STATE_COOKIE, STATE_MAX_AGE_SECONDS } from "@/lib/session";

const NEXT_COOKIE = "sf_oauth_next";

export async function GET(request: NextRequest) {
  const { configured, publicUrl } = getOAuthConfig();
  if (!configured) {
    return NextResponse.redirect(`${publicUrl}/login?error=oauth_not_configured`, 302);
  }

  const nextParam = (request.nextUrl.searchParams.get("next") || "").trim();
  const safeNext = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "";

  const state = randomToken(24);
  const response = NextResponse.redirect(buildAuthorizeUrl(state), 302);
  response.cookies.set(STATE_COOKIE, state, {
    ...getCookieBase(),
    maxAge: STATE_MAX_AGE_SECONDS,
  });
  if (safeNext) {
    response.cookies.set(NEXT_COOKIE, safeNext, {
      ...getCookieBase(),
      maxAge: STATE_MAX_AGE_SECONDS,
    });
  }
  return response;
}
