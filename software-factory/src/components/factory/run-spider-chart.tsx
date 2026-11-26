"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowUpRightIcon,
  ClockIcon,
  CoinsIcon,
  RadarIcon,
  ShieldCheckIcon,
  UserCheckIcon,
} from "lucide-react";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  formatCompactTokens,
  formatUsd,
  StatusDot,
} from "@/components/factory/factory-primitives";

export interface RunSpiderInput {
  id: string;
  runKey: string;
  title: string;
  mode: string;
  status: string;
  engine?: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  durationMs: number | null;
  waitMs: number;
  humanInterventions: number;
  interactionsCount: number;
  criteriaMet: number;
  criteriaTotal: number;
  repairRounds: number;
  failureCount: number;
  checksPassed: boolean | null;
  reviewsPassed: number;
  reviewsTotal: number;
  startedAt: string;
  finishedAt?: string | null;
  updatedAt: string;
}

export type SpiderAxisKey = "cost" | "time" | "quality" | "humanEffort";

export interface ScoredAxis {
  key: SpiderAxisKey;
  label: string;
  shortLabel: string;
  score: number;
  rawValue: string;
  detail: string;
}

export interface RunSpiderScore {
  run: RunSpiderInput;
  shortName: string;
  composite: number;
  axes: Record<SpiderAxisKey, ScoredAxis>;
}

const MAX_SELECTED_RUNS = 3;

const SERIES_STYLES = [
  {
    key: "s0",
    color: "var(--chart-1)",
    strokeDasharray: undefined as string | undefined,
    fillOpacity: 0.24,
    dotRadius: 4,
  },
  {
    key: "s1",
    color: "var(--chart-2)",
    strokeDasharray: "6 3",
    fillOpacity: 0.16,
    dotRadius: 4,
  },
  {
    key: "s2",
    color: "var(--chart-5)",
    strokeDasharray: "2 3",
    fillOpacity: 0.14,
    dotRadius: 4,
  },
] as const;

const AXIS_ORDER: Array<{
  key: SpiderAxisKey;
  label: string;
  shortLabel: string;
  hint: string;
}> = [
  { key: "cost", label: "Cost", shortLabel: "Cost", hint: "Lower spend = higher score" },
  { key: "time", label: "Time", shortLabel: "Time", hint: "Faster run = higher score" },
  {
    key: "quality",
    label: "Quality",
    shortLabel: "Quality",
    hint: "Criteria, gates & fewer retries",
  },
  {
    key: "humanEffort",
    label: "Human Effort",
    shortLabel: "Effort",
    hint: "100 = hands-free (0 steers)",
  },
];

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function formatShortDuration(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const mins = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (mins < 60) return remSec > 0 ? `${mins}m ${remSec}s` : `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`;
}

export function extractShortRunName(title: string): string {
  const clean = title.trim();
  const issueMatch = clean.match(/^([A-Z]\d+)\s*[:\-–]/);
  if (issueMatch) {
    const rest = clean.slice(issueMatch[0].length).trim();
    return rest.length > 26 ? `${issueMatch[1]} · ${rest.slice(0, 25)}…` : `${issueMatch[1]} · ${rest}`;
  }
  return clean.length > 30 ? `${clean.slice(0, 29)}…` : clean || "Run";
}

function extractChipLabel(run: RunSpiderInput): string {
  const clean = run.title.trim();
  const issueMatch = clean.match(/^([A-Z]\d+)\s*[:\-–]/);
  if (issueMatch) return issueMatch[1];
  return clean.length > 14 ? `${clean.slice(0, 13)}…` : clean || run.runKey.slice(0, 8);
}

function resolveDurationMs(run: RunSpiderInput): number {
  if (typeof run.durationMs === "number" && run.durationMs > 0) {
    return run.durationMs;
  }
  const start = new Date(run.startedAt).getTime();
  const endRef = run.finishedAt ? new Date(run.finishedAt).getTime() : new Date(run.updatedAt).getTime();
  if (Number.isFinite(start) && Number.isFinite(endRef) && endRef >= start) {
    return endRef - start;
  }
  return 0;
}

export function scoreRunDimensions(run: RunSpiderInput, engine?: string): RunSpiderScore {
  const resolvedEngine = run.engine ?? engine;
  const totalTokens = run.inputTokens + run.outputTokens + run.cacheReadTokens;
  const cacheBase = run.inputTokens + run.cacheReadTokens;
  const cachePct = cacheBase > 0 ? Math.round((run.cacheReadTokens / cacheBase) * 100) : 0;

  // 1. COST (higher = more cost-efficient; $4.50 anchor ≈ 50 pts)
  const costScore =
    run.costUsd <= 0
      ? run.status === "queued"
        ? 50
        : 100
      : clamp(Math.round(100 / (1 + Math.pow(run.costUsd / 4.5, 0.95))), 8, 100);
  const costPrefix = resolvedEngine === "antigravity" && run.costUsd > 0 ? "~" : "";
  const costRaw = `${costPrefix}${formatUsd(run.costUsd)}`;
  const costDetail =
    totalTokens > 0
      ? `${formatCompactTokens(totalTokens)} tok${cachePct > 0 ? ` · ${cachePct}% cache` : ""}`
      : "No spend yet";

  // 2. TIME (higher = faster turnaround; 25m anchor ≈ 50 pts)
  const durMs = resolveDurationMs(run);
  const durMins = durMs / 60_000;
  const timeScore =
    durMs <= 0
      ? run.status === "queued"
        ? 50
        : 100
      : clamp(Math.round(100 / (1 + Math.pow(durMins / 25, 0.9))), 8, 100);
  const timeRaw = durMs > 0 ? formatShortDuration(durMs) : "—";
  const timeDetail =
    run.waitMs > 0
      ? `${formatShortDuration(run.waitMs)} wait`
      : run.status === "running"
        ? "Running"
        : "Active time";

  // 3. QUALITY
  let qualityBase: number;
  if (run.criteriaTotal > 0) {
    const ratio = run.criteriaMet / run.criteriaTotal;
    if (run.status === "passed") {
      qualityBase = Math.round(62 + ratio * 38);
    } else if (run.status === "running" || run.status === "queued") {
      qualityBase = Math.round(35 + ratio * 45);
    } else {
      qualityBase = Math.round(18 + ratio * 42);
    }
  } else {
    switch (run.status) {
      case "passed":
        qualityBase = 96;
        break;
      case "running":
      case "queued":
        qualityBase = 65;
        break;
      case "awaiting_input":
        qualityBase = 55;
        break;
      case "blocked":
      case "stalled":
        qualityBase = 30;
        break;
      default:
        qualityBase = 22;
        break;
    }
  }

  let qualityPenalty = 0;
  if (run.checksPassed === false) qualityPenalty += 14;
  if (run.reviewsTotal > 0 && run.reviewsPassed < run.reviewsTotal) {
    qualityPenalty += Math.round(((run.reviewsTotal - run.reviewsPassed) / run.reviewsTotal) * 18);
  }
  qualityPenalty += Math.min(24, run.repairRounds * 8);
  qualityPenalty += Math.min(20, run.failureCount * 4);

  const qualityScore = clamp(qualityBase - qualityPenalty, 5, 100);
  const qualityRaw =
    run.criteriaTotal > 0
      ? `${run.criteriaMet}/${run.criteriaTotal}C`
      : run.status.replace("_", " ");
  const qualityParts: string[] = [];
  if (run.repairRounds > 0) {
    qualityParts.push(`${run.repairRounds} retry`);
  }
  if (run.failureCount > 0) {
    qualityParts.push(`${run.failureCount} issue${run.failureCount === 1 ? "" : "s"}`);
  }
  if (run.reviewsTotal > 0) {
    qualityParts.push(`${run.reviewsPassed}/${run.reviewsTotal} rev`);
  }
  const qualityDetail =
    qualityParts.length > 0
      ? qualityParts.join(" · ")
      : run.status === "passed"
        ? "Clean pass"
        : run.status.replace("_", " ");

  // 4. HUMAN EFFORT (100 = hands-free)
  const rawTouchpoints = Math.max(run.humanInterventions, run.interactionsCount);
  const touchpoints =
    run.status === "awaiting_input" && rawTouchpoints === 0 ? 1 : rawTouchpoints;
  const waitMins = run.waitMs / 60_000;
  let humanScore = 100 - touchpoints * 16 - Math.min(25, Math.round(waitMins * 1.5));
  if (run.status === "awaiting_input" || run.status === "blocked") {
    humanScore -= 10;
  } else if (run.status === "cancelled") {
    humanScore -= 12;
  }
  humanScore = clamp(humanScore, 8, 100);

  const humanRaw =
    touchpoints === 0
      ? "0 steers"
      : `${touchpoints} steer${touchpoints === 1 ? "" : "s"}`;
  const humanDetail =
    touchpoints === 0 && run.waitMs === 0
      ? run.status === "blocked" || run.status === "awaiting_input"
        ? "Needs unblock"
        : "Hands-free"
      : run.waitMs > 0
        ? `${formatShortDuration(run.waitMs)} wait`
        : `${run.interactionsCount} prompt${run.interactionsCount === 1 ? "" : "s"}`;

  const axes: Record<SpiderAxisKey, ScoredAxis> = {
    cost: {
      key: "cost",
      label: "Cost",
      shortLabel: "Cost",
      score: costScore,
      rawValue: costRaw,
      detail: costDetail,
    },
    time: {
      key: "time",
      label: "Time",
      shortLabel: "Time",
      score: timeScore,
      rawValue: timeRaw,
      detail: timeDetail,
    },
    quality: {
      key: "quality",
      label: "Quality",
      shortLabel: "Quality",
      score: qualityScore,
      rawValue: qualityRaw,
      detail: qualityDetail,
    },
    humanEffort: {
      key: "humanEffort",
      label: "Human Effort",
      shortLabel: "Effort",
      score: humanScore,
      rawValue: humanRaw,
      detail: humanDetail,
    },
  };

  const composite = Math.round((costScore + timeScore + qualityScore + humanScore) / 4);

  return {
    run,
    shortName: extractShortRunName(run.title),
    composite,
    axes,
  };
}

function AxisIcon({ axis }: { axis: SpiderAxisKey }) {
  switch (axis) {
    case "cost":
      return <CoinsIcon className="size-3.5 shrink-0 text-muted-foreground" />;
    case "time":
      return <ClockIcon className="size-3.5 shrink-0 text-muted-foreground" />;
    case "quality":
      return <ShieldCheckIcon className="size-3.5 shrink-0 text-muted-foreground" />;
    case "humanEffort":
      return <UserCheckIcon className="size-3.5 shrink-0 text-muted-foreground" />;
  }
}

function SeriesSwatch({
  color,
  dash,
}: {
  color: string;
  dash: string | undefined;
}) {
  return (
    <svg width="16" height="8" viewBox="0 0 16 8" className="shrink-0" aria-hidden="true">
      <line
        x1="1"
        y1="4"
        x2="15"
        y2="4"
        stroke={color}
        strokeWidth="2.2"
        strokeDasharray={dash}
        strokeLinecap="round"
      />
      <circle cx="8" cy="4" r="2.1" fill={color} />
    </svg>
  );
}

interface RadarTooltipRow {
  axisKey: SpiderAxisKey;
  axis: string;
  [seriesKey: string]: string | number;
}

function SpiderTooltipContent({
  active,
  payload,
  scoredSeries,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: unknown }>;
  scoredSeries: Array<{
    scored: RunSpiderScore;
    style: (typeof SERIES_STYLES)[number];
  }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload as RadarTooltipRow | undefined;
  if (!row || !row.axisKey) return null;
  const axisKey = row.axisKey;
  const axisMeta = AXIS_ORDER.find((a) => a.key === axisKey);

  return (
    <div className="min-w-52 rounded-lg border border-border/70 bg-popover px-3.5 py-2.5 text-xs text-popover-foreground shadow-lg">
      <div className="mb-2 flex items-baseline justify-between gap-3 border-b border-border/60 pb-1.5">
        <span className="font-semibold text-foreground">{axisMeta?.label ?? row.axis}</span>
        <span className="text-[11px] text-muted-foreground">{axisMeta?.hint}</span>
      </div>
      <div className="flex flex-col gap-2">
        {scoredSeries.map(({ scored, style }) => {
          const metric = scored.axes[axisKey];
          return (
            <div key={scored.run.id} className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <SeriesSwatch color={style.color} dash={style.strokeDasharray} />
                <div className="flex min-w-0 flex-col">
                  <span className="max-w-[148px] truncate font-medium text-foreground">
                    {scored.shortName}
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                    {metric.rawValue} · {metric.detail}
                  </span>
                </div>
              </div>
              <span className="shrink-0 font-mono text-xs font-semibold text-foreground tabular-nums">
                {metric.score}
                <span className="font-normal text-muted-foreground">/100</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function scoreToneClass(score: number): string {
  if (score >= 75) return "text-primary";
  if (score >= 45) return "text-warning";
  return "text-destructive";
}

function scoreBarColor(score: number): string {
  if (score >= 75) return "var(--primary)";
  if (score >= 45) return "var(--warning)";
  return "var(--destructive)";
}

/**
 * Clean, zero-clutter comparative Spider Chart card designed for the Bento Executive Dashboard.
 * Follows ui-ux-pro-max: max 3 overlaid datasets, angled radius axis (no label overlap),
 * distinct hues + stroke dashes, 8px touch spacing, flat hairline typography (no box-in-box).
 */
export function ProjectRunsSpiderChart({
  runs,
  engine,
}: {
  runs: RunSpiderInput[];
  engine?: string;
}) {
  const factoryRuns = React.useMemo(
    () => runs.filter((r) => r.mode === "factory"),
    [runs],
  );
  const [scope, setScope] = React.useState<"factory" | "all">(() =>
    factoryRuns.length > 0 ? "factory" : "all",
  );

  const availableRuns = React.useMemo(() => {
    if (scope === "factory" && factoryRuns.length > 0) return factoryRuns;
    return runs;
  }, [scope, factoryRuns, runs]);

  const defaultSelectedIds = React.useMemo(() => {
    const meaningful = availableRuns.filter(
      (r) => r.costUsd > 0 || (r.durationMs ?? 0) > 0 || r.status === "passed",
    );
    const pool = meaningful.length > 0 ? meaningful : availableRuns;
    return pool.slice(0, Math.min(2, pool.length)).map((r) => r.id);
  }, [availableRuns]);

  const [userSelectedIds, setUserSelectedIds] = React.useState<string[] | null>(null);

  const selectedIds = React.useMemo(() => {
    if (userSelectedIds === null) return defaultSelectedIds;
    const validSet = new Set(availableRuns.map((r) => r.id));
    const kept = userSelectedIds.filter((id) => validSet.has(id));
    return kept.length > 0 ? kept.slice(0, MAX_SELECTED_RUNS) : defaultSelectedIds;
  }, [userSelectedIds, availableRuns, defaultSelectedIds]);

  const toggleRun = React.useCallback(
    (runId: string) => {
      setUserSelectedIds((prev) => {
        const validSet = new Set(availableRuns.map((r) => r.id));
        const current =
          prev === null
            ? defaultSelectedIds
            : (() => {
                const kept = prev.filter((id) => validSet.has(id));
                return kept.length > 0 ? kept.slice(0, MAX_SELECTED_RUNS) : defaultSelectedIds;
              })();
        if (current.includes(runId)) {
          if (current.length === 1) return current;
          return current.filter((id) => id !== runId);
        }
        if (current.length >= MAX_SELECTED_RUNS) {
          return [...current.slice(1), runId];
        }
        return [...current, runId];
      });
    },
    [availableRuns, defaultSelectedIds],
  );

  const selectedSeries = React.useMemo(() => {
    const byId = new Map(availableRuns.map((r) => [r.id, r]));
    return selectedIds
      .map((id) => byId.get(id))
      .filter((r): r is RunSpiderInput => Boolean(r))
      .slice(0, MAX_SELECTED_RUNS)
      .map((run, idx) => ({
        scored: scoreRunDimensions(run, engine),
        style: SERIES_STYLES[idx] ?? SERIES_STYLES[0],
      }));
  }, [availableRuns, selectedIds, engine]);

  const chartConfig = React.useMemo<ChartConfig>(() => {
    const cfg: ChartConfig = {};
    selectedSeries.forEach(({ scored, style }) => {
      cfg[style.key] = {
        label: scored.shortName,
        color: style.color,
      };
    });
    return cfg;
  }, [selectedSeries]);

  const chartData = React.useMemo<RadarTooltipRow[]>(() => {
    return AXIS_ORDER.map((axis) => {
      const row: RadarTooltipRow = {
        axisKey: axis.key,
        axis: axis.label,
      };
      selectedSeries.forEach(({ scored, style }) => {
        row[style.key] = scored.axes[axis.key].score;
      });
      return row;
    });
  }, [selectedSeries]);

  if (runs.length === 0) {
    return (
      <section className="flex h-full flex-col justify-between rounded-xl border border-border/80 bg-card p-6">
        <div className="flex items-center gap-2">
          <RadarIcon className="size-4 text-primary" />
          <h2 className="text-sm font-semibold tracking-tight text-foreground">
            Run performance
          </h2>
        </div>
        <p className="py-12 text-center text-xs text-muted-foreground">
          Complete a Factory run to visualize Cost, Time, Quality, and Human Effort.
        </p>
      </section>
    );
  }

  return (
    <section
      aria-label="Run performance spider chart"
      className="flex h-full flex-col rounded-xl border border-border/80 bg-card"
    >
      {/* Top Bar: Title + Scope Filter */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-5 pb-4">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold tracking-tight text-foreground">
              Run performance
            </h2>
            <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
              {selectedSeries.length}/{Math.min(MAX_SELECTED_RUNS, availableRuns.length)} compared
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Cost, Time, Quality &amp; Human Effort · outer ring 100 = optimal
          </p>
        </div>

        {factoryRuns.length > 0 && factoryRuns.length < runs.length && (
          <div
            role="group"
            aria-label="Filter runs by mode"
            className="flex items-center gap-1 rounded-lg border border-border/70 bg-muted/40 p-0.5 text-xs"
          >
            <button
              type="button"
              onClick={() => setScope("factory")}
              className={`cursor-pointer rounded-md px-2.5 py-1 transition-colors ${
                scope === "factory"
                  ? "bg-card font-medium text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Factory ({factoryRuns.length})
            </button>
            <button
              type="button"
              onClick={() => setScope("all")}
              className={`cursor-pointer rounded-md px-2.5 py-1 transition-colors ${
                scope === "all"
                  ? "bg-card font-medium text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              All ({runs.length})
            </button>
          </div>
        )}
      </div>

      {/* Run selector strip — clean subtle pills with >= 8px touch spacing */}
      <div
        className="flex flex-wrap items-center gap-2 border-y border-border/60 bg-muted/20 px-6 py-2.5"
        role="group"
        aria-label="Select up to 3 runs to compare"
      >
        {availableRuns.slice(0, 10).map((r) => {
          const activeIndex = selectedIds.indexOf(r.id);
          const isSelected = activeIndex !== -1;
          const style = isSelected ? SERIES_STYLES[activeIndex] : null;
          return (
            <button
              key={r.id}
              type="button"
              aria-pressed={isSelected}
              onClick={() => toggleRun(r.id)}
              title={`${r.title} (${r.status}) — ${formatUsd(r.costUsd)}`}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1 text-xs transition-all duration-150 ${
                isSelected
                  ? "bg-card font-medium text-foreground ring-1 ring-border shadow-xs"
                  : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
              }`}
            >
              {style ? (
                <SeriesSwatch color={style.color} dash={style.strokeDasharray} />
              ) : (
                <StatusDot status={r.status} />
              )}
              <span className="max-w-[120px] truncate">{extractChipLabel(r)}</span>
            </button>
          );
        })}
      </div>

      {/* Main Content: Spacious Radar on Left + Flat Hairline Metrics on Right */}
      <div className="grid flex-1 grid-cols-1 items-center lg:grid-cols-[minmax(280px,340px)_1fr] lg:divide-x lg:divide-border/60">
        {/* Spider Chart */}
        <div className="flex items-center justify-center px-3 py-5">
          <ChartContainer
            config={chartConfig}
            initialDimension={{ width: 320, height: 290 }}
            className="aspect-auto h-[290px] w-full max-w-[340px]"
          >
            <RadarChart
              data={chartData}
              cx="50%"
              cy="50%"
              outerRadius="74%"
              margin={{ top: 22, right: 34, bottom: 22, left: 34 }}
            >
              <PolarGrid gridType="polygon" stroke="var(--border)" strokeOpacity={0.85} />
              <PolarAngleAxis
                dataKey="axis"
                tick={{
                  fill: "var(--foreground)",
                  fontSize: 12,
                  fontWeight: 500,
                }}
              />
              <PolarRadiusAxis
                angle={45}
                domain={[0, 100]}
                tickCount={5}
                tick={{
                  fill: "var(--muted-foreground)",
                  fontSize: 10,
                }}
                axisLine={false}
              />
              <ChartTooltip
                cursor={false}
                content={({ active, payload }) => (
                  <SpiderTooltipContent
                    active={active}
                    payload={payload}
                    scoredSeries={selectedSeries}
                  />
                )}
              />
              {selectedSeries.map(({ scored, style }) => (
                <Radar
                  key={scored.run.id}
                  name={scored.shortName}
                  dataKey={style.key}
                  stroke={style.color}
                  strokeWidth={2}
                  strokeDasharray={style.strokeDasharray}
                  fill={style.color}
                  fillOpacity={style.fillOpacity}
                  dot={{
                    r: style.dotRadius,
                    fill: style.color,
                    stroke: "var(--card)",
                    strokeWidth: 1.5,
                  }}
                  activeDot={{
                    r: 5.5,
                    fill: style.color,
                    stroke: "var(--foreground)",
                    strokeWidth: 1.5,
                  }}
                />
              ))}
            </RadarChart>
          </ChartContainer>
        </div>

        {/* Clean Flat Hairline Run Comparison Rows — ZERO nested boxes! */}
        <div className="flex h-full min-w-0 flex-col justify-center divide-y divide-border/60">
          {selectedSeries.map(({ scored, style }) => (
            <div key={scored.run.id} className="flex flex-col gap-3 px-6 py-4">
              {/* Row Header */}
              <div className="flex items-center justify-between gap-3">
                <Link
                  href={`/sessions/${scored.run.id}`}
                  className="group flex min-w-0 items-center gap-2 text-xs font-semibold text-foreground transition-colors hover:text-primary"
                >
                  <SeriesSwatch color={style.color} dash={style.strokeDasharray} />
                  <span className="truncate">{scored.run.title}</span>
                  <ArrowUpRightIcon className="size-3.5 shrink-0 text-muted-foreground opacity-60 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary group-hover:opacity-100" />
                </Link>
                <div className="flex shrink-0 items-center gap-2.5 text-xs">
                  <span className="inline-flex items-center gap-1.5 capitalize text-muted-foreground">
                    <StatusDot status={scored.run.status} />
                    {scored.run.status.replace("_", " ")}
                  </span>
                  <span className="font-mono font-semibold text-foreground tabular-nums">
                    {scored.composite}
                    <span className="font-normal text-muted-foreground">/100</span>
                  </span>
                </div>
              </div>

              {/* 4 Clean Borderless Metric Columns */}
              <div className="grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-4">
                {AXIS_ORDER.map((axis) => {
                  const metric = scored.axes[axis.key];
                  return (
                    <div key={axis.key} className="flex min-w-0 flex-col gap-1">
                      <div className="flex items-center justify-between gap-1 text-[11px]">
                        <span className="text-muted-foreground">{axis.shortLabel}</span>
                        <span
                          className={`font-mono font-semibold tabular-nums ${scoreToneClass(metric.score)}`}
                        >
                          {metric.score}
                        </span>
                      </div>
                      <span className="truncate font-mono text-sm font-semibold tracking-tight text-foreground tabular-nums">
                        {metric.rawValue}
                      </span>
                      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full transition-all duration-300"
                          style={{
                            width: `${metric.score}%`,
                            backgroundColor: scoreBarColor(metric.score),
                          }}
                        />
                      </div>
                      <span className="truncate text-[11px] text-muted-foreground">
                        {metric.detail}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * Single-run Spider Chart scorecard for an individual run's Live Pipeline view.
 */
export function SingleRunSpiderCard({ run }: { run: RunSpiderInput }) {
  const scored = React.useMemo(() => scoreRunDimensions(run, run.engine), [run]);
  const singleSeries = React.useMemo(
    () => [{ scored, style: SERIES_STYLES[0] }],
    [scored],
  );

  const chartConfig = React.useMemo<ChartConfig>(
    () => ({
      s0: {
        label: scored.shortName,
        color: SERIES_STYLES[0].color,
      },
    }),
    [scored.shortName],
  );

  const chartData = React.useMemo<RadarTooltipRow[]>(
    () =>
      AXIS_ORDER.map((axis) => ({
        axisKey: axis.key,
        axis: axis.label,
        s0: scored.axes[axis.key].score,
      })),
    [scored],
  );

  return (
    <div className="overflow-hidden rounded-xl border border-border/80 bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-3.5">
        <div className="flex items-center gap-2">
          <RadarIcon className="size-4 text-primary" />
          <span className="text-xs font-semibold text-foreground">Run Scorecard</span>
          <span className="text-xs text-muted-foreground">
            · Cost, Time, Quality &amp; Human Effort (0–100)
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Overall</span>
          <span className="font-mono text-sm font-semibold text-foreground tabular-nums">
            {scored.composite}
            <span className="font-normal text-muted-foreground">/100</span>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 items-center lg:grid-cols-[minmax(280px,350px)_1fr] lg:divide-x lg:divide-border/60">
        <div className="flex items-center justify-center px-3 py-5">
          <ChartContainer
            config={chartConfig}
            initialDimension={{ width: 320, height: 270 }}
            className="aspect-auto h-[270px] w-full max-w-[350px]"
          >
            <RadarChart
              data={chartData}
              cx="50%"
              cy="50%"
              outerRadius="74%"
              margin={{ top: 22, right: 34, bottom: 22, left: 34 }}
            >
              <PolarGrid gridType="polygon" stroke="var(--border)" strokeOpacity={0.85} />
              <PolarAngleAxis
                dataKey="axis"
                tick={{
                  fill: "var(--foreground)",
                  fontSize: 12,
                  fontWeight: 500,
                }}
              />
              <PolarRadiusAxis
                angle={45}
                domain={[0, 100]}
                tickCount={5}
                tick={{
                  fill: "var(--muted-foreground)",
                  fontSize: 10,
                }}
                axisLine={false}
              />
              <ChartTooltip
                cursor={false}
                content={({ active, payload }) => (
                  <SpiderTooltipContent
                    active={active}
                    payload={payload}
                    scoredSeries={singleSeries}
                  />
                )}
              />
              <Radar
                name={scored.shortName}
                dataKey="s0"
                stroke={SERIES_STYLES[0].color}
                strokeWidth={2}
                fill={SERIES_STYLES[0].color}
                fillOpacity={0.24}
                dot={{
                  r: 4,
                  fill: SERIES_STYLES[0].color,
                  stroke: "var(--card)",
                  strokeWidth: 1.5,
                }}
                activeDot={{
                  r: 5.5,
                  fill: SERIES_STYLES[0].color,
                  stroke: "var(--foreground)",
                  strokeWidth: 1.5,
                }}
              />
            </RadarChart>
          </ChartContainer>
        </div>

        <div className="grid grid-cols-1 divide-y divide-border/60 sm:grid-cols-2 sm:divide-y-0">
          {AXIS_ORDER.map((axis, idx) => {
            const metric = scored.axes[axis.key];
            return (
              <div
                key={axis.key}
                className={`flex flex-col gap-2.5 p-5 ${
                  idx % 2 === 1 ? "sm:border-l sm:border-border/60" : ""
                } ${idx >= 2 ? "sm:border-t sm:border-border/60" : ""}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <AxisIcon axis={axis.key} />
                    {axis.label}
                  </span>
                  <span
                    className={`font-mono text-sm font-semibold tabular-nums ${scoreToneClass(metric.score)}`}
                  >
                    {metric.score}
                    <span className="text-xs font-normal text-muted-foreground">/100</span>
                  </span>
                </div>

                <span className="font-mono text-lg font-semibold tracking-tight text-foreground tabular-nums">
                  {metric.rawValue}
                </span>

                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${metric.score}%`,
                      backgroundColor: scoreBarColor(metric.score),
                    }}
                  />
                </div>

                <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span className="truncate">{metric.detail}</span>
                  <span className="shrink-0 opacity-75">{axis.hint}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
