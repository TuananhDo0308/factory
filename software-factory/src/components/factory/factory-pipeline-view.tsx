"use client";

import * as React from "react";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleDashedIcon,
  ExternalLinkIcon,
  FileCodeIcon,
  GitPullRequestIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SparklesIcon,
  TerminalIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  formatClockDuration,
  formatCompactTokens,
  formatRelativeTime,
  formatUsd,
  StatusDot,
} from "@/components/factory/factory-primitives";
import {
  SingleRunSpiderCard,
  type RunSpiderInput,
} from "@/components/factory/run-spider-chart";
import { formatModelLabel } from "@/lib/models";
import type { RunDetailData } from "@/lib/workspace-data";

type CheckpointSnapshot = {
  phase?: string;
  outcome?: string;
  agentsCount?: number;
  repairRounds?: number;
  maxRepairRounds?: number;
  check?: { text?: string; state?: string } | null;
  review?: Array<{ tag?: string; text?: string; state?: string; label?: string }>;
  repairs?: Array<{ round?: number; specs?: string[]; reason?: string }>;
  flaky?: string[];
  tddUnproven?: string[];
  seconds?: number;
};

type StepStatus = "done" | "running" | "failed" | "waiting";
type PhaseKey = "spec" | "build" | "check" | "review" | "other";

const PHASE_META: Record<PhaseKey, { label: string; color: string; bgTint: string }> = {
  spec: {
    label: "Spec",
    color: "var(--phase-spec)",
    bgTint: "color-mix(in srgb, var(--phase-spec) 16%, transparent)",
  },
  build: {
    label: "Build",
    color: "var(--phase-build)",
    bgTint: "color-mix(in srgb, var(--phase-build) 16%, transparent)",
  },
  check: {
    label: "Check",
    color: "var(--phase-check)",
    bgTint: "color-mix(in srgb, var(--phase-check) 16%, transparent)",
  },
  review: {
    label: "Review",
    color: "var(--phase-review)",
    bgTint: "color-mix(in srgb, var(--phase-review) 16%, transparent)",
  },
  other: {
    label: "Orchestrator",
    color: "var(--muted-foreground)",
    bgTint: "color-mix(in srgb, var(--muted-foreground) 16%, transparent)",
  },
};

const ROLE_META: Record<string, { label: string; phase: PhaseKey }> = {
  orchestrator: { label: "Orchestrator", phase: "other" },
  planner: { label: "Planner", phase: "spec" },
  implementer: { label: "Implementer", phase: "build" },
  qa: { label: "QA", phase: "build" },
  checker: { label: "Checker", phase: "check" },
  reviewer: { label: "Reviewer", phase: "review" },
  "spec-reviewer": { label: "Spec reviewer", phase: "review" },
  qc: { label: "QC", phase: "review" },
};

const PIPELINE_STAGES = [
  { id: "Spec", num: 1, title: "Spec", subtitle: "Planner breaks contract" },
  { id: "Build", num: 2, title: "Build & QA", subtitle: "TDD code + QA per spec" },
  { id: "Check", num: 3, title: "Check", subtitle: "Build, lint & test suite" },
  { id: "Review", num: 4, title: "Review & QC", subtitle: "Code review + live QC" },
  { id: "Verdict", num: 5, title: "Verdict", subtitle: "Gate evaluation & PR" },
] as const;

type StageId = (typeof PIPELINE_STAGES)[number]["id"];

function normalizeStage(phase: string | null | undefined): StageId {
  const p = (phase || "").toLowerCase();
  if (p.includes("verdict") || p.includes("merge") || p.includes("done")) return "Verdict";
  if (p.includes("review") || p.includes("qc")) return "Review";
  if (p.includes("check")) return "Check";
  if (p.includes("build") || p.includes("qa") || p.includes("repair")) return "Build";
  return "Spec";
}

function phaseForRole(role: string | null | undefined): PhaseKey {
  return ROLE_META[(role || "").toLowerCase()]?.phase ?? "other";
}

function labelForRole(role: string | null | undefined): string {
  const key = (role || "").toLowerCase();
  return ROLE_META[key]?.label ?? (role || "Other");
}

function formatShortSec(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function formatOffset(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s === 0) return "+0s";
  if (s < 60) return `+${s}s`;
  return `+${Math.floor(s / 60)}m ${s % 60}s`;
}

function shortActivity(text: string | null | undefined): string {
  if (!text) return "–";
  const cleaned = text.replace(/\s+/g, " ").trim();
  const colonIdx = cleaned.indexOf(":");
  if (colonIdx > 0 && colonIdx < 24) {
    const tool = cleaned.slice(0, colonIdx).trim();
    const rest = cleaned.slice(colonIdx + 1).trim();
    const seg = rest.split("/").pop() || rest;
    return `${tool}: ${seg.length > 34 ? `${seg.slice(0, 33)}…` : seg}`;
  }
  return cleaned.length > 44 ? `${cleaned.slice(0, 43)}…` : cleaned;
}

// ============================================================================
// Interactive Gantt Timeline (XFB /runs/$runId style)
// ============================================================================

interface GanttRow {
  id: string;
  name: string;
  role: string;
  phase: PhaseKey;
  leftPct: number;
  widthPct: number;
  offsetText: string;
  durationText: string;
  costUsd: number;
  status: string;
}

interface GanttGroup {
  phase: PhaseKey;
  label: string;
  color: string;
  bgTint: string;
  rows: GanttRow[];
  leftPct: number;
  widthPct: number;
  spanMs: number;
  costUsd: number;
  isLead: boolean;
}

function buildGanttGroups(run: RunDetailData, elapsedMs: number): {
  groups: GanttGroup[];
  axisMs: number;
  ticks: Array<{ left: number; label: string }>;
} {
  // Derive true execution spans from recorded step timestamps so backfill/sync ticks
  // never stretch completed agents across the entire run duration.
  const stepBoundsByAgentId = new Map<string, { minStart: number; maxEnd: number }>();
  const stepBoundsByAgentKey = new Map<string, { minStart: number; maxEnd: number }>();
  for (const s of run.steps) {
    const t = new Date(s.createdAt).getTime();
    if (!Number.isFinite(t)) continue;
    const endT = t + Math.max(0, s.durationMs ?? 0);
    if (s.runAgentId) {
      const prev = stepBoundsByAgentId.get(s.runAgentId);
      if (!prev) {
        stepBoundsByAgentId.set(s.runAgentId, { minStart: t, maxEnd: endT });
      } else {
        if (t < prev.minStart) prev.minStart = t;
        if (endT > prev.maxEnd) prev.maxEnd = endT;
      }
    }
    if (s.agentId) {
      const prev = stepBoundsByAgentKey.get(s.agentId);
      if (!prev) {
        stepBoundsByAgentKey.set(s.agentId, { minStart: t, maxEnd: endT });
      } else {
        if (t < prev.minStart) prev.minStart = t;
        if (endT > prev.maxEnd) prev.maxEnd = endT;
      }
    }
  }

  const runStartRaw = new Date(run.startedAt).getTime();
  const nowApprox = runStartRaw + Math.max(elapsedMs, 1000);

  const resolvedSpans = run.agents.map((ag) => {
    const stepBounds =
      stepBoundsByAgentId.get(ag.id) ?? stepBoundsByAgentKey.get(ag.agentKey) ?? null;
    const fallbackStart = new Date(ag.startedAt).getTime();
    const fallbackEnd = ag.finishedAt
      ? new Date(ag.finishedAt).getTime()
      : ag.status === "working"
        ? Math.max(nowApprox, new Date(ag.updatedAt).getTime())
        : new Date(ag.updatedAt).getTime();

    const start = stepBounds
      ? stepBounds.minStart
      : Number.isFinite(fallbackStart)
        ? fallbackStart
        : runStartRaw;
    const end = stepBounds
      ? ag.status === "working"
        ? Math.max(nowApprox, stepBounds.maxEnd)
        : Math.max(stepBounds.minStart, stepBounds.maxEnd)
      : Math.max(start, Number.isFinite(fallbackEnd) ? fallbackEnd : start);

    return { ag, start, end };
  });

  const subStarts = resolvedSpans
    .filter((r) => r.ag.role !== "orchestrator")
    .map((r) => r.start)
    .filter((t) => Number.isFinite(t));
  const allStarts = resolvedSpans.map((r) => r.start).filter((t) => Number.isFinite(t));

  // Anchor timeline to subagent start window when subagents exist so bars fill the axis cleanly.
  const earliestStart =
    subStarts.length > 0
      ? Math.min(...subStarts)
      : allStarts.length > 0
        ? Math.min(...allStarts)
        : runStartRaw;

  const latestEnd = Math.max(
    earliestStart + 1000,
    ...resolvedSpans.map((r) => r.end).filter((t) => Number.isFinite(t)),
  );
  const axisMs = Math.max(1000, latestEnd - earliestStart);

  const byPhase = new Map<PhaseKey, GanttRow[]>();
  const phaseSpans = new Map<PhaseKey, { minStart: number; maxEnd: number; cost: number }>();

  for (const { ag, start, end } of resolvedSpans) {
    const ph = phaseForRole(ag.role);
    const agStart = Math.max(earliestStart, start);
    const agEnd = Math.max(agStart, end);
    const leftPct = Math.max(0, Math.min(98.5, ((agStart - earliestStart) / axisMs) * 100));
    const rawWidth = ((agEnd - agStart) / axisMs) * 100;
    const widthPct = Math.max(1.5, Math.min(100 - leftPct, rawWidth));

    const row: GanttRow = {
      id: ag.id,
      name: ag.name,
      role: labelForRole(ag.role),
      phase: ph,
      leftPct,
      widthPct,
      offsetText: formatOffset(agStart - earliestStart),
      durationText: formatShortSec(agEnd - agStart),
      costUsd: ag.costUsd,
      status: ag.status,
    };

    const list = byPhase.get(ph) ?? [];
    list.push(row);
    byPhase.set(ph, list);

    const prev = phaseSpans.get(ph);
    if (!prev) {
      phaseSpans.set(ph, { minStart: agStart, maxEnd: agEnd, cost: ag.costUsd });
    } else {
      prev.minStart = Math.min(prev.minStart, agStart);
      prev.maxEnd = Math.max(prev.maxEnd, agEnd);
      prev.cost += ag.costUsd;
    }
  }

  const order: PhaseKey[] = ["spec", "build", "check", "review", "other"];
  let maxCost = 0;
  let leadPhase: PhaseKey | null = null;
  for (const ph of order) {
    const sp = phaseSpans.get(ph);
    if (sp && sp.cost > maxCost) {
      maxCost = sp.cost;
      leadPhase = ph;
    }
  }

  const groups: GanttGroup[] = [];
  for (const ph of order) {
    const rows = byPhase.get(ph);
    const sp = phaseSpans.get(ph);
    if (!rows || !sp) continue;
    const leftPct = Math.max(0, ((sp.minStart - earliestStart) / axisMs) * 100);
    const widthPct = Math.max(
      1.5,
      Math.min(100 - leftPct, ((sp.maxEnd - sp.minStart) / axisMs) * 100),
    );
    groups.push({
      phase: ph,
      label: PHASE_META[ph].label,
      color: PHASE_META[ph].color,
      bgTint: PHASE_META[ph].bgTint,
      rows,
      leftPct,
      widthPct,
      spanMs: sp.maxEnd - sp.minStart,
      costUsd: sp.cost,
      isLead: ph === leadPhase && maxCost > 0,
    });
  }

  const tickCount = 3;
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => {
    const frac = i / tickCount;
    return {
      left: frac * 100,
      label: formatShortSec(frac * axisMs),
    };
  });

  return { groups, axisMs, ticks };
}

function GanttTimeline({
  run,
  elapsedMs,
  onInspectAgent,
}: {
  run: RunDetailData;
  elapsedMs: number;
  onInspectAgent: (agentId: string) => void;
}) {
  const rulerRef = React.useRef<HTMLDivElement | null>(null);
  const [scrubPct, setScrubPct] = React.useState<number | null>(null);
  const [replayKey, setReplayKey] = React.useState(0);
  const [collapsedGroups, setCollapsedGroups] = React.useState<Record<string, boolean>>({});

  const { groups, axisMs, ticks } = React.useMemo(
    () => buildGanttGroups(run, elapsedMs),
    [run, elapsedMs],
  );

  function isGroupOpen(phase: string, rowCount: number): boolean {
    if (collapsedGroups[phase] !== undefined) return !collapsedGroups[phase];
    return rowCount <= 6;
  }

  function toggleGroup(phase: string, rowCount: number) {
    const currentlyOpen = isGroupOpen(phase, rowCount);
    setCollapsedGroups((prev) => ({ ...prev, [phase]: currentlyOpen }));
  }

  function handlePointerMove(e: React.PointerEvent<HTMLTableElement>) {
    const rect = rulerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const frac = (e.clientX - rect.left) / rect.width;
    if (frac < 0 || frac > 1) {
      setScrubPct(null);
      return;
    }
    setScrubPct(Math.round(frac * 1000) / 10);
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <span className="text-xs font-medium text-muted-foreground">
          Click any agent row to inspect its transcript
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => setReplayKey((k) => k + 1)}
        >
          <RotateCcwIcon data-icon="inline-start" />
          Replay
        </Button>
      </div>

      {groups.length === 0 ? (
        <div className="px-4 py-8 text-center text-xs text-muted-foreground">
          Waiting for agent execution…
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table
            key={replayKey}
            className="w-full min-w-[640px] table-fixed border-collapse text-xs"
            onPointerMove={handlePointerMove}
            onPointerLeave={() => setScrubPct(null)}
          >
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="h-9 w-[240px] px-4 text-left font-medium">Agent</th>
                <th className="relative h-9 px-3 text-left font-medium">
                  <div ref={rulerRef} className="relative h-full w-full">
                    {ticks.map((tk, idx) => (
                      <span
                        key={`${idx}-${tk.label}`}
                        className="absolute bottom-2 whitespace-nowrap font-mono text-[11px] tabular-nums"
                        style={{
                          left: `${tk.left}%`,
                          transform:
                            tk.left === 0
                              ? "none"
                              : tk.left >= 95
                                ? "translateX(-100%)"
                                : "translateX(-50%)",
                        }}
                      >
                        {tk.label}
                      </span>
                    ))}
                    {scrubPct !== null && (
                      <span
                        className="pointer-events-none absolute top-1.5 z-10 -translate-x-1/2 rounded bg-primary px-1.5 py-0.5 font-mono text-[10px] font-medium text-primary-foreground tabular-nums"
                        style={{ left: `${Math.min(96, Math.max(4, scrubPct))}%` }}
                      >
                        {formatShortSec((scrubPct / 100) * axisMs)}
                      </span>
                    )}
                  </div>
                </th>
                <th className="h-9 w-[76px] px-3 text-right font-medium">Start</th>
                <th className="h-9 w-[80px] px-3 text-right font-medium">Duration</th>
                <th className="h-9 w-[84px] px-4 text-right font-medium">Cost</th>
              </tr>
            </thead>

            {groups.map((grp) => {
              const open = isGroupOpen(grp.phase, grp.rows.length);
              return (
                <tbody key={grp.phase} className="border-b last:border-b-0">
                  <tr
                    onClick={() => toggleGroup(grp.phase, grp.rows.length)}
                    className="cursor-pointer bg-muted/20 transition-colors hover:bg-muted/40"
                  >
                    <th className="h-9 px-4 text-left font-medium">
                      <div className="flex items-center gap-2">
                        <ChevronRightIcon
                          className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${
                            open ? "rotate-90" : ""
                          }`}
                        />
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: grp.color }}
                        />
                        <span className="truncate text-foreground">{grp.label}</span>
                        <span className="text-xs font-normal text-muted-foreground tabular-nums">
                          {grp.rows.length}
                        </span>
                      </div>
                    </th>
                    <td className="relative h-9 px-3">
                      <div className="relative h-2 w-full rounded-full bg-muted/50">
                        <div
                          className="absolute top-0 bottom-0 rounded-full"
                          style={{
                            left: `${grp.leftPct}%`,
                            width: `${grp.widthPct}%`,
                            backgroundColor: grp.bgTint,
                            border: `1px solid ${grp.color}`,
                          }}
                        />
                        {scrubPct !== null && (
                          <div
                            className="pointer-events-none absolute -top-2 -bottom-2 w-px bg-primary/70"
                            style={{ left: `${scrubPct}%` }}
                          />
                        )}
                      </div>
                    </td>
                    <td className="h-9 px-3 text-right font-mono text-xs text-muted-foreground" />
                    <td className="h-9 px-3 text-right font-mono text-xs text-muted-foreground tabular-nums">
                      {formatShortSec(grp.spanMs)}
                    </td>
                    <td
                      className={`h-9 px-4 text-right font-mono text-xs tabular-nums ${
                        grp.isLead ? "font-semibold text-foreground" : "text-muted-foreground"
                      }`}
                    >
                      {formatUsd(grp.costUsd)}
                    </td>
                  </tr>

                  {open &&
                    grp.rows.map((row) => {
                      const isLiveAtScrub =
                        scrubPct !== null &&
                        scrubPct >= row.leftPct &&
                        scrubPct <= row.leftPct + row.widthPct;
                      return (
                        <tr
                          key={row.id}
                          onClick={() => onInspectAgent(row.id)}
                          className={`cursor-pointer border-t border-border/40 transition-colors hover:bg-muted/35 ${
                            isLiveAtScrub ? "bg-primary/5" : ""
                          }`}
                        >
                          <th className="h-9 px-4 pl-9 text-left font-normal">
                            <div className="flex items-center gap-2">
                              <StatusDot status={row.status} />
                              <span className="truncate text-foreground">{row.name}</span>
                            </div>
                          </th>
                          <td className="relative h-9 px-3">
                            <div className="relative h-2 w-full rounded-full bg-muted/25">
                              <div
                                className="absolute top-0 bottom-0 rounded-full"
                                style={{
                                  left: `${row.leftPct}%`,
                                  width: `${row.widthPct}%`,
                                  backgroundColor: grp.color,
                                }}
                              />
                              {scrubPct !== null && (
                                <div
                                  className="pointer-events-none absolute -top-2 -bottom-2 w-px bg-primary/70"
                                  style={{ left: `${scrubPct}%` }}
                                />
                              )}
                            </div>
                          </td>
                          <td className="h-9 px-3 text-right font-mono text-xs text-muted-foreground tabular-nums">
                            {row.offsetText}
                          </td>
                          <td className="h-9 px-3 text-right font-mono text-xs text-foreground tabular-nums">
                            {row.durationText}
                          </td>
                          <td className="h-9 px-4 text-right font-mono text-xs text-foreground tabular-nums">
                            {formatUsd(row.costUsd)}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              );
            })}

            <tfoot>
              <tr className="border-t bg-muted/20 text-xs">
                <th className="h-9 px-4 text-left font-medium text-foreground">Total</th>
                <td
                  className="h-9 px-3 text-xs text-muted-foreground tabular-nums"
                  suppressHydrationWarning
                >
                  {new Date(run.startedAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}{" "}
                  →{" "}
                  {run.finishedAt
                    ? new Date(run.finishedAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })
                    : "live"}
                </td>
                <td className="h-9 px-3" />
                <td className="h-9 px-3 text-right font-mono font-medium text-foreground tabular-nums">
                  {formatShortSec(elapsedMs)}
                </td>
                <td className="h-9 px-4 text-right font-mono font-semibold text-foreground tabular-nums">
                  {run.engine === "antigravity" && run.costUsd > 0 ? "~" : ""}
                  {formatUsd(run.costUsd)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main FactoryPipelineView — Clear Step Tracker + Retry Monitor + Token Bench
// ============================================================================

export function FactoryPipelineView({
  run,
  elapsedMs,
  onInspectAgent,
  onOpenChat,
}: {
  run: RunDetailData;
  elapsedMs: number;
  onInspectAgent: (agentId: string) => void;
  onOpenChat?: () => void;
}) {
  const [expandedCriteria, setExpandedCriteria] = React.useState<Record<string, boolean>>({});
  const [logScope, setLogScope] = React.useState<"current" | "all">("current");
  const [activeTab, setActiveTab] = React.useState<string>(() =>
    run.status === "running" || run.status === "queued" ? "activity" : "timeline",
  );
  const liveLogRef = React.useRef<HTMLDivElement | null>(null);
  const cp = React.useMemo(
    () => (run.checkpoint ?? {}) as CheckpointSnapshot,
    [run.checkpoint],
  );
  const specs = run.specs ?? [];
  const reviewRows = React.useMemo(
    () => (Array.isArray(cp.review) ? cp.review : []),
    [cp.review],
  );
  const checkInfo = cp.check ?? null;
  const repairsList = React.useMemo(
    () => (Array.isArray(cp.repairs) ? cp.repairs : []),
    [cp.repairs],
  );
  const flakyList = Array.isArray(cp.flaky) ? cp.flaky : [];
  const maxRepairRounds = typeof cp.maxRepairRounds === "number" ? cp.maxRepairRounds : 2;

  // Detect retries / repair rounds from checkpoint, steps, and failureLog
  const maxStepRound = run.steps.reduce(
    (max, s) => (typeof s.round === "number" && s.round > max ? s.round : max),
    0,
  );
  const repairRounds = Math.max(
    typeof cp.repairRounds === "number" ? cp.repairRounds : 0,
    repairsList.length,
    maxStepRound > 1 ? maxStepRound - 1 : 0,
  );
  const sentBackSpecs = React.useMemo(() => {
    const set = new Set<string>();
    for (const r of repairsList) {
      for (const sid of r.specs ?? []) set.add(sid);
    }
    for (const f of run.failureLog) {
      if (f.sentBack) {
        for (const sid of f.specs ?? []) set.add(sid);
      }
    }
    for (const s of run.steps) {
      if (s.spec && ((s.round && s.round > 1) || /rebuild|retry|repair/i.test(s.label || s.step))) {
        set.add(s.spec);
      }
    }
    return set;
  }, [repairsList, run.failureLog, run.steps]);

  const isRetryingNow =
    (run.status === "running" || run.status === "queued") &&
    (repairRounds > 0 ||
      /repair|retry|rebuild/i.test(run.currentPhase) ||
      run.agents.some(
        (a) =>
          a.status === "working" && /rebuild|retry|repair/i.test(`${a.name} ${a.activity || ""}`),
      ));
  const hasAnyRetry = repairRounds > 0 || sentBackSpecs.size > 0 || flakyList.length > 0;

  // Token & cost telemetry
  const totalTokens = run.inputTokens + run.outputTokens + run.cacheReadTokens;
  const cacheBase = run.inputTokens + run.cacheReadTokens;
  const cacheHitPct = cacheBase > 0 ? Math.round((run.cacheReadTokens / cacheBase) * 100) : 0;

  const metCriteria = run.criteria.filter((c) => c.status === "met").length;
  const totalCriteria = run.criteria.length;

  const subagents = React.useMemo(
    () => run.agents.filter((a) => a.role !== "orchestrator"),
    [run.agents],
  );
  const workingSubagents = React.useMemo(
    () => subagents.filter((a) => a.status === "working"),
    [subagents],
  );
  const passedSubagents = subagents.filter((a) => a.status === "passed").length;
  const totalTrackedAgents = subagents.length > 0 ? subagents.length : run.agents.length;
  const activeAgent = React.useMemo(
    () => workingSubagents[0] ?? run.agents.find((a) => a.status === "working") ?? null,
    [workingSubagents, run.agents],
  );

  const curStage = normalizeStage(run.currentPhase);
  const curStageIdx = PIPELINE_STAGES.findIndex((s) => s.id === curStage);
  const isStopped =
    run.status === "failed" ||
    run.status === "blocked" ||
    run.status === "stalled" ||
    run.status === "cancelled";
  const isPassed = run.status === "passed";

  function stageStatus(stageId: StageId): StepStatus {
    if (isPassed) return "done";
    const idx = PIPELINE_STAGES.findIndex((s) => s.id === stageId);
    if (stageId === "Check" && checkInfo?.state === "ok") return "done";
    if (stageId === "Check" && checkInfo?.state === "fail") return "failed";
    if (idx < curStageIdx) return "done";
    if (idx === curStageIdx) return isStopped ? "failed" : "running";
    return "waiting";
  }

  // Match agents to specs so clicking Impl/QA pills jumps directly to that agent
  const agentByKey = React.useMemo(() => {
    const map = new Map<string, RunDetailData["agents"][number]>();
    for (const a of run.agents) {
      map.set(a.agentKey.toLowerCase(), a);
      if (a.specId) {
        const suffix = a.role === "qa" ? "qa" : a.role === "implementer" ? "impl" : a.role;
        map.set(`${a.specId.toLowerCase()}-${suffix}`, a);
      }
    }
    return map;
  }, [run.agents]);

  // Role breakdown table (XFB Vu: Role | Agents | Input | Output | Cache read | Total | Cost | % of cost)
  const roleBreakdown = React.useMemo(() => {
    const map = new Map<
      string,
      {
        roleKey: string;
        label: string;
        phase: PhaseKey;
        agents: number;
        input: number;
        output: number;
        cacheRead: number;
        cost: number;
      }
    >();

    for (const ag of run.agents) {
      const key = (ag.role || "other").toLowerCase();
      const prev = map.get(key) ?? {
        roleKey: key,
        label: labelForRole(key),
        phase: phaseForRole(key),
        agents: 0,
        input: 0,
        output: 0,
        cacheRead: 0,
        cost: 0,
      };
      prev.agents += 1;
      prev.input += ag.inputTokens;
      prev.output += ag.outputTokens;
      prev.cacheRead += ag.cacheReadTokens;
      prev.cost += ag.costUsd;
      map.set(key, prev);
    }

    const rows = Array.from(map.values()).sort((a, b) => b.cost - a.cost);
    const summedCost = rows.reduce((s, r) => s + r.cost, 0);
    const denom = summedCost > 0 ? summedCost : run.costUsd;

    return {
      rows: rows.map((r) => ({
        ...r,
        totalTokens: r.input + r.output + r.cacheRead,
        sharePct: denom > 0 ? Math.round((r.cost / denom) * 100) : 0,
      })),
      total: {
        agents: run.agents.length,
        input: rows.reduce((s, r) => s + r.input, 0) || run.inputTokens,
        output: rows.reduce((s, r) => s + r.output, 0) || run.outputTokens,
        cacheRead: rows.reduce((s, r) => s + r.cacheRead, 0) || run.cacheReadTokens,
        cost: summedCost || run.costUsd,
      },
    };
  }, [run.agents, run.costUsd, run.inputTokens, run.outputTokens, run.cacheReadTokens]);

  const phaseCostMap = React.useMemo(() => {
    const totals = new Map<PhaseKey, number>();
    for (const r of roleBreakdown.rows) {
      totals.set(r.phase, (totals.get(r.phase) ?? 0) + r.cost);
    }
    return totals;
  }, [roleBreakdown.rows]);

  // Spec completion counters for Stage 2 summary
  const doneSpecsCount = specs.filter(
    (s) => s.impl === "ok" && (s.test === "ok" || s.test === "none"),
  ).length;

  function stageSubLabel(stageId: StageId): string {
    const st = stageStatus(stageId);
    if (stageId === "Spec") {
      if (specs.length > 0) return `${specs.length} spec${specs.length === 1 ? "" : "s"} planned`;
      return st === "running" ? "Planning specs…" : "Pending";
    }
    if (stageId === "Build") {
      if (specs.length === 0) return "Waiting for specs";
      if (st === "done") return `${specs.length}/${specs.length} specs passed`;
      const activeSpecAgent = workingSubagents.find((a) => a.specId);
      if (activeSpecAgent) return `${activeSpecAgent.specId} · ${labelForRole(activeSpecAgent.role)}`;
      return `${doneSpecsCount}/${specs.length} specs done`;
    }
    if (stageId === "Check") {
      if (checkInfo?.state === "ok") return "All checks passed";
      if (checkInfo?.state === "fail") return "Check failed";
      return st === "running" ? "Running commands…" : checkInfo?.text ? shortActivity(checkInfo.text) : "Waiting";
    }
    if (stageId === "Review") {
      if (reviewRows.length > 0) {
        const ok = reviewRows.filter((r) => r.state === "ok").length;
        return `${ok}/${reviewRows.length} passed`;
      }
      return st === "running" ? "Reviewing & QC…" : "Waiting";
    }
    if (isPassed) return "Passed";
    if (isStopped) return run.status;
    return "Waiting";
  }

  function stageCost(stageId: StageId): number {
    if (stageId === "Spec") return phaseCostMap.get("spec") ?? 0;
    if (stageId === "Build") return phaseCostMap.get("build") ?? 0;
    if (stageId === "Check") return phaseCostMap.get("check") ?? 0;
    if (stageId === "Review") return phaseCostMap.get("review") ?? 0;
    return 0;
  }

  // Live Execution Log lines for the current active agent / phase (noise-filtered, auto-scrolled)
  const liveLogSteps = React.useMemo(() => {
    const agentNameById = new Map(run.agents.map((a) => [a.id, a.name]));
    const agentKeyById = new Map(run.agents.map((a) => [a.id, a.agentKey]));
    const focusAgent = workingSubagents[0] ?? activeAgent;
    const raw =
      logScope === "current" && focusAgent
        ? run.steps.filter(
            (s) =>
              s.runAgentId === focusAgent.id ||
              (s.agentId && s.agentId === focusAgent.agentKey),
          )
        : run.steps;
    const source = raw.length > 0 ? raw : run.steps;
    const cleaned = source
      .map((s) => {
        const rawLabel = (s.label || s.summary || s.step || "").replace(/\s+/g, " ").trim();
        // Filter meaningless internal sync/bookkeeping pings
        if (
          !rawLabel ||
          /^\d+\s+spec\(s\)\s*·\s*\d+\s+level\(s\)$/i.test(rawLabel) ||
          /^(update_steps|update_focus|assistant)$/i.test(rawLabel)
        ) {
          return null;
        }
        const cleanLabel = rawLabel
          .replace(/\/Users\/[^\s]+?\/\.agents\/worktrees\/[^/\s]+\/?/g, "")
          .replace(/(?:^|\s)\.?\/?\.agents\/worktrees\/[^/\s]+\/?/g, " ")
          .replace(/\/Users\/[^\s]+?\/factory-projects\/[^/\s]+\//g, "")
          .replace(/\/Users\/[^\s]+?\/\.gemini\/config\/skills\//g, "skills/")
          .replace(/^(run_command|read_file|edit_file|write_file):\s*/i, "")
          .replace(/\s+/g, " ")
          .trim();
        if (!cleanLabel) return null;
        const stepLower = s.step.toLowerCase();
        const kind: "cmd" | "file" | "think" | "other" =
          stepLower.includes("bash") || stepLower.includes("command") || /^run_command/i.test(rawLabel)
            ? "cmd"
            : stepLower.includes("read") ||
                stepLower.includes("edit") ||
                stepLower.includes("write") ||
                /^(read|edit|write)_file/i.test(rawLabel)
              ? "file"
              : stepLower.includes("think") || /^thinking/i.test(rawLabel)
                ? "think"
                : "other";
        const agentTag =
          (s.runAgentId && agentNameById.get(s.runAgentId)) ||
          (s.runAgentId && agentKeyById.get(s.runAgentId)) ||
          s.agentId ||
          "Orchestrator";
        return {
          id: s.id,
          kind,
          agentTag,
          text: cleanLabel.length > 130 ? `${cleanLabel.slice(0, 129)}…` : cleanLabel,
          status: s.status,
          durationMs: s.durationMs,
          costUsd: s.costUsd ?? 0,
          createdAt: s.createdAt,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
    return cleaned.slice(-30);
  }, [run.steps, run.agents, workingSubagents, activeAgent, logScope]);

  const lastLogId = liveLogSteps.at(-1)?.id ?? "";
  React.useEffect(() => {
    const el = liveLogRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [liveLogSteps.length, lastLogId]);

  const currentStageMeta = PIPELINE_STAGES[curStageIdx] ?? PIPELINE_STAGES[0];
  const isRunLive = run.status === "running" || run.status === "queued";

  const spiderRunInput = React.useMemo<RunSpiderInput>(() => {
    const checkState = checkInfo?.state?.toLowerCase();
    const checksPassed =
      checkState === "ok" || checkState === "pass" || checkState === "passed"
        ? true
        : checkState === "fail" || checkState === "failed"
          ? false
          : null;
    const reviewsPassed = reviewRows.filter((rv) => {
      const st = rv.state?.toLowerCase();
      return st === "ok" || st === "pass" || st === "passed";
    }).length;
    return {
      id: run.id,
      runKey: run.runKey,
      title: run.title,
      mode: run.mode,
      status: run.status,
      engine: run.engine,
      costUsd: run.costUsd,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      cacheReadTokens: run.cacheReadTokens,
      durationMs: run.durationMs ?? elapsedMs,
      waitMs: run.waitMs,
      humanInterventions: run.humanInterventions,
      interactionsCount: run.interactions.length,
      criteriaMet: metCriteria,
      criteriaTotal: totalCriteria,
      repairRounds,
      failureCount: run.failureLog.length,
      checksPassed,
      reviewsPassed,
      reviewsTotal: reviewRows.length,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      updatedAt: run.updatedAt,
    };
  }, [run, elapsedMs, metCriteria, totalCriteria, repairRounds, checkInfo, reviewRows]);

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-6 py-6">
        {/* TOP OVERVIEW STRIP — clean borderless Swiss metrics */}
        <div className="flex flex-wrap items-end justify-between gap-6 border-b pb-5">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2.5">
              {isPassed ? (
                <CheckCircle2Icon className="size-4.5 shrink-0 text-primary" />
              ) : isRunLive ? (
                <Spinner className="size-4.5 shrink-0 text-primary" />
              ) : (
                <StatusDot status={run.status} />
              )}
              <span className="text-base font-semibold tracking-tight text-foreground">
                {isPassed
                  ? "Pipeline passed"
                  : isStopped
                    ? `${run.status.charAt(0).toUpperCase() + run.status.slice(1)} in ${currentStageMeta.title}`
                    : `${currentStageMeta.title} · Step ${currentStageMeta.num} of 5`}
              </span>
              {isRetryingNow ? (
                <Badge variant="outline" className="text-warning">
                  <RefreshCwIcon className="size-3 animate-spin" />
                  Retry {Math.max(1, repairRounds)}/{maxRepairRounds}
                </Badge>
              ) : hasAnyRetry ? (
                <Badge variant="outline" className="text-warning">
                  {repairRounds} {repairRounds === 1 ? "retry" : "retries"}
                </Badge>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {activeAgent ? (
                <span className="truncate">
                  {activeAgent.name} — {shortActivity(activeAgent.activity || activeAgent.role)}
                </span>
              ) : isPassed ? (
                <span>
                  {specs.length > 0
                    ? `${specs.length} specs built and verified`
                    : `${passedSubagents} agents completed`}
                </span>
              ) : (
                <span>{stageSubLabel(currentStageMeta.id)}</span>
              )}
              {run.prUrl && (
                <>
                  <span>·</span>
                  <a
                    href={run.prUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                  >
                    <GitPullRequestIcon className="size-3.5" />
                    PR #{run.prNumber}
                    <ExternalLinkIcon className="size-3" />
                  </a>
                </>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-7">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">Elapsed</span>
              <span className="font-mono text-base font-semibold text-foreground tabular-nums">
                {formatClockDuration(elapsedMs)}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">Agents</span>
              <span className="font-mono text-base font-semibold text-foreground tabular-nums">
                {passedSubagents}/{Math.max(totalTrackedAgents, 1)}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">Tokens</span>
              <div className="flex items-baseline gap-1.5">
                <span className="font-mono text-base font-semibold text-foreground tabular-nums">
                  {formatCompactTokens(totalTokens)}
                </span>
                {cacheHitPct > 0 && (
                  <span className="text-xs font-medium text-primary tabular-nums">
                    {cacheHitPct}%
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">
                {run.engine === "antigravity" ? "Est. cost" : "Cost"}
              </span>
              <div className="flex items-baseline gap-1.5">
                <span className="font-mono text-base font-semibold text-foreground tabular-nums">
                  {run.engine === "antigravity" && run.costUsd > 0 ? "~" : ""}
                  {formatUsd(run.costUsd)}
                </span>
                {totalCriteria > 0 && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {metCriteria}/{totalCriteria}C
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* PIPELINE STEPPER + SPEC ROWS — single clean card, zero nested boxes */}
        <div className="overflow-hidden rounded-xl border bg-card">
          {/* Sleek horizontal 5-step connected stepper */}
          <div className="grid grid-cols-1 divide-y sm:grid-cols-5 sm:divide-x sm:divide-y-0">
            {PIPELINE_STAGES.map((stage) => {
              const st = stageStatus(stage.id);
              const cost = stageCost(stage.id);
              return (
                <div
                  key={stage.id}
                  className={`flex flex-col gap-1 px-4 py-3.5 transition-colors ${
                    st === "running"
                      ? "bg-primary/[0.05]"
                      : st === "failed"
                        ? "bg-destructive/[0.05]"
                        : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {st === "done" ? (
                        <CheckCircle2Icon className="size-4 shrink-0 text-primary" />
                      ) : st === "running" ? (
                        <Spinner className="size-4 shrink-0 text-primary" />
                      ) : st === "failed" ? (
                        <XCircleIcon className="size-4 shrink-0 text-destructive" />
                      ) : (
                        <CircleDashedIcon className="size-4 shrink-0 text-muted-foreground/40" />
                      )}
                      <span
                        className={`text-xs font-medium ${
                          st === "waiting" ? "text-muted-foreground" : "text-foreground"
                        }`}
                      >
                        {stage.title}
                      </span>
                    </div>
                    {cost > 0 && (
                      <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                        {formatUsd(cost)}
                      </span>
                    )}
                  </div>
                  <span
                    className={`truncate pl-6 text-xs ${
                      st === "running"
                        ? "text-primary"
                        : st === "failed"
                          ? "text-destructive"
                          : "text-muted-foreground"
                    }`}
                  >
                    {stageSubLabel(stage.id)}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Stopped / Failure / Blocked Reason Banner — always visible on Live view */}
          {isStopped && (
            <div className="flex flex-col gap-2 border-t border-destructive/25 bg-destructive/[0.06] px-4 py-3 text-xs">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-2">
                  <XCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="font-semibold capitalize text-destructive">
                      {run.status} in {run.currentPhase}
                    </span>
                    <p className="whitespace-pre-wrap break-words leading-relaxed text-foreground/90">
                      {run.summary?.trim() ||
                        run.failureLog.at(-1)?.problem ||
                        `Run ended with status "${run.status}" in ${run.currentPhase}. Open Chat to inspect the full trace.`}
                    </p>
                  </div>
                </div>
                {onOpenChat && (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    className="shrink-0"
                    onClick={onOpenChat}
                  >
                    Open Trace
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Retry & Failure Log Banner (shown when retries or failure log entries occurred) */}
          {(hasAnyRetry || run.failureLog.length > 0) && (
            <div className="flex flex-col gap-2 border-t bg-warning/5 px-4 py-2.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  {isRetryingNow ? (
                    <RefreshCwIcon className="size-3.5 shrink-0 animate-spin text-warning" />
                  ) : (
                    <AlertTriangleIcon className="size-3.5 shrink-0 text-warning" />
                  )}
                  <span className="font-medium text-foreground">
                    {hasAnyRetry
                      ? `Repair round ${Math.max(1, repairRounds)}/${maxRepairRounds}`
                      : `Failure log (${run.failureLog.length})`}
                  </span>
                  {sentBackSpecs.size > 0 && (
                    <span className="text-muted-foreground">
                      · {Array.from(sentBackSpecs).join(", ")}
                    </span>
                  )}
                </div>
                {repairsList.at(-1)?.reason && (
                  <span className="truncate text-muted-foreground">{repairsList.at(-1)!.reason}</span>
                )}
              </div>
              {run.failureLog.length > 0 && (
                <div className="flex flex-col gap-1.5 border-t border-warning/20 pt-2">
                  {run.failureLog.map((entry, idx) => (
                    <div
                      key={`${entry.stage ?? "stage"}-${entry.round ?? idx}-${idx}`}
                      className="flex items-start gap-2 text-[11px] leading-relaxed"
                    >
                      <span className="mt-0.5 shrink-0 rounded bg-warning/15 px-1.5 py-0.5 font-mono text-[10px] font-medium text-warning">
                        {[
                          entry.specs?.length ? entry.specs.join(",") : null,
                          entry.kind || entry.stage || "issue",
                          typeof entry.round === "number" ? `R${entry.round}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      <span className="min-w-0 break-words text-foreground/85">
                        {entry.problem}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Specs list directly integrated (no nested bordered card!) */}
          {specs.length > 0 && (
            <div className="border-t">
              <div className="flex items-center justify-between bg-muted/20 px-4 py-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  Specs{" "}
                  <span className="font-mono font-normal text-muted-foreground tabular-nums">
                    {doneSpecsCount}/{specs.length}
                  </span>
                </span>
                <span>Click Impl or QA to view transcript</span>
              </div>
              <div className="divide-y divide-border/60">
                {specs.map((sp) => {
                  const implAgent = agentByKey.get(`${sp.id.toLowerCase()}-impl`);
                  const qaAgent = agentByKey.get(`${sp.id.toLowerCase()}-qa`);
                  const wasRebuilt = sentBackSpecs.has(sp.id);
                  const liveNote =
                    sp.test === "run"
                      ? qaAgent?.activity || sp.testNote || "Verifying tests"
                      : sp.impl === "run"
                        ? implAgent?.activity || sp.implNote || "Implementing"
                        : sp.testNote || sp.implNote || (sp.waitFor ? `After ${sp.waitFor}` : "Queued");

                  return (
                    <div
                      key={sp.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/20"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <span className="w-7 shrink-0 font-mono text-xs font-medium text-muted-foreground">
                          {sp.id}
                        </span>
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-foreground">
                              {sp.title || "Untitled spec"}
                            </span>
                            {wasRebuilt && (
                              <Badge variant="outline" className="text-warning">
                                Retry
                              </Badge>
                            )}
                          </div>
                          <span className="truncate text-xs text-muted-foreground">
                            {shortActivity(liveNote)}
                          </span>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-1.5 text-xs">
                        <button
                          type="button"
                          disabled={!implAgent}
                          onClick={() => implAgent && onInspectAgent(implAgent.id)}
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 transition-colors ${
                            sp.impl === "ok"
                              ? "bg-muted/60 text-foreground hover:bg-muted"
                              : sp.impl === "run"
                                ? "bg-primary/12 font-medium text-primary"
                                : sp.impl === "fail"
                                  ? "bg-destructive/12 font-medium text-destructive"
                                  : "bg-muted/30 text-muted-foreground"
                          } ${implAgent ? "cursor-pointer" : "cursor-default"}`}
                        >
                          {sp.impl === "ok" ? (
                            <CheckIcon className="size-3 text-primary" />
                          ) : sp.impl === "run" ? (
                            <Spinner className="size-3" />
                          ) : sp.impl === "fail" ? (
                            <XCircleIcon className="size-3" />
                          ) : (
                            <span className="size-1.5 rounded-full bg-current opacity-40" />
                          )}
                          <span>Impl</span>
                          {implAgent && implAgent.costUsd > 0 && (
                            <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                              {formatUsd(implAgent.costUsd)}
                            </span>
                          )}
                        </button>

                        <ArrowRightIcon className="size-3 shrink-0 text-muted-foreground/35" />

                        <button
                          type="button"
                          disabled={!qaAgent}
                          onClick={() => qaAgent && onInspectAgent(qaAgent.id)}
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 transition-colors ${
                            sp.test === "ok"
                              ? "bg-muted/60 text-foreground hover:bg-muted"
                              : sp.test === "run"
                                ? "bg-primary/12 font-medium text-primary"
                                : sp.test === "fail"
                                  ? "bg-destructive/12 font-medium text-destructive"
                                  : "bg-muted/30 text-muted-foreground"
                          } ${qaAgent ? "cursor-pointer" : "cursor-default"}`}
                        >
                          {sp.test === "ok" ? (
                            <CheckIcon className="size-3 text-primary" />
                          ) : sp.test === "run" ? (
                            <Spinner className="size-3" />
                          ) : sp.test === "fail" ? (
                            <XCircleIcon className="size-3" />
                          ) : (
                            <span className="size-1.5 rounded-full bg-current opacity-40" />
                          )}
                          <span>QA</span>
                          {qaAgent && qaAgent.costUsd > 0 && (
                            <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                              {formatUsd(qaAgent.costUsd)}
                            </span>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* UNIFIED LOWER WORKSPACE — zero duplicate panels! */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col gap-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b">
            <TabsList variant="line">
              <TabsTrigger value="activity">
                Activity
                {isRunLive && <span className="ml-1.5 size-1.5 rounded-full bg-primary" />}
              </TabsTrigger>
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
              <TabsTrigger value="agents">Agents ({run.agents.length})</TabsTrigger>
              <TabsTrigger value="criteria">
                Checks &amp; Criteria
                {totalCriteria > 0 ? ` (${metCriteria}/${totalCriteria})` : ""}
              </TabsTrigger>
              <TabsTrigger value="scorecard">Scorecard</TabsTrigger>
            </TabsList>

            {onOpenChat && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="mb-1 text-muted-foreground hover:text-foreground"
                onClick={onOpenChat}
              >
                Open full transcript →
              </Button>
            )}
          </div>

          {/* TAB 1: LIVE ACTIVITY (Clean sans-serif + noise-filtered) */}
          <TabsContent value="activity">
            <div className="overflow-hidden rounded-xl border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {isRunLive ? (
                    <Spinner className="size-3.5 text-primary" />
                  ) : (
                    <StatusDot status={run.status} />
                  )}
                  <span className="font-medium text-foreground">
                    {activeAgent ? activeAgent.name : "Recent actions"}
                  </span>
                </div>

                <div className="flex items-center rounded-md border bg-background p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setLogScope("current")}
                    className={`rounded px-2.5 py-0.5 transition-colors ${
                      logScope === "current"
                        ? "bg-secondary font-medium text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Active
                  </button>
                  <button
                    type="button"
                    onClick={() => setLogScope("all")}
                    className={`rounded px-2.5 py-0.5 transition-colors ${
                      logScope === "all"
                        ? "bg-secondary font-medium text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    All ({run.steps.length})
                  </button>
                </div>
              </div>

              <div
                ref={liveLogRef}
                className="max-h-96 divide-y divide-border/50 overflow-y-auto"
              >
                {liveLogSteps.length === 0 ? (
                  <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                    Waiting for execution activity…
                  </div>
                ) : (
                  liveLogSteps.map((line) => (
                    <div
                      key={line.id}
                      className="flex items-center gap-3 px-4 py-2.5 text-xs transition-colors hover:bg-muted/25"
                    >
                      {line.kind === "cmd" ? (
                        <TerminalIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      ) : line.kind === "file" ? (
                        <FileCodeIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      ) : line.kind === "think" ? (
                        <SparklesIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <WrenchIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      )}
                      {logScope === "all" && (
                        <span className="w-32 shrink-0 truncate text-xs text-muted-foreground">
                          {line.agentTag}
                        </span>
                      )}
                      <span
                        className={`min-w-0 flex-1 truncate ${
                          line.kind === "cmd" || line.kind === "file" ? "font-mono text-xs" : "text-xs"
                        } ${
                          line.status === "failed" || line.status === "blocked"
                            ? "text-destructive"
                            : "text-foreground/90"
                        }`}
                      >
                        {line.text}
                      </span>
                      {line.costUsd > 0 && (
                        <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
                          {formatUsd(line.costUsd)}
                        </span>
                      )}
                      <span
                        className="w-12 shrink-0 text-right font-mono text-[11px] text-muted-foreground tabular-nums"
                        suppressHydrationWarning
                      >
                        {line.durationMs
                          ? `${(line.durationMs / 1000).toFixed(1)}s`
                          : formatRelativeTime(line.createdAt)}
                      </span>
                    </div>
                  ))
                )}

                {isRunLive && activeAgent && (
                  <div className="flex items-center gap-3 bg-primary/[0.04] px-4 py-2.5 text-xs text-primary">
                    <Spinner className="size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {activeAgent.activity || "Working…"}
                    </span>
                    <span className="shrink-0 font-mono text-[11px]">live</span>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          {/* TAB 2: INTERACTIVE GANTT TIMELINE */}
          <TabsContent value="timeline">
            <GanttTimeline run={run} elapsedMs={elapsedMs} onInspectAgent={onInspectAgent} />
          </TabsContent>

          {/* TAB 3: AGENTS & SPEND (Clean 6-column table) */}
          <TabsContent value="agents" className="flex flex-col gap-4">
            <div className="overflow-hidden rounded-xl border bg-card">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Agent</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Tokens</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {run.agents.map((ag) => {
                      const agTotal = ag.inputTokens + ag.outputTokens + ag.cacheReadTokens;
                      const agCacheBase = ag.inputTokens + ag.cacheReadTokens;
                      const agCachePct =
                        agCacheBase > 0 ? Math.round((ag.cacheReadTokens / agCacheBase) * 100) : 0;
                      const ph = phaseForRole(ag.role);
                      return (
                        <TableRow
                          key={ag.id}
                          onClick={() => onInspectAgent(ag.id)}
                          className="cursor-pointer"
                        >
                          <TableCell className="max-w-[260px] truncate font-medium text-foreground">
                            <div className="flex items-center gap-2">
                              <span
                                className="size-2 shrink-0 rounded-full"
                                style={{ backgroundColor: PHASE_META[ph].color }}
                              />
                              <span className="truncate">{ag.name}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {labelForRole(ag.role)}
                            {ag.specId ? ` · ${ag.specId}` : ""}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {ag.model ? formatModelLabel(ag.model) : "—"}
                          </TableCell>
                          <TableCell>
                            <span className="inline-flex items-center gap-1.5 text-xs capitalize">
                              <StatusDot status={ag.status} />
                              {ag.status.replace("_", " ")}
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs tabular-nums">
                            <span>{formatCompactTokens(agTotal)}</span>
                            {agCachePct > 0 && (
                              <span className="ml-1.5 text-muted-foreground">({agCachePct}%)</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs font-medium tabular-nums">
                            {formatUsd(ag.costUsd)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>

            {roleBreakdown.rows.length > 0 && (
              <div className="overflow-hidden rounded-xl border bg-card">
                <div className="border-b px-4 py-2.5 text-xs font-medium text-foreground">
                  Spend by role
                </div>
                <div className="divide-y divide-border/50">
                  {roleBreakdown.rows.map((r) => (
                    <div
                      key={r.roleKey}
                      className="flex items-center justify-between gap-4 px-4 py-2.5 text-xs"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: PHASE_META[r.phase].color }}
                        />
                        <span className="font-medium text-foreground">{r.label}</span>
                        <span className="text-muted-foreground">· {r.agents}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-4">
                        <span className="font-mono text-muted-foreground tabular-nums">
                          {formatCompactTokens(r.totalTokens)}
                        </span>
                        <div className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-muted sm:block">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${r.sharePct}%`,
                              backgroundColor: PHASE_META[r.phase].color,
                            }}
                          />
                        </div>
                        <span className="w-14 text-right font-mono font-medium text-foreground tabular-nums">
                          {formatUsd(r.cost)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          {/* TAB 4: CHECKS & CRITERIA */}
          <TabsContent value="criteria" className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="overflow-hidden rounded-xl border bg-card">
                <div className="flex items-center justify-between border-b px-4 py-2.5 text-xs">
                  <span className="font-medium text-foreground">Check commands</span>
                  <span className="capitalize text-muted-foreground">
                    {checkInfo?.state || "waiting"}
                  </span>
                </div>
                <div className="px-4 py-3 font-mono text-xs text-muted-foreground">
                  {checkInfo?.text || "Not run yet"}
                </div>
              </div>

              <div className="overflow-hidden rounded-xl border bg-card">
                <div className="border-b px-4 py-2.5 text-xs font-medium text-foreground">
                  Review &amp; QC ({reviewRows.length})
                </div>
                {reviewRows.length === 0 ? (
                  <div className="px-4 py-3 text-xs text-muted-foreground">
                    Waiting for checks to pass
                  </div>
                ) : (
                  <div className="divide-y divide-border/50">
                    {reviewRows.map((rv, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs"
                      >
                        <span className="font-medium text-foreground">{rv.tag || "reviewer"}</span>
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">
                          {rv.text || "—"}
                        </span>
                        <Badge
                          variant={
                            rv.state === "fail"
                              ? "destructive"
                              : rv.state === "ok"
                                ? "secondary"
                                : "outline"
                          }
                        >
                          {rv.state || "wait"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border bg-card">
              <div className="flex items-center justify-between border-b px-4 py-2.5 text-xs">
                <span className="font-medium text-foreground">Acceptance criteria</span>
                <span className="text-muted-foreground tabular-nums">
                  {metCriteria}/{totalCriteria} met
                </span>
              </div>
              {run.criteria.length === 0 ? (
                <div className="px-4 py-5 text-xs text-muted-foreground">
                  No acceptance criteria attached.
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  {run.criteria.map((c) => {
                    const open = Boolean(expandedCriteria[c.id]);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() =>
                          setExpandedCriteria((prev) => ({
                            ...prev,
                            [c.id]: !prev[c.id],
                          }))
                        }
                        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left text-xs transition-colors hover:bg-muted/30"
                      >
                        <div className="flex min-w-0 items-start gap-2.5">
                          <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 font-mono font-medium text-muted-foreground">
                            {open ? (
                              <ChevronDownIcon className="size-3.5" />
                            ) : (
                              <ChevronRightIcon className="size-3.5" />
                            )}
                            {c.id}
                          </span>
                          <span
                            className={`text-foreground/90 ${
                              open ? "whitespace-normal leading-relaxed" : "truncate"
                            }`}
                          >
                            {c.text}
                          </span>
                        </div>
                        <span className="shrink-0 font-medium">
                          {c.status === "met" ? (
                            <span className="inline-flex items-center gap-1 text-primary">
                              <CheckCircle2Icon className="size-3.5" />
                              Met
                            </span>
                          ) : c.status === "not_met" ? (
                            <span className="inline-flex items-center gap-1 text-destructive">
                              <XCircleIcon className="size-3.5" />
                              Failed
                            </span>
                          ) : (
                            <span className="text-muted-foreground">Pending</span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {run.failureLog.length > 0 && (
              <div className="overflow-hidden rounded-xl border border-destructive/35 bg-card">
                <div className="border-b px-4 py-2.5 text-xs font-medium text-destructive">
                  Failure log ({run.failureLog.length})
                </div>
                <div className="divide-y divide-border/50">
                  {run.failureLog.map((f, idx) => (
                    <div
                      key={idx}
                      className="flex items-start justify-between gap-3 px-4 py-2.5 text-xs"
                    >
                      <div className="flex min-w-0 items-start gap-2">
                        <Badge variant="destructive">{f.kind || "failure"}</Badge>
                        <span className="text-foreground/90">
                          {f.file && (
                            <span className="mr-1.5 font-mono text-muted-foreground">
                              {f.file}
                            </span>
                          )}
                          {f.problem}
                        </span>
                      </div>
                      <span className="shrink-0 text-muted-foreground">{f.stage || "—"}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          {/* TAB 5: RUN SCORECARD SPIDER CHART */}
          <TabsContent value="scorecard">
            <SingleRunSpiderCard run={spiderRunInput} />
          </TabsContent>
        </Tabs>
      </div>
    </ScrollArea>
  );
}
