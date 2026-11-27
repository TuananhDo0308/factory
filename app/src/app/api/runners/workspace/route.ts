import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { accessibleProjectsWhere, getAccessibleRunners } from "@/lib/team-access";
import { isRunnerOnline, safeJsonParse } from "@/lib/workspace-data";

type DiscoveredFolder = {
  name: string;
  path: string;
  isGit: boolean;
  hasFactoryInit: boolean;
  defaultBranch: string;
  githubFullName: string | null;
};

function scanLocalFallbackDir(dir: string): DiscoveredFolder[] {
  if (!dir || !existsSync(/* turbopackIgnore: true */ dir)) return [];
  const ignored = new Set(["node_modules", "dist", "build", ".git", ".agents", ".next"]);
  const out: DiscoveredFolder[] = [];
  try {
    for (const name of readdirSync(/* turbopackIgnore: true */ dir).sort()) {
      if (!name || name.startsWith(".") || ignored.has(name)) continue;
      const fullPath = path.join(/* turbopackIgnore: true */ dir, name);
      try {
        if (!statSync(/* turbopackIgnore: true */ fullPath).isDirectory()) continue;
      } catch {
        continue;
      }
      out.push({
        name,
        path: fullPath,
        isGit: existsSync(/* turbopackIgnore: true */ path.join(fullPath, ".git")),
        hasFactoryInit: existsSync(
          /* turbopackIgnore: true */ path.join(fullPath, ".factory", "project.json"),
        ),
        defaultBranch: "main",
        githubFullName: null,
      });
      if (out.length >= 60) break;
    }
  } catch {
    return [];
  }
  return out;
}

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const requestedRunnerId = (request.nextUrl.searchParams.get("runnerId") || "").trim();

  const [runners, existingProjects] = await Promise.all([
    getAccessibleRunners(auth.user.id, { githubLogin: auth.user.githubLogin }),
    prisma.project.findMany({
      where: accessibleProjectsWhere(auth.user.id, auth.user.githubLogin),
      select: { id: true, name: true, slug: true, localPath: true },
    }),
  ]);

  const linkedPaths = new Set(
    existingProjects
      .map((p) => (p.localPath || "").trim().replace(/\/+$/, "").toLowerCase())
      .filter(Boolean),
  );
  const linkedByPath = new Map(
    existingProjects
      .filter((p) => p.localPath)
      .map((p) => [(p.localPath || "").trim().replace(/\/+$/, "").toLowerCase(), p.id]),
  );

  const normalizedRunners = runners.map((r) => ({
    id: r.id,
    name: r.name,
    hostname: r.hostname,
    os: r.os,
    isOwn: r.userId === auth.user.id,
    ownerLogin: r.user?.githubLogin ?? "local",
    visibility: r.visibility === "team" ? "team" : "personal",
    status: isRunnerOnline(r.status, r.lastHeartbeatAt) ? "online" : "offline",
    workspaceDir: r.workspaceDir ?? null,
    discoveredProjects: safeJsonParse<DiscoveredFolder[]>(r.discoveredProjectsJson, []),
  }));

  const preferred =
    (requestedRunnerId && normalizedRunners.find((r) => r.id === requestedRunnerId)) ||
    normalizedRunners.find((r) => r.status === "online" && r.isOwn && r.workspaceDir) ||
    normalizedRunners.find((r) => r.status === "online" && r.workspaceDir) ||
    normalizedRunners.find((r) => r.workspaceDir) ||
    normalizedRunners[0] ||
    null;

  const fallbackDir = (process.env.SF_PROJECTS_DIR || path.join(homedir(), "factory-projects")).trim();
  const activeWorkspaceDir = preferred?.workspaceDir || fallbackDir;

  const rawFolders =
    preferred && preferred.discoveredProjects.length > 0
      ? preferred.discoveredProjects
      : !process.env.VERCEL
        ? scanLocalFallbackDir(activeWorkspaceDir)
        : [];

  return NextResponse.json({
    ok: true,
    activeRunner: preferred
      ? {
          id: preferred.id,
          name: preferred.name,
          status: preferred.status,
          isOwn: preferred.isOwn,
          ownerLogin: preferred.ownerLogin,
          workspaceDir: activeWorkspaceDir,
        }
      : null,
    workspaceDir: activeWorkspaceDir,
    runners: normalizedRunners.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      isOwn: r.isOwn,
      ownerLogin: r.ownerLogin,
      workspaceDir: r.workspaceDir,
      folderCount: r.discoveredProjects.length,
    })),
    folders: rawFolders.map((f) => {
      const norm = f.path.trim().replace(/\/+$/, "").toLowerCase();
      return {
        ...f,
        alreadyImported: linkedPaths.has(norm),
        linkedProjectId: linkedByPath.get(norm) ?? null,
      };
    }),
  });
}
