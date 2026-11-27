#!/usr/bin/env node
// Software Factory CLI, Daemon & MCP Server (`sf`)
// Runs factory v2 on Claude Code for the Software Factory web app: BA sessions (`/new-ba` via
// `claude -p`) and epic runs (new-factory's orchestrator), reporting every agent, step, token and
// cost; heartbeats so the web app can watch runners on any machine; and a stdio MCP Context Lake.
// Runs directly on Node 22+ via native TypeScript type stripping.

import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
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
  writeFileSync,
} from "node:fs";
import { homedir, hostname, platform } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const CLI_VERSION = "2026.11.27-v2";
/** The factory v2 skills a runner needs, linked into ~/.claude/skills by `sf setup`. */
const FACTORY_SKILLS = ["new-ba", "new-factory"] as const;

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
              [--mode <ba|epic>]
              [--base <commit>] [--target <branch>] [--model <model>]
  sf agent    --run <run-id> --agent <key> --status <waiting_on_you|working|idle|passed|failed>
              [--name <text>] [--role <role>] [--spec <S1>] [--model <model>] [--activity <text>]
              [--input-tokens <n>] [--output-tokens <n>] [--cache-read-tokens <n>] [--cost-usd <n>]
  sf step     --run <run-id> --step <name> --phase <phase> --status <started|passed|failed|blocked|skipped|info>
              [--project <slug|owner/repo>] [--repo <dir>] [--round <n>] [--spec <id>] [--role <role>]
              [--agent <id>] [--label <text>] [--model <model>] [--duration-ms <n>]
              [--input-tokens <n>] [--output-tokens <n>] [--cache-read-tokens <n>] [--cost-usd <n>]
              [--summary <text>] [--data <json>]
  sf artifact --run <run-id> --kind <plan|mockup|prototype|qc_shot|baseline_diff|axe|walkthrough|diff|log>
              --path <file-or-url> [--title <text>] [--project <slug>] [--repo <dir>]
  sf prototype --path <index.html|dir> [--title <text>] [--slug <slug>] [--issue <I1,I2>]
               [--kind <first_screen|ticket|whole_flow|existing>] [--binding <flow|look>]
               [--run <run-id>] [--project <slug>] [--repo <dir>]
  sf sync-context [--project <slug>] [--repo <dir>]
  sf ask      --run <run-id> --title <text> [--type <question|decision>]
              [--prompt <text>] [--options <json-or-csv>] [--agent <key>] [--wait] [--timeout-sec <n>]
  sf finish   --run <run-id> --outcome <passed|failed|blocked> [--project <slug|owner/repo>] [--repo <dir>]
              [--summary <text>] [--risk <low|medium|high>] [--merge <auto|person>]
              [--merged <commit>] [--pr-number <n>] [--pr-url <url>] [--duration-ms <n>]

  # Sync & Manage Issues
  sf issues list   [--project <slug|owner/repo>] [--repo <dir>] [--json]
  sf issues update --key <I1> [--status <...>] [--phase <phase>] [--run <run-id>] [--summary <text>]

  # Local Daemon (heartbeat + runs BA sessions and epics sent from the web app)
  sf daemon [--name <runner-name>] [--max-concurrency <n>] [--interval-ms <n>]
            [--projects-dir <workspace-dir>] [--root <monorepo-dir>] [--allow-root <dir>] [--shared]

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

export type ClaudeUsageSeen = Map<string, { inTok: number; outTok: number; cacheTok: number }>;

/**
 * Token usage of one Claude Code stream-json `assistant` event that has not been counted yet.
 *
 * `claude -p --output-format stream-json` emits one `assistant` event per content block
 * (thinking, text, tool_use…) and each repeats the usage of the whole API message, so counting
 * every event multiplies the run's tokens. Usage is tracked per `message.id` and only its growth
 * is attributed.
 */
export function claudeUsageDelta(
  seen: ClaudeUsageSeen,
  ev: Record<string, unknown>,
): { inTok: number; outTok: number; cacheTok: number } {
  const msg = (ev.message || {}) as Record<string, unknown>;
  const usage = (msg.usage || {}) as Record<string, unknown>;
  const cur = {
    inTok: Number(usage.input_tokens || 0) + Number(usage.cache_creation_input_tokens || 0),
    outTok: Number(usage.output_tokens || 0),
    cacheTok: Number(usage.cache_read_input_tokens || 0),
  };
  const id = typeof msg.id === "string" ? msg.id : "";
  if (!id) return cur;
  const prev = seen.get(id) || { inTok: 0, outTok: 0, cacheTok: 0 };
  seen.set(id, {
    inTok: Math.max(prev.inTok, cur.inTok),
    outTok: Math.max(prev.outTok, cur.outTok),
    cacheTok: Math.max(prev.cacheTok, cur.cacheTok),
  });
  return {
    inTok: Math.max(0, cur.inTok - prev.inTok),
    outTok: Math.max(0, cur.outTok - prev.outTok),
    cacheTok: Math.max(0, cur.cacheTok - prev.cacheTok),
  };
}

/**
 * Directory to run a `--resume` turn in. Claude Code stores sessions per working directory
 * (`~/.claude/projects/<cwd>`), so a Claude session started in an isolated worktree can only be
 * resumed from that worktree; resuming from the project root fails with "No conversation found".
 */
export function resolveResumeCwd(params: { localPath?: unknown; savedCwd?: string }): string {
  const local =
    typeof params.localPath === "string" && params.localPath && existsSync(params.localPath)
      ? params.localPath
      : "";
  const saved = params.savedCwd && existsSync(params.savedCwd) ? params.savedCwd : "";
  return saved || local || process.cwd();
}

// ─── Claude Code stream-json → Software Factory agents & steps ───────────────────────────────
//
// One parser for every Claude process the daemon watches: a BA session turn (`claude -p` stdout)
// and each factory v2 agent (its `logs/agents/<id>.jsonl`). Every step it posts has a stable key
// and `idempotent: true`, so reading a log again after a daemon restart never duplicates a step,
// its tokens or its cost.

export type SfPost = (path: string, body: Record<string, unknown>) => void;

export type ClaudeStreamOptions = {
  post: SfPost;
  run: string;
  ctx: Record<string, unknown>;
  phase: string;
  agentKey: string;
  agentName: string;
  role: string;
  model: string;
  /** Unique per agent process or BA turn, at most ~40 chars: step keys are `<prefix>-…`. */
  stepPrefix: string;
  /** Track Agent/Task subagents of this process as their own agents (BA sessions). */
  trackSubagents?: boolean;
  onSession?: (sessionId: string) => void;
  onLive?: (chunk: Record<string, unknown>) => void;
  onToolResult?: (text: string) => void;
};

const shortId = (id: string, n = 12) => id.replace(/[^a-zA-Z0-9]+/g, "").slice(-n);

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) =>
        c && typeof c === "object" && typeof (c as { text?: unknown }).text === "string"
          ? (c as { text: string }).text
          : "",
      )
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

export class ClaudeStreamTracker {
  sessionId = "";
  model: string;
  finalText = "";
  isError = false;
  costUsd = 0;
  results = 0;
  readonly pendingTools = new Set<string>();
  private readonly o: ClaudeStreamOptions;
  private readonly usageSeen: ClaudeUsageSeen = new Map();
  /** Main-thread tokens already posted since the last `result` (subagents are counted apart). */
  private counted = { inTok: 0, outTok: 0, cacheTok: 0 };
  private readonly subagents = new Map<
    string,
    { agentKey: string; name: string; role: string; model: string }
  >();
  private textSeq = 0;

  constructor(o: ClaudeStreamOptions) {
    this.o = o;
    this.model = o.model;
  }

  /** A tool call or a subagent is still running: no output is expected until it returns. */
  get busy(): boolean {
    return this.pendingTools.size > 0 || this.subagents.size > 0;
  }

  private step(body: Record<string, unknown>) {
    this.o.post("/api/v1/runs/step", {
      run: this.o.run,
      ...this.o.ctx,
      idempotent: true,
      phase: this.o.phase,
      ...body,
    });
  }

  private agent(body: Record<string, unknown>) {
    this.o.post("/api/v1/runs/agent", { run: this.o.run, ...this.o.ctx, ...body });
  }

  handleLine(line: string) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) return;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return;
    }
    this.handle(ev);
  }

  handle(ev: Record<string, unknown>) {
    const evType = String(ev.type || "");
    const sid = typeof ev.session_id === "string" ? ev.session_id : "";
    if (sid && sid !== this.sessionId) {
      this.sessionId = sid;
      this.o.onSession?.(sid);
    }

    if (evType === "system" && ev.subtype === "init") {
      if (typeof ev.model === "string" && ev.model.trim()) this.model = ev.model.trim();
      this.agent({
        agentKey: this.o.agentKey,
        name: this.o.agentName,
        preserveExistingName: true,
        role: this.o.role,
        model: this.model,
        status: "working",
        activity: `Started (${this.model})`,
      });
      return;
    }

    if (evType === "assistant") this.onAssistant(ev);
    else if (evType === "user") this.onUser(ev);
    else if (evType === "result") this.onResult(ev);
  }

  private onAssistant(ev: Record<string, unknown>) {
    const msg = (ev.message || {}) as Record<string, unknown>;
    const content = Array.isArray(msg.content) ? msg.content : [];
    const model = typeof msg.model === "string" && msg.model ? msg.model : this.model;
    const parent = typeof ev.parent_tool_use_id === "string" ? ev.parent_tool_use_id : "";
    const sub = parent ? this.subagents.get(parent) : undefined;
    const agentKey = sub?.agentKey || this.o.agentKey;
    const role = sub?.role || this.o.role;
    const agentName = sub?.name || this.o.agentName;
    const postsStep = content.some((raw) => {
      const b = (raw || {}) as Record<string, unknown>;
      return b.type === "tool_use" || (b.type === "text" && typeof b.text === "string" && b.text.trim());
    });
    // A thinking-only event leaves the message's usage for its next block instead of dropping it.
    let usage = postsStep ? claudeUsageDelta(this.usageSeen, ev) : { inTok: 0, outTok: 0, cacheTok: 0 };
    if (!sub) {
      this.counted.inTok += usage.inTok;
      this.counted.outTok += usage.outTok;
      this.counted.cacheTok += usage.cacheTok;
    }
    const takeUsage = () => {
      const u = usage;
      usage = { inTok: 0, outTok: 0, cacheTok: 0 };
      return {
        inputTokens: u.inTok || undefined,
        outputTokens: u.outTok || undefined,
        cacheReadTokens: u.cacheTok || undefined,
      };
    };
    const msgId = typeof msg.id === "string" ? shortId(msg.id, 10) : "";

    content.forEach((raw, idx) => {
      const block = (raw || {}) as Record<string, unknown>;
      if (block.type === "tool_use") {
        const id = typeof block.id === "string" && block.id ? block.id : `${msgId}${idx}`;
        const toolName = String(block.name || "tool");
        const label = summarizeToolParams(toolName, block.input);
        this.pendingTools.add(id);
        if (this.o.trackSubagents && (toolName === "Agent" || toolName === "Task")) {
          const inp = (block.input && typeof block.input === "object" ? block.input : {}) as Record<
            string,
            unknown
          >;
          const subType = String(inp.subagent_type || "subagent").trim();
          const desc = String(inp.description || subType).trim();
          const slug = desc.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28);
          const entry = {
            agentKey: `${slug || "sub"}-${shortId(id, 6)}`,
            name: desc.slice(0, 120),
            role: "subagent",
            model: String(inp.model || model),
          };
          this.subagents.set(id, entry);
          this.agent({ ...entry, status: "working", activity: `Started (${subType})` });
        }
        this.agent({
          agentKey,
          name: agentName,
          preserveExistingName: true,
          role,
          model,
          status: "working",
          activity: label.slice(0, 150),
        });
        this.o.onLive?.({ kind: "tool_active", agentKey, agentName, tool: toolName, label: label.slice(0, 155), ts: Date.now() });
        this.step({
          step: `${this.o.stepPrefix}-t-${shortId(id)}`,
          status: "passed",
          role,
          agent: agentKey,
          agentName,
          model,
          ...takeUsage(),
          label: label.slice(0, 155),
          data: { kind: "tool_call", tool: toolName, input: block.input ?? undefined },
        });
      } else if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
        const text = block.text.trim();
        if (!sub) this.finalText = text;
        this.textSeq += 1;
        this.o.onLive?.({ kind: "text_delta", agentKey, agentName, delta: text, model, ts: Date.now() });
        this.step({
          step: `${this.o.stepPrefix}-m-${msgId || this.textSeq}-${idx}`,
          status: "info",
          role,
          agent: agentKey,
          agentName,
          model,
          ...takeUsage(),
          label: sub ? `${agentName}: response` : "Assistant",
          summary: text.slice(0, 200_000),
          data: sub
            ? { kind: "lifecycle", agentName }
            : { kind: "assistant_message", engine: "claude", model },
        });
      }
    });
  }

  private onUser(ev: Record<string, unknown>) {
    const msg = (ev.message || {}) as Record<string, unknown>;
    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const raw of content) {
      const block = (raw || {}) as Record<string, unknown>;
      if (block.type !== "tool_result" || typeof block.tool_use_id !== "string") continue;
      const id = block.tool_use_id;
      this.pendingTools.delete(id);
      const failed = block.is_error === true;
      if (this.o.onToolResult) this.o.onToolResult(toolResultText(block.content));
      const sub = this.subagents.get(id);
      if (sub) {
        this.subagents.delete(id);
        this.agent({ ...sub, status: failed ? "failed" : "passed", activity: failed ? "Failed" : "Completed" });
      }
      this.o.onLive?.({ kind: "tool_done", agentKey: this.o.agentKey, status: failed ? "failed" : "passed", ts: Date.now() });
      if (failed) {
        const parent = typeof ev.parent_tool_use_id === "string" ? ev.parent_tool_use_id : "";
        const owner = parent ? this.subagents.get(parent) : undefined;
        this.step({
          step: `${this.o.stepPrefix}-e-${shortId(id)}`,
          status: "info",
          role: owner?.role || this.o.role,
          agent: owner?.agentKey || this.o.agentKey,
          agentName: owner?.name || this.o.agentName,
          label: "Tool error",
          summary: toolResultText(block.content).slice(0, 4000),
          data: { kind: "tool_error" },
        });
      }
    }
  }

  private onResult(ev: Record<string, unknown>) {
    this.results += 1;
    const subtype = String(ev.subtype || "");
    const isError = ev.is_error === true || subtype.startsWith("error");
    this.isError = isError;
    if (typeof ev.result === "string" && ev.result.trim()) this.finalText = ev.result.trim();
    // `total_cost_usd` is the exact cost of this `claude -p` process (subagents included);
    // `usage` covers its main thread, so only the part not yet posted per message is added.
    const cost = typeof ev.total_cost_usd === "number" ? ev.total_cost_usd : 0;
    this.costUsd += cost;
    const u = (ev.usage || {}) as Record<string, unknown>;
    const totalIn = Number(u.input_tokens || 0) + Number(u.cache_creation_input_tokens || 0);
    const remIn = Math.max(0, totalIn - this.counted.inTok);
    const remOut = Math.max(0, Number(u.output_tokens || 0) - this.counted.outTok);
    const remCache = Math.max(0, Number(u.cache_read_input_tokens || 0) - this.counted.cacheTok);
    this.counted = { inTok: 0, outTok: 0, cacheTok: 0 };
    const durationMs = typeof ev.duration_ms === "number" ? Math.round(ev.duration_ms) : undefined;
    this.step({
      step: `${this.o.stepPrefix}-r${this.results}`,
      status: isError ? "failed" : "passed",
      role: this.o.role,
      agent: this.o.agentKey,
      agentName: this.o.agentName,
      model: this.model,
      durationMs,
      inputTokens: remIn || undefined,
      outputTokens: remOut || undefined,
      cacheReadTokens: remCache || undefined,
      costUsd: cost || undefined,
      label: `${isError ? `Ended with error (${subtype || "error"})` : "Turn completed"} · $${cost.toFixed(4)}`,
      data: { kind: "turn_metrics", costUsd: cost, durationMs, subtype },
      keepAgentStatus: true,
    });
  }
}

// ─── factory v2 epic run: `.factory/runs/epic-<n>/` → Software Factory ───────────────────────

/** Kanban status of a new-factory ticket status. */
export function mapV2TicketStatus(status: unknown): string {
  switch (String(status || "")) {
    case "running":
    case "reopened":
      return "in_progress";
    case "waiting":
    case "blocked":
      return "blocked";
    case "needs-decision":
      return "needs_human";
    case "merged":
      return "passed";
    default:
      return "ready";
  }
}

const V2_PHASES: Record<string, string> = {
  plan: "Plan",
  prepare: "Prepare",
  tickets: "Build",
  bisect: "Build",
  qc: "Final",
};

type V2Agent = {
  id: string;
  role: string;
  issue: number | null;
  step?: string;
  model?: string;
  start: string;
  end: string | null;
  cost?: number;
  ok: boolean | null;
  log: string;
};

type V2Ticket = {
  issue: number;
  title?: string;
  body?: string;
  size?: string;
  wave?: number;
  status?: string;
  rounds?: number;
  criteria?: Array<{ id: string; text?: string }> | string[];
  dependsOn?: Array<number | string>;
  decisions?: number;
  decision?: { question?: string; reason?: string };
};

export type EpicTrackerOptions = {
  runDir: string;
  /** Only agents started at or after this time belong to this run (a retry reuses state.json). */
  sinceMs: number;
  post: SfPost;
  run: string;
  ctx: Record<string, unknown>;
  repo: string;
  epic: number;
};

export class EpicTracker {
  private readonly o: EpicTrackerOptions;
  private readonly agents = new Map<
    string,
    { tracker: ClaudeStreamTracker; offset: number; rest: string; done: boolean }
  >();
  private readonly ticketSig = new Map<number, string>();
  private readonly decided = new Set<string>();
  private alarmsSeen = -1;
  private phase = "";
  private synced = false;
  state: Record<string, unknown> | null = null;

  constructor(o: EpicTrackerOptions) {
    this.o = o;
  }

  private step(body: Record<string, unknown>) {
    this.o.post("/api/v1/runs/step", {
      run: this.o.run,
      ...this.o.ctx,
      idempotent: true,
      role: "orchestrator",
      agent: "orchestrator",
      agentName: "new-factory orchestrator",
      ...body,
    });
  }

  /** Something is running that writes nothing for a while (an agent's tool call, a check). */
  get busy(): boolean {
    const st = this.state as { status?: string } | null;
    return st?.status === "running" || st?.status === "queued";
  }

  private readState(): Record<string, unknown> | null {
    try {
      return JSON.parse(readFileSync(join(this.o.runDir, "state.json"), "utf8")) as Record<string, unknown>;
    } catch {
      return null; // not written yet
    }
  }

  poll() {
    const st = this.readState();
    if (!st) return;
    this.state = st;
    this.syncPhase(st);
    this.syncTickets(st);
    this.syncAlarms(st);
    this.syncAgents(st);
  }

  private syncPhase(st: Record<string, unknown>) {
    const steps = (st.steps || {}) as Record<string, { start?: string; end?: string | null; restart?: string }>;
    let current = "";
    let latest = 0;
    for (const [name, s] of Object.entries(steps)) {
      if (s.end) continue;
      const at = Date.parse(s.restart || s.start || "") || 0;
      if (at >= latest) {
        latest = at;
        current = V2_PHASES[name] || name;
      }
    }
    if (!current || current === this.phase) return;
    this.phase = current;
    this.step({
      step: `ph-${current.toLowerCase()}-${String(st.runs || 1)}`,
      phase: current,
      status: "info",
      label: `${current} started`,
      data: { kind: "lifecycle" },
    });
  }

  private ticketUrl(issue: number) {
    return `https://github.com/${this.o.repo}/issues/${issue}`;
  }

  private syncTickets(st: Record<string, unknown>) {
    const tickets = Object.values((st.tickets || {}) as Record<string, V2Ticket>);
    if (tickets.length === 0) return;
    const changed: V2Ticket[] = [];
    for (const t of tickets) {
      const sig = `${t.status || ""}|${t.rounds || 0}`;
      if (this.ticketSig.get(t.issue) !== sig) {
        if (this.ticketSig.has(t.issue)) changed.push(t);
        this.ticketSig.set(t.issue, sig);
      }
    }
    const full = !this.synced;
    if (full || changed.length > 0) {
      this.synced = true;
      const send = full ? tickets : changed;
      this.o.post("/api/v1/epics/sync", {
        ...this.o.ctx,
        run: this.o.run,
        epic: {
          number: this.o.epic,
          repo: this.o.repo,
          url: this.ticketUrl(this.o.epic),
          ...(typeof (st.plan as { title?: unknown } | null)?.title === "string"
            ? { title: (st.plan as { title: string }).title }
            : {}),
        },
        tickets: send.map((t) => ({
          number: t.issue,
          status: t.status || "pending",
          rounds: t.rounds || 0,
          ...(full
            ? {
                title: t.title,
                url: this.ticketUrl(t.issue),
                body: t.body,
                size: t.size,
                wave: t.wave,
                dependsOn: (t.dependsOn || []).map(Number).filter(Number.isFinite),
                criteria: (t.criteria || []).map((c) =>
                  typeof c === "string" ? { id: c, text: "" } : { id: c.id, text: c.text || "" },
                ),
              }
            : {}),
          ...(t.status === "needs-decision" && t.decision
            ? { decision: { question: t.decision.question, reason: t.decision.reason } }
            : {}),
        })),
      });
    }
    for (const t of changed) {
      this.step({
        step: `tk-${t.issue}-${t.status}-${t.rounds || 0}`,
        phase: this.phase || "Build",
        status: t.status === "merged" ? "passed" : "info",
        label: `#${t.issue} ${t.status === "merged" ? "merged into staging" : t.status}${t.rounds ? ` (round ${t.rounds})` : ""}`,
        summary: t.title,
        data: { kind: "ticket", issue: t.issue, status: t.status, rounds: t.rounds || 0 },
      });
    }
    for (const t of tickets) {
      if (t.status !== "needs-decision" || !t.decision) continue;
      const key = `${t.issue}-${t.decisions || 1}`;
      if (this.decided.has(key)) continue;
      this.decided.add(key);
      this.o.post("/api/v1/runs/interaction", {
        run: this.o.run,
        ...this.o.ctx,
        type: "decision",
        title: `#${t.issue} needs a decision`,
        prompt: t.decision.question || t.decision.reason || "The factory needs a decision on this ticket.",
        agentKey: "orchestrator",
        payload: {
          key,
          epic: this.o.epic,
          repo: this.o.repo,
          issue: t.issue,
          question: t.decision.question,
          reason: t.decision.reason,
        },
      });
    }
  }

  private syncAlarms(st: Record<string, unknown>) {
    const alarms = (st.alarms || []) as Array<Record<string, unknown>>;
    // On the first look, alarms of earlier runs of this epic are history, not news.
    if (this.alarmsSeen < 0) {
      const since = this.o.sinceMs;
      this.alarmsSeen = alarms.filter((a) => (Date.parse(String(a.at || "")) || 0) < since).length;
    }
    for (let i = this.alarmsSeen; i < alarms.length; i += 1) {
      const a = alarms[i];
      this.step({
        step: `al-${i + 1}`,
        phase: this.phase || "Build",
        status: "info",
        label: `Alarm${a.issue ? ` #${a.issue}` : ""}${a.step ? ` ${a.step}` : ""}: ${String(a.reason || "").slice(0, 120)}`,
        summary: [a.reason, a.handled].filter(Boolean).join(" — "),
        data: { kind: "alarm", issue: a.issue ?? null, step: a.step ?? null, reason: a.reason, handled: a.handled },
      });
    }
    this.alarmsSeen = alarms.length;
  }

  private syncAgents(st: Record<string, unknown>) {
    for (const rec of (st.agents || []) as V2Agent[]) {
      if ((Date.parse(rec.start) || 0) < this.o.sinceMs - 1000) continue;
      let entry = this.agents.get(rec.id);
      if (!entry) {
        const name = `${rec.issue ? `#${rec.issue}` : "batch"} ${rec.role}${rec.step ? ` · ${rec.step}` : ""}`;
        const tracker = new ClaudeStreamTracker({
          post: this.o.post,
          run: this.o.run,
          ctx: this.o.ctx,
          phase: rec.role === "qc" ? "Final" : "Build",
          agentKey: rec.id,
          agentName: name,
          role: rec.role,
          model: rec.model || "",
          stepPrefix: rec.id.slice(0, 40),
        });
        entry = { tracker, offset: 0, rest: "", done: false };
        this.agents.set(rec.id, entry);
        this.o.post("/api/v1/runs/agent", {
          run: this.o.run,
          ...this.o.ctx,
          agentKey: rec.id,
          name,
          role: rec.role,
          model: rec.model,
          status: "working",
          activity: "Starting",
        });
      }
      if (entry.done) continue;
      this.tailLog(join(this.o.runDir, rec.log), entry);
      if (rec.ok !== null && rec.end) {
        this.tailLog(join(this.o.runDir, rec.log), entry);
        if (entry.rest.trim()) entry.tracker.handleLine(entry.rest);
        entry.rest = "";
        entry.done = true;
        this.o.post("/api/v1/runs/agent", {
          run: this.o.run,
          ...this.o.ctx,
          agentKey: rec.id,
          role: rec.role,
          model: entry.tracker.model || rec.model,
          status: rec.ok ? "passed" : "failed",
          activity: rec.ok ? "Done" : "Failed",
        });
      }
    }
  }

  private tailLog(file: string, entry: { tracker: ClaudeStreamTracker; offset: number; rest: string }) {
    let size = 0;
    try {
      size = statSync(file).size;
    } catch {
      return;
    }
    if (size <= entry.offset) return;
    const fd = openSync(file, "r");
    try {
      const buf = Buffer.alloc(size - entry.offset);
      readSync(fd, buf, 0, buf.length, entry.offset);
      entry.offset = size;
      const text = entry.rest + buf.toString("utf8");
      const lines = text.split("\n");
      entry.rest = lines.pop() || "";
      for (const line of lines) entry.tracker.handleLine(line);
    } finally {
      closeSync(fd);
    }
  }

  /** The run's outcome from the orchestrator's exit code and final state. */
  finish(exitCode: number | null): { outcome: "passed" | "failed" | "blocked"; summary: string } {
    this.poll();
    const st = (this.state || {}) as {
      status?: string;
      refusal?: string | null;
      error?: string;
      tickets?: Record<string, V2Ticket>;
    };
    let report = "";
    try {
      report = readFileSync(join(this.o.runDir, "report.md"), "utf8");
    } catch {
      report = "";
    }
    const tickets = Object.values(st.tickets || {});
    const allMerged = tickets.length > 0 && tickets.every((t) => t.status === "merged");
    let outcome: "passed" | "failed" | "blocked";
    if (exitCode === 0) outcome = allMerged ? "passed" : "blocked";
    else if (exitCode === 3) outcome = "blocked";
    else outcome = "failed";
    const head =
      exitCode === 2 || exitCode === 3
        ? `Refused: ${st.refusal || "see report"}`
        : exitCode === 0
          ? ""
          : `new-factory exited with code ${exitCode ?? "unknown"}${st.error ? `: ${String(st.error).split("\n")[0]}` : ""}`;
    const summary = [head, report].filter(Boolean).join("\n\n").slice(0, 200_000);
    this.step({
      step: `ph-report-${Date.now().toString(36)}`,
      phase: "Report",
      status: outcome === "passed" ? "passed" : outcome === "blocked" ? "info" : "failed",
      label: `Epic #${this.o.epic}: ${st.status || outcome}`,
      summary: summary.slice(0, 20_000),
      data: { kind: "lifecycle", exitCode },
    });
    return { outcome, summary };
  }
}

/** The epic new-ba just published, read from `publish-batch.mjs`'s JSON in a tool result. */
export function findPublishedEpic(text: string): { repo: string; number: number; url?: string } | null {
  const at = text.indexOf('"epic"');
  if (at < 0) return null;
  const start = text.lastIndexOf("{", at);
  for (let s = start; s >= 0; s = text.lastIndexOf("{", s - 1)) {
    let depth = 0;
    for (let i = s; i < text.length; i += 1) {
      if (text[i] === "{") depth += 1;
      else if (text[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          try {
            const obj = JSON.parse(text.slice(s, i + 1)) as {
              repo?: unknown;
              epic?: { number?: unknown; url?: unknown };
              dryRun?: unknown;
            };
            if (obj.dryRun !== true && typeof obj.repo === "string" && typeof obj.epic?.number === "number") {
              return {
                repo: obj.repo,
                number: obj.epic.number,
                url: typeof obj.epic.url === "string" ? obj.epic.url : undefined,
              };
            }
          } catch {
            // not this brace
          }
          break;
        }
      }
    }
    if (s === 0) break;
  }
  return null;
}

export function sanitizeRunDirKey(runKey: string): string {
  return runKey.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96) || "run";
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
    engine: "claude",
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

type DiscoveredModel = {
  id: string;
  label: string;
  engine: "claude";
};

type LocalCapabilities = {
  engines: string[];
  models: DiscoveredModel[];
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
  const claudeProbe = probeCommand("claude");
  const models: DiscoveredModel[] = claudeProbe.installed
    ? [
        { id: "opus", label: "Claude Opus", engine: "claude" },
        { id: "sonnet", label: "Claude Sonnet", engine: "claude" },
        { id: "haiku", label: "Claude Haiku", engine: "claude" },
      ]
    : [];
  return {
    engines: claudeProbe.installed ? ["claude"] : [],
    models,
    claude: { installed: claudeProbe.installed, version: claudeProbe.version },
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

/** A checkout that holds the factory v2 skills: `factory_v2/skills/<skill>` or `skills/<skill>`. */
function findLocalSkillsMonorepo(hintDir?: string): string | null {
  const scriptDir = dirname(resolve(process.argv[1] || "."));
  const starts = [
    hintDir ? resolve(hintDir) : "",
    process.cwd(),
    scriptDir,
    join(sfDir(), "skills-repo"),
  ].filter(Boolean);
  for (const start of starts) {
    let dir = start;
    for (let depth = 0; depth < 5; depth += 1) {
      if (v2SkillsRoot(dir)) return dir;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

/** The folder of a checkout that holds `new-ba/` and `new-factory/`, or null. */
function v2SkillsRoot(dir: string): string | null {
  for (const candidate of [join(dir, "factory_v2", "skills"), join(dir, "skills")]) {
    if (FACTORY_SKILLS.every((s) => existsSync(join(candidate, s, "SKILL.md")))) return candidate;
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

function hasRegisteredMcp(binary: "claude", name = "software-factory"): boolean {
  try {
    // `claude mcp list` health-checks every configured server and can time out;
    // `claude mcp get <name>` checks only this one.
    execFileSync(binary, ["mcp", "get", name], { stdio: "ignore", timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

function registerSoftwareFactoryMcp(caps: { claude: { installed: boolean } }): {
  mcpConfigPath: string;
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
  let claudeStatus: "registered" | "failed" | "skipped" = "skipped";
  if (caps.claude.installed) {
    try {
      try {
        execFileSync("claude", ["mcp", "remove", "-s", "user", "software-factory"], {
          stdio: "ignore",
          timeout: 6000,
        });
      } catch {
        // Not registered yet.
      }
      execFileSync(
        "claude",
        ["mcp", "add", "-s", "user", "software-factory", "--", entry.command, ...entry.args],
        { stdio: "ignore", timeout: 8000 },
      );
      claudeStatus = "registered";
    } catch {
      claudeStatus = "failed";
    }
  }
  return { mcpConfigPath, claude: claudeStatus };
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
        : "  ! gh CLI        installed, not logged in (run `gh auth login`; new-ba and new-factory need it)",
    );
  } else {
    console.log("  ! gh CLI        not installed (required: new-ba publishes and new-factory reads tickets on GitHub)");
  }

  const caps = discoverLocalCapabilities();
  if (caps.claude.installed) {
    console.log(`  ✓ Claude Code   ${caps.claude.version || "claude"}`);
  } else {
    console.log("  ✗ Claude Code   `claude` not found in PATH (required: every run is a Claude Code run)");
    criticalFailures += 1;
  }

  for (const skill of FACTORY_SKILLS) {
    const dir = join(homedir(), ".claude", "skills", skill);
    console.log(
      existsSync(join(dir, "SKILL.md"))
        ? `  ✓ Skill         ${skill} (~/.claude/skills/${skill})`
        : `  ✗ Skill         ${skill} not installed (run \`sf setup --root <checkout with factory_v2/skills>\`)`,
    );
    if (!existsSync(join(dir, "SKILL.md"))) criticalFailures += 1;
  }

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
  if (caps.claude.installed) {
    console.log(`  ✓ Claude Code (${caps.claude.version || "claude"}) detected`);
  } else {
    console.log(
      "  ! Claude Code (`claude`) not found in PATH. Install it and sign in so `sf daemon` can run BA sessions and epics.",
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

  const cloneTarget = join(sfDir(), "skills-repo");
  let skillsRoot = findLocalSkillsMonorepo(values.root);
  // The runner's own clone of the skills repository is refreshed on every setup, so a machine
  // that ran setup before gets the current factory v2 skills; a checkout the user named is left as is.
  if (skillsRepoUrl && (!skillsRoot || resolve(skillsRoot) === resolve(cloneTarget))) {
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

  const skillsDir = skillsRoot ? v2SkillsRoot(skillsRoot) : null;
  if (skillsDir) {
    const res = linkSkillsSuite(skillsDir, join(homedir(), ".claude", "skills"));
    console.log(
      `  ✓ Linked factory v2 skills from ${skillsDir}: ${res.linked.join(", ") || "none"}${res.skipped.length ? ` (kept existing: ${res.skipped.join(", ")})` : ""}`,
    );
  } else {
    const existing = countInstalledSkills(join(homedir(), ".claude", "skills"));
    console.log(
      existing === FACTORY_SKILLS.length
        ? `  ✓ Using installed skills in ~/.claude/skills (${FACTORY_SKILLS.join(", ")})`
        : "  ! factory v2 skills not found (pass `--root <checkout with factory_v2/skills>` or `--skills-repo <git-url>`).",
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

  // 4. Register the MCP Context Lake in Claude Code & register the project
  console.log("\n[4/5] Registering MCP Context Lake & checking workspace project...");
  const sfBin = join(sfDir(), "bin", "sf");
  const scriptPath = resolve(process.argv[1] || join(sfDir(), "bin", "sf.ts"));
  const mcpReg = registerSoftwareFactoryMcp(caps);
  console.log(`  ✓ Wrote MCP Context Lake snippet to ${mcpReg.mcpConfigPath}`);
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
      engine: "claude",
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

/** `owner/name` of a GitHub remote URL (https or ssh), or "". */
export function githubRepoFromUrl(url: string): string {
  const m = /github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(url.trim());
  return m ? `${m[1]}/${m[2]}` : "";
}

/** Where a factory v2 skill lives on this machine (`new-ba`, `new-factory`). */
function resolveV2SkillDir(name: "new-ba" | "new-factory", rootHint?: string): string | null {
  const candidates: string[] = [];
  if (process.env.SF_V2_SKILLS_DIR) candidates.push(join(process.env.SF_V2_SKILLS_DIR, name));
  candidates.push(join(homedir(), ".claude", "skills", name));
  const root = findLocalSkillsMonorepo(rootHint);
  if (root) candidates.push(join(root, "factory_v2", "skills", name), join(root, "skills", name));
  for (const dir of candidates) {
    if (existsSync(join(dir, "SKILL.md"))) {
      try {
        return realpathSync(dir);
      } catch {
        return dir;
      }
    }
  }
  return null;
}

/** `claude -p` arguments for a BA turn. `model` may carry an effort: `opus:high`. */
export function buildClaudeBaArgs(params: {
  model?: string;
  prompt: string;
  resumeSessionId?: string;
}): { args: string[]; model: string; effort: string } {
  const [baseModel, explicitEffort] = (params.model || "opus").split(":");
  const model = baseModel || "opus";
  const efforts = new Set(["low", "medium", "high", "xhigh", "max"]);
  const effort =
    explicitEffort && efforts.has(explicitEffort)
      ? explicitEffort
      : model === "haiku"
        ? "low"
        : model === "sonnet"
          ? "medium"
          : "high";
  const args: string[] = [];
  if (params.resumeSessionId) args.push("--resume", params.resumeSessionId);
  // Headless: nobody can answer a permission prompt or AskUserQuestion. Questions go through
  // the `sf-questions` block instead (see SF_QUESTIONS_CONTRACT).
  args.push(
    "--model",
    model,
    "--effort",
    effort,
    "--dangerously-skip-permissions",
    "--disallowedTools",
    "AskUserQuestion",
    "--output-format",
    "stream-json",
    "--verbose",
    "-p",
    params.prompt,
  );
  return { args, model, effort };
}

/** `node run.mjs …` arguments for an epic run of new-factory. */
export function buildEpicArgs(params: {
  runMjs: string;
  repo: string;
  epic: number;
  dir: string;
  retry?: number[];
  note?: string;
  createStaging?: boolean;
}): string[] {
  const args = [params.runMjs, "--repo", params.repo, "--epic", String(params.epic), "--dir", params.dir];
  const retry = (params.retry || []).filter((n) => Number.isInteger(n) && n > 0);
  if (retry.length > 0) args.push("--retry", retry.join(","));
  if (params.note && params.note.trim()) args.push("--note", params.note.trim());
  if (params.createStaging) args.push("--create-staging");
  return args;
}

const SF_QUESTIONS_CONTRACT = [
  "Software Factory headless contract:",
  "- This session runs headless through Software Factory: nobody can answer `AskUserQuestion` or a permission prompt. Whenever the skill says to ask the user, write brief context, then end your reply with one fenced JSON block tagged `sf-questions` and stop the turn. The answers come back as the next message of this session.",
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
  '- At most 4 questions per block. Keep option labels short (2-8 words), mark your best default with `"recommended": true`, use `"multiSelect": true` when several apply, and write in the user\'s language. Do not repeat the options as prose.',
  "- Agents you start with the Agent tool (the batch reader, the design reviewer): start them in the foreground, never with `run_in_background`, so this turn waits for their reports.",
].join("\n");

const SF_QUESTIONS_RESUME_REMINDER =
  "(Software Factory reminder: ask follow-up questions only with a ```sf-questions block at the end of your reply, never with AskUserQuestion.)";

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

  const caps = discoverLocalCapabilities();
  if (!caps.claude.installed) {
    console.error("sf daemon: `claude` (Claude Code) is not in PATH; runs will fail until it is installed.");
  } else if (!hasRegisteredMcp("claude")) {
    const reg = registerSoftwareFactoryMcp(caps);
    if (reg.claude === "registered") console.log('sf daemon: registered MCP "software-factory" in Claude Code');
  }
  const baSkill = resolveV2SkillDir("new-ba", values.root);
  const factorySkill = resolveV2SkillDir("new-factory", values.root);
  if (!baSkill || !factorySkill) {
    console.error(
      `sf daemon: factory v2 skill(s) missing: ${[!baSkill && "new-ba", !factorySkill && "new-factory"].filter(Boolean).join(", ")} (run \`sf setup\`, or set SF_V2_SKILLS_DIR).`,
    );
  }

  let activeRuns = 0;

  type SavedSession = {
    sessionId: string;
    model: string;
    mode: string;
    cwd: string;
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
    sessionMap[runKey] = { ...entry, updatedAt: new Date().toISOString() };
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

  const activeChildren = new Map<string, { child: ChildProcess; mode: "ba" | "epic" }>();

  console.log(
    `sf daemon: online as "${runnerName}" -> ${cfg.url} (v${CLI_VERSION}, claude ${caps.claude.version || "missing"}, poll ${intervalMs}ms)`,
  );
  console.log(`sf daemon: default projects workspace -> ${workspaceDir}`);
  console.log(`sf daemon: new-ba ${baSkill || "missing"} · new-factory ${factorySkill || "missing"}`);
  if (allowedRoots.length > 0) {
    console.log(`sf daemon: --allow-root guardrail active (${allowedRoots.join(", ")})`);
  }

  async function patchCommand(id: string, body: Record<string, unknown>) {
    await sendJsonWithRetry(cfg!, `/api/v1/runners/commands/${id}`, body, "PATCH", {
      retries: 2,
      spoolOnFail: true,
    }).catch(() => {});
  }

  /** FIFO poster: keeps the order of agents and steps, retries, and spools what cannot be sent. */
  function createPoster(onSent?: (path: string, body: Record<string, unknown>) => void) {
    let chain: Promise<unknown> = Promise.resolve();
    let lastOkMs = Date.now();
    let lastWarnMs = 0;
    const post: SfPost = (path, body) => {
      chain = chain
        .then(async () => {
          const res = await sendJsonWithRetry(cfg!, path, body, "POST", {
            retries: 2,
            retryDelayMs: 500,
            spoolOnFail: true,
          });
          if (res.ok) {
            lastOkMs = Date.now();
            onSent?.(path, body);
          } else if (Date.now() - lastWarnMs > 10_000) {
            lastWarnMs = Date.now();
            console.error(
              `sf daemon: POST ${path} failed (${res.error})${res.spooled ? " — spooled for retry" : ""}`,
            );
          }
        })
        .catch(() => {});
    };
    return {
      post,
      drain: () => chain,
      get lastOkMs() {
        return lastOkMs;
      },
    };
  }

  // Ephemeral live chunks (Ably / Supabase Broadcast / the server's SSE) so viewers on any machine
  // see a run move at once; the durable steps above stay authoritative.
  type LiveGrant =
    | { transport: "ably"; channel: string; publishUrl: string; bearerToken: string; expiresAt: number }
    | { transport: "supabase"; channel: string; publishUrl: string; apiKey: string }
    | { transport: "sse"; channel: string };
  function createLivePublisher(runKey: string, baseCtx: Record<string, unknown>) {
    let grant: LiveGrant | null = null;
    let fetching: Promise<void> | null = null;
    let stopped = false;
    const queue: Array<Record<string, unknown>> = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    let flushChain: Promise<void> = Promise.resolve();
    function ensureGrant(): Promise<void> {
      if (grant && (grant.transport !== "ably" || Date.now() < grant.expiresAt - 180_000)) {
        return Promise.resolve();
      }
      if (fetching) return fetching;
      fetching = sendJson(cfg!, "/api/v1/runs/live-token", { run: runKey, ...baseCtx })
        .then((res) => {
          const d = (res.ok ? res.data : null) as Partial<LiveGrant & { publishUrl: string; bearerToken: string; apiKey: string }> | null;
          if (!d || !d.channel) return;
          if (d.transport === "ably" && d.publishUrl && d.bearerToken) grant = d as LiveGrant;
          else if (d.transport === "supabase" && d.publishUrl && d.apiKey) grant = d as LiveGrant;
          else if (d.transport === "sse") grant = d as LiveGrant;
        })
        .catch(() => {})
        .finally(() => {
          fetching = null;
        });
      return fetching;
    }
    async function dispatch(chunks: Array<Record<string, unknown>>) {
      if (chunks.length === 0) return;
      await ensureGrant();
      const g = grant;
      if (!g) return;
      try {
        if (g.transport === "ably") {
          await fetch(g.publishUrl, {
            method: "POST",
            headers: { Authorization: `Bearer ${g.bearerToken}`, "Content-Type": "application/json" },
            body: JSON.stringify([{ name: "chunk", data: JSON.stringify({ chunks }) }]),
            signal: AbortSignal.timeout(5000),
          });
        } else if (g.transport === "supabase") {
          await fetch(g.publishUrl, {
            method: "POST",
            headers: { apikey: g.apiKey, Authorization: `Bearer ${g.apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ messages: [{ topic: g.channel, event: "chunk", payload: { chunks } }] }),
            signal: AbortSignal.timeout(5000),
          });
        } else {
          await sendJson(cfg!, "/api/v1/runs/live-chunk", { run: runKey, ...baseCtx, chunks });
        }
      } catch {
        // Best effort.
      }
    }
    function flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (queue.length === 0) return;
      const batch = queue.splice(0, queue.length);
      flushChain = flushChain.then(() => dispatch(batch)).catch(() => {});
    }
    void ensureGrant();
    return {
      emit(chunk: Record<string, unknown>) {
        if (stopped) return;
        queue.push(chunk);
        if (queue.length >= 25) flush();
        else if (!timer) timer = setTimeout(flush, 70);
      },
      /** A durable post landed: tell push-based viewers to refetch. */
      committed(step?: unknown) {
        if (!stopped && grant && grant.transport !== "sse") {
          queue.push({ kind: "step_committed", stepKey: typeof step === "string" ? step : undefined, ts: Date.now() });
          if (!timer) timer = setTimeout(flush, 70);
        }
      },
      async stop() {
        flush();
        stopped = true;
        await flushChain;
      },
    };
  }

  /** Read a just-published epic from GitHub with new-ba's own reader and put it on the board. */
  async function syncPublishedEpic(
    post: SfPost,
    baseCtx: Record<string, unknown>,
    runKey: string,
    published: { repo: string; number: number; url?: string },
  ) {
    if (!baSkill) return;
    try {
      const lib = (await import(pathToFileURL(join(baSkill, "scripts", "lib.mjs")).href)) as {
        readBatchFromGitHub: (repo: string, epic: number) => {
          epic: { number: number; title: string; url: string };
          plan: { waves: Array<{ wave: number; tickets: Array<{ issue: number; dependsOn?: unknown[] }> }> };
          tickets: Array<{ issue: number; key: string; title: string; body: string; url: string; size: string }>;
        };
        criteriaOf?: (body: string) => Array<{ id: string; text?: string }>;
      };
      const got = lib.readBatchFromGitHub(published.repo, published.number);
      const waveOf = new Map<number, { wave: number; dependsOn: number[] }>();
      for (const w of got.plan.waves || []) {
        for (const t of w.tickets || []) {
          waveOf.set(t.issue, {
            wave: w.wave,
            dependsOn: (t.dependsOn || []).map(Number).filter(Number.isFinite),
          });
        }
      }
      post("/api/v1/epics/sync", {
        ...baseCtx,
        run: runKey,
        epic: { number: got.epic.number, title: got.epic.title, url: got.epic.url, repo: published.repo },
        tickets: got.tickets.map((t) => ({
          number: t.issue,
          key: t.key,
          title: t.title,
          url: t.url,
          body: t.body,
          size: t.size,
          wave: waveOf.get(t.issue)?.wave,
          dependsOn: waveOf.get(t.issue)?.dependsOn,
          criteria: lib.criteriaOf ? lib.criteriaOf(t.body).map((c) => ({ id: c.id, text: c.text || "" })) : undefined,
          status: "ready",
        })),
      });
      post("/api/v1/runs/step", {
        run: runKey,
        ...baseCtx,
        idempotent: true,
        step: `epic-${got.epic.number}-published`,
        phase: "BA",
        status: "passed",
        role: "orchestrator",
        agent: "orchestrator",
        label: `Published epic #${got.epic.number} with ${got.tickets.length} ticket(s)`,
        summary: got.epic.title,
        data: { kind: "epic", epic: got.epic.number, repo: published.repo, url: got.epic.url },
      });
      console.log(`sf daemon [${runKey}]: synced epic #${got.epic.number} (${got.tickets.length} tickets) to the board`);
    } catch (err) {
      console.error(
        `sf daemon [${runKey}]: could not read epic #${published.number} from GitHub: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`,
      );
    }
  }

  /** One BA turn: `claude -p "/new-ba …"`, or `--resume` with the user's answer. */
  async function runBaTurn(params: {
    cmdId: string;
    runKey: string;
    cwd: string;
    projectId?: string;
    prompt: string;
    model: string;
    resumeSessionId?: string;
  }) {
    const { cmdId, runKey, cwd, projectId, prompt, resumeSessionId } = params;
    const spec = buildClaudeBaArgs({ model: params.model, prompt, resumeSessionId });
    const baseCtx = { repo: cwd, projectId: projectId || undefined };
    const live = createLivePublisher(runKey, baseCtx);
    const poster = createPoster((_path, body) => live.committed(body.step));
    const post = poster.post;
    const turnTag = (cmdId || Date.now().toString(36)).replace(/[^a-zA-Z0-9]+/g, "").slice(-8);
    let published: { repo: string; number: number; url?: string } | null = null;
    const tracker = new ClaudeStreamTracker({
      post,
      run: runKey,
      ctx: baseCtx,
      phase: "BA",
      agentKey: "orchestrator",
      agentName: "new-ba",
      role: "orchestrator",
      model: spec.model,
      stepPrefix: `ba-${turnTag}`,
      trackSubagents: true,
      onSession: (sid) => saveSession(runKey, { sessionId: sid, model: params.model || spec.model, mode: "ba", cwd }),
      onLive: (chunk) => live.emit(chunk),
      onToolResult: (text) => {
        if (text.includes('"epic"')) published = findPublishedEpic(text) || published;
      },
    });

    post("/api/v1/runs/step", {
      run: runKey,
      ...baseCtx,
      step: `ba-${turnTag}-spawn`,
      idempotent: true,
      phase: "BA",
      status: "info",
      role: "orchestrator",
      agent: "orchestrator",
      agentName: "new-ba",
      model: spec.model,
      label: `${resumeSessionId ? "Resumed" : "Started"} claude --model ${spec.model} --effort ${spec.effort}`,
      data: { kind: "lifecycle", runner: runnerName, cwd },
    });

    activeRuns += 1;
    console.log(`sf daemon [${runKey}]: claude${resumeSessionId ? " --resume" : ""} /new-ba in ${cwd}`);
    const child = spawn("claude", spec.args, { cwd, env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] });
    activeChildren.set(runKey, { child, mode: "ba" });
    let lineBuf = "";
    let stderrBuf = "";
    let lastEventMs = Date.now();
    child.stdout?.on("data", (chunk: Buffer) => {
      lastEventMs = Date.now();
      lineBuf += chunk.toString("utf8");
      let nl = lineBuf.indexOf("\n");
      while (nl !== -1) {
        tracker.handleLine(lineBuf.slice(0, nl));
        lineBuf = lineBuf.slice(nl + 1);
        nl = lineBuf.indexOf("\n");
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf = (stderrBuf + chunk.toString("utf8")).slice(-12_000);
    });
    // Keep the run's heartbeat alive; while a tool runs, keep its activity instead of "Thinking".
    const heartbeat = setInterval(() => {
      const idle = Date.now() - lastEventMs;
      if (tracker.busy) {
        if (Date.now() - poster.lastOkMs >= 45_000) {
          post("/api/v1/runs/agent", { run: runKey, ...baseCtx, agentKey: "orchestrator", preserveExistingName: true, role: "orchestrator", status: "working" });
        }
      } else if (idle >= 4000) {
        post("/api/v1/runs/agent", {
          run: runKey,
          ...baseCtx,
          agentKey: "orchestrator",
          preserveExistingName: true,
          role: "orchestrator",
          status: "working",
          activity: `Thinking… (${Math.round(idle / 1000)}s)`,
        });
      }
    }, 5000);

    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; error?: string }>((done) => {
      child.on("error", (err) => done({ code: null, signal: null, error: err.message }));
      child.on("close", (code, signal) => done({ code, signal }));
    });
    clearInterval(heartbeat);
    if (lineBuf.trim()) tracker.handleLine(lineBuf);
    if (activeChildren.get(runKey)?.child === child) activeChildren.delete(runKey);
    activeRuns = Math.max(0, activeRuns - 1);

    const paused = exit.signal === "SIGTERM" || exit.signal === "SIGINT";
    const ok = !exit.error && !paused && exit.code === 0 && !tracker.isError;
    if (published) await syncPublishedEpic(post, baseCtx, runKey, published);
    await poster.drain();
    await live.stop();
    console.log(`sf daemon [${runKey}]: claude finished (code=${exit.code ?? "null"}, signal=${exit.signal ?? "none"})`);

    const summary = (
      tracker.finalText ||
      exit.error ||
      (ok ? "" : stderrBuf) ||
      `claude exited with code ${exit.code ?? exit.signal ?? "unknown"}`
    )
      .trim()
      .slice(0, 200_000);
    await patchCommand(cmdId, ok || paused ? { status: "done" } : { status: "failed", error: summary.slice(-600) });
    await syncProjectContextToServer(cwd, { projectId }).catch(() => {});
    if (!paused) {
      await sendJsonWithRetry(
        cfg!,
        "/api/v1/runs/finish",
        {
          run: runKey,
          ...baseCtx,
          outcome: ok ? "passed" : "failed",
          summary,
          skipVerdictStep: ok,
          respectPendingInteraction: true,
        },
        "POST",
        { retries: 3, spoolOnFail: true },
      ).catch(() => {});
    }
  }

  /** An epic run: new-factory's orchestrator in the clone, tracked from its state and logs. */
  async function runEpic(params: {
    cmdId: string;
    runKey: string;
    cwd: string;
    projectId?: string;
    repo: string;
    epic: number;
    retry?: number[];
    note?: string;
    createStaging?: boolean;
  }) {
    const { cmdId, runKey, cwd, projectId, repo, epic } = params;
    const baseCtx = { repo: cwd, projectId: projectId || undefined };
    const fail = async (message: string) => {
      console.error(`sf daemon [${runKey}]: ${message}`);
      await patchCommand(cmdId, { status: "failed", error: message });
      await sendJsonWithRetry(cfg!, "/api/v1/runs/finish", { run: runKey, ...baseCtx, outcome: "failed", summary: message }, "POST", { retries: 3, spoolOnFail: true }).catch(() => {});
    };
    if (!factorySkill) {
      await fail("new-factory is not installed on this runner (run `sf setup`, or set SF_V2_SKILLS_DIR).");
      return;
    }
    const runMjs = join(factorySkill, "orchestrator", "run.mjs");
    const runDir = join(realpathSync(cwd), ".factory", "runs", `epic-${epic}`);
    const live = createLivePublisher(runKey, baseCtx);
    const poster = createPoster((_path, body) => live.committed(body.step));
    const post = poster.post;
    const sinceMs = Date.now();
    const tracker = new EpicTracker({ runDir, sinceMs, post, run: runKey, ctx: baseCtx, repo, epic });

    post("/api/v1/runs/agent", {
      run: runKey,
      ...baseCtx,
      agentKey: "orchestrator",
      name: "new-factory orchestrator",
      role: "orchestrator",
      model: "code",
      status: "working",
      activity: `Epic #${epic} on ${repo}${params.retry?.length ? ` · retry ${params.retry.map((n) => `#${n}`).join(", ")}` : ""}`,
    });

    activeRuns += 1;
    const args = buildEpicArgs({ runMjs, repo, epic, dir: cwd, retry: params.retry, note: params.note, createStaging: params.createStaging });
    console.log(`sf daemon [${runKey}]: node ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}`);
    const child = spawn(process.execPath, args, { cwd, env: { ...process.env, NF_QUIET: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    activeChildren.set(runKey, { child, mode: "epic" });
    let outTail = "";
    const keep = (chunk: Buffer) => {
      outTail = (outTail + chunk.toString("utf8")).slice(-12_000);
    };
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);

    let lastBeatMs = 0;
    const timer = setInterval(() => {
      tracker.poll();
      if (Date.now() - lastBeatMs >= 30_000) {
        lastBeatMs = Date.now();
        const st = (tracker.state || {}) as { status?: string; tickets?: Record<string, { status?: string }> };
        const tickets = Object.values(st.tickets || {});
        const merged = tickets.filter((t) => t.status === "merged").length;
        post("/api/v1/runs/agent", {
          run: runKey,
          ...baseCtx,
          agentKey: "orchestrator",
          preserveExistingName: true,
          role: "orchestrator",
          status: "working",
          activity: `${st.status || "starting"} · ${merged}/${tickets.length} ticket(s) merged`,
        });
      }
    }, 2000);

    const exit = await new Promise<{ code: number | null; error?: string }>((done) => {
      child.on("error", (err) => done({ code: null, error: err.message }));
      child.on("close", (code) => done({ code }));
    });
    clearInterval(timer);
    if (activeChildren.get(runKey)?.child === child) activeChildren.delete(runKey);
    activeRuns = Math.max(0, activeRuns - 1);
    const end = tracker.finish(exit.code);
    const summary = exit.error
      ? `Could not start new-factory: ${exit.error}`
      : end.summary || outTail.trim().slice(-4000) || `new-factory exited with code ${exit.code}`;
    post("/api/v1/runs/agent", {
      run: runKey,
      ...baseCtx,
      agentKey: "orchestrator",
      preserveExistingName: true,
      role: "orchestrator",
      status: end.outcome === "failed" ? "failed" : "passed",
      activity: `Exit ${exit.code ?? "?"}`,
    });
    await poster.drain();
    await live.stop();
    console.log(`sf daemon [${runKey}]: new-factory finished (code=${exit.code ?? "null"}, ${end.outcome})`);
    await patchCommand(cmdId, end.outcome === "failed" ? { status: "failed", error: summary.slice(0, 600) } : { status: "done" });
    await sendJsonWithRetry(
      cfg!,
      "/api/v1/runs/finish",
      { run: runKey, ...baseCtx, outcome: end.outcome, summary, skipVerdictStep: true },
      "POST",
      { retries: 3, spoolOnFail: true },
    ).catch(() => {});
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

  function resolveRepoSlug(cwd: string, given: unknown): string {
    if (typeof given === "string" && /^[\w.-]+\/[\w.-]+$/.test(given.trim())) return given.trim();
    try {
      const url = execFileSync("git", ["-C", cwd, "remote", "get-url", "origin"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000,
      });
      return githubRepoFromUrl(url);
    } catch {
      return "";
    }
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

    const blocked = async (cwd: string) => {
      const msg = `Blocked by --allow-root guardrail: ${cwd}`;
      console.error(`sf daemon: ${msg}`);
      await patchCommand(cmd.id, { status: "failed", error: msg });
      if (runKey) {
        await sendJsonWithRetry(cfg!, "/api/v1/runs/finish", { run: runKey, outcome: "blocked", summary: msg }, "POST", { retries: 2, spoolOnFail: true }).catch(() => {});
      }
    };
    const localPath =
      typeof cmd.payload.localPath === "string" && cmd.payload.localPath.trim() && existsSync(cmd.payload.localPath.trim())
        ? cmd.payload.localPath.trim()
        : "";

    // 1. Pause a BA turn. An epic run is unattended; the orchestrator resumes from state.json.
    if (cmd.type === "pause_run") {
      const active = runKey ? activeChildren.get(runKey) : undefined;
      if (active?.mode === "epic" || cmd.payload.mode === "epic") {
        await patchCommand(cmd.id, {
          status: "failed",
          error: "An epic run is unattended and cannot be paused; let it finish, or answer its decision and retry.",
        });
        return;
      }
      if (active) {
        active.child.kill("SIGTERM");
        activeChildren.delete(runKey);
        console.log(`sf daemon: paused ${runKey}`);
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
      await patchCommand(cmd.id, { status: "done" });
      return;
    }

    // 2. BA: a new turn (`start_run`) or the user's answer to the last one (`resume_run`, `answer_interaction`).
    if (
      cmd.type === "start_run" ||
      cmd.type === "retry_phase" ||
      cmd.type === "resume_run" ||
      cmd.type === "answer_interaction"
    ) {
      if (!runKey) {
        await patchCommand(cmd.id, { status: "failed", error: "runKey is required" });
        return;
      }
      if (cmd.payload.mode && cmd.payload.mode !== "ba") {
        await patchCommand(cmd.id, {
          status: "failed",
          error: `Mode "${String(cmd.payload.mode)}" is not supported: Software Factory runs factory v2 (BA sessions and epic runs) only.`,
        });
        return;
      }
      const saved = sessionMap[runKey];
      const isAnswer = cmd.type === "resume_run" || cmd.type === "answer_interaction";
      const cwd = isAnswer ? resolveResumeCwd({ localPath, savedCwd: saved?.cwd }) : localPath || saved?.cwd || process.cwd();
      if (!isPathAllowed(cwd)) {
        await blocked(cwd);
        return;
      }
      const existing = activeChildren.get(runKey);
      if (existing) {
        existing.child.kill("SIGTERM");
        activeChildren.delete(runKey);
      }
      const attachmentBlock = await materializeCommandAttachments(cwd, runKey, cmd.payload.attachments);
      // An answer keeps the model the session started with: the web's run.model is the resolved
      // id Claude reported (`claude-sonnet-5-5`), which would lose the chosen alias and effort.
      const payloadModel = typeof cmd.payload.model === "string" ? cmd.payload.model.trim() : "";
      const model = (isAnswer ? saved?.model || payloadModel : payloadModel || saved?.model) || "opus";
      let prompt: string;
      let resumeSessionId: string | undefined;
      if (isAnswer && saved?.sessionId) {
        const message = typeof cmd.payload.message === "string" ? cmd.payload.message.trim() : "";
        const decision = typeof cmd.payload.decision === "string" ? cmd.payload.decision.trim() : "";
        const text = [message || (decision ? `Decision: ${decision}. Please continue.` : ""), attachmentBlock]
          .filter(Boolean)
          .join("\n\n")
          .trim();
        if (!text) {
          await patchCommand(cmd.id, { status: "done" });
          return;
        }
        prompt = `${text}\n\n${SF_QUESTIONS_RESUME_REMINDER}`;
        resumeSessionId = saved.sessionId;
      } else {
        const raw = String(cmd.payload.prompt || cmd.payload.message || "").trim();
        const body = raw.replace(/^\/new-ba\b\s*/i, "");
        prompt = [`/new-ba ${body}`.trim(), attachmentBlock, SF_QUESTIONS_CONTRACT].filter(Boolean).join("\n\n");
      }
      await runBaTurn({ cmdId: cmd.id, runKey, cwd, projectId: resolvedProjectId, prompt, model, resumeSessionId });
      return;
    }

    // 3. Build an epic with new-factory.
    if (cmd.type === "run_epic") {
      const cwd = localPath;
      const epic = Number(cmd.payload.epic);
      const fail = async (error: string) => {
        await patchCommand(cmd.id, { status: "failed", error });
        if (runKey) {
          await sendJsonWithRetry(cfg!, "/api/v1/runs/finish", { run: runKey, outcome: "failed", summary: error }, "POST", { retries: 2, spoolOnFail: true }).catch(() => {});
        }
      };
      if (!runKey) return fail("runKey is required");
      if (!Number.isInteger(epic) || epic <= 0) return fail("epic must be an issue number");
      if (!cwd) return fail(`The project's local clone was not found on runner "${runnerName}" (${String(cmd.payload.localPath || "no localPath")}).`);
      if (!isPathAllowed(cwd)) return blocked(cwd);
      const repo = resolveRepoSlug(cwd, cmd.payload.repo);
      if (!repo) return fail(`Could not tell the GitHub repository of ${cwd} (no github.com origin); pass repo as owner/name.`);
      const retry = Array.isArray(cmd.payload.retry)
        ? cmd.payload.retry.map(Number).filter((n) => Number.isInteger(n) && n > 0)
        : [];
      await runEpic({
        cmdId: cmd.id,
        runKey,
        cwd,
        projectId: resolvedProjectId,
        repo,
        epic,
        retry,
        note: typeof cmd.payload.note === "string" ? cmd.payload.note : undefined,
        createStaging: cmd.payload.createStaging === true,
      });
      return;
    }

    await patchCommand(cmd.id, {
      status: "failed",
      error: `Unsupported command "${cmd.type}": this runner runs factory v2 only (BA sessions and epic runs).`,
    });
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
      engines: caps.claude.installed ? ["claude"] : [],
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
      description: "List Factory projects, recent runs, online runners, and inbox attention counts.",
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
      description: "Get pending human interactions, blocked runs and needs_human issues (tickets waiting on a decision).",
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
