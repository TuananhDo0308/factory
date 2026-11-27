import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";

export type ContextLakeFileRecord = {
  path: string;
  content: string;
  bytes: number;
  sha?: string | null;
  source?: string;
  updatedAt?: string;
};

export const CONTEXT_TOP_LEVEL_FILES = new Set([
  "CODING_STANDARDS.md",
  "CLAUDE.md",
  "AGENTS.md",
  "README.md",
  "DESIGN.md",
]);

const ALLOWED_PREFIXES = [".factory/", "docs/ba/", "docs/dev/adr/"];
const IGNORED_SEGMENTS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "runs",
  "worktrees",
  ".tmp",
  "shots",
]);
const ALLOWED_EXTENSIONS = new Set([
  ".md",
  ".mdx",
  ".json",
  ".yml",
  ".yaml",
  ".txt",
  ".toml",
  ".css",
]);

const MAX_FILE_CHARS = 48_000;
const MAX_FILES_PER_PROJECT = 80;

export function isContextLakePath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..")) return false;
  if (CONTEXT_TOP_LEVEL_FILES.has(normalized)) return true;

  if (!ALLOWED_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return false;
  }

  const segments = normalized.split("/");
  // Ignore transient/binary folders inside `.factory/` (like `.factory/runs/` or `.factory/prototypes/*/shots/`)
  for (let i = 1; i < segments.length - 1; i += 1) {
    if (IGNORED_SEGMENTS.has(segments[i])) return false;
  }

  const ext = path.extname(normalized).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) return false;
  return true;
}

function sha256Short(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 16);
}

/**
 * Recursively scans a local project directory for Context Lake files
 * (`.factory/**`, `docs/ba/**`, `docs/dev/adr/**`, and top-level docs).
 */
export function scanLocalContextFiles(localPath: string | null | undefined): ContextLakeFileRecord[] {
  if (!localPath || !localPath.trim()) return [];
  const root = path.resolve(/* turbopackIgnore: true */ localPath.trim());
  if (!existsSync(/* turbopackIgnore: true */ root)) return [];

  const out: ContextLakeFileRecord[] = [];
  const seen = new Set<string>();

  function collectFile(relPath: string) {
    if (out.length >= MAX_FILES_PER_PROJECT) return;
    const norm = relPath.replace(/\\/g, "/");
    if (seen.has(norm) || !isContextLakePath(norm)) return;
    const abs = path.join(/* turbopackIgnore: true */ root, norm);
    if (!existsSync(/* turbopackIgnore: true */ abs)) return;
    try {
      const st = statSync(/* turbopackIgnore: true */ abs);
      if (!st.isFile() || st.size > 512_000) return;
      const raw = readFileSync(/* turbopackIgnore: true */ abs, "utf8");
      if (raw.includes("\u0000")) return;
      seen.add(norm);
      out.push({
        path: norm,
        content: raw.slice(0, MAX_FILE_CHARS),
        bytes: Buffer.byteLength(raw, "utf8"),
        sha: sha256Short(raw),
        source: "local",
      });
    } catch {
      // Skip unreadable file.
    }
  }

  function walkDir(relDir: string, depth: number) {
    if (depth > 6 || out.length >= MAX_FILES_PER_PROJECT) return;
    const absDir = path.join(/* turbopackIgnore: true */ root, relDir);
    if (!existsSync(/* turbopackIgnore: true */ absDir)) return;
    let entries: string[];
    try {
      entries = readdirSync(/* turbopackIgnore: true */ absDir).sort();
    } catch {
      return;
    }
    for (const name of entries) {
      if (out.length >= MAX_FILES_PER_PROJECT) break;
      if (IGNORED_SEGMENTS.has(name)) continue;
      const nextRel = relDir ? `${relDir}/${name}` : name;
      const nextAbs = path.join(/* turbopackIgnore: true */ root, nextRel);
      try {
        const st = statSync(/* turbopackIgnore: true */ nextAbs);
        if (st.isDirectory()) {
          walkDir(nextRel, depth + 1);
        } else if (st.isFile()) {
          collectFile(nextRel);
        }
      } catch {
        // Ignore inaccessible entries.
      }
    }
  }

  // Priority order: `.factory/`, top-level docs, `docs/ba/`, `docs/dev/adr/`
  walkDir(".factory", 0);
  for (const topFile of CONTEXT_TOP_LEVEL_FILES) {
    collectFile(topFile);
  }
  walkDir("docs/ba", 0);
  walkDir("docs/dev/adr", 0);

  return out;
}

/**
 * Fetches Context Lake files directly from a connected GitHub repository
 * using the Git Trees + Contents APIs (works on Vercel Serverless with zero disk access!).
 */
export async function fetchGitHubContextFiles(params: {
  fullName: string;
  branch?: string | null;
  accessToken?: string | null;
}): Promise<{ ok: true; files: ContextLakeFileRecord[] } | { ok: false; error: string }> {
  const fullName = params.fullName.trim();
  if (!fullName || !fullName.includes("/")) {
    return { ok: false, error: "Invalid GitHub repository name" };
  }

  const branch = (params.branch || "main").trim() || "main";
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "software-factory",
  };
  const token = (params.accessToken || process.env.FACTORY_BOT_GITHUB_TOKEN || "").trim();
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  const [owner, repo] = fullName.split("/");
  const treeUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`;

  let treeRes: Response;
  try {
    treeRes = await fetch(treeUrl, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to reach GitHub API",
    };
  }

  if (!treeRes.ok) {
    return {
      ok: false,
      error:
        treeRes.status === 404
          ? `Branch "${branch}" or repository "${fullName}" not found on GitHub (or token lacks access)`
          : `GitHub tree request failed (HTTP ${treeRes.status})`,
    };
  }

  const treeData = (await treeRes.json().catch(() => null)) as {
    tree?: Array<{ path?: string; type?: string; size?: number; sha?: string }>;
  } | null;

  const entries = (treeData?.tree ?? [])
    .filter(
      (item): item is { path: string; type: string; size?: number; sha?: string } =>
        item.type === "blob" &&
        typeof item.path === "string" &&
        isContextLakePath(item.path) &&
        (item.size ?? 0) <= 512_000,
    )
    .slice(0, MAX_FILES_PER_PROJECT);

  const files: ContextLakeFileRecord[] = [];
  const BATCH_SIZE = 6;

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const settled = await Promise.all(
      batch.map(async (entry) => {
        const encodedPath = entry.path
          .split("/")
          .map((seg) => encodeURIComponent(seg))
          .join("/");
        const fileUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;
        try {
          const res = await fetch(fileUrl, {
            headers,
            cache: "no-store",
            signal: AbortSignal.timeout(8_000),
          });
          if (!res.ok) return null;
          const payload = (await res.json().catch(() => null)) as {
            content?: string;
            encoding?: string;
            size?: number;
            sha?: string;
          } | null;
          if (!payload || typeof payload.content !== "string") return null;
          const raw =
            payload.encoding === "base64"
              ? Buffer.from(payload.content.replace(/\n/g, ""), "base64").toString("utf8")
              : payload.content;
          if (raw.includes("\u0000")) return null;
          return {
            path: entry.path,
            content: raw.slice(0, MAX_FILE_CHARS),
            bytes: payload.size ?? Buffer.byteLength(raw, "utf8"),
            sha: payload.sha || entry.sha || sha256Short(raw),
            source: "github",
          } satisfies ContextLakeFileRecord;
        } catch {
          return null;
        }
      }),
    );

    for (const item of settled) {
      if (item) files.push(item);
    }
  }

  return { ok: true, files };
}

/**
 * Persists a project's Context Lake snapshot to PostgreSQL.
 */
export async function upsertProjectContextFiles(params: {
  projectId: string;
  files: Array<{ path: string; content: string; bytes?: number; sha?: string | null }>;
  source: "daemon" | "github" | "local";
  replaceAll?: boolean;
}): Promise<{ savedCount: number }> {
  const validFiles = params.files
    .filter((f) => typeof f.path === "string" && isContextLakePath(f.path) && typeof f.content === "string")
    .slice(0, MAX_FILES_PER_PROJECT)
    .map((f) => {
      const normalizedPath = f.path.replace(/\\/g, "/").replace(/^\/+/, "");
      const trimmedContent = f.content.slice(0, MAX_FILE_CHARS);
      return {
        path: normalizedPath,
        content: trimmedContent,
        bytes:
          typeof f.bytes === "number" && Number.isFinite(f.bytes) && f.bytes >= 0
            ? Math.round(f.bytes)
            : Buffer.byteLength(trimmedContent, "utf8"),
        sha: f.sha || sha256Short(trimmedContent),
      };
    });

  const keepPaths = validFiles.map((f) => f.path);

  // Batch upserts in parallel chunks so remote Postgres / Vercel Serverless
  // never hits Prisma's 5s interactive transaction timeout (P2028).
  const UPSERT_CHUNK = 10;
  for (let i = 0; i < validFiles.length; i += UPSERT_CHUNK) {
    const chunk = validFiles.slice(i, i + UPSERT_CHUNK);
    await Promise.all(
      chunk.map((file) =>
        prisma.projectContextFile.upsert({
          where: { projectId_path: { projectId: params.projectId, path: file.path } },
          update: {
            content: file.content,
            bytes: file.bytes,
            sha: file.sha,
            source: params.source,
          },
          create: {
            projectId: params.projectId,
            path: file.path,
            content: file.content,
            bytes: file.bytes,
            sha: file.sha,
            source: params.source,
          },
        }),
      ),
    );
  }

  if (params.replaceAll) {
    await prisma.projectContextFile.deleteMany({
      where: {
        projectId: params.projectId,
        ...(keepPaths.length > 0 ? { path: { notIn: keepPaths } } : {}),
      },
    });
  }

  return { savedCount: validFiles.length };
}

/**
 * Loads Context Lake files for a project across ALL environments (Vercel + localhost):
 * 1. Reads synced files from PostgreSQL (pushed by `sf daemon` or synced from GitHub).
 * 2. On localhost where `project.localPath` exists on disk, scans disk & persists to DB so both stay fresh.
 * 3. On Vercel (no local disk) when DB is empty and the project has a GitHub repo, auto-hydrates from GitHub!
 */
export async function getProjectContextLake(params: {
  project: {
    id: string;
    localPath: string | null;
    githubFullName: string | null;
    defaultBranch: string | null;
  };
  githubAccessToken?: string | null;
}): Promise<{
  files: ContextLakeFileRecord[];
  source: "local" | "daemon" | "github" | "none";
  syncedAt: string | null;
}> {
  // 1. Check local disk first when running on the same host (localhost)
  const localFiles = scanLocalContextFiles(params.project.localPath);
  if (localFiles.length > 0) {
    // Opportunistically cache into PostgreSQL so Vercel / shared viewers also see them
    void upsertProjectContextFiles({
      projectId: params.project.id,
      files: localFiles,
      source: "local",
      replaceAll: false,
    }).catch(() => {});

    return {
      files: localFiles,
      source: "local",
      syncedAt: new Date().toISOString(),
    };
  }

  // 2. Read DB-synced Context Lake files (pushed by `sf daemon` or previous GitHub sync)
  const dbRows = await prisma.projectContextFile.findMany({
    where: { projectId: params.project.id },
    orderBy: { path: "asc" },
  });

  if (dbRows.length > 0) {
    const latestMs = Math.max(...dbRows.map((r) => r.updatedAt.getTime()));
    const primarySource =
      dbRows[0].source === "github"
        ? "github"
        : dbRows[0].source === "local"
          ? "local"
          : "daemon";
    return {
      files: dbRows.map((r) => ({
        path: r.path,
        content: r.content,
        bytes: r.bytes,
        sha: r.sha,
        source: r.source,
        updatedAt: r.updatedAt.toISOString(),
      })),
      source: primarySource,
      syncedAt: new Date(latestMs).toISOString(),
    };
  }

  // 3. Auto-hydrate from GitHub when on Vercel & DB has no synced files yet
  if (params.project.githubFullName) {
    const gh = await fetchGitHubContextFiles({
      fullName: params.project.githubFullName,
      branch: params.project.defaultBranch,
      accessToken: params.githubAccessToken,
    });
    if (gh.ok && gh.files.length > 0) {
      await upsertProjectContextFiles({
        projectId: params.project.id,
        files: gh.files,
        source: "github",
        replaceAll: true,
      }).catch(() => {});
      return {
        files: gh.files,
        source: "github",
        syncedAt: new Date().toISOString(),
      };
    }
  }

  return { files: [], source: "none", syncedAt: null };
}
