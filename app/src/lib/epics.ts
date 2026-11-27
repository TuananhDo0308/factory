// Pure helpers for factory v2 epics and tickets (no imports, so node --test can load this file).

export type IssueCriterion = { id: string; text: string };

/** Kanban statuses a v2 ticket can be in (`ProjectIssue.status`). */
export type TicketBoardStatus = "ready" | "in_progress" | "blocked" | "needs_human" | "passed" | "failed";

/**
 * Maps a new-factory ticket status (`state.json` `tickets[].status`) to `ProjectIssue.status`.
 * Unknown values fall back to `ready`, like an absent one.
 */
export function mapTicketStatus(raw: unknown): TicketBoardStatus {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  switch (s) {
    case "running":
    case "reopened":
      return "in_progress";
    case "waiting":
    case "blocked":
      return "blocked";
    case "needs-decision":
    case "needs_decision":
      return "needs_human";
    case "merged":
      return "passed";
    case "failed":
      return "failed";
    default:
      return "ready";
  }
}

/** `ProjectIssue.issueKey` of a v2 ticket. */
export function ticketIssueKey(number: number): string {
  return `#${number}`;
}

/** `ProjectIssue.issueKey` of a v2 epic. */
export function epicIssueKey(number: number): string {
  return `epic-${number}`;
}

/** Reads the GitHub issue number back from a ticket key (`#42`). */
export function ticketNumberFromKey(issueKey: string | null | undefined): number | null {
  const m = /^#(\d+)$/.exec((issueKey || "").trim());
  return m ? Number(m[1]) : null;
}

/** Reads the epic number back from an epic key (`epic-41`). */
export function epicNumberFromKey(issueKey: string | null | undefined): number | null {
  const m = /^epic-(\d+)$/i.exec((issueKey || "").trim());
  return m ? Number(m[1]) : null;
}

/**
 * The status of the epic row, from its tickets and whether a run of it is active.
 * - no tickets: `ready`
 * - all merged: `passed`
 * - a run is active: `in_progress`
 * - any ticket needs a decision: `needs_human`
 * - any ticket failed / blocked after a run: `blocked`
 * - otherwise (nothing ran yet, or some merged and the rest ready): `ready`, or `in_progress` when part is done.
 */
export function deriveEpicStatus(ticketStatuses: string[], runActive: boolean): string {
  if (ticketStatuses.length === 0) return runActive ? "in_progress" : "ready";
  if (ticketStatuses.every((s) => s === "passed")) return "passed";
  if (runActive) return "in_progress";
  if (ticketStatuses.some((s) => s === "needs_human")) return "needs_human";
  if (ticketStatuses.some((s) => s === "failed" || s === "blocked")) return "blocked";
  if (ticketStatuses.some((s) => s === "in_progress")) return "in_progress";
  return "ready";
}

/** The ticket an epic-run agent works on, from its record id (`003-implementer-12`) or name (`#12 implementer · build`). */
export function ticketOfAgent(agentKey: string | null | undefined, name?: string | null): number | null {
  const fromName = /#(\d+)/.exec(name || "");
  if (fromName) return Number(fromName[1]);
  const fromKey = /-(\d+)$/.exec((agentKey || "").trim());
  if (fromKey && /^\d+-[a-z]+-\d+$/i.test((agentKey || "").trim())) return Number(fromKey[1]);
  return null;
}

/** Parses `owner/name` from a GitHub URL or full name; null when it is neither. */
export function repoFullName(input: { githubFullName?: string | null; githubUrl?: string | null }): string | null {
  const full = (input.githubFullName || "").trim();
  if (/^[\w.-]+\/[\w.-]+$/.test(full)) return full;
  const m = /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec((input.githubUrl || "").trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

export function normalizeCriteria(raw: unknown): IssueCriterion[] {
  const fromLine = (line: string, idx: number): IssueCriterion | null => {
    const trimmed = line.trim();
    if (!trimmed) return null;
    const m = /^(C\d+)\s*[:.\-–]\s*(.+)$/i.exec(trimmed);
    return m ? { id: m[1].toUpperCase(), text: m[2].trim() } : { id: `C${idx + 1}`, text: trimmed };
  };
  if (typeof raw === "string") {
    return raw
      .split(/\r?\n/)
      .map(fromLine)
      .filter((c): c is IssueCriterion => c !== null);
  }
  if (!Array.isArray(raw)) return [];
  const out: IssueCriterion[] = [];
  raw.forEach((item, idx) => {
    if (typeof item === "string") {
      const c = fromLine(item, idx);
      if (c) out.push(c);
      return;
    }
    if (typeof item === "object" && item !== null) {
      const obj = item as Record<string, unknown>;
      const textRaw = obj.text ?? obj.criterion ?? obj.description;
      const text = typeof textRaw === "string" ? textRaw.trim() : "";
      if (!text) return;
      const id = typeof obj.id === "string" && obj.id.trim() ? obj.id.trim().toUpperCase() : `C${idx + 1}`;
      out.push({ id, text });
    }
  });
  return out;
}

export function normalizeDependsOn(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,\s]+/) : [];
  const out: string[] = [];
  for (const item of list) {
    const key =
      typeof item === "number" && Number.isFinite(item)
        ? ticketIssueKey(Math.round(item))
        : typeof item === "string"
          ? /^\d+$/.test(item.trim())
            ? ticketIssueKey(Number(item.trim()))
            : item.trim()
          : "";
    if (key && !out.includes(key)) out.push(key);
  }
  return out;
}

const PRIORITIES = new Set(["P0", "P1", "P2", "P3"]);
const SIZES = new Set(["XS", "S", "M", "L"]);
const STATUSES = new Set(["backlog", "ready", "needs_human", "in_progress", "in_review", "passed", "failed", "blocked"]);

export function normalizePriority(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  return PRIORITIES.has(s) ? s : "P2";
}

export function normalizeSize(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  return SIZES.has(s) ? s : null;
}

export function normalizeIssueStatus(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return STATUSES.has(s) ? s : null;
}

/** A ticket as `POST /api/v1/epics/sync` receives it, normalised. Every field but `number` is optional. */
export type SyncTicket = {
  number: number;
  key?: string;
  title?: string;
  url?: string;
  body?: string;
  criteria?: IssueCriterion[];
  size?: string;
  wave?: number;
  dependsOn?: string[];
  status: TicketBoardStatus;
  statusGiven: boolean;
  rounds?: number;
  decision?: { question: string; reason: string };
};

function intOrUndefined(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return Number(v.trim());
  return undefined;
}

function strOrUndefined(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** Normalises one ticket of an epics/sync body; null when it has no usable `number`. */
export function parseSyncTicket(raw: unknown): SyncTicket | null {
  if (typeof raw !== "object" || raw === null) return null;
  const rec = raw as Record<string, unknown>;
  const number = intOrUndefined(rec.number);
  if (!number || number <= 0) return null;
  const statusGiven = typeof rec.status === "string" && rec.status.trim() !== "";
  const decisionRaw = rec.decision as Record<string, unknown> | null | undefined;
  const decision =
    decisionRaw && typeof decisionRaw === "object"
      ? {
          question: strOrUndefined(decisionRaw.question) ?? "",
          reason: strOrUndefined(decisionRaw.reason) ?? "",
        }
      : undefined;
  return {
    number,
    key: strOrUndefined(rec.key),
    title: strOrUndefined(rec.title),
    url: strOrUndefined(rec.url),
    body: typeof rec.body === "string" ? rec.body : undefined,
    criteria: rec.criteria !== undefined ? normalizeCriteria(rec.criteria) : undefined,
    size: normalizeSize(rec.size) ?? undefined,
    wave: intOrUndefined(rec.wave),
    dependsOn: rec.dependsOn !== undefined ? normalizeDependsOn(rec.dependsOn) : undefined,
    status: mapTicketStatus(rec.status),
    statusGiven,
    rounds: intOrUndefined(rec.rounds),
    decision: decision && (decision.question || decision.reason) ? decision : undefined,
  };
}

/** Phases of an epic run, in order (new-factory's design steps as the daemon reports them). */
export const EPIC_PHASES = ["Plan", "Prepare", "Build", "Final", "Report"] as const;

/** Step `data.kind` values the run page shows. */
export type StepKind =
  | "tool_call"
  | "assistant_message"
  | "turn_metrics"
  | "lifecycle"
  | "ticket"
  | "alarm"
  | "epic";

/** Index of a phase in EPIC_PHASES (case-insensitive); 0 when unknown. */
export function epicPhaseIndex(phase: string | null | undefined): number {
  const p = (phase || "").trim().toLowerCase();
  const idx = EPIC_PHASES.findIndex((x) => x.toLowerCase() === p);
  return idx >= 0 ? idx : 0;
}

type UsageAgent = {
  agentKey: string;
  name: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
};

/**
 * Groups an epic run's agents by the ticket they work on and sums each group's recorded usage.
 * Agents of no ticket (QC, …) form the `ticket: null` group, listed last. The groups' sums add up
 * to the agents' totals; they are never added to the run's own totals (that would count twice).
 */
export function summarizeAgentsByTicket<A extends UsageAgent>(
  agents: A[],
): Array<{
  ticket: number | null;
  agents: A[];
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
}> {
  const map = new Map<number | null, A[]>();
  for (const a of agents) {
    const t = ticketOfAgent(a.agentKey, a.name);
    const list = map.get(t) ?? [];
    list.push(a);
    map.set(t, list);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a - b))
    .map(([ticket, list]) => ({
      ticket,
      agents: list,
      inputTokens: list.reduce((s, a) => s + a.inputTokens, 0),
      outputTokens: list.reduce((s, a) => s + a.outputTokens, 0),
      cacheReadTokens: list.reduce((s, a) => s + a.cacheReadTokens, 0),
      costUsd: list.reduce((s, a) => s + a.costUsd, 0),
    }));
}
