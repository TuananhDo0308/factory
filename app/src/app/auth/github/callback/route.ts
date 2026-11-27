import { type NextRequest, NextResponse } from "next/server";
import { randomToken, sealToken, sha256Hex } from "@/lib/crypto";
import {
  exchangeGitHubCode,
  fetchGitHubUser,
  getOAuthConfig,
  listGitHubRepos,
} from "@/lib/github";
import { prisma } from "@/lib/prisma";
import {
  getCookieBase,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  STATE_COOKIE,
  syncUserGitHubRepos,
} from "@/lib/session";
import { linkPendingMemberships } from "@/lib/team-access";

export async function GET(request: NextRequest) {
  const { configured, clientSecret, publicUrl } = getOAuthConfig();
  if (!configured) {
    return NextResponse.redirect(`${publicUrl}/login?error=oauth_not_configured`, 302);
  }

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const oauthError = request.nextUrl.searchParams.get("error");
  const expectedState = request.cookies.get(STATE_COOKIE)?.value;

  if (oauthError) {
    return NextResponse.redirect(
      `${publicUrl}/login?error=${encodeURIComponent(oauthError)}`,
      302,
    );
  }
  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(`${publicUrl}/login?error=invalid_state`, 302);
  }

  try {
    const accessToken = await exchangeGitHubCode(code);
    const profile = await fetchGitHubUser(accessToken);

    const user = await prisma.user.upsert({
      where: { githubId: profile.githubId },
      update: {
        githubLogin: profile.login,
        name: profile.name,
        email: profile.email,
        avatarUrl: profile.avatarUrl,
      },
      create: {
        githubId: profile.githubId,
        githubLogin: profile.login,
        name: profile.name,
        email: profile.email,
        avatarUrl: profile.avatarUrl,
      },
    });

    // Link any pending ProjectMember invitations matching this GitHub handle.
    await linkPendingMemberships(user);

    // Best-effort initial sync of accessible GitHub repositories.
    try {
      const repos = await listGitHubRepos(accessToken);
      await syncUserGitHubRepos(user.id, repos);
    } catch {
      // User can retry sync from the dashboard if GitHub rate-limits or fails temporarily.
    }

    const rawSessionToken = randomToken(32);
    const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
    await prisma.session.create({
      data: {
        id: sha256Hex(rawSessionToken),
        userId: user.id,
        githubAccessToken: sealToken(accessToken, clientSecret),
        expiresAt,
      },
    });

    const cookieBase = getCookieBase();
    const rawNext = request.cookies.get("sf_oauth_next")?.value || "";
    const safeNext = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";
    const response = NextResponse.redirect(`${publicUrl}${safeNext}`, 302);
    response.cookies.delete({ name: STATE_COOKIE, path: cookieBase.path });
    response.cookies.delete({ name: "sf_oauth_next", path: cookieBase.path });
    response.cookies.set(SESSION_COOKIE, rawSessionToken, {
      ...cookieBase,
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "oauth_failed";
    return NextResponse.redirect(
      `${publicUrl}/login?error=${encodeURIComponent(message)}`,
      302,
    );
  }
}
