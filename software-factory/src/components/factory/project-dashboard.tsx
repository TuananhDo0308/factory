"use client";

import * as React from "react";
import Link from "next/link";
import {
  ActivityIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  CoinsIcon,
  CpuIcon,
  EyeIcon,
  SparklesIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  formatCompactTokens,
  formatUsd,
  StatusDot,
} from "@/components/factory/factory-primitives";
import { ProjectRunsSpiderChart } from "@/components/factory/run-spider-chart";
import type { ProjectBoardSnapshot } from "@/lib/board-data";

function formatCompactDuration(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const mins = Math.floor(sec / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`;
}

/**
 * Subtle inline SVG sparkline for spend across recent runs (ui-ux-pro-max Executive Dashboard).
 */
function SpendSparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 0.01);
  const w = 112;
  const h = 24;
  const pad = 2;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2);
    const y = h - pad - (v / max) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const areaPts = `${pad},${h - pad} ${pts.join(" ")} ${w - pad},${h - pad}`;
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="shrink-0 overflow-visible"
      aria-hidden="true"
    >
      <polygon points={areaPts} fill="var(--primary)" fillOpacity={0.12} />
      <polyline
        fill="none"
        stroke="var(--primary)"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={pts.join(" ")}
      />
    </svg>
  );
}

export function ProjectDashboard({
  engine,
  board,
  onOpenKanban,
}: {
  engine: string;
  board: ProjectBoardSnapshot;
  onOpenKanban: () => void;
}) {
  const issues = board.issues;
  const runs = board.runs;

  const draftCount = issues.filter(
    (i) => i.status === "backlog" || i.status === "needs_human",
  ).length;
  const readyCount = issues.filter((i) => i.status === "ready").length;
  const inProgressCount = issues.filter((i) => i.status === "in_progress").length;
  const reviewCount = issues.filter(
    (i) => i.status === "in_review" || i.status === "blocked" || i.status === "failed",
  ).length;
  const doneCount = issues.filter((i) => i.status === "passed").length;
  const totalIssues = issues.length;
  const completionPct = totalIssues > 0 ? Math.round((doneCount / totalIssues) * 100) : 0;

  const urgentCount = issues.filter((i) => i.priority === "P0" && i.status !== "passed").length;
  const highRiskCount = issues.filter((i) => i.tier === "high" && i.status !== "passed").length;

  const totalInput = runs.reduce((s, r) => s + r.inputTokens, 0);
  const totalOutput = runs.reduce((s, r) => s + r.outputTokens, 0);
  const totalCache = runs.reduce((s, r) => s + r.cacheReadTokens, 0);
  const totalTokens = totalInput + totalOutput + totalCache;
  const cacheBase = totalInput + totalCache;
  const cacheHitPct = cacheBase > 0 ? Math.round((totalCache / cacheBase) * 100) : 0;

  const inputPct = totalTokens > 0 ? (totalInput / totalTokens) * 100 : 0;
  const cachePct = totalTokens > 0 ? (totalCache / totalTokens) * 100 : 0;
  const outputPct = totalTokens > 0 ? (totalOutput / totalTokens) * 100 : 0;

  const totalCost = runs.reduce((s, r) => s + r.costUsd, 0);
  const avgCost = runs.length > 0 ? totalCost / runs.length : 0;
  const totalDurationMs = runs.reduce((s, r) => s + (r.durationMs ?? 0), 0);

  const factoryRuns = runs.filter((r) => r.mode === "factory");
  const finishedRuns = factoryRuns.filter(
    (r) => r.status === "passed" || r.status === "failed" || r.status === "blocked",
  );
  const passedRuns = factoryRuns.filter((r) => r.status === "passed").length;
  const failedRuns = finishedRuns.length - passedRuns;
  const passRate =
    finishedRuns.length > 0 ? Math.round((passedRuns / finishedRuns.length) * 100) : null;

  // Chronological spend series for sparkline (oldest -> newest)
  const spendSparkValues = React.useMemo(
    () =>
      [...runs]
        .reverse()
        .slice(-10)
        .map((r) => r.costUsd),
    [runs],
  );

  const modeCosts = React.useMemo(() => {
    const map = new Map<string, { mode: string; count: number; cost: number; tokens: number }>();
    for (const r of runs) {
      const m = r.mode || "normal";
      const prev = map.get(m) ?? { mode: m, count: 0, cost: 0, tokens: 0 };
      prev.count += 1;
      prev.cost += r.costUsd;
      prev.tokens += r.inputTokens + r.outputTokens + r.cacheReadTokens;
      map.set(m, prev);
    }
    return Array.from(map.values()).sort((a, b) => b.cost - a.cost);
  }, [runs]);

  const issueBuckets = [
    { label: "Done", count: doneCount, color: "var(--success)" },
    { label: "In Progress", count: inProgressCount, color: "var(--primary)" },
    { label: "Review", count: reviewCount, color: "var(--destructive)" },
    { label: "Ready", count: readyCount, color: "var(--chart-2)" },
    { label: "Draft", count: draftCount, color: "var(--warning)" },
  ];

  const activeIssues = issues.filter((i) => i.status === "in_progress" && i.latestRun);

  return (
    <div className="flex flex-col gap-5">
      {/* 1. EXECUTIVE KPI ROW — 4 spacious cards with micro-visual cues */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* KPI 1: Delivery Progress */}
        <div className="flex flex-col justify-between gap-3 rounded-xl border border-border/80 bg-card p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">Tickets completed</span>
            <CheckCircle2Icon className="size-4 text-muted-foreground/70" />
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-2xl font-semibold tracking-tight text-foreground tabular-nums">
              {doneCount}
              <span className="text-base font-normal text-muted-foreground">/{totalIssues}</span>
            </span>
            <span className="font-mono text-xs font-medium text-primary tabular-nums">
              {completionPct}%
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${completionPct}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground">
              {inProgressCount > 0
                ? `${inProgressCount} in progress · ${readyCount} ready`
                : `${readyCount} ready in queue`}
            </span>
          </div>
        </div>

        {/* KPI 2: Pass Rate & Execution Time */}
        <div className="flex flex-col justify-between gap-3 rounded-xl border border-border/80 bg-card p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">Pipeline health</span>
            <ActivityIcon className="size-4 text-muted-foreground/70" />
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-2xl font-semibold tracking-tight text-foreground tabular-nums">
              {passRate !== null ? `${passRate}%` : `${runs.length}`}
            </span>
            <span className="text-xs text-muted-foreground">
              {passRate !== null ? "pass rate" : "runs"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-border/50 pt-2 text-xs text-muted-foreground tabular-nums">
            <span>
              {passedRuns} passed{failedRuns > 0 ? ` · ${failedRuns} stopped` : ""}
            </span>
            <span className="font-mono">
              {totalDurationMs > 0 ? formatCompactDuration(totalDurationMs) : "0m"}
            </span>
          </div>
        </div>

        {/* KPI 3: Token Efficiency */}
        <div className="flex flex-col justify-between gap-3 rounded-xl border border-border/80 bg-card p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">Token volume</span>
            <CpuIcon className="size-4 text-muted-foreground/70" />
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-2xl font-semibold tracking-tight text-foreground tabular-nums">
              {formatCompactTokens(totalTokens)}
            </span>
            {cacheHitPct > 0 && (
              <span
                className="font-mono text-xs font-medium text-primary tabular-nums"
                title="Input cache hit rate = cache read / (uncached input + cache read)"
              >
                {cacheHitPct}% cache
              </span>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full bg-muted">
              {inputPct > 0 && (
                <div className="h-full bg-[var(--chart-2)]" style={{ width: `${inputPct}%` }} />
              )}
              {cachePct > 0 && (
                <div className="h-full bg-primary" style={{ width: `${cachePct}%` }} />
              )}
              {outputPct > 0 && (
                <div className="h-full bg-[var(--chart-5)]" style={{ width: `${outputPct}%` }} />
              )}
            </div>
            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              in {formatCompactTokens(totalInput)} · out {formatCompactTokens(totalOutput)}
            </span>
          </div>
        </div>

        {/* KPI 4: Spend + Trend Sparkline */}
        <div className="flex flex-col justify-between gap-3 rounded-xl border border-border/80 bg-card p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {engine === "antigravity" ? "Estimated spend" : "Total spend"}
            </span>
            <CoinsIcon className="size-4 text-muted-foreground/70" />
          </div>
          <div className="flex items-end justify-between gap-3">
            <span className="font-mono text-2xl font-semibold tracking-tight text-foreground tabular-nums">
              {engine === "antigravity" && totalCost > 0 ? "~" : ""}
              {formatUsd(totalCost)}
            </span>
            <SpendSparkline values={spendSparkValues} />
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-border/50 pt-2 font-mono text-xs text-muted-foreground tabular-nums">
            <span>{runs.length > 0 ? `${formatUsd(avgCost)} / run` : "No spend yet"}</span>
            <span>{runs.length} runs</span>
          </div>
        </div>
      </div>

      {/* 2. LIVE ACTIVITY STRIP (shown only when a build or BA chat is active) */}
      {(activeIssues.length > 0 || board.activeBaRun) && (
        <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-primary/30 bg-primary/[0.04]">
          {activeIssues.map((iss) => {
            const r = iss.latestRun!;
            const specsDone = r.specs.filter(
              (sp) => sp.impl === "ok" && (sp.test === "ok" || sp.test === "none"),
            ).length;
            return (
              <div
                key={iss.id}
                className="flex flex-wrap items-center justify-between gap-4 px-5 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <StatusDot status={r.status} />
                  <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-primary">
                    Live
                  </span>
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="font-mono text-xs font-semibold text-foreground">
                      {iss.issueKey}
                    </span>
                    <span className="truncate text-sm font-medium text-foreground">
                      {iss.title}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground tabular-nums">
                      · {r.currentPhase}
                      {r.specs.length > 0 ? ` · ${specsDone}/${r.specs.length} specs` : ""} ·{" "}
                      {formatUsd(r.costUsd)}
                    </span>
                  </div>
                </div>
                <Button
                  size="sm"
                  nativeButton={false}
                  render={<Link href={`/sessions/${r.runId}`} />}
                >
                  <EyeIcon data-icon="inline-start" />
                  Watch Live
                </Button>
              </div>
            );
          })}

          {board.activeBaRun && (
            <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <SparklesIcon className="size-4 shrink-0 text-primary" />
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="truncate text-sm font-medium text-foreground">
                    {board.activeBaRun.title}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    · BA Planning ({board.activeBaRun.currentPhase})
                  </span>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                render={<Link href={`/sessions/${board.activeBaRun.id}`} />}
              >
                Open BA Chat
              </Button>
            </div>
          )}
        </div>
      )}

      {/* 3. BENTO ANALYTICS ROW: 8-col Spider Chart + 4-col Tickets & Spend Breakdown */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <div className="xl:col-span-8">
          <ProjectRunsSpiderChart runs={runs} engine={engine} />
        </div>

        {/* Unified Right Summary Card (Tickets by Stage + Spend by Mode) */}
        <aside className="flex flex-col divide-y divide-border/60 rounded-xl border border-border/80 bg-card xl:col-span-4">
          {/* Tickets Breakdown */}
          <div className="flex flex-col gap-4 p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold tracking-tight text-foreground">
                Ticket distribution
              </h2>
              <button
                type="button"
                onClick={onOpenKanban}
                className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                Kanban
                <ArrowRightIcon className="size-3.5" />
              </button>
            </div>

            <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-muted">
              {totalIssues > 0 &&
                issueBuckets
                  .filter((b) => b.count > 0)
                  .map((b) => (
                    <div
                      key={b.label}
                      className="h-full transition-all duration-300"
                      style={{
                        width: `${(b.count / totalIssues) * 100}%`,
                        backgroundColor: b.color,
                      }}
                      title={`${b.label}: ${b.count}`}
                    />
                  ))}
            </div>

            <div className="flex flex-col gap-2.5">
              {issueBuckets.map((b) => (
                <div key={b.label} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: b.color }}
                    />
                    <span className={b.count > 0 ? "text-foreground" : ""}>{b.label}</span>
                  </span>
                  <div className="flex items-center gap-2 font-mono tabular-nums">
                    <span className="font-medium text-foreground">{b.count}</span>
                    <span className="w-8 text-right text-[11px] text-muted-foreground">
                      {totalIssues > 0 ? `${Math.round((b.count / totalIssues) * 100)}%` : "0%"}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {(urgentCount > 0 || highRiskCount > 0) && (
              <div className="flex flex-wrap items-center gap-3 border-t border-border/50 pt-3 text-xs text-muted-foreground">
                {urgentCount > 0 && (
                  <span>
                    <strong className="font-medium text-destructive">{urgentCount}</strong> urgent
                  </span>
                )}
                {highRiskCount > 0 && (
                  <span>
                    <strong className="font-medium text-warning">{highRiskCount}</strong> high risk
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Spend by Mode */}
          <div className="flex flex-1 flex-col gap-3.5 p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold tracking-tight text-foreground">
                Spend by mode
              </h2>
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                {runs.length} {runs.length === 1 ? "run" : "runs"}
              </span>
            </div>

            {modeCosts.length === 0 ? (
              <p className="py-4 text-xs text-muted-foreground">No spend recorded yet.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {modeCosts.map((mc) => {
                  const share = totalCost > 0 ? Math.round((mc.cost / totalCost) * 100) : 0;
                  return (
                    <div key={mc.mode} className="flex flex-col gap-1.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-medium capitalize text-foreground">
                            {mc.mode}
                          </span>
                          <span className="text-muted-foreground tabular-nums">
                            {mc.count} {mc.count === 1 ? "run" : "runs"}
                          </span>
                        </div>
                        <div className="flex items-center gap-2.5 font-mono tabular-nums">
                          <span className="text-muted-foreground">
                            {formatCompactTokens(mc.tokens)}
                          </span>
                          <span className="font-semibold text-foreground">
                            {formatUsd(mc.cost)}
                          </span>
                        </div>
                      </div>
                      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary/80 transition-all duration-300"
                          style={{ width: `${Math.max(share, mc.cost > 0 ? 4 : 0)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
