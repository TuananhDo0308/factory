import { notFound, redirect } from "next/navigation";
import { ProjectWorkspace } from "@/components/factory/project-workspace";
import { getProjectBoardSnapshot } from "@/lib/board-data";
import { getProjectContextLake } from "@/lib/context-lake";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/session";
import { getAccessibleRunners, getProjectAccess } from "@/lib/team-access";
import { isRunnerOnline } from "@/lib/workspace-data";

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await getCurrentSession();
  if (!session) redirect("/login");

  const { id } = await params;
  const sp = await searchParams;

  const access = await getProjectAccess(session.user, id);
  if (!access) notFound();

  const [project, board, accessibleRunners] = await Promise.all([
    prisma.project.findUnique({
      where: { id: access.project.id },
      include: {
        user: { select: { githubLogin: true } },
        _count: { select: { members: true } },
        missions: {
          orderBy: { updatedAt: "desc" },
          include: { issues: { select: { status: true } } },
        },
      },
    }),
    getProjectBoardSnapshot({
      projectId: access.project.id,
      viewerUserId: session.user.id,
      viewerGithubLogin: session.user.githubLogin,
    }),
    getAccessibleRunners(session.user.id, {
      projectId: access.project.id,
      githubLogin: session.user.githubLogin,
    }),
  ]);

  if (!project || !board) notFound();

  const contextLake = await getProjectContextLake({
    project,
    githubAccessToken: session.githubAccessToken,
  });

  return (
    <ProjectWorkspace
      project={{
        id: project.id,
        name: project.name,
        slug: project.slug,
        description: project.description,
        engine: project.engine,
        source: project.source,
        localPath: project.localPath,
        githubFullName: project.githubFullName,
        githubUrl: project.githubUrl,
        defaultBranch: project.defaultBranch || "main",
        defaultRunnerId: project.defaultRunnerId ?? null,
        initStatus: board.initStatus,
        readinessScore: project.readinessScore,
      }}
      runners={accessibleRunners.map((r) => ({
        id: r.id,
        name: r.name,
        hostname: r.hostname,
        os: r.os,
        status: isRunnerOnline(r.status, r.lastHeartbeatAt) ? "online" : "offline",
        isOwn: r.userId === session.user.id,
        ownerLogin: r.user?.githubLogin ?? session.user.githubLogin,
        visibility: r.visibility === "team" ? "team" : "personal",
      }))}
      myRole={access.role}
      currentUserId={session.user.id}
      ownerLogin={project.user?.githubLogin ?? "local"}
      memberCount={project._count.members + 1}
      initialBoard={board}
      missions={project.missions.map((m) => ({
        id: m.id,
        title: m.title,
        goal: m.goal,
        status: m.status,
        autonomy: m.autonomy,
        validationContractMd: m.validationContractMd,
        issueCount: m.issues.length,
        passedCount: m.issues.filter((i) => i.status === "passed").length,
        updatedAt: m.updatedAt.toISOString(),
      }))}
      contextLake={contextLake}
      defaultTab={sp.tab || "dashboard"}
    />
  );
}
