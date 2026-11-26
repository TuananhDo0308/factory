import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest, resolveUserProject } from "@/lib/api-auth";
import { dispatchReadyIssuesForProject } from "@/lib/auto-dispatch";
import { syncLiveRecordToDb, type LiveJsRecord } from "@/lib/live-sync";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Resolves a local repo or git worktree path back to the main repository root
 * so web-dispatched runs executed in a worktree still match `Project.localPath`.
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
  const bodyRunKey = str(body.runKey || body.run) || undefined;
  const isLiveSnapshot = str(body.source) === "live";

  let synced = 0;
  let skipped = 0;
  let lastProjectId: string | null = null;
  const projectsToDispatch = new Set<string>();

  for (const record of records) {
    if (!record || typeof record !== "object" || !record.id || record.sample === true) continue;
    const runKey = bodyRunKey || str(record.id);
    if (!runKey) continue;

    const recordRepoRaw = str(record.repo) || bodyRepoRaw;
    const recordRepo = recordRepoRaw ? canonicalLocalRepo(recordRepoRaw) : "";

    // Strict web-origin tracking only: never auto-create projects or guess unrelated
    // projects for local/personal machine chats.
    const project = await resolveUserProject(auth.user.id, {
      projectId: bodyProjectId,
      project: bodyProject,
      localPath: recordRepo || undefined,
      runKey,
    });
    if (!project) {
      skipped += 1;
      continue;
    }

    const engine = str(body.engine) === "claude" ? "claude" : project.engine || "antigravity";
    const saved = await syncLiveRecordToDb({
      userId: auth.user.id,
      projectId: project.id,
      engine,
      record,
      targetRunKey: bodyRunKey,
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
    } else {
      skipped += 1;
    }
  }

  for (const pid of projectsToDispatch) {
    await dispatchReadyIssuesForProject({
      projectId: pid,
      actorUserId: auth.user.id,
      actorGithubLogin: auth.user.githubLogin,
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true, synced, skipped, projectId: lastProjectId });
}
