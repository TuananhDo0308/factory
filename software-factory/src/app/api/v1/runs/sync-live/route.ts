import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest, resolveUserProject } from "@/lib/api-auth";
import { dispatchReadyIssuesForProject } from "@/lib/auto-dispatch";
import { isProjectFactoryInitCompleteOnDisk } from "@/lib/init-issue";
import { syncLiveRecordToDb, type LiveJsRecord } from "@/lib/live-sync";
import { prisma } from "@/lib/prisma";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Resolves a local repo or git worktree path back to the main repository root
 * so runs executed in a worktree still match the registered `Project.localPath`.
 */
function canonicalLocalRepo(rawPath: string): string {
  const cleaned = rawPath.trim().replace(/\/+$/, "");
  if (!cleaned) return "";
  try {
    const abs = resolve(cleaned);
    const dotGit = join(abs, ".git");
    if (existsSync(dotGit) && statSync(dotGit).isFile()) {
      const content = readFileSync(dotGit, "utf8");
      const m = /^gitdir:\s*(.+)$/m.exec(content);
      if (m?.[1]) {
        const gitDir = resolve(abs, m[1].trim());
        const normalized = gitDir.replace(/\\/g, "/");
        const wtIdx = normalized.indexOf("/.git/worktrees/");
        if (wtIdx > 0) {
          return normalized.slice(0, wtIdx);
        }
        if (basename(gitDir) === ".git") {
          return dirname(gitDir);
        }
      }
    }
    return abs;
  } catch {
    return cleaned;
  }
}

async function createLocalProjectForRepo(params: {
  userId: string;
  repoPath: string;
  engine: string;
}) {
  const folderName = basename(params.repoPath) || "factory-project";
  const baseSlug =
    folderName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "factory-project";

  let slug = baseSlug;
  for (let i = 2; i <= 50; i += 1) {
    const clash = await prisma.project.findUnique({
      where: { userId_slug: { userId: params.userId, slug } },
      select: { id: true },
    });
    if (!clash) break;
    slug = `${baseSlug}-${i}`;
  }

  return prisma.project.create({
    data: {
      userId: params.userId,
      name: folderName,
      slug,
      source: "local",
      engine: params.engine,
      localPath: params.repoPath,
      initStatus: isProjectFactoryInitCompleteOnDisk(params.repoPath) ? "complete" : "none",
    },
  });
}

export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const records: LiveJsRecord[] = Array.isArray(body.records)
    ? (body.records as LiveJsRecord[])
    : body.record && typeof body.record === "object"
      ? [body.record as LiveJsRecord]
      : [];

  const bodyProjectId = str(body.projectId) || undefined;
  const bodyProject = str(body.project) || undefined;
  const bodyRepoRaw = str(body.repo || body.localPath);
  const bodyEngine = str(body.engine) === "claude" ? "claude" : "antigravity";
  const isLiveSnapshot = str(body.source) === "live";

  let synced = 0;
  let lastProjectId: string | null = null;
  const projectsToDispatch = new Set<string>();

  for (const record of records) {
    if (!record || typeof record !== "object" || !record.id || record.sample === true) continue;
    const runKey = str(record.id);
    if (!runKey) continue;

    const recordRepoRaw = str(record.repo) || bodyRepoRaw;
    const recordRepo = recordRepoRaw ? canonicalLocalRepo(recordRepoRaw) : "";

    let project = await resolveUserProject(auth.user.id, {
      projectId: bodyProjectId,
      project: bodyProject,
      localPath: recordRepo || undefined,
      runKey,
    });

    if (!project && recordRepo) {
      project = await createLocalProjectForRepo({
        userId: auth.user.id,
        repoPath: recordRepo,
        engine: bodyEngine,
      });
    }

    if (!project && isLiveSnapshot) {
      // Legacy live.js without `repo`: attach to a currently active factory run if one exists.
      const activeFactoryRun = await prisma.factoryRun.findFirst({
        where: {
          userId: auth.user.id,
          mode: "factory",
          status: { in: ["running", "queued"] },
        },
        orderBy: { updatedAt: "desc" },
        include: { project: true },
      });
      project = activeFactoryRun?.project ?? null;
    }

    if (!project) {
      project = await prisma.project.findFirst({
        where: { userId: auth.user.id },
        orderBy: { updatedAt: "desc" },
      });
    }

    if (!project) {
      project = await prisma.project.create({
        data: {
          userId: auth.user.id,
          name: bodyProject || "Factory Workspace",
          slug: "factory-workspace",
          source: "local",
          engine: bodyEngine,
          localPath: recordRepo || null,
        },
      });
    }

    const engine = str(body.engine) === "claude" ? "claude" : project.engine || "antigravity";
    const saved = await syncLiveRecordToDb({
      userId: auth.user.id,
      projectId: project.id,
      engine,
      record,
      isLiveSnapshot,
    });
    if (saved) {
      synced += 1;
      lastProjectId = project.id;
      if (
        saved.issueId &&
        (saved.status === "passed" || saved.status === "failed" || saved.status === "blocked")
      ) {
        projectsToDispatch.add(project.id);
      }
    }
  }

  for (const pid of projectsToDispatch) {
    await dispatchReadyIssuesForProject({
      projectId: pid,
      actorUserId: auth.user.id,
      actorGithubLogin: auth.user.githubLogin,
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true, synced, projectId: lastProjectId });
}
