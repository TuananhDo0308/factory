import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export type ProjectRole = "owner" | "member" | "viewer";

export function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^@+/, "").toLowerCase();
}

export function accessibleProjectsWhere(
  userId: string,
  githubLogin?: string | null,
): Prisma.ProjectWhereInput {
  const login = githubLogin ? normalizeHandle(githubLogin) : "";
  return {
    OR: [
      { userId },
      { members: { some: { userId } } },
      ...(login ? [{ members: { some: { githubLogin: login } } }] : []),
    ],
  };
}

/** Projects `userId` may change: owned, or joined with the `owner` or `member` role (not `viewer`). */
export function writableProjectsWhere(
  userId: string,
  githubLogin?: string | null,
): Prisma.ProjectWhereInput {
  const login = githubLogin ? normalizeHandle(githubLogin) : "";
  const writeRole = { role: { in: ["owner", "member"] } };
  return {
    OR: [
      { userId },
      { members: { some: { userId, ...writeRole } } },
      ...(login ? [{ members: { some: { githubLogin: login, ...writeRole } } }] : []),
    ],
  };
}

export async function linkPendingMemberships(user: {
  id: string;
  githubLogin?: string | null;
}): Promise<void> {
  const login = user.githubLogin ? normalizeHandle(user.githubLogin) : "";
  if (!login || login === "local") return;
  await prisma.projectMember
    .updateMany({
      where: { githubLogin: login, userId: null },
      data: { userId: user.id },
    })
    .catch(() => {});
}

export async function getProjectAccess(
  user: { id: string; githubLogin?: string | null },
  projectId: string,
) {
  const login = user.githubLogin ? normalizeHandle(user.githubLogin) : "";
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      ...accessibleProjectsWhere(user.id, login),
    },
    include: {
      members: {
        where: {
          OR: [{ userId: user.id }, ...(login ? [{ githubLogin: login }] : [])],
        },
        take: 1,
      },
    },
  });
  if (!project) return null;

  let role: ProjectRole = "viewer";
  if (project.userId === user.id) {
    role = "owner";
  } else {
    const mRole = project.members[0]?.role;
    role = mRole === "owner" ? "owner" : mRole === "viewer" ? "viewer" : "member";
  }

  return {
    project,
    role,
    isOwner: role === "owner",
    canWrite: role === "owner" || role === "member",
  };
}

export async function getAccessibleProjectIds(
  userId: string,
  githubLogin?: string | null,
): Promise<string[]> {
  const rows = await prisma.project.findMany({
    where: accessibleProjectsWhere(userId, githubLogin),
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * Users whose shared runners `userId` may use: the owners of the projects `userId` is a member of.
 * Only the owner of a project shares runners into it. A member's runner never serves projects of
 * other people, because anyone can add anyone as a member, and a runner runs whatever it is sent.
 */
async function getRunnerSharingOwnerIds(
  userId: string,
  options?: { projectId?: string; githubLogin?: string | null },
): Promise<string[]> {
  const where: Prisma.ProjectWhereInput = options?.projectId
    ? { id: options.projectId, ...accessibleProjectsWhere(userId, options.githubLogin) }
    : accessibleProjectsWhere(userId, options?.githubLogin);
  const projects = await prisma.project.findMany({ where, select: { userId: true } });
  return Array.from(new Set(projects.map((p) => p.userId).filter((id) => id && id !== userId)));
}

export async function getAccessibleRunners(
  userId: string,
  options?: { projectId?: string; githubLogin?: string | null },
) {
  const teammateIds = await getRunnerSharingOwnerIds(userId, options);
  return prisma.runnerMachine.findMany({
    where: {
      OR: [
        { userId },
        ...(teammateIds.length > 0
          ? [{ visibility: "team", userId: { in: teammateIds } }]
          : []),
      ],
    },
    include: {
      user: { select: { id: true, githubLogin: true, name: true } },
    },
    orderBy: [{ lastHeartbeatAt: "desc" }],
  });
}

export async function findAccessibleRun(
  user: { id: string; githubLogin?: string | null },
  runIdOrKey: string,
) {
  const login = user.githubLogin ? normalizeHandle(user.githubLogin) : "";
  const run = await prisma.factoryRun.findFirst({
    where: {
      OR: [{ id: runIdOrKey }, { runKey: runIdOrKey }],
      project: accessibleProjectsWhere(user.id, login),
    },
    include: {
      project: {
        include: {
          members: {
            where: {
              OR: [{ userId: user.id }, ...(login ? [{ githubLogin: login }] : [])],
            },
            take: 1,
          },
        },
      },
      runner: { select: { id: true, userId: true, name: true, visibility: true } },
    },
  });
  if (!run) return null;

  let role: ProjectRole = "viewer";
  if (run.project.userId === user.id) {
    role = "owner";
  } else {
    const mRole = run.project.members[0]?.role;
    role = mRole === "owner" ? "owner" : mRole === "viewer" ? "viewer" : "member";
  }

  return {
    run,
    role,
    isOwner: role === "owner",
    canWrite: role === "owner" || role === "member",
  };
}
