import { redirect } from "next/navigation";
import { SettingsWorkspace } from "@/components/factory/settings-workspace";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/session";
import { accessibleProjectsWhere, getAccessibleRunners } from "@/lib/team-access";
import { isRunnerOnline, safeJsonParse } from "@/lib/workspace-data";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; project?: string }>;
}) {
  const session = await getCurrentSession();
  if (!session) redirect("/login");

  const sp = await searchParams;
  const [runners, tokens, projects, githubRepoCount] = await Promise.all([
    getAccessibleRunners(session.user.id, { githubLogin: session.user.githubLogin }),
    prisma.apiToken.findMany({
      where: { userId: session.user.id, revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        label: true,
        prefix: true,
        lastUsedAt: true,
        createdAt: true,
      },
    }),
    prisma.project.findMany({
      where: accessibleProjectsWhere(session.user.id, session.user.githubLogin),
      orderBy: { updatedAt: "desc" },
      include: {
        user: { select: { githubLogin: true } },
        _count: { select: { members: true } },
      },
    }),
    prisma.githubRepo.count({ where: { userId: session.user.id } }),
  ]);

  return (
    <SettingsWorkspace
      initialTab={sp.tab || "general"}
      initialProjectId={sp.project || undefined}
      currentUserId={session.user.id}
      user={{
        name: session.user.name,
        githubLogin: session.user.githubLogin,
        email: session.user.email,
        avatarUrl: session.user.avatarUrl,
      }}
      isLocalMode={session.isLocalMode}
      hasGithubOauth={Boolean(session.githubAccessToken)}
      projectCount={projects.length}
      githubRepoCount={githubRepoCount}
      teamProjects={projects.map((p) => ({
        id: p.id,
        name: p.name,
        isOwner: p.userId === session.user.id,
        ownerLogin: p.user?.githubLogin ?? "local",
        memberCount: p._count.members + 1,
      }))}
      runners={runners.map((r) => {
        const discovered = safeJsonParse<unknown[]>(r.discoveredProjectsJson, []);
        return {
          id: r.id,
          name: r.name,
          hostname: r.hostname,
          os: r.os,
          allowedRoots: safeJsonParse<string[]>(r.allowedRootsJson, []),
          workspaceDir: r.workspaceDir ?? null,
          discoveredCount: Array.isArray(discovered) ? discovered.length : 0,
          cliVersion: r.cliVersion ?? null,
          visibility: r.visibility === "team" ? "team" : "personal",
          isOwn: r.userId === session.user.id,
          ownerLogin: r.user?.githubLogin ?? session.user.githubLogin,
          status: isRunnerOnline(r.status, r.lastHeartbeatAt) ? "online" : "offline",
          maxConcurrency: r.maxConcurrency,
          activeRuns: r.activeRuns,
          lastHeartbeatAt: r.lastHeartbeatAt.toISOString(),
        };
      })}
      initialTokens={tokens.map((t) => ({
        id: t.id,
        label: t.label,
        prefix: t.prefix,
        lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
        createdAt: t.createdAt.toISOString(),
      }))}
    />
  );
}
