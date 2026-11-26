import type { NextRequest } from "next/server";
import { sha256Hex } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/session";
import { accessibleProjectsWhere } from "@/lib/team-access";

export async function authenticateBearer(request: NextRequest) {
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!match || !match[1]) return null;

  const tokenHash = sha256Hex(match[1]);
  const record = await prisma.apiToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!record || record.revokedAt !== null) return null;

  await prisma.apiToken
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return { user: record.user, token: record };
}

export async function authenticateRequest(request: NextRequest) {
  const bearer = await authenticateBearer(request);
  if (bearer) {
    return {
      user: bearer.user,
      via: "bearer" as const,
      githubAccessToken: null as string | null,
    };
  }
  const session = await getCurrentSession();
  if (session) {
    return {
      user: session.user,
      via: "session" as const,
      githubAccessToken: session.githubAccessToken,
    };
  }
  return null;
}

export async function resolveUserProject(
  userId: string,
  ref: { projectId?: string; project?: string; localPath?: string; runKey?: string },
) {
  const userRow = await prisma.user.findUnique({
    where: { id: userId },
    select: { githubLogin: true },
  });
  const accessFilter = accessibleProjectsWhere(userId, userRow?.githubLogin);

  if (ref.projectId) {
    const byId = await prisma.project.findFirst({
      where: { id: ref.projectId, ...accessFilter },
    });
    if (byId) return byId;
  }

  if (ref.runKey) {
    const existingRun = await prisma.factoryRun.findFirst({
      where: { runKey: ref.runKey, project: accessFilter },
      orderBy: { startedAt: "desc" },
      include: { project: true },
    });
    if (existingRun?.project) return existingRun.project;
  }

  const all = await prisma.project.findMany({
    where: accessFilter,
    orderBy: { updatedAt: "desc" },
  });

  const key = (ref.project || "").trim().toLowerCase();
  const normPath = (ref.localPath || "").trim().replace(/\/+$/, "").toLowerCase();

  if (key) {
    const exact = all.find(
      (p) =>
        p.id.toLowerCase() === key ||
        p.slug.toLowerCase() === key ||
        (p.githubFullName || "").toLowerCase() === key ||
        p.name.toLowerCase() === key,
    );
    if (exact) return exact;
  }

  if (normPath) {
    const byPath = all.find(
      (p) =>
        (p.localPath || "").trim().replace(/\/+$/, "").toLowerCase() === normPath,
    );
    if (byPath) return byPath;

    // Also match when invoked from a subdirectory inside a registered project repo.
    const containing = all
      .filter((p) => {
        const pPath = (p.localPath || "").trim().replace(/\/+$/, "").toLowerCase();
        return pPath.length > 0 && normPath.startsWith(`${pPath}/`);
      })
      .sort((a, b) => (b.localPath?.length || 0) - (a.localPath?.length || 0));
    if (containing[0]) return containing[0];
  }

  return null;
}
