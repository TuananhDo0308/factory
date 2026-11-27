// Pure helpers that read what new-ba and new-factory leave on GitHub, so a tracked repository's
// epics, tickets, staging merges and prototypes can be shown without the daemon.
// Only node:crypto and type imports, so node --test can load this file.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { IssueCriterion, SyncTicket, TicketBoardStatus } from "./epics";

export type RepoRef = { owner: string; name: string; fullName: string };

/** owner/name from a GitHub link (repo, issue, tree…), an SSH remote, or "owner/name". */
export function parseRepoLink(raw: string): RepoRef | null {
  const s = (raw || "").trim();
  const m =
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#].*)?$/i.exec(s) ||
    /^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i.exec(s) ||
    /^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(s);
  if (!m) return null;
  const [owner, name] = [m[1], m[2]];
  if (!owner || !name) return null;
  return { owner, name, fullName: `${owner}/${name}` };
}

export type PlanTicket = {
  issue: number;
  key?: string;
  title?: string;
  size?: string;
  dependsOn?: Array<number | string>;
  criteria?: string[];
};

export type EpicPlan = {
  id: string;
  title?: string;
  hash?: string;
  prototype?: { branch: string; commit: string; path: string };
  waves: Array<{ wave: number; tickets: PlanTicket[] }>;
};

const PLAN_BLOCK = /^##\s+Plan\s*$[\s\S]*?^```json\s*$([\s\S]*?)^```\s*$/m;

/** The plan new-ba writes under "## Plan" in the epic body; null when absent or unusable. */
export function parseEpicPlan(body: string | null | undefined): EpicPlan | null {
  const m = PLAN_BLOCK.exec(body || "");
  if (!m) return null;
  try {
    const plan = JSON.parse(m[1]) as EpicPlan;
    if (!plan || typeof plan.id !== "string" || !Array.isArray(plan.waves)) return null;
    return plan;
  } catch {
    return null;
  }
}

/** "- **C15** text" lines of a ticket body. */
export function parseCriteriaFromBody(body: string | null | undefined): IssueCriterion[] {
  const out: IssueCriterion[] = [];
  for (const line of (body || "").split(/\r?\n/)) {
    const m = /^\s*[-*]\s+\*\*(C\d+)\*\*\s*[:.\-–]?\s*(.+)$/.exec(line);
    if (m && !out.some((c) => c.id === m[1])) out.push({ id: m[1], text: m[2].trim() });
  }
  return out;
}

export type FactoryCommit = {
  type: "merge" | "revert";
  issue: number;
  title: string | null;
  runId: string | null;
};

/** A merge or revert commit new-factory makes on staging; null for any other commit. */
export function parseFactoryCommit(message: string | null | undefined): FactoryCommit | null {
  const text = message || "";
  const head = /^factory: (merge|revert) #(\d+)(?:\s+(.*))?$/m.exec(text.split("\n")[0] || "");
  if (!head) return null;
  const run = /^nf-run:\s*(\S+)/m.exec(text);
  return {
    type: head[1] as FactoryCommit["type"],
    issue: Number(head[2]),
    title: head[1] === "merge" ? (head[3] || "").trim() || null : null,
    runId: run ? run[1] : null,
  };
}

export type FactoryComment = { runId: string; kind: string; issue: number | null };

/** The marker new-factory puts on its comments: <!-- new-factory:<run>:<key> -->. */
export function parseFactoryComment(body: string | null | undefined): FactoryComment | null {
  const m = /<!--\s*new-factory:([^:\s]+):([\w-]+)((?::[\w-]+)*)\s*-->/.exec(body || "");
  if (!m) return null;
  const rest = m[3].split(":").filter(Boolean);
  const issue = m[2] === "needs-decision" && /^\d+$/.test(rest[0] || "") ? Number(rest[0]) : null;
  return { runId: m[1], kind: m[2], issue };
}

export type GithubTicketFacts = {
  state: string;
  labels: string[];
  merged: boolean;
  reverted: boolean;
};

const LIVE_STATUSES = new Set(["in_progress", "blocked", "failed"]);

/**
 * The board status GitHub implies for a ticket. A merge on staging that was not reverted
 * is passed; the needs-decision label waits on a person; a status the daemon reported
 * live (in progress, blocked, failed) stays while GitHub has nothing newer to say.
 */
export function deriveTicketStatus(
  facts: GithubTicketFacts,
  current: string | null | undefined,
): TicketBoardStatus {
  if (facts.merged && !facts.reverted) return "passed";
  if (facts.labels.includes("needs-decision")) return "needs_human";
  if (facts.state === "closed") return "passed";
  if (current && LIVE_STATUSES.has(current)) return current as TicketBoardStatus;
  return "ready";
}

export type GithubIssueLite = {
  number: number;
  title: string;
  body: string;
  state: string;
  labels: string[];
  url: string;
};

/** The epic's tickets as the board stores them: the plan joined with each issue and its merge. */
export function ticketsFromPlan(
  plan: EpicPlan,
  issues: Map<number, GithubIssueLite>,
  merges: Map<number, { merged: boolean; reverted: boolean }>,
  currentStatus: Map<number, string>,
): SyncTicket[] {
  const out: SyncTicket[] = [];
  for (const wave of plan.waves) {
    for (const t of wave.tickets || []) {
      if (!Number.isInteger(t.issue) || t.issue <= 0) continue;
      const issue = issues.get(t.issue);
      const merge = merges.get(t.issue) ?? { merged: false, reverted: false };
      const status = deriveTicketStatus(
        { state: issue?.state ?? "open", labels: issue?.labels ?? [], merged: merge.merged, reverted: merge.reverted },
        currentStatus.get(t.issue),
      );
      const size = typeof t.size === "string" && /^(XS|S|M|L)$/.test(t.size) ? t.size : undefined;
      out.push({
        number: t.issue,
        key: t.key,
        title: issue?.title || t.title,
        url: issue?.url,
        body: issue?.body,
        criteria: issue ? parseCriteriaFromBody(issue.body) : undefined,
        size,
        wave: wave.wave,
        dependsOn: (t.dependsOn || [])
          .filter((d): d is number => typeof d === "number")
          .map((d) => `#${d}`),
        status,
        statusGiven: true,
      });
    }
  }
  return out;
}

/** The folder of a prototype branch that holds prototype.json and index.html ("" for the root). */
export function findPrototypeFolder(paths: string[]): string | null {
  const set = new Set(paths);
  const candidates = paths
    .filter((p) => p === "prototype.json" || p.endsWith("/prototype.json"))
    .map((p) => p.slice(0, -"prototype.json".length))
    .filter((dir) => set.has(`${dir}index.html`))
    .sort((a, b) => a.length - b.length);
  return candidates[0] ?? null;
}

/** GitHub's X-Hub-Signature-256 check for a webhook delivery. */
export function verifyWebhookSignature(secret: string, rawBody: string, header: string | null | undefined): boolean {
  if (!secret || !header || !header.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const given = Buffer.from(header.slice("sha256=".length), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export type LinkedPullRequest = { number: number; url: string; state: "open" | "closed" | "merged" };

type TimelineEvent = {
  event?: string;
  created_at?: string;
  source?: { issue?: { number?: number; html_url?: string; state?: string; pull_request?: { merged_at?: string | null } } };
};

/** The newest pull request that references an issue, from the issue's timeline. */
export function linkedPullRequest(events: TimelineEvent[]): LinkedPullRequest | null {
  let best: { at: string; pr: LinkedPullRequest } | null = null;
  for (const e of events) {
    const src = e.source?.issue;
    if (e.event !== "cross-referenced" || !src?.pull_request || !src.number || !src.html_url) continue;
    const state = src.pull_request.merged_at ? "merged" : src.state === "closed" ? "closed" : "open";
    const at = e.created_at || "";
    if (!best || at >= best.at) best = { at, pr: { number: src.number, url: src.html_url, state } };
  }
  return best?.pr ?? null;
}

/** Issues a pull request closes through GitHub's keywords ("Closes #12", "fixes #13"…). */
export function issuesClosedByPullRequest(title: string | null | undefined, body: string | null | undefined): number[] {
  const out: number[] = [];
  const re = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d+)/gi;
  for (const m of `${title || ""}\n${body || ""}`.matchAll(re)) {
    const n = Number(m[1]);
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

/** The repository a text names: `--repo owner/name`, or a github.com/owner/name link. */
export function findRepoInText(text: string | null | undefined): RepoRef | null {
  const s = text || "";
  const flag = /--repo[=\s]+([\w.-]+\/[\w.-]+)/.exec(s);
  if (flag) return parseRepoLink(flag[1]);
  const link = /github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?=[/\s)"'`#?]|$)/i.exec(s);
  return link ? parseRepoLink(`${link[1]}/${link[2]}`) : null;
}

/** Issue numbers of one repository linked from a text, first-seen order. */
export function findIssueNumbers(text: string | null | undefined, repoFullName: string): number[] {
  const out: number[] = [];
  const re = /github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)/gi;
  for (const m of (text || "").matchAll(re)) {
    if (m[1].toLowerCase() !== repoFullName.toLowerCase()) continue;
    const n = Number(m[2]);
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

/** A URL GitHub cannot deliver a webhook to: loopback, private LAN ranges, mDNS names. */
export function isUnreachableUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return true;
  }
  if (host === "localhost" || host === "::1" || host === "0.0.0.0" || host.endsWith(".local")) return true;
  const ip = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(host);
  if (!ip) return false;
  const [a, b] = [Number(ip[1]), Number(ip[2])];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

type RepoEvent = { type?: string; created_at?: string; payload?: Record<string, unknown> };

const EVENT_NAMES: Record<string, string> = {
  IssuesEvent: "issues",
  IssueCommentEvent: "issue_comment",
  PullRequestEvent: "pull_request",
  CreateEvent: "create",
  PushEvent: "push",
};

/**
 * The webhook delivery a repository event (GET /repos/{r}/events) stands for, so a polled
 * repository goes through the same handler as a webhook. Null for events tracking ignores.
 */
export function repoEventToDelivery(e: RepoEvent): { event: string; payload: Record<string, unknown> } | null {
  const event = e.type ? EVENT_NAMES[e.type] : undefined;
  if (!event || !e.payload) return null;
  if (event !== "push") return { event, payload: e.payload };
  const commits = Array.isArray(e.payload.commits) ? (e.payload.commits as Array<{ sha?: string; message?: string }>) : [];
  return {
    event,
    payload: {
      ...e.payload,
      commits: commits.map((c) => ({ id: c.sha ?? "", message: c.message ?? "", timestamp: e.created_at ?? "" })),
    },
  };
}
