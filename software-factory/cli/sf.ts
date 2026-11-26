#!/usr/bin/env node
// Software Factory CLI, Daemon & MCP Server (`sf`)
// Tracks Factory runs, per-agent states, artifacts, 2-way human interactions,
// watches live.js/runs.js/lessons.js, executes Web commands, and exposes a
// stdio MCP Context Lake server.
// Runs directly on Node 22+ via native TypeScript type stripping.

import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  type FSWatcher,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
  symlinkSync,
  unlinkSync,
  watch,
  writeFileSync,
} from "node:fs";
import { homedir, hostname, platform } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const CLI_VERSION = "2026.11.26-r2";
const FACTORY_SKILLS = [
  "factory",
  "factory-init",
  "factory-clarify",
  "ba-ticket",
  "dev-subissues",
  "ui-refine-loop",
  "pr-judge",
] as const;

type SfConfig = {
  url: string;
  token: string;
  workspaceDir?: string;
};

type HttpMethod = "POST" | "PATCH";

type SpooledRequest = {
  method?: HttpMethod;
  path: string;
  body: Record<string, unknown>;
  createdAt: string;
};

const USAGE = `Software Factory CLI & Daemon (sf)

Usage:
  # 1-Command Onboarding & Diagnostics
  sf setup    [--url <server-url>] [--skills-repo <git-url>] [--root <dir>] [--name <runner>]
              [--no-browser] [--yes]
  sf doctor
  sf login    --url <server-url> [--token <sf_token>]
  sf whoami

  # Track Factory Runs, Agents, Artifacts & 2-Way Interactions
  sf start    --run <run-id> [--project <slug|owner/repo>] [--repo <dir>] [--title <text>]
              [--engine <antigravity|claude>] [--mode <factory|clarify|mission|ui-refine|pr-judge>]
              [--base <commit>] [--target <branch>] [--model <model>]
  sf agent    --run <run-id> --agent <key> --status <waiting_on_you|working|idle|passed|failed>
              [--name <text>] [--role <role>] [--spec <S1>] [--model <model>] [--activity <text>]
              [--input-tokens <n>] [--output-tokens <n>] [--cache-read-tokens <n>] [--cost-usd <n>]
  sf step     --run <run-id> --step <name> --phase <phase> --status <started|passed|failed|blocked|skipped|info>
              [--project <slug|owner/repo>] [--repo <dir>] [--round <n>] [--spec <id>] [--role <role>]
              [--agent <id>] [--label <text>] [--model <model>] [--duration-ms <n>]
              [--input-tokens <n>] [--output-tokens <n>] [--cache-read-tokens <n>] [--cost-usd <n>]
              [--summary <text>] [--data <json>]
  sf artifact --run <run-id> --kind <plan|mockup|prototype|qc_shot|baseline_diff|axe|pr_judge|walkthrough|diff|log>
              --path <file-or-url> [--title <text>] [--project <slug>] [--repo <dir>]
  sf prototype --path <index.html|dir> [--title <text>] [--slug <slug>] [--issue <I1,I2>]
               [--kind <first_screen|ticket|whole_flow|existing>] [--binding <flow|look>]
               [--run <run-id>] [--project <slug>] [--repo <dir>]
  sf sync-context [--project <slug>] [--repo <dir>]
  sf ask      --run <run-id> --title <text> [--type <question|plan_approval|mockup_approval|merge_approval>]
              [--prompt <text>] [--options <json-or-csv>] [--agent <key>] [--wait] [--timeout-sec <n>]
  sf finish   --run <run-id> --outcome <passed|failed|blocked> [--project <slug|owner/repo>] [--repo <dir>]
              [--summary <text>] [--risk <low|medium|high>] [--merge <auto|person>]
              [--merged <commit>] [--pr-number <n>] [--pr-url <url>] [--duration-ms <n>]

  # Sync & Manage Issues + Live Dashboard Files
  sf issues sync   --file <issues.json|-> [--project <slug|owner/repo>] [--repo <dir>]
  sf issues list   [--project <slug|owner/repo>] [--repo <dir>] [--json]
  sf issues update --key <I1> [--status <...>] [--phase <phase>] [--run <run-id>] [--summary <text>]
  sf sync-live     [--file <path/to/live.js>] [--engine <antigravity|claude>] [--project <slug>]
  sf sync-subagents --run <run-id> [--conv <parent-conv-id>] [--project <slug>] [--repo <dir>] [--watch]

  # Local Daemon (Heartbeat + Dashboard File Watcher + Web Command Executor)
  sf daemon [--name <runner-name>] [--max-concurrency <n>] [--interval-ms <n>]
            [--projects-dir <workspace-dir>] [--root <monorepo-dir>] [--allow-root <dir>] [--shared]
  sf agents [--watch] [--all] [--json]     (alias: sf ps) Track active & recent local AI agents/subagents + tokens

  # Mini Context Lake MCP Server (stdio JSON-RPC 2.0)
  sf mcp

  sf flush
`;

function sfDir(): string {
  return join(process.env.SF_HOME || join(homedir(), ".sf"));
}
function configPath(): string {
  return join(sfDir(), "config.json");
}
function spoolDir(): string {
  return join(sfDir(), "spool");
}

function loadConfig(): SfConfig | null {
  const envUrl = (process.env.SF_URL || "").trim().replace(/\/+$/, "");
  const envToken = (process.env.SF_TOKEN || "").trim();
  const envWorkspace = (process.env.SF_PROJECTS_DIR || "").trim();
  if (envUrl && envToken) {
    return {
      url: envUrl,
      token: envToken,
      ...(envWorkspace ? { workspaceDir: resolve(envWorkspace) } : {}),
    };
  }

  try {
    const raw = JSON.parse(readFileSync(configPath(), "utf8")) as Partial<SfConfig>;
    const url = typeof raw.url === "string" ? raw.url.trim().replace(/\/+$/, "") : "";
    const token = typeof raw.token === "string" ? raw.token.trim() : "";
    const workspaceDir =
      typeof raw.workspaceDir === "string" && raw.workspaceDir.trim()
        ? resolve(raw.workspaceDir.trim())
        : envWorkspace
          ? resolve(envWorkspace)
          : undefined;
    if (url && token) return { url, token, ...(workspaceDir ? { workspaceDir } : {}) };
  } catch {
    // Not logged in yet.
  }
  return null;
}

function saveConfig(cfg: SfConfig): void {
  mkdirSync(sfDir(), { recursive: true });
  writeFileSync(configPath(), `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(configPath(), 0o600);
  } catch {
    // Ignore on non-POSIX filesystems.
  }
}

function writeSpool(path: string, body: Record<string, unknown>, method: HttpMethod = "POST"): string {
  const dir = spoolDir();
  mkdirSync(dir, { recursive: true });
  const filename = `${Date.now()}-${randomBytes(4).toString("hex")}.json`;
  const target = join(dir, filename);
  const entry: SpooledRequest = { method, path, body, createdAt: new Date().toISOString() };
  writeFileSync(target, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  return target;
}

function listSpoolFiles(): string[] {
  const dir = spoolDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => join(dir, f));
}

function inferProjectContext(repoArg?: string, explicitProject?: string): {
  project?: string;
  localPath?: string;
} {
  const absRepo = repoArg ? resolve(repoArg) : process.cwd();
  let project = explicitProject?.trim() || undefined;

  if (!project && existsSync(join(absRepo, ".factory", "project.json"))) {
    try {
      const parsed = JSON.parse(
        readFileSync(join(absRepo, ".factory", "project.json"), "utf8"),
      ) as { slug?: unknown; name?: unknown };
      if (typeof parsed.slug === "string" && parsed.slug.trim()) project = parsed.slug.trim();
      else if (typeof parsed.name === "string" && parsed.name.trim()) project = parsed.name.trim();
    } catch {
      // Ignore malformed profile.
    }
  }

  if (!project) {
    try {
      const remote = execFileSync("git", ["-C", absRepo, "remote", "get-url", "origin"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      const m =
        /(?:git@github\.com:|https?:\/\/(?:[^@/]+@)?github\.com\/|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(
          remote,
        );
      if (m?.[1]) project = m[1];
    } catch {
      // Not a git repo or no origin remote.
    }
  }

  if (!project) project = basename(absRepo);
  return { project, localPath: absRepo };
}

function gitFallback(repoDir: string, args: string[]): string | undefined {
  try {
    const out = execFileSync("git", ["-C", repoDir, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}

async function sendJson(
  cfg: SfConfig,
  apiPath: string,
  body: Record<string, unknown>,
  method: HttpMethod = "POST",
  timeoutMs = 20_000,
): Promise<{ ok: true; data: unknown } | { ok: false; status: number; error: string }> {
  try {
    const res = await fetch(`${cfg.url}${apiPath}`, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${cfg.token}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    if (res.ok) return { ok: true, data };
    const msg =
      typeof data === "object" && data !== null && "error" in data
        ? String((data as { error?: unknown }).error)
        : `HTTP ${res.status}`;
    return { ok: false, status: res.status, error: msg };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : "network error",
    };
  }
}

function isRetryableHttpFailure(status: number): boolean {
  return status === 0 || status >= 500 || status === 429;
}

async function sendJsonWithRetry(
  cfg: SfConfig,
  apiPath: string,
  body: Record<string, unknown>,
  method: HttpMethod = "POST",
  opts?: { retries?: number; retryDelayMs?: number; spoolOnFail?: boolean; timeoutMs?: number },
): Promise<{ ok: true; data: unknown } | { ok: false; status: number; error: string; spooled?: boolean }> {
  const maxRetries = Math.max(0, opts?.retries ?? 2);
  const baseDelayMs = Math.max(100, opts?.retryDelayMs ?? 600);
  const timeoutMs = opts?.timeoutMs ?? 20_000;
  let lastRes: { ok: false; status: number; error: string } = {
    ok: false,
    status: 0,
    error: "unknown error",
  };
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const res = await sendJson(cfg, apiPath, body, method, timeoutMs);
    if (res.ok) return res;
    lastRes = res;
    if (!isRetryableHttpFailure(res.status) || attempt === maxRetries) break;
    await new Promise((r) => setTimeout(r, baseDelayMs * (attempt + 1)));
  }
  if (opts?.spoolOnFail && isRetryableHttpFailure(lastRes.status)) {
    try {
      writeSpool(apiPath, body, method);
      return { ...lastRes, spooled: true };
    } catch {
      // Ignore spool write error.
    }
  }
  return lastRes;
}

async function getJson(cfg: SfConfig, apiPath: string) {
  const res = await fetch(`${cfg.url}${apiPath}`, {
    headers: { authorization: `Bearer ${cfg.token}` },
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

export type AgyTokenTotals = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
};

/**
 * Computes the unreported token residual for Antigravity `event: "result"` without double-counting
 * earlier turns in resumed (`agy --resume`) conversations.
 *
 * Antigravity's `result.usage` is cumulative across ALL turns of a `conversation_id`, whereas
 * `step_update` `DONE` usage reports only the current turn. Subtracting `(priorCumulative + turnReported)`
 * prevents quadratic O(N^2) inflation across multi-turn Clarify/Init/BA sessions.
 */
export function computeAgyResultTokenDelta(params: {
  resultUsage: AgyTokenTotals;
  priorCumulative: AgyTokenTotals;
  turnReported: AgyTokenTotals;
}): {
  remIn: number;
  remOut: number;
  remCache: number;
  nextCumulative: AgyTokenTotals;
} {
  const alreadyIn = params.priorCumulative.inputTokens + params.turnReported.inputTokens;
  const alreadyOut = params.priorCumulative.outputTokens + params.turnReported.outputTokens;
  const alreadyCache = params.priorCumulative.cacheReadTokens + params.turnReported.cacheReadTokens;

  const remIn = Math.max(0, params.resultUsage.inputTokens - alreadyIn);
  const remOut = Math.max(0, params.resultUsage.outputTokens - alreadyOut);
  const remCache = Math.max(0, params.resultUsage.cacheReadTokens - alreadyCache);

  return {
    remIn,
    remOut,
    remCache,
    nextCumulative: {
      inputTokens: Math.max(alreadyIn, params.resultUsage.inputTokens),
      outputTokens: Math.max(alreadyOut, params.resultUsage.outputTokens),
      cacheReadTokens: Math.max(alreadyCache, params.resultUsage.cacheReadTokens),
    },
  };
}

export function sanitizeRunDirKey(runKey: string): string {
  return runKey.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96) || "run";
}

/**
 * Copies uncommitted `.factory/{plans,prototypes,design/mockups}` artifacts from the main checkout
 * into an isolated git worktree so unattended Factory builds see plans & prototypes written by
 * interactive `/factory clarify` or `/ba-ticket` sessions on `main`.
 */
export function copyUncommittedFactoryArtifacts(baseCwd: string, workCwd: string): string[] {
  const absBase = resolve(baseCwd);
  const absWork = resolve(workCwd);
  if (absBase === absWork || !existsSync(absBase) || !existsSync(absWork)) return [];

  const relRoots = [".factory/plans", ".factory/prototypes", ".factory/design/mockups"];
  const copied: string[] = [];

  function syncDirRecursive(srcDir: string, dstDir: string, relPrefix: string) {
    if (!existsSync(srcDir)) return;
    let entries: string[];
    try {
      entries = readdirSync(srcDir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === ".DS_Store") continue;
      const srcPath = join(srcDir, entry);
      const dstPath = join(dstDir, entry);
      const relPath = `${relPrefix}/${entry}`;
      let srcStat;
      try {
        srcStat = lstatSync(srcPath);
      } catch {
        continue;
      }
      if (srcStat.isSymbolicLink()) continue;
      if (srcStat.isDirectory()) {
        syncDirRecursive(srcPath, dstPath, relPath);
      } else if (srcStat.isFile()) {
        let shouldCopy = !existsSync(dstPath);
        if (!shouldCopy) {
          try {
            const dstStat = statSync(dstPath);
            if (srcStat.mtimeMs > dstStat.mtimeMs + 10) shouldCopy = true;
          } catch {
            shouldCopy = true;
          }
        }
        if (shouldCopy) {
          try {
            mkdirSync(dirname(dstPath), { recursive: true });
            copyFileSync(srcPath, dstPath);
            copied.push(relPath);
          } catch {
            // Skip unreadable artifact file.
          }
        }
      }
    }
  }

  for (const rel of relRoots) {
    syncDirRecursive(join(absBase, rel), join(absWork, rel), rel);
  }
  return copied;
}

export function readPerRunStateFile(
  searchDirs: string[],
  runKey: string,
): {
  outcome?: string;
  reason?: string;
  mergeDecision?: string;
  risk?: string;
  record: Record<string, unknown>;
  path: string;
} | null {
  if (!runKey.trim()) return null;
  const safeId = sanitizeRunDirKey(runKey);
  const uniqueDirs = Array.from(new Set(searchDirs.filter((d) => Boolean(d && d.trim())).map((d) => resolve(d))));
  for (const dir of uniqueDirs) {
    const candidate = join(dir, ".factory", "runs", safeId, "state.json");
    if (!existsSync(candidate)) continue;
    try {
      const parsed = JSON.parse(readFileSync(candidate, "utf8")) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      const outcome = typeof parsed.outcome === "string" ? parsed.outcome.trim() : undefined;
      const reason = typeof parsed.reason === "string" ? parsed.reason.trim() : undefined;
      const mergeObj =
        parsed.merge && typeof parsed.merge === "object"
          ? (parsed.merge as Record<string, unknown>)
          : null;
      const mergeDecision =
        mergeObj && typeof mergeObj.decision === "string" ? mergeObj.decision.trim() : undefined;
      const riskObj =
        parsed.risk && typeof parsed.risk === "object"
          ? (parsed.risk as Record<string, unknown>)
          : null;
      const risk = riskObj && typeof riskObj.level === "string" ? riskObj.level.trim() : undefined;
      return { outcome, reason, mergeDecision, risk, record: parsed, path: candidate };
    } catch {
      // Ignore partial write.
    }
  }
  return null;
}

export function readLocalPlanForSync(
  repoDir: string,
  issueKeyHint: string | undefined,
  modifiedAfterMs: number,
): Array<Record<string, unknown>> {
  const plansDir = join(resolve(repoDir), ".factory", "plans");
  if (!existsSync(plansDir)) return [];
  let files: string[];
  try {
    files = readdirSync(plansDir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const results: Array<Record<string, unknown>> = [];
  const normalizedHint = (issueKeyHint || "").trim().toUpperCase();
  for (const file of files) {
    const fullPath = join(plansDir, file);
    const stem = file.slice(0, -5);
    const matchesHint = Boolean(normalizedHint && stem.toUpperCase() === normalizedHint);
    let mtimeMs = 0;
    try {
      mtimeMs = statSync(fullPath).mtimeMs;
    } catch {
      continue;
    }
    if (!matchesHint && mtimeMs < modifiedAfterMs - 1500) continue;
    try {
      const parsed = JSON.parse(readFileSync(fullPath, "utf8")) as Record<string, unknown>;
      const rawCriteria = Array.isArray(parsed.criteria)
        ? parsed.criteria
        : parsed.contract &&
            typeof parsed.contract === "object" &&
            Array.isArray((parsed.contract as Record<string, unknown>).criteria)
          ? ((parsed.contract as Record<string, unknown>).criteria as unknown[])
          : [];
      const criteria = rawCriteria
        .map((c, idx) => {
          if (typeof c === "string" && c.trim()) return { id: `C${idx + 1}`, text: c.trim() };
          if (c && typeof c === "object") {
            const rec = c as Record<string, unknown>;
            const text = typeof rec.text === "string" ? rec.text.trim() : "";
            const id = typeof rec.id === "string" && rec.id.trim() ? rec.id.trim() : `C${idx + 1}`;
            if (text) return { id, text };
          }
          return null;
        })
        .filter((c): c is { id: string; text: string } => c !== null);
      if (criteria.length === 0) continue;
      const key =
        (typeof parsed.issueKey === "string" && parsed.issueKey.trim()) ||
        (normalizedHint && matchesHint ? normalizedHint : stem.toUpperCase());
      const objective =
        (typeof parsed.objective === "string" && parsed.objective.trim()) ||
        (parsed.contract &&
        typeof parsed.contract === "object" &&
        typeof (parsed.contract as Record<string, unknown>).objective === "string"
          ? String((parsed.contract as Record<string, unknown>).objective).trim()
          : "");
      const title =
        (typeof parsed.title === "string" && parsed.title.trim()) ||
        objective.slice(0, 120) ||
        `Ticket ${key}`;
      const specCount = Array.isArray(parsed.specs) ? parsed.specs.length : 0;
      results.push({
        issueKey: key,
        title,
        goal: objective || title,
        criteria,
        summary: `Clarified plan synced from .factory/plans/${file} (${criteria.length} criteria${specCount > 0 ? `, ${specCount} spec(s)` : ""})`,
      });
    } catch {
      // Ignore invalid JSON.
    }
  }
  return results;
}

async function flushSpool(cfg: SfConfig): Promise<{ sent: number; remaining: number }> {
  const files = listSpoolFiles();
  let sent = 0;
  let remaining = 0;
  for (const file of files) {
    let parsed: SpooledRequest;
    try {
      parsed = JSON.parse(readFileSync(file, "utf8")) as SpooledRequest;
    } catch {
      unlinkSync(file);
      continue;
    }
    const res = await sendJson(cfg, parsed.path, parsed.body, parsed.method || "POST");
    if (res.ok) {
      unlinkSync(file);
      sent += 1;
    } else if (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 429) {
      unlinkSync(file);
    } else {
      remaining += 1;
    }
  }
  return { sent, remaining };
}

async function deliverOrSpool(
  label: string,
  apiPath: string,
  body: Record<string, unknown>,
  method: HttpMethod = "POST",
  formatOk?: (data: unknown) => string,
): Promise<number> {
  const cfg = loadConfig();
  if (!cfg) {
    writeSpool(apiPath, body, method);
    console.log(`sf ${label}: spooled in ${spoolDir()} (not logged in; run \`sf login\`)`);
    return 0;
  }
  await flushSpool(cfg);
  const res = await sendJson(cfg, apiPath, body, method);
  if (res.ok) {
    console.log(formatOk ? formatOk(res.data) : `sf ${label}: ok`);
    return 0;
  }
  if (res.status === 0 || res.status >= 500 || res.status === 429) {
    writeSpool(apiPath, body, method);
    console.log(`sf ${label}: spooled (${res.error})`);
  } else {
    console.error(`sf ${label}: server rejected (${res.error})`);
  }
  return 0;
}

async function readStdinText(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseDashboardJs(filePath: string): unknown {
  const raw = readFileSync(filePath, "utf8").trim();
  const assignIdx = raw.indexOf("=");
  if (assignIdx === -1) return null;
  let rhs = raw.slice(assignIdx + 1).trim();
  if (rhs.endsWith(";")) rhs = rhs.slice(0, -1).trim();
  try {
    return JSON.parse(rhs);
  } catch {
    return null;
  }
}

async function cmdLogin(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { url: { type: "string" }, token: { type: "string" } },
    strict: true,
  });
  const url = (values.url || process.env.SF_URL || "http://localhost:8787")
    .trim()
    .replace(/\/+$/, "");
  let token = (values.token || "").trim();
  if (!token) {
    if (process.stdin.isTTY) {
      console.error("sf login: pass --token <sf_token> or pipe token on stdin");
      return 2;
    }
    token = (await readStdinText()).split(/\r?\n/)[0]?.trim() || "";
  }
  if (!token) {
    console.error("sf login: token is empty");
    return 2;
  }
  const res = await fetch(`${url}/api/v1/me`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  });
  const data = (await res.json().catch(() => null)) as {
    user?: { githubLogin?: string };
    error?: string;
  } | null;
  if (!res.ok || !data?.user?.githubLogin) {
    console.error(`sf login: failed (${data?.error || `HTTP ${res.status}`})`);
    return 1;
  }
  saveConfig({ url, token });
  console.log(`sf login: logged in as @${data.user.githubLogin} (${url})`);
  return 0;
}

async function cmdWhoami(): Promise<number> {
  const cfg = loadConfig();
  if (!cfg) {
    console.log("sf: not logged in. Run `sf login --url http://localhost:8787 --token <token>`");
    return 1;
  }
  const spooled = listSpoolFiles().length;
  try {
    const { ok, status, data } = await getJson(cfg, "/api/v1/me");
    const rec = data as { user?: { githubLogin?: string }; tokenLabel?: string } | null;
    if (ok && rec?.user?.githubLogin) {
      console.log(
        `sf: @${rec.user.githubLogin} on ${cfg.url} (token: ${rec.tokenLabel || "active"}, spooled: ${spooled})`,
      );
      return 0;
    }
    console.error(`sf: token rejected by ${cfg.url} (HTTP ${status})`);
    return 1;
  } catch (error) {
    console.error(
      `sf: cannot reach ${cfg.url} (${error instanceof Error ? error.message : "network error"}, spooled: ${spooled})`,
    );
    return 1;
  }
}

async function cmdStart(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      run: { type: "string" },
      project: { type: "string" },
      repo: { type: "string" },
      title: { type: "string" },
      engine: { type: "string" },
      mode: { type: "string" },
      base: { type: "string" },
      target: { type: "string" },
      model: { type: "string" },
    },
    strict: true,
  });
  if (!values.run?.trim()) {
    console.error("sf start: --run <run-id> is required");
    return 2;
  }
  const ctx = inferProjectContext(values.repo, values.project);
  const repoDir = ctx.localPath || process.cwd();
  return deliverOrSpool(`start ${values.run.trim()}`, "/api/v1/runs/start", {
    run: values.run.trim(),
    project: ctx.project,
    repo: ctx.localPath,
    title: values.title?.trim() || values.run.trim(),
    engine: values.engine?.trim() || undefined,
    mode: values.mode?.trim() || undefined,
    base: values.base?.trim() || gitFallback(repoDir, ["rev-parse", "HEAD"]),
    target: values.target?.trim() || gitFallback(repoDir, ["branch", "--show-current"]),
    model: values.model?.trim() || undefined,
  });
}

async function cmdAgent(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      run: { type: "string" },
      agent: { type: "string" },
      status: { type: "string" },
      name: { type: "string" },
      role: { type: "string" },
      spec: { type: "string" },
      level: { type: "string" },
      model: { type: "string" },
      activity: { type: "string" },
      summary: { type: "string" },
      "input-tokens": { type: "string" },
      "output-tokens": { type: "string" },
      "cache-read-tokens": { type: "string" },
      "cost-usd": { type: "string" },
      project: { type: "string" },
      repo: { type: "string" },
    },
    strict: true,
  });
  if (!values.run?.trim() || !values.agent?.trim()) {
    console.error("sf agent: --run and --agent are required");
    return 2;
  }
  const ctx = inferProjectContext(values.repo, values.project);
  return deliverOrSpool(`agent ${values.agent.trim()}`, "/api/v1/runs/agent", {
    run: values.run.trim(),
    agentKey: values.agent.trim(),
    status: values.status?.trim() || "working",
    name: values.name?.trim() || undefined,
    role: values.role?.trim() || undefined,
    specId: values.spec?.trim() || undefined,
    level: values.level !== undefined ? Number(values.level) : undefined,
    model: values.model?.trim() || undefined,
    activity: values.activity?.trim() || undefined,
    summary: values.summary?.trim() || undefined,
    inputTokens: values["input-tokens"] !== undefined ? Number(values["input-tokens"]) : undefined,
    outputTokens:
      values["output-tokens"] !== undefined ? Number(values["output-tokens"]) : undefined,
    cacheReadTokens:
      values["cache-read-tokens"] !== undefined ? Number(values["cache-read-tokens"]) : undefined,
    costUsd: values["cost-usd"] !== undefined ? Number(values["cost-usd"]) : undefined,
    project: ctx.project,
    repo: ctx.localPath,
  });
}

async function cmdStep(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      run: { type: "string" },
      project: { type: "string" },
      repo: { type: "string" },
      step: { type: "string" },
      phase: { type: "string" },
      status: { type: "string" },
      round: { type: "string" },
      spec: { type: "string" },
      role: { type: "string" },
      agent: { type: "string" },
      label: { type: "string" },
      model: { type: "string" },
      "duration-ms": { type: "string" },
      "input-tokens": { type: "string" },
      "output-tokens": { type: "string" },
      "cache-read-tokens": { type: "string" },
      "cost-usd": { type: "string" },
      summary: { type: "string" },
      data: { type: "string" },
    },
    strict: true,
  });
  if (!values.run?.trim() || !values.step?.trim() || !values.phase?.trim() || !values.status?.trim()) {
    console.error("sf step: --run, --step, --phase, and --status are required");
    return 2;
  }
  let parsedData: unknown = undefined;
  if (values.data) {
    try {
      parsedData = JSON.parse(values.data);
    } catch {
      parsedData = values.data;
    }
  }
  const ctx = inferProjectContext(values.repo, values.project);
  return deliverOrSpool(
    `step ${values.phase.trim()}/${values.step.trim()} (${values.status.trim()})`,
    "/api/v1/runs/step",
    {
      run: values.run.trim(),
      project: ctx.project,
      repo: ctx.localPath,
      step: values.step.trim(),
      phase: values.phase.trim(),
      status: values.status.trim(),
      round: values.round !== undefined ? Number(values.round) : undefined,
      spec: values.spec?.trim() || undefined,
      role: values.role?.trim() || undefined,
      agent: values.agent?.trim() || undefined,
      label: values.label?.trim() || undefined,
      model: values.model?.trim() || undefined,
      durationMs: values["duration-ms"] !== undefined ? Number(values["duration-ms"]) : undefined,
      inputTokens:
        values["input-tokens"] !== undefined ? Number(values["input-tokens"]) : undefined,
      outputTokens:
        values["output-tokens"] !== undefined ? Number(values["output-tokens"]) : undefined,
      cacheReadTokens:
        values["cache-read-tokens"] !== undefined ? Number(values["cache-read-tokens"]) : undefined,
      costUsd: values["cost-usd"] !== undefined ? Number(values["cost-usd"]) : undefined,
      summary: values.summary?.trim() || undefined,
      data: parsedData,
    },
  );
}

const ARTIFACT_TEXT_EXTS: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".mdx": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".css": "text/css; charset=utf-8",
};
const ARTIFACT_BIN_EXTS: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

const CONTEXT_TOP_FILES = new Set([
  "CODING_STANDARDS.md",
  "GEMINI.md",
  "CLAUDE.md",
  "AGENTS.md",
  "README.md",
  "DESIGN.md",
]);
const CONTEXT_IGNORED_DIRS = new Set([
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
const CONTEXT_ALLOWED_EXTS = new Set([
  ".md",
  ".mdx",
  ".json",
  ".yml",
  ".yaml",
  ".txt",
  ".toml",
  ".css",
]);

function scanLocalContextLakeFiles(repoDir: string): Array<{
  path: string;
  content: string;
  bytes: number;
  sha: string;
}> {
  const root = resolve(repoDir);
  if (!existsSync(root)) return [];
  const out: Array<{ path: string; content: string; bytes: number; sha: string }> = [];
  const seen = new Set<string>();

  function collect(relPath: string) {
    if (out.length >= 80) return;
    const norm = relPath.replace(/\\/g, "/");
    if (seen.has(norm)) return;
    const ext = extname(norm).toLowerCase();
    if (!CONTEXT_TOP_FILES.has(norm) && !CONTEXT_ALLOWED_EXTS.has(ext)) return;
    const abs = join(root, norm);
    if (!existsSync(abs)) return;
    try {
      const st = statSync(abs);
      if (!st.isFile() || st.size > 512_000) return;
      const raw = readFileSync(abs, "utf8");
      if (raw.includes("\u0000")) return;
      seen.add(norm);
      out.push({
        path: norm,
        content: raw.slice(0, 48_000),
        bytes: Buffer.byteLength(raw, "utf8"),
        sha: createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 16),
      });
    } catch {
      // Skip unreadable file.
    }
  }

  function walk(relDir: string, depth: number) {
    if (depth > 6 || out.length >= 80) return;
    const absDir = join(root, relDir);
    if (!existsSync(absDir)) return;
    let names: string[];
    try {
      names = readdirSync(absDir).sort();
    } catch {
      return;
    }
    for (const name of names) {
      if (out.length >= 80) break;
      if (CONTEXT_IGNORED_DIRS.has(name)) continue;
      const nextRel = relDir ? `${relDir}/${name}` : name;
      const nextAbs = join(root, nextRel);
      try {
        const st = statSync(nextAbs);
        if (st.isDirectory()) walk(nextRel, depth + 1);
        else if (st.isFile()) collect(nextRel);
      } catch {
        // Ignore inaccessible entries.
      }
    }
  }

  walk(".factory", 0);
  for (const top of CONTEXT_TOP_FILES) collect(top);
  walk("docs/ba", 0);
  walk("docs/dev/adr", 0);
  return out;
}

async function cmdArtifact(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      run: { type: "string" },
      kind: { type: "string" },
      path: { type: "string" },
      title: { type: "string" },
      project: { type: "string" },
      repo: { type: "string" },
    },
    strict: true,
  });
  if (!values.run?.trim() || !values.path?.trim()) {
    console.error("sf artifact: --run and --path are required");
    return 2;
  }
  const ctx = inferProjectContext(values.repo, values.project);
  const isUrl = /^https?:\/\//i.test(values.path.trim());
  const pathVal = isUrl ? values.path.trim() : resolve(values.path.trim());
  let mimeType: string | undefined;
  let contentText: string | undefined;
  let contentBase64: string | undefined;

  if (!isUrl && existsSync(pathVal)) {
    try {
      const st = statSync(pathVal);
      const ext = extname(pathVal).toLowerCase();
      if (st.isFile() && ext in ARTIFACT_TEXT_EXTS && st.size <= 1_500_000) {
        mimeType = ARTIFACT_TEXT_EXTS[ext];
        contentText = readFileSync(pathVal, "utf8");
      } else if (st.isFile() && ext in ARTIFACT_BIN_EXTS && st.size <= 2_000_000) {
        mimeType = ARTIFACT_BIN_EXTS[ext];
        contentBase64 = readFileSync(pathVal).toString("base64");
      }
    } catch {
      // Fall back to path-only reference if unreadable.
    }
  }

  return deliverOrSpool(`artifact ${values.kind || "file"}`, "/api/v1/runs/artifact", {
    run: values.run.trim(),
    kind: values.kind?.trim() || "log",
    title: values.title?.trim() || basename(pathVal),
    pathOrUrl: pathVal,
    ...(mimeType ? { mimeType } : {}),
    ...(contentText !== undefined ? { contentText } : {}),
    ...(contentBase64 !== undefined ? { contentBase64 } : {}),
    project: ctx.project,
    repo: ctx.localPath,
  });
}

async function cmdPrototype(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      path: { type: "string" },
      title: { type: "string" },
      slug: { type: "string" },
      issue: { type: "string" },
      kind: { type: "string" },
      binding: { type: "string" },
      run: { type: "string" },
      project: { type: "string" },
      repo: { type: "string" },
    },
    strict: true,
  });
  if (!values.path?.trim()) {
    console.error("sf prototype: --path <index.html|dir> is required");
    return 2;
  }
  const rawTarget = resolve(values.path.trim());
  const htmlFile =
    existsSync(rawTarget) && statSync(rawTarget).isDirectory()
      ? join(rawTarget, "index.html")
      : rawTarget;
  if (!existsSync(htmlFile)) {
    console.error(`sf prototype: file not found: ${htmlFile}`);
    return 1;
  }
  const htmlContent = readFileSync(htmlFile, "utf8");
  const manifestPath = join(dirname(htmlFile), "prototype.json");
  let manifest: Record<string, unknown> = {};
  if (existsSync(manifestPath)) {
    try {
      const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        manifest = parsed as Record<string, unknown>;
      }
    } catch {
      // Ignore invalid prototype.json.
    }
  }

  const issueKeys = (values.issue || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const ctx = inferProjectContext(values.repo, values.project);
  return deliverOrSpool(`prototype ${values.slug || basename(dirname(htmlFile))}`, "/api/v1/prototypes", {
    project: ctx.project,
    repo: ctx.localPath,
    run: values.run?.trim() || undefined,
    slug: values.slug?.trim() || undefined,
    title:
      values.title?.trim() ||
      (typeof manifest.title === "string" && manifest.title.trim()) ||
      basename(dirname(htmlFile)),
    kind: values.kind?.trim() || (typeof manifest.kind === "string" ? manifest.kind : "ticket"),
    binding:
      values.binding?.trim() || (typeof manifest.binding === "string" ? manifest.binding : "flow"),
    issueKeys: issueKeys.length > 0 ? issueKeys : undefined,
    htmlPath: htmlFile,
    htmlContent,
    manifest,
  });
}

async function cmdSyncContext(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      project: { type: "string" },
      repo: { type: "string" },
    },
    strict: true,
  });
  const ctx = inferProjectContext(values.repo, values.project);
  const repoDir = ctx.localPath || process.cwd();
  const files = scanLocalContextLakeFiles(repoDir);
  return deliverOrSpool(
    `sync-context (${files.length} files)`,
    "/api/v1/projects/context-sync",
    {
      project: ctx.project,
      repo: repoDir,
      source: "daemon",
      replaceAll: true,
      files,
    },
    "POST",
    (data) => {
      const rec = data as { savedCount?: number; initComplete?: boolean } | null;
      return `sf sync-context: synced ${rec?.savedCount ?? files.length} file(s)${rec?.initComplete ? " · init complete" : ""}`;
    },
  );
}

async function cmdAsk(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      run: { type: "string" },
      title: { type: "string" },
      type: { type: "string" },
      prompt: { type: "string" },
      options: { type: "string" },
      agent: { type: "string" },
      wait: { type: "boolean" },
      "timeout-sec": { type: "string" },
      project: { type: "string" },
      repo: { type: "string" },
    },
    strict: true,
  });
  if (!values.run?.trim() || !values.title?.trim()) {
    console.error("sf ask: --run and --title are required");
    return 2;
  }
  const cfg = loadConfig();
  if (!cfg) {
    console.error("sf ask: login required (`sf login`)");
    return 1;
  }
  let parsedPayload: Record<string, unknown> | undefined;
  if (values.options?.trim()) {
    const rawOpts = values.options.trim();
    try {
      const parsed = JSON.parse(rawOpts) as unknown;
      if (Array.isArray(parsed)) {
        parsedPayload = { options: parsed };
      } else if (parsed && typeof parsed === "object") {
        parsedPayload = parsed as Record<string, unknown>;
      }
    } catch {
      const splitOpts = rawOpts
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (splitOpts.length > 0) {
        parsedPayload = { options: splitOpts };
      }
    }
  }
  const ctx = inferProjectContext(values.repo, values.project);
  const created = await sendJson(cfg, "/api/v1/runs/interaction", {
    run: values.run.trim(),
    title: values.title.trim(),
    type: values.type?.trim() || "question",
    prompt: values.prompt?.trim() || undefined,
    payload: parsedPayload,
    agentKey: values.agent?.trim() || undefined,
    project: ctx.project,
    repo: ctx.localPath,
  });
  if (!created.ok) {
    console.error(`sf ask: ${created.error}`);
    return 1;
  }
  const interactionId = (created.data as { interaction?: { id?: string } })?.interaction?.id;
  if (!values.wait || !interactionId) {
    console.log(JSON.stringify(created.data));
    return 0;
  }
  const timeoutMs = (Number(values["timeout-sec"]) || 3600) * 1000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const check = await getJson(cfg, `/api/v1/runs/interaction?id=${encodeURIComponent(interactionId)}`);
    const inter = (check.data as { interaction?: { status?: string; response?: unknown } })
      ?.interaction;
    if (inter && inter.status !== "pending") {
      console.log(JSON.stringify(inter));
      return 0;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.error("sf ask: timed out waiting for response");
  return 1;
}

async function cmdFinish(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      run: { type: "string" },
      project: { type: "string" },
      repo: { type: "string" },
      outcome: { type: "string" },
      summary: { type: "string" },
      risk: { type: "string" },
      merge: { type: "string" },
      merged: { type: "string" },
      "pr-number": { type: "string" },
      "pr-url": { type: "string" },
      "duration-ms": { type: "string" },
    },
    strict: true,
  });
  if (!values.run?.trim() || !values.outcome?.trim()) {
    console.error("sf finish: --run and --outcome <passed|failed|blocked> are required");
    return 2;
  }
  const ctx = inferProjectContext(values.repo, values.project);
  return deliverOrSpool(`finish ${values.run.trim()} (${values.outcome.trim()})`, "/api/v1/runs/finish", {
    run: values.run.trim(),
    project: ctx.project,
    repo: ctx.localPath,
    outcome: values.outcome.trim(),
    summary: values.summary?.trim() || undefined,
    risk: values.risk?.trim() || undefined,
    merge: values.merge?.trim() || undefined,
    merged: values.merged?.trim() || undefined,
    prNumber: values["pr-number"] !== undefined ? Number(values["pr-number"]) : undefined,
    prUrl: values["pr-url"]?.trim() || undefined,
    durationMs: values["duration-ms"] !== undefined ? Number(values["duration-ms"]) : undefined,
  });
}

function resolveMonorepoRoot(explicitRoot?: string): string {
  if (explicitRoot && explicitRoot.trim()) return resolve(explicitRoot.trim());
  const starts = [dirname(resolve(process.argv[1] || ".")), process.cwd()];
  for (const start of starts) {
    let cur = start;
    for (let depth = 0; depth < 6; depth += 1) {
      if (
        existsSync(join(cur, "antigravity/factory/dashboard")) ||
        existsSync(join(cur, "claude/factory/dashboard"))
      ) {
        return cur;
      }
      const parent = dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  }
  return dirname(dirname(dirname(resolve(process.argv[1] || "."))));
}

export function estimateCostUsd(
  engine: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
): number {
  const m = model.toLowerCase();
  // Per-1M token rough rates (USD): [input, output, cacheRead]
  let rates: [number, number, number] = [2.5, 10.0, 0.25];
  if (m.includes("opus") || m.includes("fable")) rates = [15.0, 75.0, 1.5];
  else if (m.includes("neon") || m.includes("orchestrator")) rates = [3.5, 14.0, 0.35];
  else if (m.includes("sonnet")) rates = [3.0, 15.0, 0.3];
  else if (m.includes("carbon")) rates = [1.25, 5.0, 0.125];
  else if (m.includes("haiku") || m.includes("hydrogen") || m.includes("flash")) {
    rates = [0.35, 1.4, 0.04];
  } else if (engine === "claude") {
    rates = [3.0, 15.0, 0.3];
  }
  const usd =
    (inputTokens * rates[0] + outputTokens * rates[1] + cacheReadTokens * rates[2]) / 1_000_000;
  return Number(usd.toFixed(6));
}

function summarizeToolParams(toolName: string, params: unknown): string {
  if (!params || typeof params !== "object") return toolName;
  const obj = params as Record<string, unknown>;
  const pick =
    obj.CommandLine ??
    obj.command ??
    obj.Path ??
    obj.path ??
    obj.file_path ??
    obj.TargetFile ??
    obj.AbsolutePath ??
    obj.query ??
    obj.Query ??
    obj.pattern ??
    obj.Description ??
    obj.description ??
    obj.Role ??
    obj.role ??
    obj.toolSummary;
  if (typeof pick === "string" && pick.trim()) {
    const compact = pick.trim().replace(/\s+/g, " ").slice(0, 90);
    return `${toolName}: ${compact}`;
  }
  return toolName;
}

type SubagentMeta = {
  agentKey: string;
  name: string;
  role: string;
  specId?: string;
  level: number;
  phase: string;
  preserveExistingName: boolean;
};

const WORKFLOW_PHASE_RE = /^\s*-\s*\[phase\]\s+(.+?)\s*$/;
const WORKFLOW_AGENT_RE =
  /^\s*-\s*\[agent:([^\]]+)\]\s+(.+?):\s+(running|done|failed|error|blocked)\s+\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)(?::\s*(.*))?$/i;
const SUBAGENT_CREATED_CONV_RE = /"conversationId"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/i;

function parseAgyWorkflowAgentMeta(
  rawLabel: string,
  fallbackPhase: string,
  convId: string,
): SubagentMeta {
  const label = rawLabel.trim();
  if (/^ba(?:\b|$)/i.test(label)) {
    return {
      agentKey: "ba",
      name: "BA Analyst",
      role: "planner",
      level: 0,
      phase: "Spec",
      preserveExistingName: true,
    };
  }
  if (/^planner(?:\b|$)/i.test(label)) {
    return {
      agentKey: "planner",
      name: "Planner",
      role: "planner",
      level: 0,
      phase: "Spec",
      preserveExistingName: true,
    };
  }
  const buildMatch = /^(?:build|rebuild(?:\s+\d+)?)\s+(S\d+)\b/i.exec(label);
  if (buildMatch) {
    const specId = buildMatch[1].toUpperCase();
    return {
      agentKey: `${specId}-impl`,
      name: `${specId}: Implementer`,
      role: "implementer",
      specId,
      level: 1,
      phase: "Build",
      preserveExistingName: true,
    };
  }
  const qaMatch = /^qa\s+(S\d+)\b/i.exec(label);
  if (qaMatch) {
    const specId = qaMatch[1].toUpperCase();
    return {
      agentKey: `${specId}-qa`,
      name: `${specId} QA`,
      role: "qa",
      specId,
      level: 1,
      phase: "Build",
      preserveExistingName: true,
    };
  }
  if (/^checker(?:\b|$)/i.test(label)) {
    return {
      agentKey: "checker",
      name: "Checker",
      role: "checker",
      level: 3,
      phase: "Check",
      preserveExistingName: true,
    };
  }
  if (/^reviewer(?:\b|$)/i.test(label)) {
    return {
      agentKey: "whole change",
      name: "Reviewer (whole change)",
      role: "reviewer",
      level: 4,
      phase: "Review",
      preserveExistingName: true,
    };
  }
  const specRevMatch = /^review\s+(S\d+)\b/i.exec(label);
  if (specRevMatch) {
    const specId = specRevMatch[1].toUpperCase();
    return {
      agentKey: specId,
      name: `Reviewer (${specId})`,
      role: "spec-reviewer",
      specId,
      level: 4,
      phase: "Review",
      preserveExistingName: true,
    };
  }
  if (/^qc(?:\b|$)/i.test(label)) {
    return {
      agentKey: "qc",
      name: "QC (Playwright)",
      role: "qc",
      level: 4,
      phase: "Review",
      preserveExistingName: true,
    };
  }
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return {
    agentKey: slug ? `${slug}-${convId.slice(0, 6)}` : `sub-${convId.slice(0, 8)}`,
    name: label || `Subagent ${convId.slice(0, 8)}`,
    role: "subagent",
    level: 1,
    phase: fallbackPhase || "Build",
    preserveExistingName: false,
  };
}

function parseAgyToolArgs(rawArgs: unknown): Record<string, unknown> {
  if (!rawArgs || typeof rawArgs !== "object" || Array.isArray(rawArgs)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rawArgs as Record<string, unknown>)) {
    if (typeof v === "string") {
      const trimmed = v.trim();
      if (
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
        trimmed === "true" ||
        trimmed === "false"
      ) {
        try {
          out[k] = JSON.parse(trimmed);
          continue;
        } catch {
          // Keep raw string when truncated in compact transcript.jsonl
        }
      }
      if (trimmed.startsWith('"')) {
        out[k] = trimmed.slice(1).replace(/\\n/g, "\n").replace(/\\"/g, '"');
      } else {
        out[k] = v;
      }
    } else {
      out[k] = v;
    }
  }
  return out;
}

function resolveAgyBrainDir(convId: string): string | null {
  const candidates = [
    join(homedir(), ".gemini", "antigravity-cli", "brain", convId),
    join(homedir(), ".gemini", "antigravity", "brain", convId),
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return null;
}

function readNewTextFromOffset(
  filePath: string,
  offset: number,
): { text: string; nextOffset: number } {
  if (!existsSync(filePath)) return { text: "", nextOffset: offset };
  let size = 0;
  try {
    size = statSync(filePath).size;
  } catch {
    return { text: "", nextOffset: offset };
  }
  if (size <= offset) return { text: "", nextOffset: offset };
  const toRead = size - offset;
  const buf = Buffer.allocUnsafe(toRead);
  let fd: number | null = null;
  try {
    fd = openSync(filePath, "r");
    let totalRead = 0;
    while (totalRead < toRead) {
      const n = readSync(fd, buf, totalRead, toRead - totalRead, offset + totalRead);
      if (n <= 0) break;
      totalRead += n;
    }
    return {
      text: buf.subarray(0, totalRead).toString("utf8"),
      nextOffset: offset + totalRead,
    };
  } catch {
    return { text: "", nextOffset: offset };
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // Ignore close errors.
      }
    }
  }
}

function readRootTranscriptUsage(convId: string): AgyTokenTotals {
  const totals: AgyTokenTotals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  if (!convId.trim()) return totals;
  const brainDir = resolveAgyBrainDir(convId.trim().toLowerCase());
  if (!brainDir) return totals;
  const transcriptPath = join(brainDir, ".system_generated", "logs", "transcript.jsonl");
  if (!existsSync(transcriptPath)) return totals;
  try {
    const raw = readFileSync(transcriptPath, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("{")) continue;
      try {
        const entry = JSON.parse(trimmed) as Record<string, unknown>;
        if (entry.type !== "PLANNER_RESPONSE") continue;
        totals.inputTokens += Number(entry.input_tokens || 0);
        totals.outputTokens += Number(entry.output_tokens || 0);
        totals.cacheReadTokens += Number(entry.cache_read_tokens || 0);
      } catch {
        // Ignore malformed line.
      }
    }
  } catch {
    // Ignore unreadable transcript.
  }
  return totals;
}

function createAgySubagentTracker(opts: {
  runKey: string;
  baseCtx: Record<string, unknown>;
  defaultPhase: string;
  initialRootOffset?: number;
  enqueuePost: (path: string, body: Record<string, unknown>) => void;
  emitLive?: (chunk: Record<string, unknown>) => void;
  onActivity?: () => void;
  onLog?: (msg: string) => void;
}) {
  const {
    runKey,
    baseCtx,
    defaultPhase,
    initialRootOffset = 0,
    enqueuePost,
    emitLive,
    onActivity,
    onLog,
  } = opts;

  type BgTaskState = {
    desc: string;
    logPath?: string;
    lastSize: number;
  };

  type TrackedConv = {
    convId: string;
    isRoot: boolean;
    meta: SubagentMeta;
    brainDir: string | null;
    byteOffset: number;
    lineRemainder: string;
    model: string;
    status: "working" | "passed" | "failed";
    activity: string;
    summary: string;
    lastSentStatus: string;
    lastSentActivity: string;
    lastSentModel: string;
    lastSentSummary: string;
    pendingSubagentSpawns: Array<{ role: string; typeName: string }>;
    runningBgTasks: Map<number, BgTaskState>;
    stepsEmitted: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    costUsd: number;
    loggedDone: boolean;
  };

  let rootConvId: string | null = null;
  let currentWorkflowPhase = defaultPhase;
  const convs = new Map<string, TrackedConv>();
  const taskLogSizes = new Map<string, number>();
  const watchers: FSWatcher[] = [];
  const watchedDirs = new Set<string>();
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let liveMode = false;

  function flushAgentUpdate(st: TrackedConv, force = false) {
    if (st.isRoot || !runKey) return;
    if (
      !force &&
      st.status === st.lastSentStatus &&
      st.activity === st.lastSentActivity &&
      st.model === st.lastSentModel &&
      st.summary === st.lastSentSummary
    ) {
      return;
    }
    st.lastSentStatus = st.status;
    st.lastSentActivity = st.activity;
    st.lastSentModel = st.model;
    st.lastSentSummary = st.summary;
    emitLive?.({
      kind: "activity",
      agentKey: st.meta.agentKey,
      agentName: st.meta.name,
      role: st.meta.role,
      status: st.status,
      activity: st.activity ? st.activity.slice(0, 160) : "",
      model: st.model || undefined,
      ts: Date.now(),
    });
    enqueuePost("/api/v1/runs/agent", {
      run: runKey,
      ...baseCtx,
      agentKey: st.meta.agentKey,
      name: st.meta.name,
      preserveExistingName: st.meta.preserveExistingName,
      role: st.meta.role,
      specId: st.meta.specId,
      level: st.meta.level,
      model: st.model || undefined,
      status: st.status,
      activity: st.activity ? st.activity.slice(0, 160) : undefined,
      summary: st.summary ? st.summary.slice(0, 1000) : undefined,
    });
  }

  function registerConv(
    convId: string,
    meta: SubagentMeta,
    isRoot: boolean,
    initialStatus: "working" | "passed" | "failed" = "working",
    summaryText = "",
  ): TrackedConv {
    const existing = convs.get(convId);
    if (existing) {
      if (!isRoot) {
        if (meta.phase && meta.phase !== existing.meta.phase) {
          existing.meta.phase = meta.phase;
        }
        if (initialStatus !== existing.status) {
          existing.status = initialStatus;
        }
        if (summaryText && summaryText !== existing.summary) {
          existing.summary = summaryText;
        }
        flushAgentUpdate(existing);
        if ((existing.status === "passed" || existing.status === "failed") && !existing.loggedDone) {
          existing.loggedDone = true;
          const icon = existing.status === "passed" ? "✓" : "✗";
          onLog?.(
            `${icon} subagent ${existing.meta.name} (${existing.status}${existing.model ? ` · ${existing.model}` : ""}, ${existing.stepsEmitted} steps, in=${existing.inputTokens.toLocaleString()} out=${existing.outputTokens.toLocaleString()})`,
          );
        }
      }
      return existing;
    }
    const created: TrackedConv = {
      convId,
      isRoot,
      meta,
      brainDir: resolveAgyBrainDir(convId),
      byteOffset: isRoot && initialRootOffset > 0 ? initialRootOffset : 0,
      lineRemainder: "",
      model: "",
      status: initialStatus,
      activity: isRoot ? "" : `Spawned (${convId.slice(0, 8)})`,
      summary: summaryText,
      lastSentStatus: "",
      lastSentActivity: "",
      lastSentModel: "",
      lastSentSummary: "",
      pendingSubagentSpawns: [],
      runningBgTasks: new Map(),
      stepsEmitted: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      costUsd: 0,
      loggedDone: initialStatus !== "working",
    };
    convs.set(convId, created);
    if (!isRoot) {
      flushAgentUpdate(created, true);
      onActivity?.();
      onLog?.(
        `+ subagent ${meta.name} (${meta.role}${meta.phase ? ` · ${meta.phase}` : ""}) conv=${convId.slice(0, 8)}`,
      );
    }
    return created;
  }

  let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleSyncOnce() {
    if (syncDebounceTimer) return;
    syncDebounceTimer = setTimeout(() => {
      syncDebounceTimer = null;
      syncOnce();
    }, 35);
  }

  function watchDirLive(targetDir: string) {
    if (!liveMode || watchedDirs.has(targetDir) || !existsSync(targetDir)) return;
    watchedDirs.add(targetDir);
    try {
      const w = watch(targetDir, () => {
        scheduleSyncOnce();
      });
      watchers.push(w);
    } catch {
      // Fall back to periodic poll if fs.watch is unavailable.
    }
  }

  function scanTaskLogs(st: TrackedConv): boolean {
    if (!st.brainDir) return false;
    const tasksDir = join(st.brainDir, ".system_generated", "tasks");
    if (!existsSync(tasksDir)) return false;
    watchDirLive(tasksDir);

    let files: string[];
    try {
      files = readdirSync(tasksDir)
        .filter((f) => f.endsWith(".log"))
        .sort();
    } catch {
      return false;
    }

    let discoveredAny = false;
    for (const file of files) {
      const fullPath = join(tasksDir, file);
      let size = 0;
      try {
        size = statSync(fullPath).size;
      } catch {
        continue;
      }
      if (taskLogSizes.get(fullPath) === size) continue;
      taskLogSizes.set(fullPath, size);

      let content = "";
      try {
        content = readFileSync(fullPath, "utf8");
      } catch {
        continue;
      }

      let localPhase = currentWorkflowPhase;
      for (const rawLine of content.split(/\r?\n/)) {
        const phaseMatch = WORKFLOW_PHASE_RE.exec(rawLine);
        if (phaseMatch?.[1]) {
          localPhase = phaseMatch[1].trim();
          currentWorkflowPhase = localPhase;
          continue;
        }
        const agentMatch = WORKFLOW_AGENT_RE.exec(rawLine);
        if (!agentMatch) continue;
        const label = agentMatch[2].trim();
        const rawState = agentMatch[3].toLowerCase();
        const childConvId = agentMatch[4].toLowerCase();
        const tailSummary = (agentMatch[5] || "").trim().slice(0, 600);
        const mappedStatus: "working" | "passed" | "failed" =
          rawState === "done"
            ? "passed"
            : rawState === "failed" || rawState === "error" || rawState === "blocked"
              ? "failed"
              : "working";
        const meta = parseAgyWorkflowAgentMeta(label, localPhase, childConvId);
        const existed = convs.has(childConvId);
        const child = registerConv(childConvId, meta, false, mappedStatus, tailSummary);
        if (mappedStatus === "passed" && child.activity.startsWith("Running:")) {
          child.activity = "Completed";
          flushAgentUpdate(child);
        }
        if (!existed) discoveredAny = true;
      }
    }
    return discoveredAny;
  }

  function registerAdHocSubagent(parent: TrackedConv, childConvId: string) {
    if (convs.has(childConvId)) return false;
    const hint = parent.pendingSubagentSpawns.shift();
    const roleHint = hint?.typeName?.trim().toLowerCase() || "subagent";
    const normalizedRole = ["research", "browser", "planner", "reviewer", "qa", "qc"].includes(
      roleHint,
    )
      ? roleHint
      : "subagent";
    const displayName = hint?.role?.trim() || `${roleHint} (${childConvId.slice(0, 8)})`;
    const slug = displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 28);
    registerConv(
      childConvId,
      {
        agentKey: slug ? `${slug}-${childConvId.slice(0, 6)}` : `sub-${childConvId.slice(0, 8)}`,
        name: displayName,
        role: normalizedRole,
        specId: parent.meta.specId,
        level: parent.meta.level + 1,
        phase: parent.meta.phase || currentWorkflowPhase,
        preserveExistingName: false,
      },
      false,
      "working",
    );
    return true;
  }

  function drainTranscript(st: TrackedConv): boolean {
    if (!st.brainDir) {
      st.brainDir = resolveAgyBrainDir(st.convId);
      if (!st.brainDir) return false;
    }
    const logsDir = join(st.brainDir, ".system_generated", "logs");
    watchDirLive(logsDir);
    const transcriptPath = join(logsDir, "transcript.jsonl");
    const { text, nextOffset } = readNewTextFromOffset(transcriptPath, st.byteOffset);
    if (!text) return false;
    st.byteOffset = nextOffset;

    const combined = st.lineRemainder + text;
    const parts = combined.split("\n");
    st.lineRemainder = parts.pop() ?? "";

    const shortId = st.convId.slice(0, 8);
    let discoveredAny = false;
    let sawActivity = false;

    for (const rawLine of parts) {
      const trimmed = rawLine.trim();
      if (!trimmed || !trimmed.startsWith("{")) continue;
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        continue;
      }

      const stepIdx = Number(entry.step_index ?? 0);
      const entryType = String(entry.type || "");
      const entryStatus = String(entry.status || "").toUpperCase();
      const entryCreatedAt =
        typeof entry.created_at === "string" && entry.created_at.trim()
          ? entry.created_at.trim()
          : undefined;
      const content = typeof entry.content === "string" ? entry.content : "";

      // Detect invoke_subagent spawns in BOTH root and child transcripts (recursive tree!)
      if (entryType === "PLANNER_RESPONSE" && Array.isArray(entry.tool_calls)) {
        for (const rawTc of entry.tool_calls) {
          const tc = (rawTc || {}) as Record<string, unknown>;
          if (String(tc.name || "") === "invoke_subagent") {
            const parsedArgs = parseAgyToolArgs(tc.args);
            st.pendingSubagentSpawns.push({
              role: String(parsedArgs.Role || parsedArgs.role || ""),
              typeName: String(parsedArgs.TypeName || parsedArgs.typeName || "subagent"),
            });
          }
        }
      }
      if (entryType === "GENERIC" && content.includes("Created the following subagent")) {
        const match = SUBAGENT_CREATED_CONV_RE.exec(content);
        if (match?.[1]) {
          if (registerAdHocSubagent(st, match[1].toLowerCase())) {
            discoveredAny = true;
          }
        }
      }

      // Root's own tool calls & responses are streamed live from `agy --output-format stream-json`,
      // EXCEPT `thinking` (stream-json omits reasoning text) and `SYSTEM_MESSAGE` subagent completions.
      if (st.isRoot) {
        if (entryType === "PLANNER_RESPONSE") {
          const rootThinking = typeof entry.thinking === "string" ? entry.thinking.trim() : "";
          if (rootThinking) {
            sawActivity = true;
            emitLive?.({
              kind: "thinking",
              stepKey: `think-root-${shortId}-${stepIdx}`,
              agentKey: "orchestrator",
              agentName: "Session Orchestrator",
              text: rootThinking.slice(0, 4000),
              model: typeof entry.model === "string" && entry.model ? entry.model : undefined,
              ts: Date.now(),
            });
            enqueuePost("/api/v1/runs/step", {
              run: runKey,
              ...baseCtx,
              idempotent: true,
              keepAgentStatus: true,
              createdAt: entryCreatedAt,
              step: `think-root-${shortId}-${stepIdx}`,
              phase: currentWorkflowPhase,
              status: "info",
              role: "orchestrator",
              agent: "orchestrator",
              model: typeof entry.model === "string" && entry.model ? entry.model : undefined,
              label: "Thinking",
              summary: rootThinking.slice(0, 4000),
              data: {
                kind: "thinking",
                subagentConvId: st.convId,
                agentName: "Session Orchestrator",
              },
            });
          }
        } else if (entryType === "SYSTEM_MESSAGE") {
          const subSenderMatch =
            /\bsender=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?!\/task-)/i.exec(
              content,
            );
          if (subSenderMatch?.[1]) {
            const childSt = convs.get(subSenderMatch[1].toLowerCase());
            if (childSt && !childSt.isRoot && childSt.status === "working") {
              childSt.status = "passed";
              if (childSt.activity.startsWith("Spawned")) childSt.activity = "Completed";
              flushAgentUpdate(childSt);
              if (!childSt.loggedDone) {
                childSt.loggedDone = true;
                onLog?.(
                  `✓ subagent ${childSt.meta.name} (passed${childSt.model ? ` · ${childSt.model}` : ""}, ${childSt.stepsEmitted} steps, in=${childSt.inputTokens.toLocaleString()} out=${childSt.outputTokens.toLocaleString()})`,
                );
              }
            }
          }
        }
        continue;
      }
      sawActivity = true;

      if (entryType === "PLANNER_RESPONSE") {
        const model = typeof entry.model === "string" && entry.model ? entry.model : st.model;
        if (model) st.model = model;
        const inTok = Number(entry.input_tokens || 0);
        const outTok = Number(entry.output_tokens || 0);
        const cacheTok = Number(entry.cache_read_tokens || 0);
        const costUsd = estimateCostUsd("antigravity", st.model || "hydrogen", inTok, outTok, cacheTok);
        st.inputTokens += inTok;
        st.outputTokens += outTok;
        st.cacheReadTokens += cacheTok;
        st.costUsd += costUsd;
        let usageAttributed = false;

        const takeUsage = () => {
          if (usageAttributed) return {};
          usageAttributed = true;
          return {
            inputTokens: inTok || undefined,
            outputTokens: outTok || undefined,
            cacheReadTokens: cacheTok || undefined,
            costUsd: costUsd || undefined,
          };
        };

        const thinking = typeof entry.thinking === "string" ? entry.thinking.trim() : "";
        if (thinking) {
          st.stepsEmitted += 1;
          emitLive?.({
            kind: "thinking",
            stepKey: `think-${shortId}-${stepIdx}`,
            agentKey: st.meta.agentKey,
            agentName: st.meta.name,
            text: thinking.slice(0, 4000),
            model: st.model || undefined,
            ts: Date.now(),
          });
          enqueuePost("/api/v1/runs/step", {
            run: runKey,
            ...baseCtx,
            idempotent: true,
            keepAgentStatus: true,
            createdAt: entryCreatedAt,
            step: `think-${shortId}-${stepIdx}`,
            phase: st.meta.phase || currentWorkflowPhase,
            status: "info",
            role: st.meta.role,
            spec: st.meta.specId,
            agent: st.meta.agentKey,
            agentName: st.meta.name,
            model: st.model || undefined,
            ...takeUsage(),
            label: "Thinking",
            summary: thinking.slice(0, 4000),
            data: {
              kind: "thinking",
              subagentConvId: st.convId,
              agentName: st.meta.name,
            },
          });
        }

        const toolCalls = Array.isArray(entry.tool_calls) ? entry.tool_calls : [];
        for (let i = 0; i < toolCalls.length; i += 1) {
          const tc = (toolCalls[i] || {}) as Record<string, unknown>;
          const toolName = String(tc.name || "tool");
          const parsedArgs = parseAgyToolArgs(tc.args);
          const label = summarizeToolParams(toolName, parsedArgs);
          st.activity = label.slice(0, 150);
          st.stepsEmitted += 1;
          const safeTool = toolName.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 32) || "tool";
          emitLive?.({
            kind: "tool_active",
            stepKey: `${safeTool}-${shortId}-${stepIdx}-${i}`,
            agentKey: st.meta.agentKey,
            agentName: st.meta.name,
            tool: toolName,
            label: label.slice(0, 155),
            ts: Date.now(),
          });
          enqueuePost("/api/v1/runs/step", {
            run: runKey,
            ...baseCtx,
            idempotent: true,
            keepAgentStatus: true,
            createdAt: entryCreatedAt,
            step: `${safeTool}-${shortId}-${stepIdx}-${i}`,
            phase: st.meta.phase || currentWorkflowPhase,
            status: "passed",
            role: st.meta.role,
            spec: st.meta.specId,
            agent: st.meta.agentKey,
            agentName: st.meta.name,
            model: st.model || undefined,
            ...takeUsage(),
            label: label.slice(0, 155),
            data: {
              kind: "tool_call",
              tool: toolName,
              input: Object.keys(parsedArgs).length > 0 ? parsedArgs : undefined,
              subagentConvId: st.convId,
              agentName: st.meta.name,
            },
          });
        }

        const trimmedContent = content.trim();
        if (trimmedContent) {
          st.stepsEmitted += 1;
          st.activity = trimmedContent.replace(/\s+/g, " ").slice(0, 140);
          enqueuePost("/api/v1/runs/step", {
            run: runKey,
            ...baseCtx,
            idempotent: true,
            keepAgentStatus: true,
            createdAt: entryCreatedAt,
            step: `submsg-${shortId}-${stepIdx}`,
            phase: st.meta.phase || currentWorkflowPhase,
            status: "info",
            role: st.meta.role,
            spec: st.meta.specId,
            agent: st.meta.agentKey,
            agentName: st.meta.name,
            model: st.model || undefined,
            ...takeUsage(),
            label: `${st.meta.name}: response`,
            summary: trimmedContent.slice(0, 8000),
            data: {
              kind: "lifecycle",
              subagentConvId: st.convId,
              agentName: st.meta.name,
            },
          });
        } else if (!usageAttributed && (inTok > 0 || outTok > 0 || cacheTok > 0)) {
          st.stepsEmitted += 1;
          enqueuePost("/api/v1/runs/step", {
            run: runKey,
            ...baseCtx,
            idempotent: true,
            keepAgentStatus: true,
            createdAt: entryCreatedAt,
            step: `think-${shortId}-${stepIdx}`,
            phase: st.meta.phase || currentWorkflowPhase,
            status: "info",
            role: st.meta.role,
            spec: st.meta.specId,
            agent: st.meta.agentKey,
            agentName: st.meta.name,
            model: st.model || undefined,
            ...takeUsage(),
            label: "Thinking",
            data: {
              kind: "thinking",
              subagentConvId: st.convId,
              agentName: st.meta.name,
            },
          });
        }
        continue;
      }

      if (entryType === "GENERIC") {
        if (entryStatus === "RUNNING" && content.includes("Task Description:")) {
          const descMatch = /Task Description:\s*(.+)/i.exec(content);
          const taskDesc = (descMatch?.[1] || "background command").trim().slice(0, 110);
          const logMatch = /Task logs are available at:\s*file:\/\/(\S+)/i.exec(content);
          const taskLogPath = logMatch?.[1];
          let logTail = "";
          let logSize = 0;
          if (taskLogPath && existsSync(taskLogPath)) {
            try {
              logSize = statSync(taskLogPath).size;
              logTail = readFileSync(taskLogPath, "utf8").slice(-3000);
            } catch {
              // Ignore transient read error.
            }
          }
          st.runningBgTasks.set(stepIdx, { desc: taskDesc, logPath: taskLogPath, lastSize: logSize });
          st.activity = `Running: ${taskDesc}`.slice(0, 150);
          st.stepsEmitted += 1;
          enqueuePost("/api/v1/runs/step", {
            run: runKey,
            ...baseCtx,
            upsert: true,
            idempotent: true,
            keepAgentStatus: true,
            createdAt: entryCreatedAt,
            step: `bgtask-${shortId}-${stepIdx}`,
            phase: st.meta.phase || currentWorkflowPhase,
            status: "started",
            role: st.meta.role,
            spec: st.meta.specId,
            agent: st.meta.agentKey,
            agentName: st.meta.name,
            model: st.model || undefined,
            label: `Running: ${taskDesc}`.slice(0, 155),
            data: {
              kind: "tool_call",
              tool: "run_command",
              output: logTail || undefined,
              taskLogPath,
              subagentConvId: st.convId,
              agentName: st.meta.name,
            },
          });
        } else if (content.includes("Task is complete.")) {
          st.status = "passed";
          st.activity = "Completed";
          for (const [taskIdx, taskState] of st.runningBgTasks) {
            let finalTail = "";
            if (taskState.logPath && existsSync(taskState.logPath)) {
              try {
                finalTail = readFileSync(taskState.logPath, "utf8").slice(-3000);
              } catch {
                // Ignore read error.
              }
            }
            enqueuePost("/api/v1/runs/step", {
              run: runKey,
              ...baseCtx,
              upsert: true,
              idempotent: true,
              keepAgentStatus: true,
              step: `bgtask-${shortId}-${taskIdx}`,
              phase: st.meta.phase || currentWorkflowPhase,
              status: "passed",
              role: st.meta.role,
              spec: st.meta.specId,
              agent: st.meta.agentKey,
              agentName: st.meta.name,
              model: st.model || undefined,
              label: `Finished: ${taskState.desc}`.slice(0, 155),
              data: {
                kind: "tool_call",
                tool: "run_command",
                output: finalTail || undefined,
                taskLogPath: taskState.logPath,
                subagentConvId: st.convId,
                agentName: st.meta.name,
              },
            });
          }
          st.runningBgTasks.clear();
          if (!st.loggedDone) {
            st.loggedDone = true;
            onLog?.(
              `✓ subagent ${st.meta.name} (passed${st.model ? ` · ${st.model}` : ""}, ${st.stepsEmitted} steps, in=${st.inputTokens.toLocaleString()} out=${st.outputTokens.toLocaleString()})`,
            );
          }
        }
        continue;
      }

      if (entryType === "SYSTEM_MESSAGE") {
        // When an ad-hoc invoke_subagent finishes and sends its final reply back to its
        // parent, Antigravity delivers a SYSTEM_MESSAGE with `sender=<child-conv-id>`.
        const subSenderMatch =
          /\bsender=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?!\/task-)/i.exec(
            content,
          );
        if (subSenderMatch?.[1]) {
          const childSt = convs.get(subSenderMatch[1].toLowerCase());
          if (childSt && !childSt.isRoot && childSt.status === "working") {
            childSt.status = "passed";
            if (childSt.activity.startsWith("Spawned")) childSt.activity = "Completed";
            flushAgentUpdate(childSt);
            if (!childSt.loggedDone) {
              childSt.loggedDone = true;
              onLog?.(
                `✓ subagent ${childSt.meta.name} (passed${childSt.model ? ` · ${childSt.model}` : ""}, ${childSt.stepsEmitted} steps, in=${childSt.inputTokens.toLocaleString()} out=${childSt.outputTokens.toLocaleString()})`,
              );
            }
          }
        }
        if (st.runningBgTasks.size > 0) {
          const senderMatch = new RegExp(`sender=${st.convId}/task-(\\d+)`, "i").exec(content);
          if (senderMatch?.[1]) {
            const taskIdx = Number(senderMatch[1]);
            const taskState = st.runningBgTasks.get(taskIdx);
            if (taskState) {
              st.runningBgTasks.delete(taskIdx);
              let finalTail = "";
              if (taskState.logPath && existsSync(taskState.logPath)) {
                try {
                  finalTail = readFileSync(taskState.logPath, "utf8").slice(-3000);
                } catch {
                  // Ignore read error.
                }
              }
              enqueuePost("/api/v1/runs/step", {
                run: runKey,
                ...baseCtx,
                upsert: true,
                idempotent: true,
                keepAgentStatus: true,
                createdAt: entryCreatedAt,
                step: `bgtask-${shortId}-${taskIdx}`,
                phase: st.meta.phase || currentWorkflowPhase,
                status: "passed",
                role: st.meta.role,
                spec: st.meta.specId,
                agent: st.meta.agentKey,
                agentName: st.meta.name,
                model: st.model || undefined,
                label: `Finished: ${taskState.desc}`.slice(0, 155),
                data: {
                  kind: "tool_call",
                  tool: "run_command",
                  output: finalTail || undefined,
                  taskLogPath: taskState.logPath,
                  subagentConvId: st.convId,
                  agentName: st.meta.name,
                },
              });
            }
          }
        }
      }
    }

    if (sawActivity) {
      flushAgentUpdate(st);
      onActivity?.();
    }
    return discoveredAny;
  }

  function pollRunningBgTasks(st: TrackedConv) {
    if (st.isRoot || st.runningBgTasks.size === 0) return;
    const shortId = st.convId.slice(0, 8);
    for (const [taskIdx, taskState] of st.runningBgTasks) {
      if (!taskState.logPath || !existsSync(taskState.logPath)) continue;
      let size = 0;
      try {
        size = statSync(taskState.logPath).size;
      } catch {
        continue;
      }
      if (size <= taskState.lastSize) continue;
      taskState.lastSize = size;
      let logTail = "";
      try {
        logTail = readFileSync(taskState.logPath, "utf8").slice(-3000);
      } catch {
        continue;
      }
      onActivity?.();
      emitLive?.({
        kind: "tool_output",
        stepKey: `bgtask-${shortId}-${taskIdx}`,
        agentKey: st.meta.agentKey,
        agentName: st.meta.name,
        tool: "run_command",
        label: `Running: ${taskState.desc}`.slice(0, 155),
        output: logTail,
        ts: Date.now(),
      });
      enqueuePost("/api/v1/runs/step", {
        run: runKey,
        ...baseCtx,
        upsert: true,
        idempotent: true,
        keepAgentStatus: true,
        step: `bgtask-${shortId}-${taskIdx}`,
        phase: st.meta.phase || currentWorkflowPhase,
        status: "started",
        role: st.meta.role,
        spec: st.meta.specId,
        agent: st.meta.agentKey,
        agentName: st.meta.name,
        model: st.model || undefined,
        label: `Running: ${taskState.desc}`.slice(0, 155),
        data: {
          kind: "tool_call",
          tool: "run_command",
          output: logTail || undefined,
          taskLogPath: taskState.logPath,
          subagentConvId: st.convId,
          agentName: st.meta.name,
        },
      });
    }
  }

  function syncOnce() {
    if (!rootConvId || !runKey) return;
    for (let pass = 0; pass < 4; pass += 1) {
      let discovered = false;
      for (const st of Array.from(convs.values())) {
        if (!st.brainDir) st.brainDir = resolveAgyBrainDir(st.convId);
        if (scanTaskLogs(st)) discovered = true;
        if (drainTranscript(st)) discovered = true;
        pollRunningBgTasks(st);
      }
      if (!discovered) break;
    }
  }

  function attachRoot(convId: string, enableLive = true) {
    const clean = convId.trim().toLowerCase();
    if (!clean) return;
    if (!rootConvId) {
      rootConvId = clean;
      registerConv(
        clean,
        {
          agentKey: "orchestrator",
          name: "Session Orchestrator",
          role: "orchestrator",
          level: 0,
          phase: defaultPhase,
          preserveExistingName: true,
        },
        true,
        "working",
      );
    }
    if (enableLive && !liveMode) {
      liveMode = true;
      pollTimer = setInterval(() => {
        syncOnce();
      }, 1500);
    }
    syncOnce();
  }

  function handleStreamInvokeSubagent(roleHint: string, typeHint: string, outputText: string) {
    const match = SUBAGENT_CREATED_CONV_RE.exec(outputText);
    if (!match?.[1]) return;
    const root = rootConvId ? convs.get(rootConvId) : undefined;
    if (root) {
      root.pendingSubagentSpawns.push({ role: roleHint, typeName: typeHint || "subagent" });
      registerAdHocSubagent(root, match[1].toLowerCase());
      syncOnce();
    }
  }

  function hasActiveSubagents(): boolean {
    for (const st of convs.values()) {
      if (!st.isRoot && st.status === "working") return true;
    }
    return false;
  }

  function stop() {
    if (syncDebounceTimer) {
      clearTimeout(syncDebounceTimer);
      syncDebounceTimer = null;
    }
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    for (const w of watchers) {
      try {
        w.close();
      } catch {
        // Ignore close errors.
      }
    }
    watchers.length = 0;
    watchedDirs.clear();
    liveMode = false;
    syncOnce();
  }

  function getSummary() {
    const agents = Array.from(convs.values())
      .filter((st) => !st.isRoot)
      .map((st) => ({
        convId: st.convId,
        agentKey: st.meta.agentKey,
        name: st.meta.name,
        role: st.meta.role,
        status: st.status,
        model: st.model,
        stepsEmitted: st.stepsEmitted,
        inputTokens: st.inputTokens,
        outputTokens: st.outputTokens,
        cacheReadTokens: st.cacheReadTokens,
        costUsd: st.costUsd,
      }));
    const stepsEmitted = agents.reduce((acc, a) => acc + a.stepsEmitted, 0);
    return { subagentCount: agents.length, stepsEmitted, agents };
  }

  return {
    attachRoot,
    syncOnce,
    handleStreamInvokeSubagent,
    hasActiveSubagents,
    stop,
    getSummary,
  };
}

async function cmdSyncLive(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      file: { type: "string" },
      engine: { type: "string" },
      project: { type: "string" },
      repo: { type: "string" },
    },
    strict: true,
  });
  const defaultLivePath = existsSync(resolve("antigravity/factory/dashboard/live.js"))
    ? resolve("antigravity/factory/dashboard/live.js")
    : join(resolveMonorepoRoot(), "antigravity/factory/dashboard/live.js");
  const filePath = values.file ? resolve(values.file) : defaultLivePath;
  if (!existsSync(filePath)) {
    console.error(`sf sync-live: file not found: ${filePath}`);
    return 1;
  }
  const parsed = parseDashboardJs(filePath);
  if (!parsed) {
    console.error(`sf sync-live: could not parse JSON payload from ${filePath}`);
    return 1;
  }
  const records = Array.isArray(parsed) ? parsed : [parsed];
  const ctx = inferProjectContext(values.repo, values.project);
  return deliverOrSpool(`sync-live (${records.length})`, "/api/v1/runs/sync-live", {
    project: ctx.project,
    repo: ctx.localPath,
    engine: values.engine?.trim() || (filePath.includes("/claude/") ? "claude" : "antigravity"),
    records,
  });
}

async function cmdSyncSubagents(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      run: { type: "string" },
      conv: { type: "string" },
      project: { type: "string" },
      repo: { type: "string" },
      watch: { type: "boolean" },
    },
    strict: true,
  });
  const runKey = values.run?.trim() || "";
  if (!runKey) {
    console.error("sf sync-subagents: --run <run-id> is required");
    return 2;
  }
  const cfg = loadConfig();
  if (!cfg) {
    console.error("sf sync-subagents: not logged in");
    return 1;
  }
  let convId = values.conv?.trim() || "";
  if (!convId) {
    const sessionsFile = join(sfDir(), "sessions.json");
    if (existsSync(sessionsFile)) {
      try {
        const saved = JSON.parse(readFileSync(sessionsFile, "utf8")) as Record<
          string,
          { sessionId?: string }
        >;
        convId = saved[runKey]?.sessionId?.trim() || "";
      } catch {
        // Ignore malformed sessions file.
      }
    }
  }
  if (!convId) {
    console.error(
      `sf sync-subagents: pass --conv <parent-conv-id> (no saved session found for ${runKey})`,
    );
    return 2;
  }

  const ctx = inferProjectContext(values.repo, values.project);
  const baseCtx = {
    project: ctx.project,
    repo: ctx.localPath,
  };

  let chain: Promise<unknown> = Promise.resolve();
  const tracker = createAgySubagentTracker({
    runKey,
    baseCtx,
    defaultPhase: "Spec",
    enqueuePost: (path, body) => {
      chain = chain.then(() => sendJson(cfg, path, body)).catch(() => {});
    },
  });

  if (values.watch) {
    tracker.attachRoot(convId, true);
    console.log(`sf sync-subagents: watching ${convId} for run ${runKey} (Ctrl+C to stop)`);
    await new Promise<void>((resolveStop) => {
      const onSig = () => {
        tracker.stop();
        resolveStop();
      };
      process.once("SIGINT", onSig);
      process.once("SIGTERM", onSig);
    });
    await chain;
    return 0;
  }

  tracker.attachRoot(convId, false);
  await chain;
  const summary = tracker.getSummary();
  console.log(
    `sf sync-subagents: tracked ${summary.subagentCount} subagent(s), ${summary.stepsEmitted} step(s) for ${runKey}`,
  );
  for (const a of summary.agents) {
    console.log(
      `  - ${a.agentKey} (${a.role}, ${a.status}${a.model ? `, ${a.model}` : ""}): ${a.stepsEmitted} step(s) [${a.convId.slice(0, 8)}]`,
    );
  }
  return 0;
}

type DiscoveredModel = {
  id: string;
  label: string;
  engine: "antigravity" | "claude";
};

type LocalCapabilities = {
  engines: string[];
  models: DiscoveredModel[];
  agy: { installed: boolean; authenticated: boolean; version?: string; modelCount: number };
  claude: { installed: boolean; version?: string };
};

function probeCommand(binary: string, versionArgs = ["--version"]): {
  installed: boolean;
  path?: string;
  version?: string;
} {
  try {
    const whichBin = platform() === "win32" ? "where" : "which";
    const resolvedPath = execFileSync(whichBin, [binary], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
    })
      .trim()
      .split(/\r?\n/)[0];
    let version: string | undefined;
    try {
      const out = execFileSync(binary, versionArgs, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 4000,
      }).trim();
      version = out.split(/\r?\n/)[0]?.slice(0, 80);
    } catch {
      // Ignore version probe errors.
    }
    return { installed: Boolean(resolvedPath), path: resolvedPath || undefined, version };
  } catch {
    return { installed: false };
  }
}

function discoverLocalCapabilities(): LocalCapabilities {
  const agyProbe = probeCommand("agy");
  const claudeProbe = probeCommand("claude");
  const engines: string[] = [];
  const models: DiscoveredModel[] = [];

  let agyAuthenticated = false;
  let agyModelCount = 0;

  if (agyProbe.installed) {
    engines.push("antigravity");
    try {
      const out = execFileSync("agy", ["models"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 8000,
      });
      const seen = new Set<string>();
      for (const rawLine of out.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("-") || line.startsWith("=")) continue;
        // Match lines like: "gemini-4-neon-xhigh    Gemini 4 Neon (Extra High)" or "* gemini-4-neon-xhigh ..."
        const cleaned = line.replace(/^[*•▸>\s]+/, "");
        const match = /^([a-z0-9][a-z0-9._-]{2,})(?:\s{2,}|\s+[-–—]\s+|\t+)(.+?)\s*$/i.exec(cleaned);
        if (!match) continue;
        const id = match[1].trim();
        const lower = id.toLowerCase();
        if (
          lower === "model" ||
          lower === "models" ||
          lower === "name" ||
          lower === "id" ||
          lower === "available" ||
          lower === "default"
        ) {
          continue;
        }
        if (seen.has(id)) continue;
        seen.add(id);
        const label = match[2].replace(/\s*\(default\)\s*/i, "").trim() || id;
        models.push({ id, label, engine: "antigravity" });
      }
      agyModelCount = models.filter((m) => m.engine === "antigravity").length;
      agyAuthenticated = agyModelCount > 0;
    } catch {
      agyAuthenticated = false;
    }
  }

  if (claudeProbe.installed) {
    engines.push("claude");
    const claudeDefaults: DiscoveredModel[] = [
      { id: "opus", label: "Claude Opus", engine: "claude" },
      { id: "sonnet", label: "Claude Sonnet", engine: "claude" },
      { id: "haiku", label: "Claude Haiku", engine: "claude" },
    ];
    models.push(...claudeDefaults);
  }

  return {
    engines,
    models,
    agy: {
      installed: agyProbe.installed,
      authenticated: agyAuthenticated,
      version: agyProbe.version,
      modelCount: agyModelCount,
    },
    claude: {
      installed: claudeProbe.installed,
      version: claudeProbe.version,
    },
  };
}

function openBrowserUrl(url: string): boolean {
  try {
    const cmd = platform() === "darwin" ? "open" : platform() === "win32" ? "cmd" : "xdg-open";
    const cmdArgs = platform() === "win32" ? ["/c", "start", "", url] : [url];
    const child = spawn(cmd, cmdArgs, { detached: true, stdio: "ignore" });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function promptLine(question: string, fallback = ""): Promise<string> {
  if (!process.stdin.isTTY) return fallback;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise<string>((resolveAnswer) => {
      rl.question(question, (ans) => resolveAnswer(ans));
    });
    return answer.trim() || fallback;
  } finally {
    rl.close();
  }
}

function findLocalSkillsMonorepo(hintDir?: string): string | null {
  const scriptDir = dirname(resolve(process.argv[1] || "."));
  const candidates = [
    hintDir ? resolve(hintDir) : "",
    process.cwd(),
    dirname(scriptDir),
    dirname(dirname(scriptDir)),
    join(sfDir(), "skills-repo"),
  ].filter(Boolean);
  for (const dir of candidates) {
    if (
      existsSync(join(dir, "antigravity", "factory", "SKILL.md")) ||
      existsSync(join(dir, "claude", "factory", "SKILL.md"))
    ) {
      return dir;
    }
  }
  return null;
}

function linkSkillsSuite(sourceRoot: string, targetRoot: string): {
  linked: string[];
  skipped: string[];
} {
  const linked: string[] = [];
  const skipped: string[] = [];
  if (!existsSync(sourceRoot)) return { linked, skipped };
  mkdirSync(targetRoot, { recursive: true });
  for (const skill of FACTORY_SKILLS) {
    const src = join(sourceRoot, skill);
    if (!existsSync(join(src, "SKILL.md"))) continue;
    const dest = join(targetRoot, skill);
    try {
      if (existsSync(dest)) {
        const st = lstatSync(dest);
        if (st.isSymbolicLink()) {
          unlinkSync(dest);
        } else {
          skipped.push(skill);
          continue;
        }
      }
      symlinkSync(src, dest);
      linked.push(skill);
    } catch {
      skipped.push(skill);
    }
  }
  return { linked, skipped };
}

function countInstalledSkills(dir: string): number {
  let count = 0;
  for (const skill of FACTORY_SKILLS) {
    if (existsSync(join(dir, skill, "SKILL.md"))) count += 1;
  }
  return count;
}

function resolveSfMcpServerEntry(): { command: string; args: string[] } {
  const sfBin = join(sfDir(), "bin", "sf");
  const scriptPath = resolve(process.argv[1] || join(sfDir(), "bin", "sf.ts"));
  return existsSync(sfBin)
    ? { command: sfBin, args: ["mcp"] }
    : { command: process.execPath, args: [scriptPath, "mcp"] };
}

function hasRegisteredMcp(binary: "agy" | "claude", name = "software-factory"): boolean {
  try {
    if (binary === "claude") {
      // `claude mcp list` health-checks every configured remote MCP server and can time out;
      // `claude mcp get <name>` checks only the target server cleanly in ~1s.
      execFileSync("claude", ["mcp", "get", name], {
        stdio: "ignore",
        timeout: 8000,
      });
      return true;
    }
    const out = execFileSync(binary, ["mcp", "list"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 8000,
    });
    return new RegExp(`(^|\\s)${name}(\\s|:|$)`, "mi").test(out);
  } catch {
    return false;
  }
}

function registerSoftwareFactoryMcp(caps: {
  agy: { installed: boolean };
  claude: { installed: boolean };
}): {
  mcpConfigPath: string;
  agy: "registered" | "failed" | "skipped";
  claude: "registered" | "failed" | "skipped";
} {
  const entry = resolveSfMcpServerEntry();
  mkdirSync(sfDir(), { recursive: true, mode: 0o700 });
  const mcpConfigPath = join(sfDir(), "mcp-config.json");
  writeFileSync(
    mcpConfigPath,
    `${JSON.stringify({ mcpServers: { "software-factory": entry } }, null, 2)}\n`,
    { mode: 0o600 },
  );

  let agyStatus: "registered" | "failed" | "skipped" = "skipped";
  if (caps.agy.installed) {
    try {
      execFileSync("agy", ["mcp", "add", "software-factory", entry.command, ...entry.args], {
        stdio: "ignore",
        timeout: 8000,
      });
      agyStatus = "registered";
    } catch {
      agyStatus = "failed";
    }
  }

  let claudeStatus: "registered" | "failed" | "skipped" = "skipped";
  if (caps.claude.installed) {
    try {
      try {
        execFileSync("claude", ["mcp", "remove", "-s", "user", "software-factory"], {
          stdio: "ignore",
          timeout: 6000,
        });
      } catch {
        // Not registered yet; ignore.
      }
      execFileSync(
        "claude",
        ["mcp", "add", "-s", "user", "software-factory", "--", entry.command, ...entry.args],
        {
          stdio: "ignore",
          timeout: 8000,
        },
      );
      claudeStatus = "registered";
    } catch {
      claudeStatus = "failed";
    }
  }

  return { mcpConfigPath, agy: agyStatus, claude: claudeStatus };
}

async function cmdDoctor(): Promise<number> {
  console.log(`\n⚡ Software Factory Doctor (sf CLI v${CLI_VERSION})\n`);
  let criticalFailures = 0;

  const nodeMajor = Number(process.versions.node.split(".")[0] || 0);
  if (nodeMajor >= 22) {
    console.log(`  ✓ Node.js       v${process.versions.node}`);
  } else {
    console.log(`  ✗ Node.js       v${process.versions.node} (requires Node 22+)`);
    criticalFailures += 1;
  }

  const gitProbe = probeCommand("git");
  if (gitProbe.installed) {
    console.log(`  ✓ git           ${gitProbe.version || gitProbe.path}`);
  } else {
    console.log("  ✗ git           not found (required for worktree isolation)");
    criticalFailures += 1;
  }

  const ghProbe = probeCommand("gh");
  if (ghProbe.installed) {
    let ghAuthed = false;
    try {
      execFileSync("gh", ["auth", "status"], { stdio: "ignore", timeout: 4000 });
      ghAuthed = true;
    } catch {
      ghAuthed = false;
    }
    console.log(
      ghAuthed
        ? "  ✓ gh CLI        authenticated"
        : "  ! gh CLI        installed, not logged in (run `gh auth login` for PR/issue automation)",
    );
  } else {
    console.log("  ! gh CLI        not installed (optional, needed for PR Judge / GitHub issues)");
  }

  const caps = discoverLocalCapabilities();
  if (caps.agy.installed) {
    if (caps.agy.authenticated) {
      console.log(
        `  ✓ Antigravity   ${caps.agy.version || "agy"} (${caps.agy.modelCount} models available)`,
      );
    } else {
      console.log(
        `  ! Antigravity   installed (${caps.agy.version || "agy"}) — could not list models (sign in to Antigravity / run \`agy models\`)`,
      );
    }
  } else {
    console.log("  - Antigravity   `agy` not installed");
  }

  if (caps.claude.installed) {
    console.log(`  ✓ Claude Code   ${caps.claude.version || "claude"}`);
  } else {
    console.log("  - Claude Code   `claude` not installed");
  }

  if (!caps.agy.installed && !caps.claude.installed) {
    console.log("  ✗ AI Engines    neither `agy` nor `claude` found in PATH");
    criticalFailures += 1;
  }

  const agySkillsDir = join(homedir(), ".gemini", "config", "skills");
  const claudeSkillsDir = join(homedir(), ".claude", "skills");
  const agySkillCount = countInstalledSkills(agySkillsDir);
  const claudeSkillCount = countInstalledSkills(claudeSkillsDir);
  console.log(
    agySkillCount > 0
      ? `  ✓ AGY Skills    ${agySkillCount}/${FACTORY_SKILLS.length} installed in ~/.gemini/config/skills`
      : "  ! AGY Skills    0 installed (run `sf setup` to link Factory skills)",
  );
  console.log(
    claudeSkillCount > 0
      ? `  ✓ Claude Skills ${claudeSkillCount}/${FACTORY_SKILLS.length} installed in ~/.claude/skills`
      : "  ! Claude Skills 0 installed (run `sf setup` to link Factory skills)",
  );

  const cfg = loadConfig();
  if (!cfg) {
    console.log("  ! Factory Auth  not logged in (run `sf setup --url <your-app-url>`)");
  } else {
    try {
      const me = await getJson(cfg, "/api/v1/me");
      if (me.ok && me.data && typeof me.data === "object") {
        const u = (me.data as { user?: { githubLogin?: string; name?: string } }).user;
        console.log(
          `  ✓ Factory Auth  connected to ${cfg.url} as ${u?.name || u?.githubLogin || "authenticated user"}`,
        );
      } else {
        console.log(`  ✗ Factory Auth  token rejected by ${cfg.url} (HTTP ${me.status}) — run \`sf setup\``);
        criticalFailures += 1;
      }
    } catch (err) {
      console.log(
        `  ! Factory Auth  configured (${cfg.url}) but server unreachable (${err instanceof Error ? err.message : "offline"})`,
      );
    }
  }

  const mcpFile = join(sfDir(), "mcp-config.json");
  console.log(
    existsSync(mcpFile)
      ? `  ✓ MCP Config    ${mcpFile}`
      : "  - MCP Config    not generated yet (created automatically by `sf setup`)",
  );
  if (caps.agy.installed) {
    const agyHasMcp = hasRegisteredMcp("agy");
    console.log(
      agyHasMcp
        ? '  ✓ AGY MCP       "software-factory" registered (Context Lake ready)'
        : '  ! AGY MCP       "software-factory" not registered (run `sf setup` or restart `sf daemon`)',
    );
  }
  if (caps.claude.installed) {
    const claudeHasMcp = hasRegisteredMcp("claude");
    console.log(
      claudeHasMcp
        ? '  ✓ Claude MCP    "software-factory" registered (Context Lake ready)'
        : '  ! Claude MCP    "software-factory" not registered (run `sf setup` or restart `sf daemon`)',
    );
  }

  console.log("");
  return criticalFailures > 0 ? 1 : 0;
}

type DiscoveredWorkspaceProject = {
  name: string;
  path: string;
  isGit: boolean;
  hasFactoryInit: boolean;
  defaultBranch: string;
  githubFullName: string | null;
};

function scanWorkspaceProjects(workspaceDir: string): DiscoveredWorkspaceProject[] {
  if (!workspaceDir || !existsSync(workspaceDir)) return [];
  const ignored = new Set([
    "node_modules",
    "dist",
    "build",
    ".git",
    ".agents",
    ".next",
    "__pycache__",
  ]);
  const out: DiscoveredWorkspaceProject[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(workspaceDir).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }

  for (const name of entries) {
    if (!name || name.startsWith(".") || ignored.has(name)) continue;
    const fullPath = join(workspaceDir, name);
    try {
      const st = statSync(fullPath);
      if (!st.isDirectory()) continue;
    } catch {
      continue;
    }

    const isGit = existsSync(join(fullPath, ".git"));
    const hasFactoryInit = existsSync(join(fullPath, ".factory", "project.json"));
    let defaultBranch = "main";
    let githubFullName: string | null = null;
    if (isGit) {
      const branch = gitFallback(fullPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
      if (branch && branch !== "HEAD") defaultBranch = branch;
      const remote = gitFallback(fullPath, ["remote", "get-url", "origin"]);
      if (remote) {
        const m =
          /(?:git@github\.com:|https?:\/\/(?:[^@/]+@)?github\.com\/|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(
            remote,
          );
        if (m?.[1]) githubFullName = m[1];
      }
    }
    out.push({
      name,
      path: fullPath,
      isGit,
      hasFactoryInit,
      defaultBranch,
      githubFullName,
    });
    if (out.length >= 80) break;
  }
  return out;
}

async function cmdSetup(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      url: { type: "string" },
      "skills-repo": { type: "string" },
      root: { type: "string" },
      "projects-dir": { type: "string" },
      name: { type: "string" },
      "allow-root": { type: "string" },
      "no-browser": { type: "boolean" },
      yes: { type: "boolean" },
      "no-daemon": { type: "boolean" },
    },
    strict: true,
  });

  const existingCfg = loadConfig();
  let serverUrl = (
    values.url ||
    process.env.SF_SERVER_URL ||
    existingCfg?.url ||
    ""
  )
    .trim()
    .replace(/\/+$/, "");

  console.log(`\n⚡ Software Factory Setup Wizard (sf CLI v${CLI_VERSION})\n`);

  if (!serverUrl) {
    serverUrl = (
      await promptLine("Control Plane URL [http://localhost:8787]: ", "http://localhost:8787")
    ).replace(/\/+$/, "");
  }
  if (!/^https?:\/\//i.test(serverUrl)) {
    serverUrl = `https://${serverUrl}`;
  }
  console.log(`→ Control Plane: ${serverUrl}`);

  // 1. Detect local AI CLIs & models
  console.log("\n[1/5] Checking local AI agent CLIs...");
  const caps = discoverLocalCapabilities();
  if (caps.agy.installed) {
    console.log(
      caps.agy.authenticated
        ? `  ✓ Antigravity (agy) ready — ${caps.agy.modelCount} live models detected`
        : "  ! Antigravity (agy) installed, but `agy models` did not return models — sign in to Antigravity before launching AGY runs.",
    );
  } else {
    console.log("  - Antigravity (`agy`) not found in PATH.");
  }
  if (caps.claude.installed) {
    console.log(`  ✓ Claude Code (${caps.claude.version || "claude"}) detected`);
  } else {
    console.log("  - Claude Code (`claude`) not found in PATH.");
  }
  if (!caps.agy.installed && !caps.claude.installed) {
    console.log(
      "  ! Warning: Neither `agy` nor `claude` was found. Install at least one CLI and sign in so `sf daemon` can execute runs.",
    );
  }

  // 2. Install / symlink Factory skills
  console.log("\n[2/5] Configuring Factory skills...");
  let skillsRepoUrl = (values["skills-repo"] || process.env.SF_SKILLS_REPO || "").trim();
  if (!skillsRepoUrl) {
    try {
      const manifestRes = await fetch(`${serverUrl}/api/skills/manifest`, {
        signal: AbortSignal.timeout(5000),
      });
      if (manifestRes.ok) {
        const manifest = (await manifestRes.json().catch(() => null)) as {
          skillsRepoUrl?: string;
        } | null;
        if (manifest?.skillsRepoUrl) skillsRepoUrl = manifest.skillsRepoUrl.trim();
      }
    } catch {
      // Optional manifest lookup.
    }
  }

  let skillsRoot = findLocalSkillsMonorepo(values.root);
  if (!skillsRoot && skillsRepoUrl) {
    const cloneTarget = join(sfDir(), "skills-repo");
    mkdirSync(sfDir(), { recursive: true });
    try {
      if (existsSync(join(cloneTarget, ".git"))) {
        console.log(`  → Updating skills repo at ${cloneTarget} ...`);
        execFileSync("git", ["-C", cloneTarget, "pull", "--ff-only"], {
          stdio: "ignore",
          timeout: 30000,
        });
      } else {
        console.log(`  → Cloning skills repo from ${skillsRepoUrl} ...`);
        execFileSync("git", ["clone", "--depth", "1", skillsRepoUrl, cloneTarget], {
          stdio: "ignore",
          timeout: 45000,
        });
      }
      skillsRoot = cloneTarget;
    } catch (err) {
      console.log(
        `  ! Could not clone skills repo (${err instanceof Error ? err.message : "git error"}). Continuing.`,
      );
    }
  }

  if (skillsRoot) {
    const agyRes = linkSkillsSuite(
      join(skillsRoot, "antigravity"),
      join(homedir(), ".gemini", "config", "skills"),
    );
    const claudeRes = linkSkillsSuite(
      join(skillsRoot, "claude"),
      join(homedir(), ".claude", "skills"),
    );
    console.log(
      `  ✓ Linked skills from ${skillsRoot} (Antigravity: ${agyRes.linked.length}, Claude: ${claudeRes.linked.length})`,
    );
  } else {
    const existingAgy = countInstalledSkills(join(homedir(), ".gemini", "config", "skills"));
    const existingClaude = countInstalledSkills(join(homedir(), ".claude", "skills"));
    console.log(
      existingAgy > 0 || existingClaude > 0
        ? `  ✓ Using already-installed skills (Antigravity: ${existingAgy}, Claude: ${existingClaude})`
        : "  - No local Factory skills directory found (pass `--skills-repo <git-url>` or `--root <monorepo-dir>` later to install skills).",
    );
  }

  // 3. Browser Device Code Login (forces Web App login & approval)
  console.log("\n[3/5] Authenticating runner with Software Factory Web App...");
  const runnerName = values.name?.trim() || hostname();
  const startRes = await fetch(`${serverUrl}/api/v1/device/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      runnerName,
      hostname: hostname(),
      os: platform(),
    }),
    signal: AbortSignal.timeout(10000),
  }).catch((err) => {
    throw new Error(
      `Could not reach ${serverUrl}/api/v1/device/start (${err instanceof Error ? err.message : "network error"})`,
    );
  });

  const startData = (await startRes.json().catch(() => null)) as {
    deviceCode?: string;
    userCode?: string;
    verificationUrl?: string;
    intervalSeconds?: number;
    intervalSec?: number;
    expiresAt?: string;
    error?: string;
  } | null;

  if (!startRes.ok || !startData?.deviceCode || !startData?.userCode) {
    console.error(
      `✗ Failed to start device login: ${startData?.error || `HTTP ${startRes.status}`}`,
    );
    return 1;
  }

  const verifyUrl =
    startData.verificationUrl || `${serverUrl}/device?code=${encodeURIComponent(startData.userCode)}`;
  console.log("");
  console.log(`  Verification Code :  ${startData.userCode}`);
  console.log(`  Approval URL      :  ${verifyUrl}`);
  console.log("");

  if (!values["no-browser"]) {
    const opened = openBrowserUrl(verifyUrl);
    if (opened) {
      console.log("  → Opened browser for sign-in & device approval...");
    } else {
      console.log("  → Open the Approval URL above in your browser to sign in and approve.");
    }
  } else {
    console.log("  → Open the Approval URL above in your browser to sign in and approve.");
  }

  const pollIntervalMs = Math.max(
    1500,
    Number(startData.intervalSeconds || startData.intervalSec || 2) * 1000,
  );
  const deadline = Date.now() + 5 * 60 * 1000;
  let receivedToken = "";
  let approvedBy = "";

  process.stdout.write("  Waiting for approval");
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    process.stdout.write(".");
    try {
      const pollRes = await fetch(`${serverUrl}/api/v1/device/poll`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceCode: startData.deviceCode }),
        signal: AbortSignal.timeout(8000),
      });
      const pollData = (await pollRes.json().catch(() => null)) as {
        status?: string;
        token?: string;
        user?: { name?: string | null; githubLogin?: string };
        error?: string;
      } | null;
      if (pollData?.status === "approved" && pollData.token) {
        receivedToken = pollData.token;
        approvedBy = pollData.user?.name || pollData.user?.githubLogin || "authenticated user";
        break;
      }
      if (pollData?.status === "denied") {
        console.log("\n✗ Device authorization was denied in the browser.");
        return 1;
      }
      if (pollData?.status === "expired" || pollRes.status === 410) {
        console.log("\n✗ Verification code expired. Re-run `sf setup` to try again.");
        return 1;
      }
    } catch {
      // Transient network hiccup; keep polling until deadline.
    }
  }
  console.log("");

  if (!receivedToken) {
    console.error("✗ Timed out waiting for browser approval.");
    return 1;
  }

  const defaultWorkspace =
    values["projects-dir"]?.trim() ||
    existingCfg?.workspaceDir ||
    join(homedir(), "factory-projects");
  const workspaceDir = resolve(
    values["projects-dir"]?.trim() ||
      (values.yes || !process.stdin.isTTY
        ? defaultWorkspace
        : await promptLine(`Default Projects Workspace folder [${defaultWorkspace}]: `, defaultWorkspace)),
  );
  mkdirSync(workspaceDir, { recursive: true });

  const cfg: SfConfig = { url: serverUrl, token: receivedToken, workspaceDir };
  saveConfig(cfg);
  console.log(`  ✓ Runner authorized as "${approvedBy}" — saved token to ${configPath()} (chmod 600)`);
  console.log(`  ✓ Default Projects Workspace folder: ${workspaceDir}`);

  // 4. Register MCP Context Lake in Antigravity (`agy`) & Claude Code (`claude`) & register project
  console.log("\n[4/5] Registering MCP Context Lake & checking workspace project...");
  const sfBin = join(sfDir(), "bin", "sf");
  const scriptPath = resolve(process.argv[1] || join(sfDir(), "bin", "sf.ts"));
  const mcpReg = registerSoftwareFactoryMcp(caps);
  console.log(`  ✓ Wrote MCP Context Lake snippet to ${mcpReg.mcpConfigPath}`);
  if (mcpReg.agy === "registered") {
    console.log('  ✓ Auto-registered MCP "software-factory" in Antigravity (`agy mcp add`)');
  } else if (mcpReg.agy === "failed") {
    console.log('  ! Could not auto-register MCP in `agy` (run: `agy mcp add software-factory ~/.sf/bin/sf mcp`)');
  }
  if (mcpReg.claude === "registered") {
    console.log('  ✓ Auto-registered MCP "software-factory" in Claude Code (`claude mcp add -s user`)');
  } else if (mcpReg.claude === "failed") {
    console.log('  ! Could not auto-register MCP in `claude` (run: `claude mcp add -s user software-factory -- ~/.sf/bin/sf mcp`)');
  }

  const projectRoot = values.root ? resolve(values.root) : skillsRoot || process.cwd();
  if (
    existsSync(join(projectRoot, ".git")) ||
    existsSync(join(projectRoot, ".factory", "project.json"))
  ) {
    const reg = await sendJson(cfg, "/api/projects/local", {
      localPath: projectRoot,
      name: basename(projectRoot),
      engine: caps.agy.installed ? "antigravity" : "claude",
    });
    if (reg.ok) {
      console.log(`  ✓ Registered local project "${basename(projectRoot)}" (${projectRoot})`);
    }
  }

  // 5. Optional macOS launchd auto-start setup + summary
  console.log("\n[5/5] Runner daemon configuration...");
  const allowRoot = values["allow-root"] ? resolve(values["allow-root"]) : "";
  const daemonArgs = ["daemon", "--name", runnerName, "--root", projectRoot];
  if (allowRoot) daemonArgs.push("--allow-root", allowRoot);

  const daemonDisplay = existsSync(sfBin)
    ? `${sfBin} ${daemonArgs.join(" ")}`
    : `node ${scriptPath} ${daemonArgs.join(" ")}`;

  if (platform() === "darwin" && !values["no-daemon"] && !values.yes && process.stdin.isTTY) {
    const ans = await promptLine(
      "  Install macOS LaunchAgent so `sf daemon` starts automatically on login? [y/N]: ",
      "n",
    );
    if (ans.toLowerCase() === "y" || ans.toLowerCase() === "yes") {
      const plistDir = join(homedir(), "Library", "LaunchAgents");
      const plistPath = join(plistDir, "com.softwarefactory.daemon.plist");
      const logDir = join(sfDir(), "logs");
      mkdirSync(plistDir, { recursive: true });
      mkdirSync(logDir, { recursive: true });
      const programArgs = existsSync(sfBin)
        ? [sfBin, ...daemonArgs]
        : [process.execPath, scriptPath, ...daemonArgs];
      const xmlArgs = programArgs.map((a) => `      <string>${a}</string>`).join("\n");
      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>com.softwarefactory.daemon</string>
    <key>ProgramArguments</key>
    <array>
${xmlArgs}
    </array>
    <key>EnvironmentVariables</key>
    <dict>
      <key>PATH</key>
      <string>${process.env.PATH || "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"}</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${join(logDir, "daemon.out.log")}</string>
    <key>StandardErrorPath</key>
    <string>${join(logDir, "daemon.err.log")}</string>
  </dict>
</plist>
`;
      writeFileSync(plistPath, plist, { mode: 0o644 });
      console.log(`  ✓ Wrote LaunchAgent: ${plistPath}`);
      console.log(`    Load now with: launchctl load -w ${plistPath}`);
    }
  }

  console.log("\n🎉 Software Factory runner setup complete!\n");
  console.log(`  1. Start runner daemon :  ${daemonDisplay}`);
  console.log(`  2. Check environment   :  ${existsSync(sfBin) ? sfBin : `node ${scriptPath}`} doctor`);
  console.log(`  3. Open Control Plane  :  ${serverUrl}/sessions\n`);
  return 0;
}

async function cmdDaemon(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      name: { type: "string" },
      "max-concurrency": { type: "string" },
      "interval-ms": { type: "string" },
      root: { type: "string" },
      "projects-dir": { type: "string" },
      "allow-root": { type: "string", multiple: true },
      shared: { type: "boolean" },
    },
    strict: true,
  });

  const cfg = loadConfig();
  if (!cfg) {
    console.error("sf daemon: not logged in. Run `sf setup --url <server-url>` or `sf login` first.");
    return 1;
  }

  const runnerName = values.name?.trim() || hostname();
  const maxConcurrency = Math.max(1, Math.min(10, Number(values["max-concurrency"]) || 2));
  const intervalMs = Math.max(1500, Number(values["interval-ms"]) || 3000);
  const workspaceDir = resolve(
    values["projects-dir"]?.trim() ||
      process.env.SF_PROJECTS_DIR?.trim() ||
      cfg.workspaceDir ||
      join(homedir(), "factory-projects"),
  );
  mkdirSync(workspaceDir, { recursive: true });
  const sharedWithTeam = Boolean(values.shared);
  const allowedRoots = (values["allow-root"] || [])
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => resolve(r));

  function isPathAllowed(targetPath: string): boolean {
    if (allowedRoots.length === 0) return true;
    const abs = resolve(targetPath);
    return allowedRoots.some((root) => abs === root || abs.startsWith(`${root}/`));
  }

  function prepareWorktree(
    baseCwd: string,
    runKey: string,
    mode: string,
    branch?: string,
  ): { workCwd: string; worktreeBranch?: string; created: boolean; copiedFactoryFiles: string[] } {
    if (!runKey || !existsSync(join(baseCwd, ".git"))) {
      return { workCwd: baseCwd, created: false, copiedFactoryFiles: [] };
    }
    const safeKey = runKey.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
    if (!safeKey) return { workCwd: baseCwd, created: false, copiedFactoryFiles: [] };
    const worktreesRoot = join(baseCwd, ".agents", "worktrees");
    const worktreeDir = join(worktreesRoot, `${mode}-${safeKey}`);
    const worktreeBranch = `factory/${safeKey}`;
    if (existsSync(worktreeDir)) {
      const copiedFactoryFiles = copyUncommittedFactoryArtifacts(baseCwd, worktreeDir);
      return { workCwd: worktreeDir, worktreeBranch, created: false, copiedFactoryFiles };
    }
    try {
      mkdirSync(worktreesRoot, { recursive: true });
      const startRef = branch && branch.trim() ? branch.trim() : "HEAD";
      try {
        execFileSync(
          "git",
          ["-C", baseCwd, "worktree", "add", "-b", worktreeBranch, worktreeDir, startRef],
          { stdio: "ignore", timeout: 15000 },
        );
      } catch {
        // Fallback if branch name already exists or startRef is missing locally
        execFileSync(
          "git",
          ["-C", baseCwd, "worktree", "add", "-B", worktreeBranch, worktreeDir, "HEAD"],
          { stdio: "ignore", timeout: 15000 },
        );
      }
      const copiedFactoryFiles = copyUncommittedFactoryArtifacts(baseCwd, worktreeDir);
      return { workCwd: worktreeDir, worktreeBranch, created: true, copiedFactoryFiles };
    } catch {
      return { workCwd: baseCwd, created: false, copiedFactoryFiles: [] };
    }
  }

  const caps = discoverLocalCapabilities();
  const discoveredEngines = caps.engines.length > 0 ? caps.engines : ["antigravity", "claude"];

  // Ensure the Software Factory MCP Context Lake is registered for installed CLIs so
  // AI sessions can query issues, runs, inbox, and lessons directly instead of reading SQLite.
  const missingMcpAgy = caps.agy.installed && !hasRegisteredMcp("agy");
  const missingMcpClaude = caps.claude.installed && !hasRegisteredMcp("claude");
  if (missingMcpAgy || missingMcpClaude) {
    const reg = registerSoftwareFactoryMcp({
      agy: { installed: missingMcpAgy },
      claude: { installed: missingMcpClaude },
    });
    const added: string[] = [];
    if (reg.agy === "registered") added.push("agy");
    if (reg.claude === "registered") added.push("claude");
    if (added.length > 0) {
      console.log(`sf daemon: auto-registered MCP "software-factory" for ${added.join(", ")}`);
    }
  }

  let activeRuns = 0;

  type SavedSession = {
    engine: "antigravity" | "claude";
    sessionId: string;
    model: string;
    autonomy: string;
    mode: string;
    cwd: string;
    issueKey?: string;
    reportedInputTokens?: number;
    reportedOutputTokens?: number;
    reportedCacheReadTokens?: number;
    updatedAt?: string;
  };

  const sessionsFile = join(sfDir(), "sessions.json");
  function loadSessionMap(): Record<string, SavedSession> {
    if (!existsSync(sessionsFile)) return {};
    try {
      return JSON.parse(readFileSync(sessionsFile, "utf8")) as Record<string, SavedSession>;
    } catch {
      return {};
    }
  }
  const sessionMap: Record<string, SavedSession> = loadSessionMap();
  function saveSession(runKey: string, entry: SavedSession) {
    sessionMap[runKey] = entry;
    try {
      mkdirSync(sfDir(), { recursive: true, mode: 0o700 });
      const keys = Object.keys(sessionMap).slice(-200);
      const trimmed: Record<string, SavedSession> = {};
      for (const k of keys) trimmed[k] = sessionMap[k];
      writeFileSync(sessionsFile, JSON.stringify(trimmed, null, 2), { mode: 0o600 });
    } catch {
      // Ignore persistence failures.
    }
  }

  const activeChildren = new Map<string, ChildProcess>();

  console.log(
    `sf daemon: online as "${runnerName}" -> ${cfg.url} (v${CLI_VERSION}, engines: ${discoveredEngines.join(", ")}, ${caps.models.length} models, poll ${intervalMs}ms)`,
  );
  console.log(`sf daemon: default projects workspace -> ${workspaceDir}`);
  if (allowedRoots.length > 0) {
    console.log(`sf daemon: --allow-root guardrail active (${allowedRoots.join(", ")})`);
  }
  console.log("sf daemon: web-origin tracking only (local/personal IDE chats are not synced)");

  function readWorkflowOutcomeForRun(
    runKey: string,
    searchDirs: string[] = [],
  ): { outcome?: string; reason?: string; mergeDecision?: string; risk?: string } | null {
    // Strictly read isolated per-run `.factory/runs/<safeRunKey>/state.json` written by
    // web-dispatched workflow runs — never read shared global dashboard live.js/runs.js.
    const perRun = readPerRunStateFile(searchDirs, runKey);
    if (perRun && perRun.outcome) {
      return {
        outcome: perRun.outcome,
        reason: perRun.reason,
        mergeDecision: perRun.mergeDecision,
        risk: perRun.risk,
      };
    }
    return null;
  }

  const SF_QUESTIONS_CONTRACT = [
    "Interactive Questions Contract:",
    "- Do NOT call interactive-only tools like `ask_question` / `AskUserQuestion` (this session runs headless over Software Factory).",
    "- Whenever you need the user to answer questions (at most 3 per wave), write brief context first and end your reply with a single fenced JSON block tagged `sf-questions` so Software Factory renders clickable radio/multi-select options:",
    "```sf-questions",
    "{",
    '  "questions": [',
    "    {",
    '      "id": "Q1",',
    '      "header": "Short topic",',
    '      "question": "Clear question text?",',
    '      "multiSelect": false,',
    '      "options": [',
    '        { "label": "Recommended option", "description": "Short rationale", "recommended": true },',
    '        { "label": "Alternative option", "description": "Trade-off" }',
    "      ],",
    '      "allowOther": true',
    "    }",
    "  ]",
    "}",
    "```",
    '- Keep option labels concise (2-8 words), mark your best default with `"recommended": true`, set `"multiSelect": true` when multiple choices apply, and write in the same language as the user.',
    "- Do NOT duplicate the full options list in plain markdown prose when emitting `sf-questions`.",
  ].join("\n");

  const SF_PROTOTYPE_CONTRACT = [
    "Interactive HTML Prototype Contract (BA → Prototype Flow):",
    "- Whenever a ticket introduces a new screen, changes a layout, adds a new kind of control, or has distinct UI states (empty, loading, error, no permission), build a clickable self-contained HTML prototype so the user can test the UX right in Software Factory before any code is built.",
    "- If the product has NO existing UI look yet, first ask a brief Design Brief via `sf-questions` (Vibe, Theme: light/dark/both, Colours & Type, Motion) and draw ONE primary screen (`kind: \"first_screen\"`) for the user to approve or steer before drawing remaining screens.",
    "- Prototype rules:",
    "  1. Completely self-contained HTML (inline `<style>` and `<script>`, zero external network/CDN requests, believable sample data, responsive at both `1440px` desktop and `390px` mobile, respects light & dark themes via CSS variables / `[data-theme=\"dark\"]` / `.dark`).",
    "  2. Every criterion state (normal, empty, loading, error, permission, dialog) is a separate `<section data-screen=\"<id>\" data-title=\"<Label>\">` shown one at a time via `location.hash` (`#<id>`), with real in-memory interactivity (filters, validation, dialogs, tabs).",
    "  3. Mark elements added/changed by the ticket with `data-change` and show a subtle prototype bar noting sample data.",
    "  4. When 2+ tickets form a sequential user journey, also produce a combined whole-flow demo (`kind: \"whole_flow\"`) so the user can click through end-to-end.",
    "- Delivery (preferred): write `.factory/prototypes/<slug>/index.html` (and optionally `.factory/prototypes/<slug>/prototype.json`), then emit a compact fenced `sf-prototype` JSON metadata block referencing `\"htmlPath\": \".factory/prototypes/<slug>/index.html\"` (the local runner automatically uploads the full HTML to Software Factory so even Vercel users can click it!). Alternatively, emit ` ```sf-prototype ` metadata immediately followed by a fenced ` ```sf-prototype-html ` block.",
    "```sf-prototype",
    "{",
    '  "slug": "orders-export",',
    '  "title": "Orders Export & Filters",',
    '  "kind": "ticket",',
    '  "binding": "flow",',
    '  "issueKeys": ["I1"],',
    '  "themes": ["light", "dark"],',
    '  "htmlPath": ".factory/prototypes/orders-export/index.html",',
    '  "screens": [',
    '    { "id": "orders-list", "title": "Orders list (Normal)", "criteria": ["C1"], "shows": "Filter bar, table rows, Export CSV button" },',
    '    { "id": "orders-empty", "title": "Empty state", "criteria": ["C2"], "shows": "No orders match filters + Clear button" }',
    "  ],",
    '  "notShown": [',
    '    { "criterion": "C5", "why": "Server rate limit; nothing on screen" }',
    "  ]",
    "}",
    "```",
  ].join("\n");

  const SF_QUESTIONS_RESUME_REMINDER =
    '(Interactive Questions & Prototype reminder: if you ask any follow-up questions, end with a ```sf-questions JSON block containing concise clickable options and `"recommended": true` on your suggested default. If you created or updated a clickable HTML prototype, save it to `.factory/prototypes/<slug>/index.html` and include its compact ```sf-prototype metadata block — do NOT call `ask_question`/`AskUserQuestion`.)';

  function buildBaTicketPrompt(userRequest: string): string {
    return [
      "You are the Business Analyst (BA) for Software Factory. Follow the `ba-ticket` skill principles:",
      "1. First inspect the repository (README, `.factory/`, design tokens, existing code/screens, and any existing prototypes in `.factory/prototypes/` or `docs/ba/prototypes/`) so your tickets and prototypes match what actually exists.",
      "2. When requirements are ambiguous or the task touches UI and you need to confirm whether the user already has a prototype / design direction, ask the highest-impact questions first (at most 3-4 per wave) using `sf-questions` so the user can click options.",
      "3. Break the user's request into well-sized tickets (1 ticket = 1 pull request, each deliverable and testable on its own). Order them by dependency (`dependsOn`).",
      "4. Each ticket MUST have 3-6 crisp, externally verifiable acceptance criteria (`C1..Cn`), clear `goal`, `priority` (`P0|P1|P2|P3`), `complexity` (`XS|S|M|L`), and a concise `body` (bullet points for Scope, UI & States, and explicit **Out of scope** — avoid long repetitive essays).",
      "5. For every UI change that is not trivial, build a clickable self-contained HTML prototype (starting with 1 main screen first if the product has no look yet, plus a whole-flow demo when 2+ tickets form a sequential user journey) following the Interactive HTML Prototype Contract below.",
      "6. Do NOT edit application source code, do NOT create GitHub issues yet, and do NOT call interactive-only tools like `ask_question` / `AskUserQuestion` (this session is headless). You MAY write prototype HTML/JSON files inside `.factory/prototypes/<slug>/` so Software Factory uploads them for the user to preview and click. Write in the same language as the user's request.",
      "7. When presenting tickets, give a brief human-readable overview table/list first, then end with a single fenced JSON block tagged `sf-tickets` using this exact shape so Software Factory imports them automatically into the Draft column:",
      "",
      "```sf-tickets",
      "{",
      '  "tickets": [',
      "    {",
      '      "issueKey": "I1",',
      '      "title": "Short imperative ticket title",',
      '      "goal": "User story / outcome this ticket delivers",',
      '      "body": "## Scope\\n- ...\\n\\n## UI & States\\n- ...\\n\\n## Out of scope\\n- ...",',
      '      "criteria": [',
      '        { "id": "C1", "text": "Observable, checkable requirement" },',
      '        { "id": "C2", "text": "Edge case / error handling requirement" }',
      "      ],",
      '      "dependsOn": [],',
      '      "priority": "P1",',
      '      "complexity": "S"',
      "    }",
      "  ]",
      "}",
      "```",
      "",
      SF_PROTOTYPE_CONTRACT,
      "",
      SF_QUESTIONS_CONTRACT,
      "",
      `User Request:\n${userRequest}`,
    ].join("\n");
  }

  function extractPrototypesFromTurn(
    text: string,
    repoDir: string,
    sinceMs: number,
  ): Array<{
    slug?: string;
    title: string;
    kind: string;
    binding: string;
    issueKeys: string[];
    htmlPath?: string;
    htmlContent: string;
    manifest: Record<string, unknown>;
  }> {
    const results: Array<{
      slug?: string;
      title: string;
      kind: string;
      binding: string;
      issueKeys: string[];
      htmlPath?: string;
      htmlContent: string;
      manifest: Record<string, unknown>;
    }> = [];
    const seenPaths = new Set<string>();
    const seenSlugs = new Set<string>();

    // 1. Parse ```sf-prototype + optional adjacent ```sf-prototype-html blocks
    const fenceRe = /```(sf-prototype-html|sf-prototype)\s*\r?\n([\s\S]*?)```/gi;
    const spans: Array<{ kind: "meta" | "html"; body: string }> = [];
    let m: RegExpExecArray | null;
    while ((m = fenceRe.exec(text || "")) !== null) {
      spans.push({
        kind: m[1].toLowerCase() === "sf-prototype-html" ? "html" : "meta",
        body: m[2].trim(),
      });
    }

    for (let i = 0; i < spans.length; i += 1) {
      const sp = spans[i];
      if (sp.kind === "html") {
        const titleMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(sp.body);
        const title = titleMatch?.[1]?.trim() || `Interactive Prototype ${results.length + 1}`;
        results.push({
          title,
          kind: "ticket",
          binding: "flow",
          issueKeys: [],
          htmlContent: sp.body,
          manifest: { title, kind: "ticket", binding: "flow" },
        });
        continue;
      }

      let meta: Record<string, unknown> | null = null;
      try {
        const parsed = JSON.parse(sp.body) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          meta = parsed as Record<string, unknown>;
        }
      } catch {
        continue;
      }
      if (!meta) continue;

      let htmlContent = typeof meta.html === "string" && meta.html.trim() ? meta.html.trim() : "";
      if (!htmlContent && spans[i + 1]?.kind === "html") {
        htmlContent = spans[i + 1].body;
        i += 1;
      }

      const rawPath =
        (typeof meta.htmlPath === "string" && meta.htmlPath.trim()) ||
        (typeof meta.file === "string" && meta.file.trim()) ||
        (typeof meta.path === "string" && meta.path.trim()) ||
        "";
      let resolvedHtmlPath: string | undefined;
      if (rawPath) {
        const candidate = rawPath.startsWith("/") ? resolve(rawPath) : resolve(repoDir, rawPath);
        const finalFile =
          existsSync(candidate) && statSync(candidate).isDirectory()
            ? join(candidate, "index.html")
            : candidate;
        if (existsSync(finalFile) && statSync(finalFile).isFile()) {
          resolvedHtmlPath = finalFile;
          seenPaths.add(finalFile);
          if (!htmlContent) {
            try {
              htmlContent = readFileSync(finalFile, "utf8");
            } catch {
              // Ignore read error.
            }
          }
          // Merge sibling prototype.json if meta omitted screens
          const siblingManifest = join(dirname(finalFile), "prototype.json");
          if (existsSync(siblingManifest)) {
            try {
              const sib = JSON.parse(readFileSync(siblingManifest, "utf8")) as Record<string, unknown>;
              meta = { ...sib, ...meta };
            } catch {
              // Ignore invalid sibling manifest.
            }
          }
        }
      }

      if (!htmlContent) continue;

      const issueKeys = Array.isArray(meta.issueKeys)
        ? meta.issueKeys.map((k) => String(k).trim()).filter(Boolean)
        : typeof meta.issueKey === "string" && meta.issueKey.trim()
          ? [meta.issueKey.trim()]
          : [];
      const slug = typeof meta.slug === "string" && meta.slug.trim() ? meta.slug.trim() : undefined;
      if (slug) seenSlugs.add(slug.toLowerCase());
      results.push({
        slug,
        title: (typeof meta.title === "string" && meta.title.trim()) || "Interactive Prototype",
        kind: typeof meta.kind === "string" ? meta.kind : "ticket",
        binding: typeof meta.binding === "string" ? meta.binding : "flow",
        issueKeys,
        htmlPath: rawPath || resolvedHtmlPath,
        htmlContent,
        manifest: meta,
      });
    }

    // 2. Fallback disk scan: capture any newly written `.factory/prototypes/<slug>/index.html`
    const protoRoot = join(repoDir, ".factory", "prototypes");
    if (existsSync(protoRoot)) {
      try {
        for (const entry of readdirSync(protoRoot)) {
          const dir = join(protoRoot, entry);
          const htmlFile = join(dir, "index.html");
          if (!existsSync(htmlFile)) continue;
          const st = statSync(htmlFile);
          if (!st.isFile() || st.mtimeMs < sinceMs - 2000) continue;
          const absFile = resolve(htmlFile);
          if (seenPaths.has(absFile) || seenSlugs.has(entry.toLowerCase())) continue;

          const htmlContent = readFileSync(absFile, "utf8");
          let manifest: Record<string, unknown> = {};
          const manifestFile = join(dir, "prototype.json");
          if (existsSync(manifestFile)) {
            try {
              const parsed = JSON.parse(readFileSync(manifestFile, "utf8")) as unknown;
              if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                manifest = parsed as Record<string, unknown>;
              }
            } catch {
              // Ignore malformed manifest.
            }
          }
          const issueKeys = Array.isArray(manifest.issueKeys)
            ? manifest.issueKeys.map((k) => String(k).trim()).filter(Boolean)
            : [];
          results.push({
            slug: entry,
            title:
              (typeof manifest.title === "string" && manifest.title.trim()) ||
              entry.replace(/[-_]+/g, " "),
            kind: typeof manifest.kind === "string" ? manifest.kind : "ticket",
            binding: typeof manifest.binding === "string" ? manifest.binding : "flow",
            issueKeys,
            htmlPath: `.factory/prototypes/${entry}/index.html`,
            htmlContent,
            manifest,
          });
        }
      } catch {
        // Ignore scan errors.
      }
    }

    return results;
  }

  const contextDigestByRepo = new Map<string, string>();
  const MAX_CONTEXT_UPLOAD_BYTES = 3_000_000;
  async function syncProjectContextToServer(
    repoDir: string,
    opts?: { projectId?: string; projectSlug?: string; force?: boolean },
  ): Promise<{ ok: boolean; error?: string; count?: number }> {
    if (!repoDir || !existsSync(repoDir)) {
      return { ok: false, error: `Repo directory not found: ${repoDir}` };
    }
    const scanned = scanLocalContextLakeFiles(repoDir);
    // Stay safely below Vercel Serverless 4.5 MB request body limit.
    const files: typeof scanned = [];
    let totalBytes = 0;
    for (const f of scanned) {
      const est = Buffer.byteLength(f.content, "utf8") + f.path.length + 128;
      if (totalBytes + est > MAX_CONTEXT_UPLOAD_BYTES) break;
      totalBytes += est;
      files.push(f);
    }
    const digest = createHash("sha256")
      .update(files.map((f) => `${f.path}:${f.sha}`).join("|"))
      .digest("hex");
    const key = resolve(repoDir);
    if (!opts?.force && contextDigestByRepo.get(key) === digest) {
      return { ok: false };
    }
    const ctx = inferProjectContext(repoDir, opts?.projectSlug);
    const res = await sendJson(cfg!, "/api/v1/projects/context-sync", {
      projectId: opts?.projectId || undefined,
      project: opts?.projectSlug || ctx.project,
      repo: key,
      source: "daemon",
      replaceAll: true,
      files,
    });
    if (res.ok) {
      contextDigestByRepo.set(key, digest);
      return { ok: true, count: files.length };
    }
    return { ok: false, error: res.error || `HTTP ${res.status}` };
  }

  function extractBaTicketsFromText(text: string): Array<Record<string, unknown>> {
    if (!text) return [];
    const blocks: string[] = [];
    // Prefer explicit ```sf-tickets blocks (take last if multiple revisions appeared)
    const sfRe = /```sf-tickets\s*([\s\S]*?)```/gi;
    let m: RegExpExecArray | null;
    while ((m = sfRe.exec(text)) !== null) {
      if (m[1]?.trim()) blocks.unshift(m[1].trim());
    }
    // Fallback to ```json blocks
    const jsonRe = /```json\s*([\s\S]*?)```/gi;
    while ((m = jsonRe.exec(text)) !== null) {
      if (m[1]?.trim()) blocks.push(m[1].trim());
    }
    for (const raw of blocks) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        const arr = Array.isArray(parsed)
          ? parsed
          : typeof parsed === "object" && parsed !== null
            ? Array.isArray((parsed as { tickets?: unknown }).tickets)
              ? (parsed as { tickets: unknown[] }).tickets
              : Array.isArray((parsed as { issues?: unknown }).issues)
                ? (parsed as { issues: unknown[] }).issues
                : null
            : null;
        if (!arr || arr.length === 0) continue;
        const valid = arr.filter(
          (item): item is Record<string, unknown> =>
            typeof item === "object" &&
            item !== null &&
            !Array.isArray(item) &&
            typeof (item as { title?: unknown }).title === "string" &&
            Boolean((item as { title: string }).title.trim()),
        );
        if (valid.length > 0) return valid;
      } catch {
        // Ignore malformed JSON blocks and try next candidate.
      }
    }
    return [];
  }

  function stripLeadingSkillPrefix(rawPrompt: string): { skill: string | null; body: string } {
    const trimmed = rawPrompt.trimStart();
    const aliases: Array<[string, string]> = [
      ["/factory clarify", "clarify"],
      ["/factory-clarify", "clarify"],
      ["/factory init", "init"],
      ["/factory-init", "init"],
      ["/ui-refine-loop", "ui-refine"],
      ["/dev-subissues", "dev-subissues"],
      ["/ba-ticket", "ba"],
      ["/ui-refine", "ui-refine"],
      ["/pr-judge", "pr-judge"],
      ["/clarify", "clarify"],
      ["/factory", "factory"],
      ["/refine", "ui-refine"],
      ["/judge", "pr-judge"],
      ["/init", "init"],
      ["/ba", "ba"],
    ];
    const lower = trimmed.toLowerCase();
    for (const [alias, skill] of aliases) {
      if (!lower.startsWith(alias)) continue;
      const nextCh = trimmed[alias.length];
      if (nextCh !== undefined && !/\s/.test(nextCh)) continue;
      return {
        skill,
        body: trimmed.slice(alias.length).replace(/^[ \t]+/, ""),
      };
    }
    return { skill: null, body: rawPrompt };
  }

  function buildCliSpawnSpec(cmd: {
    type: string;
    payload: Record<string, unknown>;
    resumeSessionId?: string;
    overridePrompt?: string;
  }): {
    engine: "antigravity" | "claude";
    binary: string;
    args: string[];
    model: string;
    autonomy: string;
    mode: string;
    summary: string;
  } {
    const engine: "antigravity" | "claude" =
      cmd.payload.engine === "claude" ? "claude" : "antigravity";
    const autonomy = String(cmd.payload.autonomy || "high");
    const rawModel = typeof cmd.payload.model === "string" ? cmd.payload.model.trim() : "";
    const rawPrompt =
      cmd.overridePrompt !== undefined ? cmd.overridePrompt : String(cmd.payload.prompt || "");

    const isResume = Boolean(cmd.resumeSessionId);
    const stripped = isResume ? { skill: null, body: rawPrompt } : stripLeadingSkillPrefix(rawPrompt);
    const mode =
      stripped.skill === "ba"
        ? "ba"
        : String(cmd.payload.mode || (cmd.type === "run_ba" ? "ba" : "factory"));

    let fullPrompt: string;
    if (cmd.type === "run_ba" || mode === "ba") {
      fullPrompt = isResume
        ? `${rawPrompt}\n\n(If you updated, added, or split any tickets, include the complete updated \`\`\`sf-tickets JSON block at the end so the Software Factory Kanban Board syncs automatically.)\n${SF_QUESTIONS_RESUME_REMINDER}`
        : buildBaTicketPrompt(stripped.body || rawPrompt);
    } else if (isResume) {
      const isInteractiveMode = mode === "init" || mode === "clarify" || mode === "normal";
      fullPrompt = isInteractiveMode
        ? `${rawPrompt.trim()}\n\n${SF_QUESTIONS_RESUME_REMINDER}`
        : rawPrompt.trim();
    } else if (mode === "init" || stripped.skill === "init") {
      const bodyText = stripped.skill === "init" ? stripped.body : rawPrompt.replace(/^\/factory[\s-]+init\b/i, "").trim();
      fullPrompt = `/factory init ${bodyText}`.trim();
      if (!fullPrompt.includes("Interactive Questions Contract:")) {
        fullPrompt += `\n\n${SF_QUESTIONS_CONTRACT}`;
      }
    } else if (stripped.skill === "dev-subissues") {
      fullPrompt = `/dev-subissues ${stripped.body}`.trim();
    } else {
      const isClarify =
        cmd.type === "run_clarify" || mode === "clarify" || stripped.skill === "clarify";
      const prefix = isClarify
        ? "/factory clarify "
        : cmd.type === "run_ui_refine" || mode === "ui-refine" || stripped.skill === "ui-refine"
          ? "/ui-refine-loop "
          : cmd.type === "run_pr_judge" || mode === "pr-judge" || stripped.skill === "pr-judge"
            ? "/pr-judge "
            : mode === "normal" && !stripped.skill
              ? ""
              : "/factory ";
      fullPrompt = `${prefix}${stripped.skill ? stripped.body : rawPrompt}`.trim();
      if (isClarify && !fullPrompt.includes("Interactive Questions Contract:")) {
        fullPrompt += `\n\n${SF_QUESTIONS_CONTRACT}`;
      } else if (
        prefix === "/factory " &&
        !fullPrompt.includes("UNATTENDED FACTORY BUILD RUN")
      ) {
        fullPrompt +=
          "\n\nUNATTENDED FACTORY BUILD RUN: nobody can answer questions during this run. Never call `ask_question`/`AskUserQuestion`, never pause for user confirmation, and never switch to interactive `/factory init` or `/factory clarify`. Execute the workflow to completion or stop cleanly with workflow outcome `blocked`.";
      }
      const contextNote =
        typeof cmd.payload.contextNote === "string" ? cmd.payload.contextNote.trim() : "";
      if (contextNote && mode === "normal" && !stripped.skill) {
        fullPrompt = `${contextNote}\n\nUser request:\n${fullPrompt}`;
      }
    }

    if (engine === "claude") {
      const [baseModel, explicitEffort] = (rawModel || "opus").split(":");
      const model = baseModel || "opus";
      const validEfforts = new Set(["low", "medium", "high", "xhigh", "max"]);
      const effort =
        explicitEffort && validEfforts.has(explicitEffort)
          ? explicitEffort
          : model === "haiku"
            ? "low"
            : model === "sonnet"
              ? "medium"
              : "high";
      const args: string[] = [];
      if (cmd.resumeSessionId) {
        args.push("--resume", cmd.resumeSessionId);
      }
      // Headless `claude -p` has no interactive TTY to answer permission prompts:
      // always bypass permission checks so runs never hang or fail with tool denials.
      args.push(
        "--model",
        model,
        "--effort",
        effort,
        "--dangerously-skip-permissions",
        "--permission-mode",
        "bypassPermissions",
        "--output-format",
        "stream-json",
        "--verbose",
        "-p",
        fullPrompt,
      );
      return {
        engine,
        binary: "claude",
        args,
        model,
        autonomy,
        mode,
        summary: `claude${cmd.resumeSessionId ? " --resume" : ""} --model ${model} --effort ${effort} --dangerously-skip-permissions --output-format stream-json`,
      };
    }

    // Antigravity (`agy`) — map legacy tier labels to latest Gemini 4 CLI model IDs
    const legacyAgyMap: Record<string, string> = {
      pro: "gemini-4-neon-xhigh",
      flash: "gemini-4-carbon-medium",
      flash_lite: "gemini-4-hydrogen-medium",
    };
    const model = legacyAgyMap[rawModel] || rawModel || "gemini-4-neon-xhigh";
    const args: string[] = [];
    if (cmd.resumeSessionId) {
      args.push("--resume", cmd.resumeSessionId);
    }
    // Headless `agy --print` has no interactive TTY to answer permission prompts:
    // always pass `--dangerously-skip-permissions` so tools never silently deny.
    args.push(
      "--model",
      model,
      "--dangerously-skip-permissions",
      "--output-format",
      "stream-json",
    );
    // IMPORTANT: `agy` requires `--print=<prompt>` with `=` when combined with other flags.
    args.push(`--print=${fullPrompt}`);
    return {
      engine,
      binary: "agy",
      args,
      model,
      autonomy,
      mode,
      summary: `agy${cmd.resumeSessionId ? " --resume" : ""} --model ${model} --dangerously-skip-permissions --output-format stream-json`,
    };
  }

  async function runStreamedCli(params: {
    cmdId: string;
    runKey: string;
    cwd: string;
    repoRoot?: string;
    projectId?: string;
    missionId?: string;
    issueKey?: string;
    spec: ReturnType<typeof buildCliSpawnSpec>;
    isResume?: boolean;
  }) {
    const { cmdId, runKey, cwd, repoRoot, projectId, missionId, issueKey, spec, isResume } = params;
    const basePhase =
      spec.mode === "ba"
        ? "BA Planning"
        : spec.mode === "init"
          ? "Factory Init"
          : spec.mode === "clarify"
            ? "Clarify"
            : spec.mode === "ui-refine"
            ? "Refine"
            : spec.mode === "pr-judge"
              ? "Judge"
              : spec.mode === "normal"
                ? "Run"
                : "Spec";

    activeRuns += 1;
    console.log(`sf daemon: streaming ${spec.summary} in ${cwd}`);

    const resolvedRepo = repoRoot || cwd;
    const baseCtx = {
      repo: resolvedRepo,
      projectId: projectId || undefined,
    };

    if (runKey) {
      await sendJson(cfg!, "/api/v1/runs/step", {
        run: runKey,
        ...baseCtx,
        step: isResume ? "daemon-resume" : "daemon-spawn",
        phase: basePhase,
        status: "passed",
        role: "orchestrator",
        agent: "orchestrator",
        model: spec.model,
        label: `${isResume ? "Resumed" : "Started"} ${spec.binary} (${spec.model})`,
        data: {
          kind: "lifecycle",
          runner: runnerName,
          cwd,
          command: spec.summary,
        },
      }).catch(() => {});
    }

    const prevSavedSession = runKey ? sessionMap[runKey] : undefined;
    let activeConvId = prevSavedSession?.sessionId || "";
    let activeModel = spec.model;
    let priorConvUsage: AgyTokenTotals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
    let initialRootOffset = 0;
    if (isResume && spec.engine === "antigravity" && prevSavedSession?.sessionId) {
      if (typeof prevSavedSession.reportedInputTokens === "number") {
        priorConvUsage = {
          inputTokens: prevSavedSession.reportedInputTokens,
          outputTokens: prevSavedSession.reportedOutputTokens || 0,
          cacheReadTokens: prevSavedSession.reportedCacheReadTokens || 0,
        };
      } else {
        // Backfill prior cumulative usage from existing root transcript before spawning `--resume`
        // so upgraded daemons never double-count older multi-turn sessions either.
        priorConvUsage = readRootTranscriptUsage(prevSavedSession.sessionId);
      }
      const prevBrainDir = resolveAgyBrainDir(prevSavedSession.sessionId.trim().toLowerCase());
      if (prevBrainDir) {
        const prevTranscript = join(prevBrainDir, ".system_generated", "logs", "transcript.jsonl");
        try {
          if (existsSync(prevTranscript)) {
            initialRootOffset = statSync(prevTranscript).size;
          }
        } catch {
          initialRootOffset = 0;
        }
      }
    }

    const runStartedAtMs = Date.now();
    const turnTag = (cmdId || String(runStartedAtMs)).replace(/[^a-zA-Z0-9_-]+/g, "").slice(-8);
    const child = spawn(spec.binary, spec.args, {
      cwd,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (runKey) activeChildren.set(runKey, child);

    const MAX_RESPONSE_CHARS = 200_000;
    let lineBuf = "";
    let stderrBuf = "";
    let finalResponseText = "";
    let emittedAssistantResponse = false;
    let sawErrorResult = false;
    let blockedByPermission = false;
    let deniedActionsSummary = "";
    let totalReportedIn = 0;
    let totalReportedOut = 0;
    let totalReportedCache = 0;
    let totalReportedCost = 0;
    let activeToolRunning = false;
    let thinkingSinceMs = Date.now();
    let lastStreamActivityMs = Date.now();
    let lastServerHeartbeatMs = Date.now();
    const agyTextByStep = new Map<number, string>();
    const agyLastFlushMs = new Map<number, number>();
    const agyLastFlushLen = new Map<number, number>();
    const agyStreamingInFlight = new Set<number>();
    let lastPostWarnMs = 0;

    // Ephemeral low-latency live chunk broadcaster (Ably / Supabase Broadcast / local zero-DB SSE).
    // Bypasses Vercel Lambda + Postgres while tokens/thinking/tool logs stream at ~70ms cadence.
    type LivePublishGrant =
      | {
          transport: "ably";
          runId: string;
          channel: string;
          publishUrl: string;
          bearerToken: string;
          expiresAt: number;
        }
      | {
          transport: "supabase";
          runId: string;
          channel: string;
          publishUrl: string;
          apiKey: string;
        }
      | {
          transport: "sse";
          runId: string;
          channel: string;
        };

    let liveGrant: LivePublishGrant | null = null;
    let liveGrantFetchInFlight: Promise<void> | null = null;
    const liveQueue: Array<Record<string, unknown>> = [];
    let liveFlushTimer: ReturnType<typeof setTimeout> | null = null;
    let liveFlushChain: Promise<void> = Promise.resolve();
    let liveStopped = false;

    function ensureLiveGrant(): Promise<void> {
      if (!runKey || liveStopped) return Promise.resolve();
      if (
        liveGrant &&
        (liveGrant.transport !== "ably" || Date.now() < liveGrant.expiresAt - 180_000)
      ) {
        return Promise.resolve();
      }
      if (liveGrantFetchInFlight) return liveGrantFetchInFlight;
      liveGrantFetchInFlight = sendJson(cfg!, "/api/v1/runs/live-token", {
        run: runKey,
        ...baseCtx,
      })
        .then((res) => {
          if (res.ok && res.data && typeof res.data === "object") {
            const d = res.data as Partial<LivePublishGrant>;
            if (d.transport === "ably" && d.publishUrl && d.bearerToken && d.channel && d.runId) {
              liveGrant = d as LivePublishGrant;
            } else if (d.transport === "supabase" && d.publishUrl && d.apiKey && d.channel && d.runId) {
              liveGrant = d as LivePublishGrant;
            } else if (d.transport === "sse" && d.channel && d.runId) {
              liveGrant = d as LivePublishGrant;
            }
          }
        })
        .catch(() => {})
        .finally(() => {
          liveGrantFetchInFlight = null;
        });
      return liveGrantFetchInFlight;
    }

    function coalesceLocalChunks(items: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
      const out: Array<Record<string, unknown>> = [];
      for (const item of items) {
        const prev = out[out.length - 1];
        if (
          item.kind === "text_delta" &&
          prev?.kind === "text_delta" &&
          prev.stepKey === item.stepKey &&
          prev.agentKey === item.agentKey
        ) {
          prev.delta = `${String(prev.delta || "")}${String(item.delta || "")}`;
          prev.ts = item.ts;
          continue;
        }
        if (
          item.kind === "tool_output" &&
          prev?.kind === "tool_output" &&
          prev.stepKey === item.stepKey &&
          prev.agentKey === item.agentKey
        ) {
          out[out.length - 1] = item;
          continue;
        }
        if (
          item.kind === "activity" &&
          prev?.kind === "activity" &&
          prev.agentKey === item.agentKey
        ) {
          out[out.length - 1] = item;
          continue;
        }
        out.push({ ...item });
      }
      return out;
    }

    async function dispatchLiveBatch(batch: Array<Record<string, unknown>>) {
      if (batch.length === 0 || !runKey) return;
      await ensureLiveGrant();
      if (!liveGrant) return;
      const chunks = coalesceLocalChunks(batch);
      try {
        if (liveGrant.transport === "ably") {
          await fetch(liveGrant.publishUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${liveGrant.bearerToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify([{ name: "chunk", data: JSON.stringify({ chunks }) }]),
            signal: AbortSignal.timeout(5000),
          });
        } else if (liveGrant.transport === "supabase") {
          await fetch(liveGrant.publishUrl, {
            method: "POST",
            headers: {
              apikey: liveGrant.apiKey,
              Authorization: `Bearer ${liveGrant.apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              messages: [{ topic: liveGrant.channel, event: "chunk", payload: { chunks } }],
            }),
            signal: AbortSignal.timeout(5000),
          });
        } else {
          await sendJson(cfg!, "/api/v1/runs/live-chunk", {
            run: runKey,
            ...baseCtx,
            chunks,
          });
        }
      } catch {
        // Ephemeral live chunks are best-effort; durable DB steps remain authoritative.
      }
    }

    function flushLiveQueueNow() {
      if (liveFlushTimer) {
        clearTimeout(liveFlushTimer);
        liveFlushTimer = null;
      }
      if (liveQueue.length === 0) return;
      const batch = liveQueue.splice(0, liveQueue.length);
      liveFlushChain = liveFlushChain.then(() => dispatchLiveBatch(batch)).catch(() => {});
    }

    function emitLiveChunk(chunk: Record<string, unknown>) {
      if (!runKey || liveStopped) return;
      liveQueue.push(chunk);
      if (liveQueue.length >= 25) {
        flushLiveQueueNow();
        return;
      }
      if (!liveFlushTimer) {
        liveFlushTimer = setTimeout(flushLiveQueueNow, 70);
      }
    }

    if (runKey) {
      void ensureLiveGrant();
    }

    // Strict FIFO chain for all non-coalesced posts with retry + spool fallback so transient
    // network timeouts or serverless cold starts never drop steps or leave runs stuck.
    let postChain: Promise<unknown> = Promise.resolve();
    function enqueuePost(path: string, body: Record<string, unknown>) {
      postChain = postChain
        .then(async () => {
          const res = await sendJsonWithRetry(cfg!, path, body, "POST", {
            retries: 2,
            retryDelayMs: 500,
            spoolOnFail: true,
          });
          if (res.ok) {
            lastServerHeartbeatMs = Date.now();
            if (liveGrant && liveGrant.transport !== "sse") {
              emitLiveChunk({
                kind: "step_committed",
                stepKey: typeof body.step === "string" ? body.step : undefined,
                ts: Date.now(),
              });
            }
          } else {
            const now = Date.now();
            if (now - lastPostWarnMs > 10_000) {
              lastPostWarnMs = now;
              console.error(
                `sf daemon [${runKey || "run"}]: POST ${path} failed (${res.error})${res.spooled ? " — spooled for retry" : ""}`,
              );
            }
          }
        })
        .catch(() => {});
    }

    // Tail isolated per-run progress files written by `workflow/factory.py`:
    // `<cwd|repoRoot>/.factory/runs/<safeRunKey>/{state.json,events.jsonl}`
    const perRunSearchDirs = Array.from(new Set([resolve(cwd), resolve(resolvedRepo)]));
    const perRunSafeId = runKey ? sanitizeRunDirKey(runKey) : "";
    let perRunStateLastMtime = 0;
    let perRunEventsOffset = 0;
    let perRunEventsRemainder = "";
    let perRunEventsPath = "";
    const perRunActiveAgents = new Set<string>();

    function syncPerRunProgress() {
      if (!runKey || !perRunSafeId) return;
      for (const dir of perRunSearchDirs) {
        const statePath = join(dir, ".factory", "runs", perRunSafeId, "state.json");
        if (existsSync(statePath)) {
          try {
            const st = statSync(statePath);
            if (st.mtimeMs > perRunStateLastMtime) {
              const parsed = JSON.parse(readFileSync(statePath, "utf8")) as Record<string, unknown>;
              if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                perRunStateLastMtime = st.mtimeMs;
                lastStreamActivityMs = Date.now();
                enqueuePost("/api/v1/runs/sync-live", {
                  engine: spec.engine,
                  source: "live",
                  runKey,
                  ...baseCtx,
                  records: [parsed],
                });
              }
            }
          } catch {
            // Ignore partial/transient write.
          }
        }

        const eventsPath = join(dir, ".factory", "runs", perRunSafeId, "events.jsonl");
        if (!existsSync(eventsPath)) continue;
        if (perRunEventsPath && perRunEventsPath !== eventsPath) continue;
        perRunEventsPath = eventsPath;
        const { text, nextOffset } = readNewTextFromOffset(eventsPath, perRunEventsOffset);
        if (!text) continue;
        perRunEventsOffset = nextOffset;
        const combined = perRunEventsRemainder + text;
        const lines = combined.split("\n");
        perRunEventsRemainder = lines.pop() ?? "";
        for (const rawLine of lines) {
          const trimmed = rawLine.trim();
          if (!trimmed || !trimmed.startsWith("{")) continue;
          let ev: Record<string, unknown>;
          try {
            ev = JSON.parse(trimmed) as Record<string, unknown>;
          } catch {
            continue;
          }
          const evType = String(ev.event || "");
          const evPhase = String(ev.phase || basePhase);
          const evRole = String(ev.role || "");
          const evModel = String(ev.model || "");
          const evSeq = Number(ev.seq || 0);
          lastStreamActivityMs = Date.now();

          if (evType === "agent_start" && evRole) {
            perRunActiveAgents.add(evRole);
            const meta = parseAgyWorkflowAgentMeta(evRole, evPhase, `wf-${evSeq}`);
            console.log(
              `sf daemon [${runKey}]: ▶ [${evPhase}] ${meta.name}${evModel ? ` (${evModel})` : ""}`,
            );
            enqueuePost("/api/v1/runs/agent", {
              run: runKey,
              ...baseCtx,
              agentKey: meta.agentKey,
              name: meta.name,
              preserveExistingName: meta.preserveExistingName,
              role: meta.role,
              specId: meta.specId,
              level: meta.level,
              model: evModel && evModel !== "inherit" ? evModel : undefined,
              status: "working",
              activity: `${evPhase}: running ${evRole}`.slice(0, 150),
            });
          } else if ((evType === "agent_done" || evType === "agent_error") && evRole) {
            perRunActiveAgents.delete(evRole);
            const meta = parseAgyWorkflowAgentMeta(evRole, evPhase, `wf-${evSeq}`);
            const durSec = Math.max(0, Math.round(Number(ev.durationMs || 0) / 1000));
            const icon = evType === "agent_done" ? "✓" : "✗";
            console.log(
              `sf daemon [${runKey}]: ${icon} [${evPhase}] ${meta.name} (${durSec}s${ev.error ? ` · ${String(ev.error).slice(0, 80)}` : ""})`,
            );
            enqueuePost("/api/v1/runs/agent", {
              run: runKey,
              ...baseCtx,
              agentKey: meta.agentKey,
              name: meta.name,
              preserveExistingName: meta.preserveExistingName,
              role: meta.role,
              specId: meta.specId,
              level: meta.level,
              model: evModel && evModel !== "inherit" ? evModel : undefined,
              status: evType === "agent_done" ? "passed" : "failed",
              activity: evType === "agent_done" ? `Completed (${durSec}s)` : `Failed (${durSec}s)`,
              summary: typeof ev.error === "string" && ev.error ? ev.error.slice(0, 500) : undefined,
            });
          } else if (evType === "phase_state") {
            const evOutcome = String(ev.outcome || "running");
            const evAgents = Number(ev.agents || 0);
            console.log(
              `sf daemon [${runKey}]: ◆ phase=${evPhase} outcome=${evOutcome} agents=${evAgents}`,
            );
          }
        }
      }
    }

    // Track every subagent spawned by `run_workflow` or `invoke_subagent` (recursively)
    // by watching task logs & tailing each subagent's live transcript.jsonl.
    const agySubagentTracker =
      spec.engine === "antigravity" && runKey
        ? createAgySubagentTracker({
            runKey,
            baseCtx,
            defaultPhase: basePhase,
            initialRootOffset,
            enqueuePost,
            emitLive: emitLiveChunk,
            onActivity: () => {
              lastStreamActivityMs = Date.now();
            },
            onLog: (msg) => {
              console.log(`sf daemon [${runKey}]: ${msg}`);
            },
          })
        : null;

    // Track Claude Code Agent/Task subagents via parent_tool_use_id in stream-json.
    const claudeSubagents = new Map<
      string,
      { agentKey: string; name: string; role: string; model: string }
    >();

    function formatLiveWritingLabel(text: string): string {
      const charCount = text.length.toLocaleString();
      if (/```sf-tickets/i.test(text)) {
        const ticketMatches = text.match(/"issueKey"\s*:/g);
        const count = ticketMatches ? ticketMatches.length : 0;
        return count > 0
          ? `Generating Kanban tickets… (${count} drafted · ${charCount} chars)`
          : `Generating Kanban tickets JSON… (${charCount} chars)`;
      }
      if (/```sf-questions/i.test(text)) {
        const qMatches = text.match(/"question"\s*:/g);
        const count = qMatches ? qMatches.length : 0;
        return count > 0
          ? `Preparing interactive questions… (${count} ready)`
          : "Preparing interactive questions…";
      }
      return `Writing response… (${charCount} chars)`;
    }

    // Periodic thinking & liveness heartbeat: always poll per-run files & subagents, and keep
    // `lastHeartbeatAt` alive whenever the child CLI process is still running so long `run_workflow`
    // phases never get falsely marked stalled after 10 minutes.
    const liveHeartbeatTimer = runKey
      ? setInterval(() => {
          const nowMs = Date.now();
          const childAlive = child.exitCode === null && !child.killed;
          syncPerRunProgress();
          agySubagentTracker?.syncOnce();
          const hasSubagents =
            Boolean(agySubagentTracker?.hasActiveSubagents()) || perRunActiveAgents.size > 0;
          if (childAlive && (hasSubagents || activeToolRunning)) {
            if (nowMs - lastServerHeartbeatMs >= 45_000) {
              const activeNames = Array.from(perRunActiveAgents).slice(0, 3);
              enqueuePost("/api/v1/runs/agent", {
                run: runKey,
                ...baseCtx,
                agentKey: "orchestrator",
                preserveExistingName: true,
                role: "orchestrator",
                model: activeModel,
                status: "working",
                ...(activeNames.length > 0
                  ? { activity: `Workflow running: ${activeNames.join(", ")}`.slice(0, 150) }
                  : {}),
              });
            }
            return;
          }
          const idleSec = Math.floor((nowMs - lastStreamActivityMs) / 1000);
          if (idleSec < 4) return;
          const thinkSec = Math.max(1, Math.floor((nowMs - thinkingSinceMs) / 1000));
          enqueuePost("/api/v1/runs/agent", {
            run: runKey,
            ...baseCtx,
            agentKey: "orchestrator",
            role: "orchestrator",
            model: activeModel,
            status: "working",
            activity: `Thinking… (${thinkSec}s)`,
          });
        }, 3000)
      : null;

    function agyStepPrefix(): string {
      const short = (activeConvId || turnTag).replace(/[^a-zA-Z0-9_-]+/g, "").slice(0, 8);
      return `agy-${short}`;
    }

    function flushAgyStreamStep(stepIdx: number) {
      if (!runKey || agyStreamingInFlight.has(stepIdx)) return;
      const curText = (agyTextByStep.get(stepIdx) || "").trim();
      if (!curText) return;
      if (agyLastFlushLen.get(stepIdx) === curText.length) return;
      agyLastFlushMs.set(stepIdx, Date.now());
      agyLastFlushLen.set(stepIdx, curText.length);
      agyStreamingInFlight.add(stepIdx);
      const liveLabel = formatLiveWritingLabel(curText);
      const stepKey = `${agyStepPrefix()}-r${stepIdx}`;
      postChain = postChain
        .then(() =>
          sendJson(cfg!, "/api/v1/runs/step", {
            run: runKey,
            ...baseCtx,
            upsert: true,
            step: stepKey,
            phase: basePhase,
            status: "started",
            role: "orchestrator",
            agent: "orchestrator",
            model: activeModel,
            label: liveLabel,
            summary: curText.slice(0, MAX_RESPONSE_CHARS),
            data: {
              kind: "assistant_message",
              engine: "antigravity",
              model: activeModel,
              streaming: true,
            },
          }),
        )
        .catch(() => {})
        .finally(() => {
          agyStreamingInFlight.delete(stepIdx);
        });
    }

    function handleAgyEvent(ev: Record<string, unknown>) {
      const eventName = String(ev.event || "");
      const convId =
        typeof ev.conversation_id === "string"
          ? ev.conversation_id
          : typeof (ev.step_update as Record<string, unknown> | undefined)?.conversation_id ===
              "string"
            ? String((ev.step_update as Record<string, unknown>).conversation_id)
            : typeof (ev.result as Record<string, unknown> | undefined)?.conversation_id ===
                "string"
              ? String((ev.result as Record<string, unknown>).conversation_id)
              : "";

      if (convId && runKey) {
        if (activeConvId && activeConvId.toLowerCase() !== convId.toLowerCase()) {
          priorConvUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
        }
        activeConvId = convId;
        agySubagentTracker?.attachRoot(convId, true);
        const existingSaved = sessionMap[runKey];
        saveSession(runKey, {
          engine: "antigravity",
          sessionId: convId,
          model: activeModel,
          autonomy: spec.autonomy,
          mode: spec.mode,
          cwd,
          issueKey: issueKey || existingSaved?.issueKey,
          reportedInputTokens:
            existingSaved?.sessionId === convId ? existingSaved.reportedInputTokens : undefined,
          reportedOutputTokens:
            existingSaved?.sessionId === convId ? existingSaved.reportedOutputTokens : undefined,
          reportedCacheReadTokens:
            existingSaved?.sessionId === convId ? existingSaved.reportedCacheReadTokens : undefined,
          updatedAt: new Date().toISOString(),
        });
      }

      if (eventName === "init") {
        const init = (ev.init || {}) as Record<string, unknown>;
        if (typeof init.model === "string" && init.model.trim()) {
          activeModel = init.model.trim();
        }
        thinkingSinceMs = Date.now();
        lastStreamActivityMs = Date.now();
        if (runKey) {
          enqueuePost("/api/v1/runs/agent", {
            run: runKey,
            ...baseCtx,
            agentKey: "orchestrator",
            name: spec.mode === "ba" ? "BA Ticket Planner" : "Session Orchestrator",
            role: "orchestrator",
            model: activeModel,
            status: "working",
            activity: `Connected (${activeModel}) · conv ${convId.slice(0, 8)}`,
          });
        }
        return;
      }

      if (eventName === "step_update") {
        const su = (ev.step_update || {}) as Record<string, unknown>;
        const stepIdx = Number(su.step_index ?? 0);
        const state = String(su.state || "").toUpperCase();
        const stepType = String(su.step_type || "");
        const durationMs =
          typeof su.duration_seconds === "number"
            ? Math.round(su.duration_seconds * 1000)
            : undefined;
        const usageObj =
          su.usage && typeof su.usage === "object" ? (su.usage as Record<string, unknown>) : null;

        if (stepType === "tool") {
          const toolName = String(
            su.tool_name || (su.tool_info as Record<string, unknown> | undefined)?.name || "tool",
          );
          const toolInfo = (su.tool_info || {}) as Record<string, unknown>;
          const label = summarizeToolParams(toolName, toolInfo.parameters);

          if (state === "ACTIVE" && runKey) {
            activeToolRunning = true;
            lastStreamActivityMs = Date.now();
            const safeTool = toolName.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 28) || "tool";
            emitLiveChunk({
              kind: "tool_active",
              stepKey: `${agyStepPrefix()}-${safeTool}-${stepIdx}`,
              agentKey: "orchestrator",
              agentName: "Session Orchestrator",
              tool: toolName,
              label: label.slice(0, 155),
              ts: Date.now(),
            });
            enqueuePost("/api/v1/runs/agent", {
              run: runKey,
              ...baseCtx,
              agentKey: "orchestrator",
              role: "orchestrator",
              model: activeModel,
              status: "working",
              activity: label.slice(0, 150),
            });
          } else if ((state === "DONE" || state === "ERROR") && runKey) {
            activeToolRunning = false;
            thinkingSinceMs = Date.now();
            lastStreamActivityMs = Date.now();
            const safeToolForLive = toolName.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 28) || "tool";
            emitLiveChunk({
              kind: "tool_done",
              stepKey: `${agyStepPrefix()}-${safeToolForLive}-${stepIdx}`,
              agentKey: "orchestrator",
              status: state === "ERROR" ? "failed" : "passed",
              ts: Date.now(),
            });
            const inTok = Number(usageObj?.input_tokens || 0);
            const outTok = Number(usageObj?.output_tokens || 0);
            const cacheTok = Number(usageObj?.cache_read_tokens || 0);
            const toolCost =
              inTok || outTok || cacheTok
                ? estimateCostUsd("antigravity", activeModel, inTok, outTok, cacheTok)
                : 0;
            if (inTok || outTok || cacheTok) {
              totalReportedIn += inTok;
              totalReportedOut += outTok;
              totalReportedCache += cacheTok;
              totalReportedCost += toolCost;
            }
            const errObj = (toolInfo.error || {}) as Record<string, unknown>;
            const errMsg =
              typeof errObj.message === "string"
                ? errObj.message.trim()
                : typeof toolInfo.error === "string"
                  ? toolInfo.error.trim()
                  : "";
            const outText =
              typeof toolInfo.output === "string" && toolInfo.output.trim()
                ? toolInfo.output.trim().slice(-6000)
                : errMsg
                  ? errMsg.slice(0, 2000)
                  : state === "ERROR"
                    ? "Tool call failed"
                    : "";
            const safeTool = toolName.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 28) || "tool";
            enqueuePost("/api/v1/runs/step", {
              run: runKey,
              ...baseCtx,
              idempotent: true,
              step: `${agyStepPrefix()}-${safeTool}-${stepIdx}`,
              phase: basePhase,
              status: state === "ERROR" ? "failed" : "passed",
              role: "orchestrator",
              agent: "orchestrator",
              model: activeModel,
              durationMs,
              inputTokens: inTok || undefined,
              outputTokens: outTok || undefined,
              cacheReadTokens: cacheTok || undefined,
              costUsd: toolCost || undefined,
              label: label.slice(0, 155),
              summary: state === "ERROR" ? outText.slice(0, 1000) : undefined,
              data: {
                kind: "tool_call",
                tool: toolName,
                input: toolInfo.parameters ?? undefined,
                output: outText || undefined,
              },
            });
            if (toolName.toLowerCase().includes("workflow")) {
              agySubagentTracker?.syncOnce();
            } else if (toolName === "invoke_subagent" && outText) {
              const pObj =
                toolInfo.parameters && typeof toolInfo.parameters === "object"
                  ? (toolInfo.parameters as Record<string, unknown>)
                  : {};
              agySubagentTracker?.handleStreamInvokeSubagent(
                String(pObj.Role || pObj.role || ""),
                String(pObj.TypeName || pObj.typeName || "subagent"),
                outText,
              );
            }
          }
          return;
        }

        if (stepType === "agent_response") {
          if (typeof su.text_delta === "string" && su.text_delta) {
            const prev = agyTextByStep.get(stepIdx) || "";
            const next = prev + su.text_delta;
            // IMPORTANT: Keep from the START (never negative-slice off the beginning!).
            agyTextByStep.set(
              stepIdx,
              next.length > MAX_RESPONSE_CHARS ? next.slice(0, MAX_RESPONSE_CHARS) : next,
            );
            lastStreamActivityMs = Date.now();
            if (runKey) {
              emitLiveChunk({
                kind: "text_delta",
                stepKey: `${agyStepPrefix()}-r${stepIdx}`,
                agentKey: "orchestrator",
                agentName: "Session Orchestrator",
                delta: su.text_delta,
                model: activeModel,
                ts: Date.now(),
              });
            }
          }

          if (state === "ACTIVE" && runKey) {
            activeToolRunning = false;
            const curText = (agyTextByStep.get(stepIdx) || "").trim();
            const lastMs = agyLastFlushMs.get(stepIdx) || 0;
            const dbDraftIntervalMs = liveGrant && liveGrant.transport !== "sse" ? 3000 : 1200;
            if (curText && (lastMs === 0 || Date.now() - lastMs >= dbDraftIntervalMs)) {
              flushAgyStreamStep(stepIdx);
            }
          } else if (state === "DONE" && runKey) {
            activeToolRunning = false;
            thinkingSinceMs = Date.now();
            lastStreamActivityMs = Date.now();
            const usage = usageObj || {};
            const inTok = Number(usage.input_tokens || 0);
            const outTok = Number(usage.output_tokens || 0);
            const cacheTok = Number(usage.cache_read_tokens || 0);
            const costUsd = estimateCostUsd("antigravity", activeModel, inTok, outTok, cacheTok);
            totalReportedIn += inTok;
            totalReportedOut += outTok;
            totalReportedCache += cacheTok;
            totalReportedCost += costUsd;
            const text = (agyTextByStep.get(stepIdx) || "").trim();
            agyLastFlushMs.delete(stepIdx);
            agyLastFlushLen.delete(stepIdx);
            if (text) {
              finalResponseText = text;
              emittedAssistantResponse = true;
            }
            enqueuePost("/api/v1/runs/step", {
              run: runKey,
              ...baseCtx,
              upsert: Boolean(text),
              idempotent: true,
              step: text ? `${agyStepPrefix()}-r${stepIdx}` : `${agyStepPrefix()}-t${stepIdx}`,
              phase: basePhase,
              status: "info",
              role: "orchestrator",
              agent: "orchestrator",
              model: activeModel,
              durationMs,
              inputTokens: inTok || undefined,
              outputTokens: outTok || undefined,
              cacheReadTokens: cacheTok || undefined,
              costUsd: costUsd || undefined,
              label: text ? "Assistant" : "Thinking",
              summary: text ? text.slice(0, MAX_RESPONSE_CHARS) : undefined,
              data: text
                ? { kind: "assistant_message", engine: "antigravity", model: activeModel }
                : {
                    kind: "thinking",
                    thinkingTokens: Number(usage.thinking_tokens || 0),
                  },
            });
          }
          return;
        }

        // Capture usage emitted on any other DONE step type so live token totals stay accurate.
        if (state === "DONE" && runKey && usageObj) {
          const inTok = Number(usageObj.input_tokens || 0);
          const outTok = Number(usageObj.output_tokens || 0);
          const cacheTok = Number(usageObj.cache_read_tokens || 0);
          if (inTok > 0 || outTok > 0 || cacheTok > 0) {
            const costUsd = estimateCostUsd("antigravity", activeModel, inTok, outTok, cacheTok);
            totalReportedIn += inTok;
            totalReportedOut += outTok;
            totalReportedCache += cacheTok;
            totalReportedCost += costUsd;
            enqueuePost("/api/v1/runs/step", {
              run: runKey,
              ...baseCtx,
              idempotent: true,
              keepAgentStatus: true,
              step: `${agyStepPrefix()}-u${stepIdx}`,
              phase: basePhase,
              status: "info",
              role: "orchestrator",
              agent: "orchestrator",
              model: activeModel,
              durationMs,
              inputTokens: inTok || undefined,
              outputTokens: outTok || undefined,
              cacheReadTokens: cacheTok || undefined,
              costUsd: costUsd || undefined,
              label: "Thinking",
              data: {
                kind: "thinking",
                stepType,
                thinkingTokens: Number(usageObj.thinking_tokens || 0),
              },
            });
          }
        }
        return;
      }

      if (eventName === "result") {
        const res = (ev.result || {}) as Record<string, unknown>;
        const status = String(res.status || "").toUpperCase();
        if (status && status !== "SUCCESS") sawErrorResult = true;
        if (typeof res.response === "string" && res.response.trim()) {
          finalResponseText = res.response.trim();
        }
        const denied = Array.isArray(res.denied_actions)
          ? (res.denied_actions as Array<Record<string, unknown>>)
              .map((d) => String(d.display_name || d.action || "tool"))
              .filter(Boolean)
          : [];
        if (denied.length > 0 && !finalResponseText) {
          blockedByPermission = true;
          deniedActionsSummary = `Headless Antigravity denied tool permission (${denied.join(", ")}). Switch Autonomy to Medium or High and retry.`;
        }
        // Compute unreported residual against cumulative conversation usage (prior turns + this turn)
        // so resumed multi-turn `agy --resume` sessions NEVER double-count earlier turns!
        const usage = (res.usage || {}) as Record<string, unknown>;
        const delta = computeAgyResultTokenDelta({
          resultUsage: {
            inputTokens: Number(usage.input_tokens || 0),
            outputTokens: Number(usage.output_tokens || 0),
            cacheReadTokens: Number(usage.cache_read_tokens || 0),
          },
          priorCumulative: priorConvUsage,
          turnReported: {
            inputTokens: totalReportedIn,
            outputTokens: totalReportedOut,
            cacheReadTokens: totalReportedCache,
          },
        });
        const { remIn, remOut, remCache, nextCumulative } = delta;
        priorConvUsage = nextCumulative;
        if (runKey && (activeConvId || convId)) {
          saveSession(runKey, {
            engine: "antigravity",
            sessionId: convId || activeConvId,
            model: activeModel,
            autonomy: spec.autonomy,
            mode: spec.mode,
            cwd,
            issueKey: issueKey || sessionMap[runKey]?.issueKey,
            reportedInputTokens: nextCumulative.inputTokens,
            reportedOutputTokens: nextCumulative.outputTokens,
            reportedCacheReadTokens: nextCumulative.cacheReadTokens,
            updatedAt: new Date().toISOString(),
          });
        }
        const turnIn = totalReportedIn + remIn;
        const turnOut = totalReportedOut + remOut;
        const turnCache = totalReportedCache + remCache;
        const turnCost = estimateCostUsd("antigravity", activeModel, turnIn, turnOut, turnCache);
        console.log(
          `sf daemon [${runKey || "run"}]: tokens turn(in=${turnIn.toLocaleString()} out=${turnOut.toLocaleString()} cache=${turnCache.toLocaleString()} ~$${turnCost.toFixed(4)} · ${activeModel}) conv_total(in=${nextCumulative.inputTokens.toLocaleString()} out=${nextCumulative.outputTokens.toLocaleString()})`,
        );
        if (runKey && !emittedAssistantResponse && finalResponseText) {
          const remCost = estimateCostUsd("antigravity", activeModel, remIn, remOut, remCache);
          emittedAssistantResponse = true;
          enqueuePost("/api/v1/runs/step", {
            run: runKey,
            ...baseCtx,
            idempotent: true,
            step: `${agyStepPrefix()}-res-${turnTag}`,
            phase: basePhase,
            status: sawErrorResult ? "failed" : "passed",
            role: "orchestrator",
            agent: "orchestrator",
            model: activeModel,
            inputTokens: remIn || undefined,
            outputTokens: remOut || undefined,
            cacheReadTokens: remCache || undefined,
            costUsd: remCost || undefined,
            label: "Assistant",
            summary: finalResponseText.slice(0, MAX_RESPONSE_CHARS),
            data: { kind: "assistant_message", engine: "antigravity", model: activeModel },
          });
        } else if (runKey && (remIn > 0 || remOut > 0 || remCache > 0)) {
          const remCost = estimateCostUsd("antigravity", activeModel, remIn, remOut, remCache);
          enqueuePost("/api/v1/runs/step", {
            run: runKey,
            ...baseCtx,
            idempotent: true,
            step: `${agyStepPrefix()}-met-${turnTag}`,
            phase: basePhase,
            status: sawErrorResult ? "failed" : "passed",
            role: "orchestrator",
            agent: "orchestrator",
            model: activeModel,
            inputTokens: remIn || undefined,
            outputTokens: remOut || undefined,
            cacheReadTokens: remCache || undefined,
            costUsd: remCost || undefined,
            label: "Usage recorded",
            data: { kind: "turn_metrics", status },
          });
        }
      }
    }

    function handleClaudeEvent(ev: Record<string, unknown>) {
      const evType = String(ev.type || "");
      const sid = typeof ev.session_id === "string" ? ev.session_id : "";
      if (sid && runKey) {
        saveSession(runKey, {
          engine: "claude",
          sessionId: sid,
          model: spec.model,
          autonomy: spec.autonomy,
          mode: spec.mode,
          cwd,
        });
      }

      if (evType === "system" && ev.subtype === "init" && runKey) {
        if (typeof ev.model === "string" && ev.model.trim()) {
          activeModel = ev.model.trim();
        }
        thinkingSinceMs = Date.now();
        lastStreamActivityMs = Date.now();
        enqueuePost("/api/v1/runs/agent", {
          run: runKey,
          ...baseCtx,
          agentKey: "orchestrator",
          name: spec.mode === "ba" ? "BA Ticket Planner" : "Session Orchestrator",
          role: "orchestrator",
          model: activeModel,
          status: "working",
          activity: `Connected (${activeModel}) · session ${sid.slice(0, 8)}`,
        });
        return;
      }

      if (evType === "user" && runKey) {
        const msg = (ev.message || {}) as Record<string, unknown>;
        const content = Array.isArray(msg.content) ? msg.content : [];
        for (const rawBlock of content) {
          const block = (rawBlock || {}) as Record<string, unknown>;
          if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
            const sub = claudeSubagents.get(block.tool_use_id);
            if (sub) {
              claudeSubagents.delete(block.tool_use_id);
              enqueuePost("/api/v1/runs/agent", {
                run: runKey,
                ...baseCtx,
                agentKey: sub.agentKey,
                name: sub.name,
                role: sub.role,
                model: sub.model,
                status: block.is_error === true ? "failed" : "passed",
                activity: block.is_error === true ? "Failed" : "Completed",
              });
            }
          }
        }
        return;
      }

      if (evType === "assistant" && runKey) {
        thinkingSinceMs = Date.now();
        lastStreamActivityMs = Date.now();
        const msg = (ev.message || {}) as Record<string, unknown>;
        const content = Array.isArray(msg.content) ? msg.content : [];
        const usage = (msg.usage || {}) as Record<string, unknown>;
        const activeModel = String(msg.model || spec.model);
        const parentToolUseId =
          typeof ev.parent_tool_use_id === "string" ? ev.parent_tool_use_id : "";
        const activeSub = parentToolUseId ? claudeSubagents.get(parentToolUseId) : undefined;
        const targetAgentKey = activeSub?.agentKey || "orchestrator";
        const targetRole = activeSub?.role || "orchestrator";
        const targetName = activeSub?.name;
        const inTok =
          Number(usage.input_tokens || 0) + Number(usage.cache_creation_input_tokens || 0);
        const outTok = Number(usage.output_tokens || 0);
        const cacheTok = Number(usage.cache_read_input_tokens || 0);
        let usageAttributed = false;

        for (const rawBlock of content) {
          const block = (rawBlock || {}) as Record<string, unknown>;
          if (block.type === "tool_use") {
            const toolName = String(block.name || "tool");
            const label = summarizeToolParams(toolName, block.input);
            if (
              (toolName === "Agent" || toolName === "Task") &&
              typeof block.id === "string" &&
              block.id
            ) {
              const inp =
                block.input && typeof block.input === "object"
                  ? (block.input as Record<string, unknown>)
                  : {};
              const subType = String(inp.subagent_type || "subagent").trim();
              const subDesc = String(inp.description || subType || "Subagent").trim();
              const slug = subDesc
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-+|-+$/g, "")
                .slice(0, 28);
              const subKey = slug
                ? `${slug}-${block.id.slice(-6)}`
                : `sub-${block.id.slice(-8)}`;
              const subEntry = {
                agentKey: subKey,
                name: subDesc.slice(0, 120),
                role: ["planner", "implementer", "qa", "checker", "reviewer", "qc", "research"].includes(
                  subType.toLowerCase(),
                )
                  ? subType.toLowerCase()
                  : "subagent",
                model: String(inp.model || activeModel),
              };
              claudeSubagents.set(block.id, subEntry);
              enqueuePost("/api/v1/runs/agent", {
                run: runKey,
                ...baseCtx,
                agentKey: subEntry.agentKey,
                name: subEntry.name,
                role: subEntry.role,
                model: subEntry.model,
                status: "working",
                activity: `Spawned (${subType})`,
              });
            }
            enqueuePost("/api/v1/runs/agent", {
              run: runKey,
              ...baseCtx,
              agentKey: targetAgentKey,
              name: targetName,
              preserveExistingName: true,
              role: targetRole,
              model: activeModel,
              status: "working",
              activity: label.slice(0, 150),
            });
            enqueuePost("/api/v1/runs/step", {
              run: runKey,
              ...baseCtx,
              step: toolName.slice(0, 80),
              phase: basePhase,
              status: "passed",
              role: targetRole,
              agent: targetAgentKey,
              agentName: targetName,
              model: activeModel,
              inputTokens: !usageAttributed && inTok ? inTok : undefined,
              outputTokens: !usageAttributed && outTok ? outTok : undefined,
              cacheReadTokens: !usageAttributed && cacheTok ? cacheTok : undefined,
              label: label.slice(0, 155),
              data: {
                kind: "tool_call",
                tool: toolName,
                input: block.input ?? undefined,
              },
            });
            if (!usageAttributed) {
              totalReportedIn += inTok;
              totalReportedOut += outTok;
              totalReportedCache += cacheTok;
              usageAttributed = true;
            }
          } else if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
            const text = block.text.trim();
            if (!activeSub) {
              finalResponseText = text;
              emittedAssistantResponse = true;
            }
            enqueuePost("/api/v1/runs/step", {
              run: runKey,
              ...baseCtx,
              step: activeSub ? `submsg-${activeSub.agentKey}` : "assistant-response",
              phase: basePhase,
              status: "info",
              role: targetRole,
              agent: targetAgentKey,
              agentName: targetName,
              model: activeModel,
              inputTokens: !usageAttributed && inTok ? inTok : undefined,
              outputTokens: !usageAttributed && outTok ? outTok : undefined,
              cacheReadTokens: !usageAttributed && cacheTok ? cacheTok : undefined,
              label: activeSub ? `${activeSub.name}: response` : "Assistant",
              summary: text.slice(0, MAX_RESPONSE_CHARS),
              data: activeSub
                ? { kind: "lifecycle", agentName: activeSub.name }
                : { kind: "assistant_message", engine: "claude", model: activeModel },
            });
            if (!usageAttributed) {
              totalReportedIn += inTok;
              totalReportedOut += outTok;
              totalReportedCache += cacheTok;
              usageAttributed = true;
            }
          }
        }
        return;
      }

      if (evType === "result") {
        if (ev.is_error === true || ev.subtype === "error") sawErrorResult = true;
        if (typeof ev.result === "string" && ev.result.trim()) {
          finalResponseText = ev.result.trim();
        }
        const exactCost = typeof ev.total_cost_usd === "number" ? ev.total_cost_usd : 0;
        const deltaCost = Math.max(0, exactCost - totalReportedCost);
        totalReportedCost = exactCost;
        const usage = (ev.usage || {}) as Record<string, unknown>;
        const totalIn =
          Number(usage.input_tokens || 0) + Number(usage.cache_creation_input_tokens || 0);
        const remIn = Math.max(0, totalIn - totalReportedIn);
        const remOut = Math.max(0, Number(usage.output_tokens || 0) - totalReportedOut);
        const remCache = Math.max(
          0,
          Number(usage.cache_read_input_tokens || 0) - totalReportedCache,
        );
        const durationMs =
          typeof ev.duration_ms === "number" ? Math.round(ev.duration_ms) : undefined;
        if (runKey && !emittedAssistantResponse && finalResponseText) {
          emittedAssistantResponse = true;
          enqueuePost("/api/v1/runs/step", {
            run: runKey,
            ...baseCtx,
            idempotent: true,
            step: `cl-res-${turnTag}`,
            phase: basePhase,
            status: sawErrorResult ? "failed" : "passed",
            role: "orchestrator",
            agent: "orchestrator",
            model: activeModel,
            durationMs,
            inputTokens: remIn || undefined,
            outputTokens: remOut || undefined,
            cacheReadTokens: remCache || undefined,
            costUsd: deltaCost || undefined,
            label: "Assistant",
            summary: finalResponseText.slice(0, MAX_RESPONSE_CHARS),
            data: { kind: "assistant_message", engine: "claude", model: activeModel, costUsd: exactCost },
          });
        } else if (runKey && (deltaCost > 0 || remIn > 0 || remOut > 0 || remCache > 0)) {
          enqueuePost("/api/v1/runs/step", {
            run: runKey,
            ...baseCtx,
            idempotent: true,
            step: `cl-met-${turnTag}`,
            phase: basePhase,
            status: sawErrorResult ? "failed" : "passed",
            role: "orchestrator",
            agent: "orchestrator",
            model: activeModel,
            durationMs,
            inputTokens: remIn || undefined,
            outputTokens: remOut || undefined,
            cacheReadTokens: remCache || undefined,
            costUsd: deltaCost || undefined,
            label: `Turn completed ($${exactCost.toFixed(4)})`,
            data: { kind: "turn_metrics", costUsd: exactCost, durationMs },
          });
        }
      }
    }

    function processNdjsonLine(rawLine: string) {
      const trimmed = rawLine.trim();
      if (!trimmed || !trimmed.startsWith("{")) return;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        return;
      }
      if (spec.engine === "claude") {
        handleClaudeEvent(parsed);
      } else {
        handleAgyEvent(parsed);
      }
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      lineBuf += chunk.toString("utf8");
      let nl = lineBuf.indexOf("\n");
      while (nl !== -1) {
        const line = lineBuf.slice(0, nl);
        lineBuf = lineBuf.slice(nl + 1);
        processNdjsonLine(line);
        nl = lineBuf.indexOf("\n");
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf = (stderrBuf + chunk.toString("utf8")).slice(-12_000);
    });

    child.on("error", async (err) => {
      if (liveHeartbeatTimer) clearInterval(liveHeartbeatTimer);
      syncPerRunProgress();
      agySubagentTracker?.stop();
      flushLiveQueueNow();
      liveStopped = true;
      await liveFlushChain;
      if (runKey) activeChildren.delete(runKey);
      activeRuns = Math.max(0, activeRuns - 1);
      const message = `Failed to spawn ${spec.binary}: ${err.message}`;
      console.error(`sf daemon: ${message}`);
      await sendJsonWithRetry(
        cfg!,
        `/api/v1/runners/commands/${cmdId}`,
        { status: "failed", error: message },
        "PATCH",
        { retries: 2, spoolOnFail: true },
      ).catch(() => {});
      if (runKey) {
        await sendJsonWithRetry(
          cfg!,
          "/api/v1/runs/finish",
          {
            run: runKey,
            ...baseCtx,
            outcome: "failed",
            summary: message,
          },
          "POST",
          { retries: 3, spoolOnFail: true },
        ).catch(() => {});
      }
    });

    child.on("close", async (code, signal) => {
      if (liveHeartbeatTimer) clearInterval(liveHeartbeatTimer);
      if (lineBuf.trim()) processNdjsonLine(lineBuf);
      syncPerRunProgress();
      agySubagentTracker?.stop();
      if (runKey) activeChildren.delete(runKey);
      activeRuns = Math.max(0, activeRuns - 1);
      await postChain;
      if (liveGrant && liveGrant.transport !== "sse") {
        emitLiveChunk({ kind: "step_committed", ts: Date.now() });
      }
      flushLiveQueueNow();
      liveStopped = true;
      await liveFlushChain;

      const wasPaused = signal === "SIGTERM" || signal === "SIGINT";
      const ok = !wasPaused && !blockedByPermission && code === 0 && !sawErrorResult;
      const finalSummary = (
        finalResponseText ||
        deniedActionsSummary ||
        (ok ? "" : stderrBuf) ||
        `${spec.binary} exited with code ${code ?? signal ?? "unknown"}`
      )
        .trim()
        .slice(0, MAX_RESPONSE_CHARS);
      const errorTail = (deniedActionsSummary || stderrBuf || finalSummary).trim().slice(-600);

      console.log(
        `sf daemon: ${spec.binary} finished (code=${code ?? "null"}, signal=${signal ?? "none"}${blockedByPermission ? ", blocked=permission" : ""})`,
      );
      await sendJsonWithRetry(
        cfg!,
        `/api/v1/runners/commands/${cmdId}`,
        ok || wasPaused ? { status: "done" } : { status: "failed", error: errorTail },
        "PATCH",
        { retries: 2, spoolOnFail: true },
      ).catch(() => {});

      const isUnattendedFactory = spec.mode === "factory" || spec.mode === "mission";

      // In BA Ticket Planning / Clarify mode (or any interactive turn returning an `sf-tickets` block),
      // extract drafted/refined tickets and sync them onto the Project Kanban Board.
      // If Clarify wrote `.factory/plans/<issueKey>.json` without emitting `sf-tickets`, auto-sync
      // its updated criteria so Build runs never receive stale pre-clarify drafts.
      if (ok && !isUnattendedFactory) {
        let extractedTickets =
          finalResponseText &&
          (spec.mode === "ba" || spec.mode === "clarify" || /```sf-tickets/i.test(finalResponseText))
            ? extractBaTicketsFromText(finalResponseText)
            : [];
        let syncedFromLocalPlan = false;
        if (extractedTickets.length === 0 && spec.mode === "clarify") {
          const hintKey =
            issueKey ||
            sessionMap[runKey]?.issueKey ||
            (/\bclarify-(i\d+)\b/i.exec(runKey)?.[1]?.toUpperCase() ?? undefined);
          extractedTickets = readLocalPlanForSync(repoRoot || cwd, hintKey, runStartedAtMs);
          syncedFromLocalPlan = extractedTickets.length > 0;
        }
        if (extractedTickets.length > 0) {
          const syncRes = await sendJsonWithRetry(
            cfg!,
            "/api/v1/issues/sync",
            {
              projectId: projectId || undefined,
              repo: repoRoot || cwd,
              missionId: missionId || undefined,
              defaultStatus: "backlog",
              preserveStatus: spec.mode === "clarify" || syncedFromLocalPlan,
              issues: extractedTickets,
            },
            "POST",
            { retries: 2, spoolOnFail: true },
          ).catch(() => ({ ok: false as const, status: 0, error: "sync failed" }));

          if (syncRes.ok) {
            const keys = extractedTickets
              .map((t, idx) => String(t.issueKey || t.key || `I${idx + 1}`))
              .slice(0, 30);
            console.log(
              `sf daemon: synced ${extractedTickets.length} ticket(s) (${keys.join(", ")})${syncedFromLocalPlan ? " from .factory/plans" : ""} to Kanban Board`,
            );
            if (runKey) {
              await sendJsonWithRetry(
                cfg!,
                "/api/v1/runs/step",
                {
                  run: runKey,
                  projectId: projectId || undefined,
                  repo: repoRoot || cwd,
                  step: spec.mode === "clarify" ? "clarify-ticket-synced" : "ba-tickets-synced",
                  phase: spec.mode === "clarify" ? "Clarify" : "BA Planning",
                  status: "passed",
                  role: "orchestrator",
                  agent: "orchestrator",
                  label: syncedFromLocalPlan
                    ? `Auto-synced clarified plan (${keys.join(", ")}) to Kanban Board`
                    : `Synced ${extractedTickets.length} ticket(s) to Kanban Board`,
                  summary: `Updated ${keys.join(", ")} — ready for review & approval.`,
                  data: {
                    kind: "ba_tickets",
                    count: extractedTickets.length,
                    issueKeys: keys,
                    source: syncedFromLocalPlan ? "local_plan" : "sf_tickets",
                  },
                },
                "POST",
                { retries: 2, spoolOnFail: true },
              ).catch(() => {});

              if (spec.mode === "ba") {
                await sendJsonWithRetry(
                  cfg!,
                  "/api/v1/runs/interaction",
                  {
                    run: runKey,
                    projectId: projectId || undefined,
                    repo: repoRoot || cwd,
                    type: "plan_approval",
                    title: `Confirm ${extractedTickets.length} BA ticket(s) (${keys.join(", ")})`,
                    prompt:
                      "Review the drafted tickets below or on the Kanban Board. Reply in chat to refine them, or click Confirm & Auto-Run.",
                    agentKey: "orchestrator",
                    payload: { issueKeys: keys, count: extractedTickets.length },
                  },
                  "POST",
                  { retries: 2, spoolOnFail: true },
                ).catch(() => {});
              }
            }
          } else {
            console.error(`sf daemon: ticket sync failed: ${syncRes.error}`);
          }
        }
      }

      // Extract & upload any clickable HTML prototypes created during this interactive turn
      // (both inline `sf-prototype` blocks and `.factory/prototypes/<slug>/index.html` files).
      if (ok && !isUnattendedFactory) {
        const extractedProtos = extractPrototypesFromTurn(
          finalResponseText,
          repoRoot || cwd,
          runStartedAtMs,
        );
        if (extractedProtos.length > 0) {
          const uploadedTitles: string[] = [];
          for (const proto of extractedProtos) {
            const pRes = await sendJson(cfg!, "/api/v1/prototypes", {
              projectId: projectId || undefined,
              repo: repoRoot || cwd,
              run: runKey || undefined,
              slug: proto.slug,
              title: proto.title,
              kind: proto.kind,
              binding: proto.binding,
              issueKeys: proto.issueKeys,
              htmlPath: proto.htmlPath,
              htmlContent: proto.htmlContent,
              manifest: proto.manifest,
            }).catch(() => ({ ok: false as const, status: 0, error: "upload failed" }));
            if (pRes.ok) {
              uploadedTitles.push(proto.title);
            } else {
              console.error(`sf daemon: prototype upload failed (${proto.title}): ${pRes.error}`);
            }
          }
          if (uploadedTitles.length > 0) {
            console.log(
              `sf daemon: uploaded ${uploadedTitles.length} interactive prototype(s) (${uploadedTitles.join(", ")})`,
            );
            if (runKey) {
              await sendJson(cfg!, "/api/v1/runs/step", {
                run: runKey,
                projectId: projectId || undefined,
                repo: repoRoot || cwd,
                step: "ba-prototype-synced",
                phase: spec.mode === "clarify" ? "Clarify" : "BA Prototype",
                status: "passed",
                role: "orchestrator",
                agent: "orchestrator",
                label: `Published ${uploadedTitles.length} interactive prototype(s)`,
                summary: `Ready to preview & click: ${uploadedTitles.join(", ")}`,
                data: { kind: "ba_prototypes", count: uploadedTitles.length, titles: uploadedTitles },
              }).catch(() => {});
            }
          }
        }
      }

      // Keep Context Lake in sync on remote servers (e.g. Vercel) whenever a run finishes.
      if (repoRoot || cwd) {
        await syncProjectContextToServer(repoRoot || cwd, {
          projectId: projectId || undefined,
        }).catch(() => {});
      }

      if (runKey && !wasPaused) {
        if (isUnattendedFactory) {
          const wf = readWorkflowOutcomeForRun(runKey, [cwd, repoRoot || cwd]);
          const wfOutcome =
            wf?.outcome === "passed" || wf?.outcome === "failed" || wf?.outcome === "blocked"
              ? wf.outcome
              : undefined;
          const workflowConfirmed = wfOutcome === "passed";
          const reportedOutcome = blockedByPermission
            ? "blocked"
            : wfOutcome ?? (ok ? "passed" : "failed");
          const finishRes = await sendJsonWithRetry(
            cfg!,
            "/api/v1/runs/finish",
            {
              run: runKey,
              projectId: projectId || undefined,
              repo: repoRoot || cwd,
              outcome: reportedOutcome,
              workflowOutcome: wfOutcome,
              workflowConfirmed,
              mergeDecision: wf?.mergeDecision,
              risk: wf?.risk,
              summary: wf?.reason || finalSummary,
              skipVerdictStep: reportedOutcome === "passed" && ok && emittedAssistantResponse,
              respectPendingInteraction: false,
            },
            "POST",
            { retries: 3, spoolOnFail: true },
          ).catch(() => ({ ok: false as const, status: 0, error: "finish error", spooled: false }));
          if (!finishRes.ok) {
            console.error(
              `sf daemon [${runKey}]: /api/v1/runs/finish failed (${finishRes.error})${finishRes.spooled ? " — spooled for retry" : ""}`,
            );
          }
        } else {
          const finishRes = await sendJsonWithRetry(
            cfg!,
            "/api/v1/runs/finish",
            {
              run: runKey,
              projectId: projectId || undefined,
              repo: repoRoot || cwd,
              outcome: blockedByPermission ? "blocked" : ok ? "passed" : "failed",
              summary: finalSummary,
              skipVerdictStep: ok && emittedAssistantResponse,
              respectPendingInteraction: true,
            },
            "POST",
            { retries: 3, spoolOnFail: true },
          ).catch(() => ({ ok: false as const, status: 0, error: "finish error", spooled: false }));
          if (!finishRes.ok) {
            console.error(
              `sf daemon [${runKey}]: /api/v1/runs/finish failed (${finishRes.error})${finishRes.spooled ? " — spooled for retry" : ""}`,
            );
          }
        }
      }
    });
  }

  async function materializeCommandAttachments(
    targetCwd: string,
    keyForDir: string,
    rawAttachments: unknown,
  ): Promise<string> {
    if (!Array.isArray(rawAttachments) || rawAttachments.length === 0) return "";
    const safeDir = sanitizeRunDirKey(keyForDir || `att-${Date.now()}`);
    const outDir = join(targetCwd, ".factory", "attachments", safeDir);
    const savedLines: string[] = [];

    for (let idx = 0; idx < rawAttachments.length; idx += 1) {
      const item = rawAttachments[idx];
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const rec = item as Record<string, unknown>;
      const artifactId = typeof rec.artifactId === "string" ? rec.artifactId.trim() : "";
      const rawName = typeof rec.name === "string" ? rec.name.trim() : `attachment-${idx + 1}`;
      const mimeType = typeof rec.mimeType === "string" ? rec.mimeType.trim() : "application/octet-stream";
      if (!artifactId) continue;

      try {
        const res = await fetch(
          `${cfg!.url.replace(/\/+$/, "")}/api/artifacts/file?id=${encodeURIComponent(artifactId)}`,
          {
            headers: { Authorization: `Bearer ${cfg!.token}` },
            signal: AbortSignal.timeout(15_000),
          },
        );
        if (!res.ok) continue;
        const arrBuf = await res.arrayBuffer();
        const bytes = Buffer.from(arrBuf);
        if (bytes.length === 0) continue;

        mkdirSync(outDir, { recursive: true });
        const safeName = rawName
          .split(/[\\/]/)
          .pop()!
          .replace(/[^a-zA-Z0-9._-]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 90) || `file-${idx + 1}`;
        const destPath = join(outDir, `${idx + 1}-${safeName}`);
        writeFileSync(destPath, bytes);
        const kb = bytes.length >= 1024 ? `${(bytes.length / 1024).toFixed(1)} KB` : `${bytes.length} B`;
        savedLines.push(`- ${rawName} (${mimeType}, ${kb}): ${destPath}`);
      } catch {
        // Best-effort download; continue with remaining attachments.
      }
    }

    if (savedLines.length === 0) return "";
    console.log(
      `sf daemon [${keyForDir}]: materialized ${savedLines.length} chat attachment(s) -> ${outDir}`,
    );
    return [
      "[Attached Files — saved locally in workspace; inspect images, PDFs, or documents with `read_file` / `Read` tool]",
      ...savedLines,
    ].join("\n");
  }

  async function executeCommand(cmd: {
    id: string;
    type: string;
    projectId?: string | null;
    runId?: string | null;
    payload: Record<string, unknown>;
  }) {
    await sendJson(cfg!, `/api/v1/runners/commands/${cmd.id}`, { status: "claimed" }, "PATCH");
    const runKey = typeof cmd.payload.runKey === "string" ? cmd.payload.runKey : "";
    const resolvedProjectId =
      (typeof cmd.payload.projectId === "string" && cmd.payload.projectId.trim()
        ? cmd.payload.projectId.trim()
        : undefined) ||
      (typeof cmd.projectId === "string" && cmd.projectId.trim() ? cmd.projectId.trim() : undefined);

    // 0. Create a new project folder inside the daemon's default `workspaceDir`
    if (cmd.type === "create_project") {
      const slugRaw = typeof cmd.payload.slug === "string" ? cmd.payload.slug.trim() : "";
      const safeSlug = slugRaw.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^\.+|\.+$/g, "");
      const projName = typeof cmd.payload.name === "string" ? cmd.payload.name.trim() : safeSlug;
      const projDesc = typeof cmd.payload.description === "string" ? cmd.payload.description.trim() : "";
      const defaultBranch =
        typeof cmd.payload.defaultBranch === "string" && cmd.payload.defaultBranch.trim()
          ? cmd.payload.defaultBranch.trim()
          : "main";
      if (!safeSlug) {
        await sendJson(
          cfg!,
          `/api/v1/runners/commands/${cmd.id}`,
          { status: "failed", error: "Invalid project slug" },
          "PATCH",
        );
        return;
      }
      const targetDir = resolve(workspaceDir, safeSlug);
      if (!targetDir.startsWith(`${workspaceDir}/`)) {
        await sendJson(
          cfg!,
          `/api/v1/runners/commands/${cmd.id}`,
          { status: "failed", error: "Project path outside workspaceDir" },
          "PATCH",
        );
        return;
      }
      try {
        mkdirSync(targetDir, { recursive: true });
        const readmePath = join(targetDir, "README.md");
        if (!existsSync(readmePath)) {
          writeFileSync(
            readmePath,
            `# ${projName || safeSlug}\n${projDesc ? `\n${projDesc}\n` : ""}`,
          );
        }
        // Do NOT pre-create a stub `.factory/project.json` here: `/factory init` owns `.factory/`
        // after BA & PM finalize tickets so `initStatus` accurately reflects uninitialized projects.
        if (!existsSync(join(targetDir, ".git"))) {
          execFileSync("git", ["init", "-b", defaultBranch, targetDir], {
            stdio: "ignore",
            timeout: 10000,
          });
          execFileSync("git", ["-C", targetDir, "add", "."], { stdio: "ignore", timeout: 10000 });
          try {
            execFileSync(
              "git",
              ["-C", targetDir, "commit", "-m", "chore: initialize Factory project"],
              { stdio: "ignore", timeout: 10000 },
            );
          } catch {
            // Git user.name/email may not be configured globally; folder + .git still initialized.
          }
        }
        console.log(`sf daemon: initialized project "${projName}" at ${targetDir}`);
        await sendJson(cfg!, `/api/v1/runners/commands/${cmd.id}`, { status: "done" }, "PATCH");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`sf daemon: create_project failed: ${msg}`);
        await sendJson(
          cfg!,
          `/api/v1/runners/commands/${cmd.id}`,
          { status: "failed", error: msg },
          "PATCH",
        );
      }
      return;
    }

    // 0b. On-demand Context Lake sync requested from Web UI (especially on Vercel!)
    if (cmd.type === "sync_context") {
      const payloadLocalPath =
        typeof cmd.payload.localPath === "string" ? cmd.payload.localPath.trim() : "";
      const payloadSlug =
        typeof cmd.payload.projectSlug === "string" ? cmd.payload.projectSlug.trim() : "";
      const payloadName =
        typeof cmd.payload.projectName === "string" ? cmd.payload.projectName.trim() : "";

      let targetPath = "";
      if (payloadLocalPath && existsSync(payloadLocalPath)) {
        targetPath = payloadLocalPath;
      } else if (payloadSlug && existsSync(join(workspaceDir, payloadSlug))) {
        targetPath = join(workspaceDir, payloadSlug);
      } else if (payloadName && existsSync(join(workspaceDir, payloadName))) {
        targetPath = join(workspaceDir, payloadName);
      } else {
        const wanted = new Set(
          [payloadSlug, payloadName, payloadLocalPath ? basename(payloadLocalPath) : ""]
            .map((v) => v.trim().toLowerCase())
            .filter(Boolean),
        );
        const discoveredMatch = cachedDiscovered.find(
          (p) =>
            p.path &&
            existsSync(p.path) &&
            (wanted.has(p.name.toLowerCase()) || wanted.has(basename(p.path).toLowerCase())),
        );
        if (discoveredMatch?.path) {
          targetPath = discoveredMatch.path;
        }
      }

      if (!targetPath || !existsSync(targetPath)) {
        const errMsg = `Local path not found on runner "${runnerName}": checked ${payloadLocalPath || "(no localPath)"} and ${join(workspaceDir, payloadSlug || payloadName || "<slug>")}`;
        await sendJson(
          cfg!,
          `/api/v1/runners/commands/${cmd.id}`,
          { status: "failed", error: errMsg },
          "PATCH",
        ).catch(() => {});
        return;
      }
      if (!isPathAllowed(targetPath)) {
        await sendJson(
          cfg!,
          `/api/v1/runners/commands/${cmd.id}`,
          { status: "failed", error: `Blocked by --allow-root guardrail: ${targetPath}` },
          "PATCH",
        ).catch(() => {});
        return;
      }
      const syncRes: { ok: boolean; error?: string; count?: number } =
        await syncProjectContextToServer(targetPath, {
          projectId: resolvedProjectId,
          projectSlug: payloadSlug || undefined,
          force: true,
        }).catch((err) => ({ ok: false, error: err instanceof Error ? err.message : String(err) }));
      console.log(
        `sf daemon: sync_context ${targetPath} -> ${syncRes.ok ? `synced (${syncRes.count ?? 0} files)` : `failed (${syncRes.error || "unknown"})`}`,
      );
      await sendJson(
        cfg!,
        `/api/v1/runners/commands/${cmd.id}`,
        syncRes.ok
          ? { status: "done" }
          : { status: "failed", error: syncRes.error || "Could not sync project context" },
        "PATCH",
      ).catch(() => {});
      return;
    }

    // 1. Pause active child process via SIGTERM (interactive sessions only; Factory build loops run unattended)
    if (cmd.type === "pause_run") {
      const pauseMode = String(
        cmd.payload.mode || (runKey ? sessionMap[runKey]?.mode : "") || "",
      );
      if (pauseMode === "factory" || pauseMode === "mission") {
        const msg =
          "Factory build loops run unattended and cannot be paused mid-run. Let the run finish or retry a fresh build.";
        await sendJson(
          cfg!,
          `/api/v1/runners/commands/${cmd.id}`,
          { status: "failed", error: msg },
          "PATCH",
        ).catch(() => {});
        return;
      }
      const child = runKey ? activeChildren.get(runKey) : undefined;
      if (child) {
        child.kill("SIGTERM");
        activeChildren.delete(runKey);
        console.log(`sf daemon: paused active run ${runKey}`);
      }
      if (runKey) {
        await sendJson(cfg!, "/api/v1/runs/agent", {
          run: runKey,
          agentKey: "orchestrator",
          role: "orchestrator",
          status: "waiting_on_you",
          activity: "Paused by operator",
        }).catch(() => {});
      }
      await sendJson(cfg!, `/api/v1/runners/commands/${cmd.id}`, { status: "done" }, "PATCH");
      return;
    }

    // 2. Two-way Steer / Resume / Answer interaction via CLI `--resume <session_id>` (interactive sessions only)
    if (cmd.type === "resume_run" || cmd.type === "answer_interaction") {
      const message = typeof cmd.payload.message === "string" ? cmd.payload.message.trim() : "";
      const decision = typeof cmd.payload.decision === "string" ? cmd.payload.decision.trim() : "";
      const saved = runKey ? sessionMap[runKey] : undefined;
      const resumeMode = String(cmd.payload.mode || saved?.mode || "");
      if (resumeMode === "factory" || resumeMode === "mission") {
        const msg =
          "Factory build loops run unattended and cannot be steered or answered mid-run. Clarify the ticket or retry a fresh build.";
        await sendJson(
          cfg!,
          `/api/v1/runners/commands/${cmd.id}`,
          { status: "failed", error: msg },
          "PATCH",
        ).catch(() => {});
        return;
      }
      const steerPromptBase =
        message || (decision ? `Operator decision: ${decision}. Please continue.` : "");
      if (!steerPromptBase && !Array.isArray(cmd.payload.attachments)) {
        await sendJson(cfg!, `/api/v1/runners/commands/${cmd.id}`, { status: "done" }, "PATCH");
        return;
      }
      // If a process is currently running for this runKey, stop it before resuming with new steer.
      const existingChild = runKey ? activeChildren.get(runKey) : undefined;
      if (existingChild) {
        existingChild.kill("SIGTERM");
        activeChildren.delete(runKey);
      }
      const cwd =
        (typeof cmd.payload.localPath === "string" && existsSync(cmd.payload.localPath)
          ? cmd.payload.localPath
          : saved?.cwd) || process.cwd();
      if (!isPathAllowed(cwd)) {
        const msg = `Blocked by --allow-root guardrail: ${cwd}`;
        console.error(`sf daemon: ${msg}`);
        if (runKey) {
          await sendJson(cfg!, "/api/v1/runs/step", {
            run: runKey,
            step: "security-guardrail",
            phase: "Setup",
            status: "failed",
            label: "Path outside --allow-root",
            summary: msg,
          }).catch(() => {});
        }
        await sendJson(cfg!, `/api/v1/runners/commands/${cmd.id}`, { status: "failed", error: msg }, "PATCH");
        return;
      }
      const attachmentBlock = await materializeCommandAttachments(
        cwd,
        runKey || cmd.id,
        cmd.payload.attachments,
      );
      const steerPrompt = [steerPromptBase, attachmentBlock].filter(Boolean).join("\n\n").trim();
      if (!steerPrompt) {
        await sendJson(cfg!, `/api/v1/runners/commands/${cmd.id}`, { status: "done" }, "PATCH");
        return;
      }
      const spec = buildCliSpawnSpec({
        type: "start_run",
        payload: {
          engine: cmd.payload.engine || saved?.engine || "antigravity",
          model: cmd.payload.model || saved?.model || "",
          autonomy: cmd.payload.autonomy || saved?.autonomy || "high",
          mode: cmd.payload.mode || saved?.mode || "normal",
          prompt: steerPrompt,
        },
        resumeSessionId: saved?.sessionId,
        overridePrompt: steerPrompt,
      });
      await runStreamedCli({
        cmdId: cmd.id,
        runKey,
        cwd,
        repoRoot: cwd,
        projectId: resolvedProjectId,
        missionId: typeof cmd.payload.missionId === "string" ? cmd.payload.missionId : undefined,
        issueKey:
          (typeof cmd.payload.issueKey === "string" && cmd.payload.issueKey.trim()) ||
          saved?.issueKey ||
          undefined,
        spec,
        isResume: true,
      });
      return;
    }

    // 3. Start or retry a streamed session (`start_run`, `retry_phase`, `run_ba`, `run_clarify`, `run_ui_refine`, `run_pr_judge`)
    if (
      cmd.type === "start_run" ||
      cmd.type === "retry_phase" ||
      cmd.type === "run_ba" ||
      cmd.type === "run_clarify" ||
      cmd.type === "run_ui_refine" ||
      cmd.type === "run_pr_judge"
    ) {
      if (cmd.type === "retry_phase" && runKey) {
        const existingChild = activeChildren.get(runKey);
        if (existingChild) {
          existingChild.kill("SIGTERM");
          activeChildren.delete(runKey);
        }
      }
      const savedForRetry = cmd.type === "retry_phase" && runKey ? sessionMap[runKey] : undefined;
      const baseCwd =
        (typeof cmd.payload.localPath === "string" && existsSync(cmd.payload.localPath)
          ? cmd.payload.localPath
          : savedForRetry?.cwd && existsSync(savedForRetry.cwd)
            ? savedForRetry.cwd
            : process.cwd());
      if (!isPathAllowed(baseCwd)) {
        const msg = `Blocked by --allow-root guardrail: ${baseCwd}`;
        console.error(`sf daemon: ${msg}`);
        if (runKey) {
          await sendJson(cfg!, "/api/v1/runs/finish", {
            run: runKey,
            outcome: "blocked",
            summary: msg,
          }).catch(() => {});
        }
        await sendJson(cfg!, `/api/v1/runners/commands/${cmd.id}`, { status: "failed", error: msg }, "PATCH");
        return;
      }

      const effectiveMode = String(cmd.payload.mode || savedForRetry?.mode || "factory");
      let execCwd = baseCwd;
      if (cmd.payload.useWorktree === true && effectiveMode !== "ba" && runKey) {
        const branchArg = typeof cmd.payload.branch === "string" ? cmd.payload.branch : undefined;
        const wt = prepareWorktree(baseCwd, runKey, effectiveMode, branchArg);
        execCwd = wt.workCwd;
        if (wt.worktreeBranch && wt.workCwd !== baseCwd) {
          const syncedNote =
            wt.copiedFactoryFiles.length > 0
              ? ` (copied ${wt.copiedFactoryFiles.length} uncommitted .factory/ plan/prototype file(s))`
              : "";
          console.log(
            `sf daemon: isolated git worktree ${wt.worktreeBranch} -> ${wt.workCwd}${syncedNote}`,
          );
          await sendJsonWithRetry(
            cfg!,
            "/api/v1/runs/step",
            {
              run: runKey,
              repo: baseCwd,
              step: "git-worktree",
              phase: "Setup",
              status: "passed",
              role: "orchestrator",
              agent: "orchestrator",
              label: `Worktree ${wt.worktreeBranch}`,
              summary: `${wt.created ? "Created" : "Reused"} isolated git worktree at ${wt.workCwd}${syncedNote}`,
            },
            "POST",
            { retries: 2, spoolOnFail: true },
          ).catch(() => {});
        }
      }
      const startAttachmentBlock = await materializeCommandAttachments(
        execCwd,
        runKey || cmd.id,
        cmd.payload.attachments,
      );
      const rawPromptStr = typeof cmd.payload.prompt === "string" ? cmd.payload.prompt : "";
      const promptWithAttachments = startAttachmentBlock
        ? `${rawPromptStr}\n\n${startAttachmentBlock}`.trim()
        : rawPromptStr;
      const spec = buildCliSpawnSpec({
        ...cmd,
        type:
          cmd.type === "retry_phase"
            ? effectiveMode === "ba"
              ? "run_ba"
              : effectiveMode === "clarify"
                ? "run_clarify"
                : effectiveMode === "ui-refine"
                  ? "run_ui_refine"
                  : effectiveMode === "pr-judge"
                    ? "run_pr_judge"
                    : "start_run"
            : cmd.type,
        payload: {
          ...cmd.payload,
          prompt: promptWithAttachments,
          engine: cmd.payload.engine || savedForRetry?.engine || "antigravity",
          model: cmd.payload.model || savedForRetry?.model || "",
          autonomy: cmd.payload.autonomy || savedForRetry?.autonomy || "high",
          mode: effectiveMode,
        },
      });
      await runStreamedCli({
        cmdId: cmd.id,
        runKey,
        cwd: execCwd,
        repoRoot: baseCwd,
        projectId: resolvedProjectId,
        missionId: typeof cmd.payload.missionId === "string" ? cmd.payload.missionId : undefined,
        issueKey:
          typeof cmd.payload.issueKey === "string" && cmd.payload.issueKey.trim()
            ? cmd.payload.issueKey.trim()
            : undefined,
        spec,
      });
      return;
    }

    await sendJson(cfg!, `/api/v1/runners/commands/${cmd.id}`, { status: "done" }, "PATCH");
  }

  let lastScanAt = 0;
  let lastContextSweepAt = 0;
  let cachedDiscovered: DiscoveredWorkspaceProject[] = [];
  let lastHeartbeatErr = "";

  async function tick() {
    await flushSpool(cfg!).catch(() => {});
    if (Date.now() - lastScanAt > 10_000) {
      cachedDiscovered = scanWorkspaceProjects(workspaceDir);
      lastScanAt = Date.now();
    }
    // Periodically push changed Context Lake files (`.factory/**`, docs) for discovered workspace repos
    // so remote servers like Vercel always display fresh Context Lake & Init status!
    if (Date.now() - lastContextSweepAt > 30_000 && cachedDiscovered.length > 0) {
      lastContextSweepAt = Date.now();
      for (const proj of cachedDiscovered.slice(0, 20)) {
        if (proj.path && isPathAllowed(proj.path)) {
          await syncProjectContextToServer(proj.path, { projectSlug: proj.name }).catch(() => {});
        }
      }
    }
    const hb = await sendJson(cfg!, "/api/v1/runners/heartbeat", {
      name: runnerName,
      hostname: hostname(),
      os: platform(),
      engines: discoveredEngines,
      models: caps.models,
      allowedRoots,
      workspaceDir,
      discoveredProjects: cachedDiscovered,
      cliVersion: CLI_VERSION,
      ...(sharedWithTeam ? { visibility: "team" } : {}),
      maxConcurrency,
      activeRuns,
    });
    if (hb.ok) {
      if (lastHeartbeatErr) {
        console.log(`sf daemon: heartbeat reconnected -> ${cfg!.url}`);
        lastHeartbeatErr = "";
      }
      const commands = (hb.data as {
        commands?: Array<{ id: string; type: string; runId?: string | null; payload: Record<string, unknown> }>;
      })?.commands;
      if (Array.isArray(commands)) {
        for (const cmd of commands) {
          void executeCommand(cmd);
        }
      }
    } else {
      const errKey = `HTTP ${hb.status}: ${hb.error}`;
      if (errKey !== lastHeartbeatErr) {
        console.error(`sf daemon: heartbeat failed (${errKey})`);
        lastHeartbeatErr = errKey;
      }
    }
  }

  await tick();
  setInterval(() => {
    void tick();
  }, intervalMs);

  // Keep alive until SIGINT/SIGTERM
  await new Promise<void>((resolveStop) => {
    process.on("SIGINT", () => resolveStop());
    process.on("SIGTERM", () => resolveStop());
  });
  return 0;
}

async function cmdMcp(): Promise<number> {
  const cfg = loadConfig();
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

  const tools = [
    {
      name: "sf_workspace_summary",
      description: "List Factory projects, missions, recent runs, online runners, and inbox attention counts.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "sf_list_issues",
      description:
        "List BA/PM issues for a Factory project with issueKey, title, goal, body, criteria, priority, tier, autonomy, status, and runKey. Omit project to infer from current repository.",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string", description: "Optional project slug, name, or id" },
          repo: { type: "string", description: "Optional absolute repository path" },
        },
      },
    },
    {
      name: "sf_list_runs",
      description: "List recent Factory runs/sessions with status, phase, engine, model, cost, and project.",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string", description: "Optional project slug, name, or id filter" },
          status: { type: "string", description: "Optional run status filter (running, passed, failed, blocked, queued)" },
        },
      },
    },
    {
      name: "sf_get_inbox",
      description: "Get pending human interactions, blocked runs, needs_human issues, and proposed lessons.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "sf_get_lessons",
      description: "List recurring failure lessons proposed or accepted across Factory runs.",
      inputSchema: { type: "object", properties: {} },
    },
  ];

  function reply(id: unknown, result: unknown) {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
  }
  function replyError(id: unknown, code: number, message: string) {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
  }

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let msg: { id?: unknown; method?: string; params?: Record<string, unknown> };
    try {
      msg = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (msg.method === "notifications/initialized" || msg.id === undefined) {
      continue;
    }
    if (msg.method === "initialize") {
      reply(msg.id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "software-factory-context-lake", version: CLI_VERSION },
      });
    } else if (msg.method === "tools/list") {
      reply(msg.id, { tools });
    } else if (msg.method === "tools/call") {
      if (!cfg) {
        replyError(msg.id, -32000, "sf not logged in. Run `sf setup` or `sf login` first.");
        continue;
      }
      const name = String(msg.params?.name || "");
      const argsObj = (msg.params?.arguments as Record<string, unknown>) || {};
      try {
        let endpoint = "/api/inbox";
        if (name === "sf_workspace_summary" || name === "sf_list_runs") {
          const qs = new URLSearchParams();
          if (typeof argsObj.status === "string" && argsObj.status.trim()) {
            qs.set("status", argsObj.status.trim());
          }
          endpoint = qs.toString() ? `/api/sessions?${qs.toString()}` : "/api/sessions";
        } else if (name === "sf_list_issues") {
          const proj = typeof argsObj.project === "string" ? argsObj.project.trim() : "";
          const repoArg = typeof argsObj.repo === "string" ? argsObj.repo.trim() : "";
          const qs = new URLSearchParams();
          if (proj) qs.set("project", proj);
          if (repoArg) qs.set("repo", repoArg);
          if (!proj && !repoArg) {
            const inferred = inferProjectContext(process.cwd());
            if (inferred.localPath) qs.set("repo", inferred.localPath);
            if (inferred.project) qs.set("project", inferred.project);
          }
          endpoint = `/api/v1/issues?${qs.toString()}`;
        } else if (name === "sf_get_lessons") {
          endpoint = "/api/lessons";
        }
        const res = await getJson(cfg, endpoint);
        let payload: unknown = res.data;
        if (
          name === "sf_list_runs" &&
          res.ok &&
          typeof argsObj.project === "string" &&
          argsObj.project.trim() &&
          payload &&
          typeof payload === "object" &&
          Array.isArray((payload as { runs?: unknown[] }).runs)
        ) {
          const filter = argsObj.project.trim().toLowerCase();
          const runs = (payload as { runs: Array<{ project?: { id?: string; slug?: string; name?: string } }> }).runs;
          payload = {
            ...(payload as Record<string, unknown>),
            runs: runs.filter((r) => {
              const p = r.project;
              return (
                p?.id?.toLowerCase() === filter ||
                p?.slug?.toLowerCase() === filter ||
                p?.name?.toLowerCase() === filter
              );
            }),
          };
        }
        if (!res.ok) {
          reply(msg.id, {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify(payload ?? { error: `HTTP ${res.status}` }, null, 2),
              },
            ],
          });
          continue;
        }
        reply(msg.id, {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        });
      } catch (err) {
        replyError(msg.id, -32001, err instanceof Error ? err.message : String(err));
      }
    } else {
      reply(msg.id, {});
    }
  }
  return 0;
}

async function cmdIssues(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  if (!sub || sub === "-h" || sub === "--help") {
    console.log(USAGE);
    return 0;
  }
  if (sub === "sync") {
    const { values } = parseArgs({
      args: rest,
      options: { file: { type: "string" }, project: { type: "string" }, repo: { type: "string" } },
      strict: true,
    });
    if (!values.file?.trim()) {
      console.error("sf issues sync: --file <issues.json|-> is required");
      return 2;
    }
    const rawText =
      values.file.trim() === "-"
        ? await readStdinText()
        : readFileSync(resolve(values.file.trim()), "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      console.error("sf issues sync: invalid JSON");
      return 2;
    }
    const issues = Array.isArray(parsed)
      ? parsed
      : typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { issues?: unknown }).issues)
        ? (parsed as { issues: unknown[] }).issues
        : null;
    if (!issues || issues.length === 0) {
      console.error("sf issues sync: expected non-empty JSON array");
      return 2;
    }
    const ctx = inferProjectContext(values.repo, values.project);
    return deliverOrSpool(`issues sync (${issues.length})`, "/api/v1/issues/sync", {
      project: ctx.project,
      repo: ctx.localPath,
      issues,
    });
  }
  if (sub === "list") {
    const { values } = parseArgs({
      args: rest,
      options: { project: { type: "string" }, repo: { type: "string" }, json: { type: "boolean" } },
      strict: true,
    });
    const cfg = loadConfig();
    if (!cfg) {
      console.error("sf issues list: not logged in");
      return 1;
    }
    const ctx = inferProjectContext(values.repo, values.project);
    const qs = new URLSearchParams();
    if (ctx.project) qs.set("project", ctx.project);
    if (ctx.localPath) qs.set("repo", ctx.localPath);
    const { ok, status, data } = await getJson(cfg, `/api/v1/issues?${qs.toString()}`);
    const rec = data as {
      error?: string;
      issues?: Array<{
        issueKey: string;
        priority: string;
        complexity: string;
        tier: string;
        autonomy: string;
        status: string;
        title: string;
      }>;
    } | null;
    if (!ok || !rec?.issues) {
      console.error(`sf issues list: ${rec?.error || `HTTP ${status}`}`);
      return 1;
    }
    if (values.json) {
      console.log(JSON.stringify(rec.issues, null, 2));
      return 0;
    }
    for (const issue of rec.issues) {
      console.log(
        `${issue.issueKey.padEnd(6)} ${issue.priority.padEnd(4)} ${issue.tier.padEnd(7)} ${issue.status.padEnd(13)} ${issue.title}`,
      );
    }
    return 0;
  }
  if (sub === "update") {
    const { values } = parseArgs({
      args: rest,
      options: {
        key: { type: "string" },
        status: { type: "string" },
        phase: { type: "string" },
        run: { type: "string" },
        summary: { type: "string" },
        priority: { type: "string" },
        tier: { type: "string" },
        autonomy: { type: "string" },
        project: { type: "string" },
        repo: { type: "string" },
      },
      strict: true,
    });
    if (!values.key?.trim()) {
      console.error("sf issues update: --key <I1> is required");
      return 2;
    }
    const ctx = inferProjectContext(values.repo, values.project);
    const key = values.key.trim();
    return deliverOrSpool(
      `issues update ${key}`,
      `/api/v1/issues/${encodeURIComponent(key)}`,
      {
        project: ctx.project,
        repo: ctx.localPath,
        status: values.status?.trim() || undefined,
        phase: values.phase?.trim() || undefined,
        run: values.run?.trim() || undefined,
        summary: values.summary?.trim() || undefined,
        priority: values.priority?.trim() || undefined,
        tier: values.tier?.trim() || undefined,
        autonomy: values.autonomy?.trim() || undefined,
      },
      "PATCH",
    );
  }
  console.error(`sf issues: unknown subcommand "${sub}"`);
  return 2;
}

type LocalAgentInspectEntry = {
  convId: string;
  runKey?: string;
  mode?: string;
  issueKey?: string;
  cwd?: string;
  source: "antigravity-cli" | "antigravity";
  active: boolean;
  updatedAt: string;
  model: string;
  lastActivity: string;
  rootUsage: AgyTokenTotals;
  subagents: Array<{
    convId: string;
    name: string;
    role: string;
    status: string;
    model: string;
    lastActivity: string;
    usage: AgyTokenTotals;
  }>;
  totalUsage: AgyTokenTotals;
  estimatedCostUsd: number;
};

function inspectBrainTranscript(brainDir: string): {
  model: string;
  lastActivity: string;
  usage: AgyTokenTotals;
  updatedMs: number;
  childIds: Map<string, { name: string; role: string; status: string }>;
} {
  const usage: AgyTokenTotals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  let model = "";
  let lastActivity = "";
  let updatedMs = 0;
  const childIds = new Map<string, { name: string; role: string; status: string }>();

  const transcriptPath = join(brainDir, ".system_generated", "logs", "transcript.jsonl");
  if (existsSync(transcriptPath)) {
    try {
      updatedMs = Math.max(updatedMs, statSync(transcriptPath).mtimeMs);
      const raw = readFileSync(transcriptPath, "utf8");
      const pendingSpawns: Array<{ role: string; typeName: string }> = [];
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("{")) continue;
        let entry: Record<string, unknown>;
        try {
          entry = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
          continue;
        }
        const entryType = String(entry.type || "");
        const content = typeof entry.content === "string" ? entry.content : "";
        if (entryType === "PLANNER_RESPONSE") {
          if (typeof entry.model === "string" && entry.model) model = entry.model;
          usage.inputTokens += Number(entry.input_tokens || 0);
          usage.outputTokens += Number(entry.output_tokens || 0);
          usage.cacheReadTokens += Number(entry.cache_read_tokens || 0);
          if (Array.isArray(entry.tool_calls) && entry.tool_calls.length > 0) {
            for (const rawTc of entry.tool_calls) {
              const tc = (rawTc || {}) as Record<string, unknown>;
              const name = String(tc.name || "tool");
              const parsedArgs = parseAgyToolArgs(tc.args);
              lastActivity = summarizeToolParams(name, parsedArgs).slice(0, 100);
              if (name === "invoke_subagent") {
                pendingSpawns.push({
                  role: String(parsedArgs.Role || parsedArgs.role || ""),
                  typeName: String(parsedArgs.TypeName || parsedArgs.typeName || "subagent"),
                });
              }
            }
          } else if (content.trim()) {
            lastActivity = content.trim().replace(/\s+/g, " ").slice(0, 100);
          }
        } else if (entryType === "GENERIC" && content.includes("Created the following subagent")) {
          const m = SUBAGENT_CREATED_CONV_RE.exec(content);
          if (m?.[1]) {
            const cid = m[1].toLowerCase();
            const hint = pendingSpawns.shift();
            if (!childIds.has(cid)) {
              childIds.set(cid, {
                name: hint?.role || hint?.typeName || `subagent-${cid.slice(0, 6)}`,
                role: hint?.typeName || "subagent",
                status: "working",
              });
            }
          }
        } else if (entryType === "GENERIC" && content.includes("Task is complete.")) {
          lastActivity = "Completed";
        } else if (entryType === "SYSTEM_MESSAGE") {
          const sm =
            /\bsender=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?!\/task-)/i.exec(
              content,
            );
          if (sm?.[1]) {
            const prev = childIds.get(sm[1].toLowerCase());
            if (prev) prev.status = "passed";
          }
        }
      }
    } catch {
      // Ignore unreadable transcript.
    }
  }

  const tasksDir = join(brainDir, ".system_generated", "tasks");
  if (existsSync(tasksDir)) {
    try {
      for (const f of readdirSync(tasksDir).filter((x) => x.endsWith(".log")).sort()) {
        const full = join(tasksDir, f);
        try {
          updatedMs = Math.max(updatedMs, statSync(full).mtimeMs);
          const text = readFileSync(full, "utf8");
          for (const rawLine of text.split(/\r?\n/)) {
            const m = WORKFLOW_AGENT_RE.exec(rawLine);
            if (!m) continue;
            const label = m[2].trim();
            const st = m[3].toLowerCase();
            const cid = m[4].toLowerCase();
            const mapped =
              st === "done"
                ? "passed"
                : st === "failed" || st === "error" || st === "blocked"
                  ? "failed"
                  : "working";
            const meta = parseAgyWorkflowAgentMeta(label, "Build", cid);
            childIds.set(cid, { name: meta.name, role: meta.role, status: mapped });
          }
        } catch {
          // Ignore unreadable task log.
        }
      }
    } catch {
      // Ignore unreadable tasks dir.
    }
  }

  return { model, lastActivity, usage, updatedMs, childIds };
}

function listActiveLocalAiProcesses(): Array<{ pid: number; etime: string; engine: string; cmd: string }> {
  try {
    const out = execFileSync("ps", ["-eo", "pid=,etime=,command="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
    });
    const rows: Array<{ pid: number; etime: string; engine: string; cmd: string }> = [];
    for (const rawLine of out.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      const m = /^(\d+)\s+(\S+)\s+(.+)$/.exec(line);
      if (!m) continue;
      const pid = Number(m[1]);
      if (pid === process.pid) continue;
      const etime = m[2];
      const cmd = m[3];
      if (/\bagy\b/.test(cmd) && !/\bps\b/.test(cmd)) {
        rows.push({ pid, etime, engine: "antigravity", cmd: cmd.slice(0, 120) });
      } else if (/\bclaude\b/.test(cmd) && cmd.includes("stream-json")) {
        rows.push({ pid, etime, engine: "claude", cmd: cmd.slice(0, 120) });
      } else if (cmd.includes("sf.ts") && /\bdaemon\b/.test(cmd)) {
        rows.push({ pid, etime, engine: "sf-daemon", cmd: cmd.slice(0, 120) });
      }
    }
    return rows;
  } catch {
    return [];
  }
}

function collectLocalAgents(showAll: boolean): {
  processes: Array<{ pid: number; etime: string; engine: string; cmd: string }>;
  sessions: LocalAgentInspectEntry[];
} {
  const processes = listActiveLocalAiProcesses();
  const sessionsFile = join(sfDir(), "sessions.json");
  let sessionMap: Record<
    string,
    { engine?: string; sessionId?: string; mode?: string; issueKey?: string; cwd?: string }
  > = {};
  if (existsSync(sessionsFile)) {
    try {
      sessionMap = JSON.parse(readFileSync(sessionsFile, "utf8")) as typeof sessionMap;
    } catch {
      sessionMap = {};
    }
  }
  const byConvId = new Map<
    string,
    { runKey: string; mode?: string; issueKey?: string; cwd?: string }
  >();
  for (const [rk, entry] of Object.entries(sessionMap)) {
    if (entry?.sessionId) {
      byConvId.set(entry.sessionId.toLowerCase(), {
        runKey: rk,
        mode: entry.mode,
        issueKey: entry.issueKey,
        cwd: entry.cwd,
      });
    }
  }

  const brainRoots: Array<{ dir: string; source: "antigravity-cli" | "antigravity" }> = [
    { dir: join(homedir(), ".gemini", "antigravity-cli", "brain"), source: "antigravity-cli" },
    { dir: join(homedir(), ".gemini", "antigravity", "brain"), source: "antigravity" },
  ];

  const allBrainDirs = new Map<string, { dir: string; source: "antigravity-cli" | "antigravity"; mtimeMs: number }>();
  const cutoffMs = showAll ? 0 : Date.now() - 24 * 60 * 60_000;

  for (const root of brainRoots) {
    if (!existsSync(root.dir)) continue;
    let names: string[];
    try {
      names = readdirSync(root.dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name)) continue;
      const full = join(root.dir, name);
      const tPath = join(full, ".system_generated", "logs", "transcript.jsonl");
      if (!existsSync(tPath)) continue;
      try {
        const mtimeMs = statSync(tPath).mtimeMs;
        if (mtimeMs < cutoffMs) continue;
        const cid = name.toLowerCase();
        if (!allBrainDirs.has(cid)) {
          allBrainDirs.set(cid, { dir: full, source: root.source, mtimeMs });
        }
      } catch {
        continue;
      }
    }
  }

  // First pass: inspect all brains to identify which UUIDs are children of another brain.
  const inspected = new Map<
    string,
    ReturnType<typeof inspectBrainTranscript> & { dir: string; source: "antigravity-cli" | "antigravity" }
  >();
  const childConvSet = new Set<string>();
  for (const [cid, info] of allBrainDirs) {
    const data = inspectBrainTranscript(info.dir);
    inspected.set(cid, { ...data, dir: info.dir, source: info.source });
    for (const childId of data.childIds.keys()) {
      childConvSet.add(childId);
    }
  }

  const nowMs = Date.now();
  const entries: LocalAgentInspectEntry[] = [];
  for (const [cid, root] of inspected) {
    if (childConvSet.has(cid) && !byConvId.has(cid)) continue;
    const linked = byConvId.get(cid);
    const subagents: LocalAgentInspectEntry["subagents"] = [];
    let latestMs = root.updatedMs;
    let totalIn = root.usage.inputTokens;
    let totalOut = root.usage.outputTokens;
    let totalCache = root.usage.cacheReadTokens;
    let totalCost = estimateCostUsd(
      "antigravity",
      root.model || "neon",
      root.usage.inputTokens,
      root.usage.outputTokens,
      root.usage.cacheReadTokens,
    );

    // Collect recursive children (BFS)
    const queue = Array.from(root.childIds.entries());
    const visited = new Set<string>([cid]);
    while (queue.length > 0) {
      const [childId, childMeta] = queue.shift()!;
      if (visited.has(childId)) continue;
      visited.add(childId);
      const childDir = resolveAgyBrainDir(childId);
      const childData =
        inspected.get(childId) || (childDir ? inspectBrainTranscript(childDir) : null);
      const cUsage: AgyTokenTotals = childData?.usage ?? {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
      };
      const cModel = childData?.model || "";
      if (childData && childData.updatedMs > latestMs) latestMs = childData.updatedMs;
      totalIn += cUsage.inputTokens;
      totalOut += cUsage.outputTokens;
      totalCache += cUsage.cacheReadTokens;
      totalCost += estimateCostUsd(
        "antigravity",
        cModel || "carbon",
        cUsage.inputTokens,
        cUsage.outputTokens,
        cUsage.cacheReadTokens,
      );
      const childActive = Boolean(childData && nowMs - childData.updatedMs < 30_000);
      subagents.push({
        convId: childId,
        name: childMeta.name,
        role: childMeta.role,
        status: childActive ? "working" : childMeta.status,
        model: cModel,
        lastActivity: childData?.lastActivity || "",
        usage: cUsage,
      });
      if (childData) {
        for (const nested of childData.childIds.entries()) {
          if (!visited.has(nested[0])) queue.push(nested);
        }
      }
    }

    const active =
      nowMs - latestMs < 30_000 ||
      subagents.some((s) => s.status === "working") ||
      processes.some((p) => p.engine === "antigravity" && p.cmd.includes(cid));

    entries.push({
      convId: cid,
      runKey: linked?.runKey,
      mode: linked?.mode,
      issueKey: linked?.issueKey,
      cwd: linked?.cwd,
      source: root.source,
      active,
      updatedAt: latestMs > 0 ? new Date(latestMs).toISOString() : "",
      model: root.model || "antigravity",
      lastActivity: root.lastActivity,
      rootUsage: root.usage,
      subagents,
      totalUsage: {
        inputTokens: totalIn,
        outputTokens: totalOut,
        cacheReadTokens: totalCache,
      },
      estimatedCostUsd: totalCost,
    });
  }

  entries.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return b.updatedAt.localeCompare(a.updatedAt);
  });

  return { processes, sessions: entries.slice(0, showAll ? 50 : 12) };
}

async function cmdAgents(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      watch: { type: "boolean", default: false },
      all: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
    strict: true,
  });

  const renderOnce = () => {
    const data = collectLocalAgents(Boolean(values.all));
    if (values.json) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    if (values.watch) {
      process.stdout.write("\x1bc");
    }
    console.log(
      `Software Factory Local Agent Tracker (v${CLI_VERSION}) · ${new Date().toLocaleTimeString()}`,
    );
    console.log("");
    if (data.processes.length > 0) {
      console.log(`Active OS Processes (${data.processes.length}):`);
      for (const p of data.processes) {
        console.log(`  [PID ${p.pid}] ${p.engine.padEnd(11)} ${p.etime.padStart(8)}  ${p.cmd}`);
      }
    } else {
      console.log("Active OS Processes: none");
    }
    console.log("");
    if (data.sessions.length === 0) {
      console.log("No recent Antigravity sessions found (pass --all to include older than 24h).");
      return;
    }
    console.log(`Antigravity Sessions & Subagent Trees (${data.sessions.length}):`);
    for (const s of data.sessions) {
      const badge = s.active ? "● ACTIVE" : "○ idle  ";
      const header = s.runKey
        ? `${s.runKey}${s.mode ? ` [${s.mode}]` : ""}`
        : `${s.source}:${s.convId.slice(0, 8)}`;
      const tokStr = `in=${s.totalUsage.inputTokens.toLocaleString()} out=${s.totalUsage.outputTokens.toLocaleString()} cache=${s.totalUsage.cacheReadTokens.toLocaleString()} (~$${s.estimatedCostUsd.toFixed(4)})`;
      console.log(`  ${badge}  ${header}  (${s.model})  ${tokStr}`);
      if (s.lastActivity) {
        console.log(`            conv=${s.convId.slice(0, 8)}  last: ${s.lastActivity}`);
      }
      for (const sub of s.subagents) {
        const subIcon = sub.status === "working" ? "▶" : sub.status === "failed" ? "✗" : "✓";
        const subTok = `in=${sub.usage.inputTokens.toLocaleString()} out=${sub.usage.outputTokens.toLocaleString()}`;
        console.log(
          `            └─ ${subIcon} ${sub.name} (${sub.role}${sub.model ? ` · ${sub.model}` : ""})  ${subTok}${sub.lastActivity ? `  · ${sub.lastActivity.slice(0, 60)}` : ""}`,
        );
      }
    }
  };

  renderOnce();
  if (!values.watch) return 0;

  await new Promise<void>((resolveStop) => {
    const timer = setInterval(renderOnce, 2000);
    const stop = () => {
      clearInterval(timer);
      resolveStop();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
  return 0;
}

async function cmdFlush(): Promise<number> {
  const cfg = loadConfig();
  if (!cfg) {
    console.error("sf flush: not logged in");
    return 1;
  }
  const { sent, remaining } = await flushSpool(cfg);
  console.log(`sf flush: sent ${sent}, remaining ${remaining}`);
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
    console.log(USAGE);
    return 0;
  }
  try {
    if (cmd === "setup") return await cmdSetup(rest);
    if (cmd === "doctor") return await cmdDoctor();
    if (cmd === "login") return await cmdLogin(rest);
    if (cmd === "whoami") return await cmdWhoami();
    if (cmd === "start") return await cmdStart(rest);
    if (cmd === "agent") return await cmdAgent(rest);
    if (cmd === "step") return await cmdStep(rest);
    if (cmd === "artifact") return await cmdArtifact(rest);
    if (cmd === "prototype") return await cmdPrototype(rest);
    if (cmd === "sync-context") return await cmdSyncContext(rest);
    if (cmd === "ask") return await cmdAsk(rest);
    if (cmd === "finish") return await cmdFinish(rest);
    if (cmd === "issues") return await cmdIssues(rest);
    if (cmd === "sync-live") return await cmdSyncLive(rest);
    if (cmd === "sync-subagents") return await cmdSyncSubagents(rest);
    if (cmd === "agents" || cmd === "ps") return await cmdAgents(rest);
    if (cmd === "daemon") return await cmdDaemon(rest);
    if (cmd === "mcp") return await cmdMcp();
    if (cmd === "flush") return await cmdFlush();
    console.error(`sf: unknown command "${cmd}"\n\n${USAGE}`);
    return 2;
  } catch (error) {
    console.error(`sf ${cmd}: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

const isDirectCliInvocation = (() => {
  try {
    const entry = process.argv[1];
    if (!entry) return false;
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isDirectCliInvocation) {
  process.exit(await main(process.argv.slice(2)));
}
