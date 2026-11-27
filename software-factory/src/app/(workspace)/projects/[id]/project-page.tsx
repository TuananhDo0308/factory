import { notFound, redirect } from "next/navigation";
import { ProjectWorkspace, type ProjectSection } from "@/components/factory/project-workspace";
import { getProjectBoardSnapshot } from "@/lib/board-data";
import { getProjectContextLake } from "@/lib/context-lake";
import { ensureProjectGithub } from "@/lib/github-tracking";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/session";
import { getAccessibleRunners, getProjectAccess } from "@/lib/team-access";
import { isRunnerOnline } from "@/lib/workspace-data";

/** One page of a project (Overview, Kanban, Prototypes, Context Lake); each has its own route. */
export async function ProjectPage({
  id,
  section,
  openTeam = false,
}: {
  id: string;
  section: ProjectSection;
  openTeam?: boolean;
}) {
  const session = await getCurrentSession();
  if (!session) redirect("/login");

  const access = await getProjectAccess(session.user, id);
  if (!access) notFound();

  // Learn the repository from a BA run that published to one, and import it once.
  await ensureProjectGithub(access.project.id, session.githubAccessToken);

  const [project, board, accessibleRunners] = await Promise.all([
    prisma.project.findUnique({
      where: { id: access.project.id },
      include: {
        user: { select: { githubLogin: true } },
        _count: { select: { members: true } },
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
        source: project.source,
        localPath: project.localPath,
        githubFullName: project.githubFullName,
        githubUrl: project.githubUrl,
        defaultBranch: project.defaultBranch || "main",
        defaultRunnerId: project.defaultRunnerId ?? null,
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
      contextLake={contextLake}
      section={section}
      openTeam={openTeam}
    />
  );
}
