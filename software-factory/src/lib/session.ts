import { cookies } from "next/headers";
import { sha256Hex, unsealToken } from "@/lib/crypto";
import { getOAuthConfig, type GitHubRepoItem } from "@/lib/github";
import { prisma } from "@/lib/prisma";

export const SESSION_COOKIE = "sf_session";
export const STATE_COOKIE = "sf_oauth_state";
export const SIGNED_OUT_COOKIE = "sf_signed_out";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const STATE_MAX_AGE_SECONDS = 600;

export function isLocalAutoAuthEnabled(): boolean {
  return false;
}

export function getCookieBase() {
  const { publicUrl } = getOAuthConfig();
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: publicUrl.startsWith("https://"),
  };
}

export async function ensureLocalOperatorUser() {
  // Prefer an existing user in local SQLite so local projects remain visible,
  // otherwise create the default Local Operator account.
  const existing = await prisma.user.findFirst({
    orderBy: [{ updatedAt: "desc" }],
  });
  if (existing) return existing;

  return prisma.user.upsert({
    where: { githubId: 0 },
    update: {},
    create: {
      githubId: 0,
      githubLogin: "local",
      name: "Local Operator",
      email: "local@factory.local",
      avatarUrl: null,
    },
  });
}

export async function getCurrentSession() {
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(SESSION_COOKIE)?.value;

  if (rawToken) {
    const sessionId = sha256Hex(rawToken);
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: { user: true },
    });

    if (session && session.expiresAt.getTime() > Date.now()) {
      const { clientSecret } = getOAuthConfig();
      let githubAccessToken: string | null = null;
      try {
        githubAccessToken = unsealToken(session.githubAccessToken, clientSecret);
      } catch {
        githubAccessToken = null;
      }

      return {
        sessionId: session.id,
        user: session.user,
        githubAccessToken,
        isLocalMode: false,
      };
    }

    if (session) {
      await prisma.session.delete({ where: { id: sessionId } }).catch(() => {});
    }
  }

  return null;
}

export async function syncUserGitHubRepos(userId: string, repos: GitHubRepoItem[]) {
  const now = new Date();
  const incomingIds = repos.map((r) => r.githubRepoId);

  await prisma.$transaction(async (tx) => {
    if (incomingIds.length > 0) {
      await tx.githubRepo.deleteMany({
        where: { userId, githubRepoId: { notIn: incomingIds } },
      });
    } else {
      await tx.githubRepo.deleteMany({ where: { userId } });
    }

    for (const repo of repos) {
      await tx.githubRepo.upsert({
        where: {
          userId_githubRepoId: { userId, githubRepoId: repo.githubRepoId },
        },
        update: {
          fullName: repo.fullName,
          name: repo.name,
          owner: repo.owner,
          isPrivate: repo.isPrivate,
          htmlUrl: repo.htmlUrl,
          cloneUrl: repo.cloneUrl,
          description: repo.description,
          defaultBranch: repo.defaultBranch,
          language: repo.language,
          pushedAt: repo.pushedAt,
          syncedAt: now,
        },
        create: {
          userId,
          githubRepoId: repo.githubRepoId,
          fullName: repo.fullName,
          name: repo.name,
          owner: repo.owner,
          isPrivate: repo.isPrivate,
          htmlUrl: repo.htmlUrl,
          cloneUrl: repo.cloneUrl,
          description: repo.description,
          defaultBranch: repo.defaultBranch,
          language: repo.language,
          pushedAt: repo.pushedAt,
          syncedAt: now,
        },
      });
    }
  });
}
