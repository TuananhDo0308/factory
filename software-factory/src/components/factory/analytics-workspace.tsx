"use client";

import * as React from "react";
import Link from "next/link";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import {
  ActivityIcon,
  ArrowDownIcon,
  ArrowRightIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  ClockIcon,
  CoinsIcon,
  FolderIcon,
  HandIcon,
  SearchIcon,
  SparklesIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatClockDuration,
  formatCompactTokens,
  formatUsd,
} from "@/components/factory/factory-primitives";
import type { getAnalyticsData } from "@/lib/workspace-data";

type AnalyticsPayload = Awaited<ReturnType<typeof getAnalyticsData>>;

type ChartMetric = "throughput" | "cost" | "tokens";
type SortField = "runs" | "passRate" | "tokens" | "avgCostUsd" | "role";

const chartConfig = {
  runs: {
    label: "Runs",
    color: "var(--chart-2)",
  },
  passed: {
    label: "Passed",
    color: "var(--chart-1)",
  },
  cost: {
    label: "Spend (USD)",
    color: "var(--chart-1)",
  },
  tokensK: {
    label: "Active Tokens (k)",
    color: "var(--chart-4)",
  },
} satisfies ChartConfig;

function formatShortDate(isoDay: string): string {
  // YYYY-MM-DD -> MM/DD for crisp X-axis legibility
  const parts = isoDay.split("-");
  if (parts.length === 3) return `${parts[1]}/${parts[2]}`;
  return isoDay;
}

export function AnalyticsWorkspace({ data }: { data: AnalyticsPayload }) {
  const { summary, dailySeries, projectBreakdown, scorecard } = data;
  const [chartMetric, setChartMetric] = React.useState<ChartMetric>("throughput");
  const [roleSearch, setRoleSearch] = React.useState("");
  const [sortField, setSortField] = React.useState<SortField>("runs");
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc");

  const activeTokens = summary.totalInputTokens + summary.totalOutputTokens;
  const inputSharePct = activeTokens > 0 ? (summary.totalInputTokens / activeTokens) * 100 : 0;
  const outputSharePct = activeTokens > 0 ? (summary.totalOutputTokens / activeTokens) * 100 : 0;

  const totalTime = summary.totalWorkMs + summary.totalWaitMs;
  const waitRatio = totalTime > 0 ? Math.round((summary.totalWaitMs / totalTime) * 100) : 0;
  const workRatio = totalTime > 0 ? 100 - waitRatio : 0;

  const autonomyLabel =
    summary.totalRuns === 0
      ? "No runs yet"
      : summary.avgInterventions <= 0.5
        ? "Hands-free"
        : summary.avgInterventions <= 2
          ? "Low touch"
          : "Interactive";

  const maxProjectCost = React.useMemo(
    () => Math.max(...projectBreakdown.map((p) => p.cost), 0.0001),
    [projectBreakdown],
  );
  const totalProjectCost = React.useMemo(
    () => projectBreakdown.reduce((s, p) => s + p.cost, 0),
    [projectBreakdown],
  );

  const filteredScorecard = React.useMemo(() => {
    const q = roleSearch.trim().toLowerCase();
    const list = scorecard.filter((s) => {
      if (q && !s.role.toLowerCase().includes(q) && !s.model.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
    return [...list].sort((a, b) => {
      const mul = sortDir === "asc" ? 1 : -1;
      if (sortField === "role") return a.role.localeCompare(b.role) * mul;
      return (a[sortField] - b[sortField]) * mul;
    });
  }, [scorecard, roleSearch, sortField, sortDir]);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((prev) => (prev === "desc" ? "asc" : "desc"));
    } else {
      setSortField(field);
      setSortDir(field === "role" ? "asc" : "desc");
    }
  }

  function renderSortIcon(field: SortField) {
    if (sortField !== field) {
      return <ArrowUpDownIcon className="size-3 opacity-45" aria-hidden="true" />;
    }
    return sortDir === "asc" ? (
      <ArrowUpIcon className="size-3 text-primary" aria-hidden="true" />
    ) : (
      <ArrowDownIcon className="size-3 text-primary" aria-hidden="true" />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
      {/* Page Header */}
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border/70 pb-4">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              Analytics &amp; Agent Effectiveness
            </h1>
            <Badge variant="outline" className="font-mono text-xs">
              Last 30 active days
            </Badge>
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Track throughput, active token efficiency, work-vs-wait autonomy ratio, and per-role
            model scorecards across all repositories.
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link href="/sessions" />}
        >
          <SparklesIcon data-icon="inline-start" />
          New Session
        </Button>
      </header>

      {/* Top 4 KPI Bento Grid (2+1 / 1+2 asymmetric matching Project Dashboard) */}
      <section
        aria-label="Analytics summary KPIs"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <div className="col-span-1 flex min-h-[144px] flex-col justify-between gap-4 rounded-xl border border-primary/20 bg-primary/[0.035] p-5 transition-colors hover:border-primary/35 sm:col-span-2 lg:col-span-2 dark:border-primary/25 dark:bg-primary/[0.06]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Total Runs · Pass Rate
            </span>
            <ActivityIcon className="size-4 text-primary/75" aria-hidden="true" />
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-mono text-3xl font-semibold tracking-tight text-foreground tabular-nums">
              {summary.totalRuns}
            </span>
            <span className="rounded-md bg-primary/12 px-2 py-0.5 font-mono text-xs font-medium text-primary tabular-nums">
              {summary.passRate !== null ? `${summary.passRate}% pass rate` : "No finished runs"}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-primary/15">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${summary.passRate ?? 0}%` }}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground tabular-nums">
              <span>
                {summary.passedRuns} passed across {summary.projectCount}{" "}
                {summary.projectCount === 1 ? "project" : "projects"}
              </span>
              <span className="font-mono text-foreground/80">
                {formatCompactTokens(activeTokens)} active tok
              </span>
            </div>
          </div>
        </div>

        <div
          title={`Active tokens: ${activeTokens.toLocaleString()} (in ${summary.totalInputTokens.toLocaleString()} · out ${summary.totalOutputTokens.toLocaleString()}) · Cached reads: ${summary.totalCacheReadTokens.toLocaleString()} (${summary.cacheHitRate}% cache hit)`}
          className="col-span-1 flex min-h-[144px] flex-col justify-between gap-4 rounded-xl border border-border/80 bg-card p-5 transition-colors hover:border-border"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Total Spend · Cache Hit
            </span>
            <CoinsIcon className="size-4 text-muted-foreground/70" aria-hidden="true" />
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-3xl font-semibold tracking-tight text-foreground tabular-nums">
              {formatUsd(summary.totalCostUsd)}
            </span>
            <span className="rounded-md bg-primary/10 px-2 py-0.5 font-mono text-xs font-medium text-primary tabular-nums">
              {summary.cacheHitRate}% cache
            </span>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full bg-muted">
              {inputSharePct > 0 && (
                <div className="h-full bg-[var(--chart-2)]" style={{ width: `${inputSharePct}%` }} />
              )}
              {outputSharePct > 0 && (
                <div
                  className="h-full bg-[var(--chart-5)]"
                  style={{ width: `${outputSharePct}%` }}
                />
              )}
            </div>
            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              in {formatCompactTokens(summary.totalInputTokens)} · out{" "}
              {formatCompactTokens(summary.totalOutputTokens)}
            </span>
          </div>
        </div>

        <div className="col-span-1 flex min-h-[144px] flex-col justify-between gap-4 rounded-xl border border-border/80 bg-card p-5 transition-colors hover:border-border">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Work Time vs Wait Time
            </span>
            <ClockIcon className="size-4 text-muted-foreground/70" aria-hidden="true" />
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-2xl font-semibold tracking-tight text-foreground tabular-nums">
              {formatClockDuration(summary.totalWorkMs)}
            </span>
            <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground tabular-nums">
              {waitRatio}% wait
            </span>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full bg-muted">
              {workRatio > 0 && (
                <div className="h-full bg-primary" style={{ width: `${workRatio}%` }} />
              )}
              {waitRatio > 0 && (
                <div className="h-full bg-[var(--warning)]" style={{ width: `${waitRatio}%` }} />
              )}
            </div>
            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              Agent {workRatio}% · Human wait {formatClockDuration(summary.totalWaitMs)}
            </span>
          </div>
        </div>

        <div className="col-span-1 flex min-h-[144px] flex-col justify-between gap-4 rounded-xl border border-border/80 bg-card p-5 transition-colors hover:border-border sm:col-span-2 lg:col-span-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Avg Human Interventions
            </span>
            <HandIcon className="size-4 text-muted-foreground/70" aria-hidden="true" />
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-3xl font-semibold tracking-tight text-foreground tabular-nums">
                {summary.avgInterventions}
              </span>
              <span className="text-sm text-muted-foreground">/ run</span>
            </div>
            <Badge variant="outline" className="font-mono text-xs">
              {autonomyLabel}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2.5 text-xs text-muted-foreground">
            <span>Lower interventions indicate higher unattended factory reliability</span>
            <span className="font-mono text-foreground/80 tabular-nums">
              {formatCompactTokens(summary.totalCacheReadTokens)} cached reads
            </span>
          </div>
        </div>
      </section>

      {/* Main Analytics Row: 7-col Multi-Metric Time-Series + 5-col Project Breakdown */}
      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-7">
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-4">
            <div className="flex flex-col gap-1">
              <CardTitle className="text-sm font-semibold">
                {chartMetric === "throughput"
                  ? "Daily Throughput (Runs vs Passed)"
                  : chartMetric === "cost"
                    ? "Daily Estimated Spend (USD)"
                    : "Daily Active Token Volume (k)"}
              </CardTitle>
              <CardDescription className="text-xs">
                {dailySeries.length > 0
                  ? `${dailySeries.length} active day${dailySeries.length === 1 ? "" : "s"} recorded`
                  : "Last 30 active days across all projects"}
              </CardDescription>
            </div>

            <div
              role="group"
              aria-label="Chart metric view"
              className="inline-flex items-center rounded-md border border-border bg-muted/40 p-0.5"
            >
              {(
                [
                  { id: "throughput", label: "Throughput" },
                  { id: "cost", label: "Spend" },
                  { id: "tokens", label: "Tokens" },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setChartMetric(m.id)}
                  className={`cursor-pointer rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    chartMetric === m.id
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </CardHeader>

          <CardContent className="pt-4">
            {dailySeries.length === 0 ? (
              <Empty className="border border-dashed py-10">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ActivityIcon />
                  </EmptyMedia>
                  <EmptyTitle>No run telemetry yet</EmptyTitle>
                  <EmptyDescription>
                    Start a session or Factory build from Software Factory Web to populate daily
                    throughput, spend, and token charts.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button
                    type="button"
                    size="sm"
                    nativeButton={false}
                    render={<Link href="/sessions" />}
                  >
                    Start a Session
                    <ArrowRightIcon data-icon="inline-end" />
                  </Button>
                </EmptyContent>
              </Empty>
            ) : (
              <div className="flex flex-col gap-3">
                {/* Accessible Series Legend (never color-only) */}
                <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                  {chartMetric === "throughput" ? (
                    <>
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="size-2.5 rounded-[2px]"
                          style={{ backgroundColor: "var(--color-runs, var(--chart-2))" }}
                        />
                        Total Runs
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="size-2.5 rounded-[2px]"
                          style={{ backgroundColor: "var(--color-passed, var(--chart-1))" }}
                        />
                        Passed
                      </span>
                    </>
                  ) : chartMetric === "cost" ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="size-2.5 rounded-full"
                        style={{ backgroundColor: "var(--chart-1)" }}
                      />
                      Daily Spend (USD)
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="size-2.5 rounded-full"
                        style={{ backgroundColor: "var(--chart-4)" }}
                      />
                      Active Tokens (in + out, thousands)
                    </span>
                  )}
                </div>

                <ChartContainer config={chartConfig} className="h-60 w-full">
                  {chartMetric === "throughput" ? (
                    <BarChart data={dailySeries} barGap={4}>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis
                        dataKey="date"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        tickFormatter={formatShortDate}
                      />
                      <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={32} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="runs" fill="var(--color-runs)" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="passed" fill="var(--color-passed)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  ) : chartMetric === "cost" ? (
                    <AreaChart data={dailySeries}>
                      <defs>
                        <linearGradient id="analyticsCostFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--color-cost)" stopOpacity={0.28} />
                          <stop offset="95%" stopColor="var(--color-cost)" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis
                        dataKey="date"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        tickFormatter={formatShortDate}
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        width={44}
                        tickFormatter={(v) => `$${Number(v).toFixed(2)}`}
                      />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Area
                        type="monotone"
                        dataKey="cost"
                        stroke="var(--color-cost)"
                        strokeWidth={2}
                        fill="url(#analyticsCostFill)"
                      />
                    </AreaChart>
                  ) : (
                    <AreaChart data={dailySeries}>
                      <defs>
                        <linearGradient id="analyticsTokensFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--color-tokensK)" stopOpacity={0.28} />
                          <stop offset="95%" stopColor="var(--color-tokensK)" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis
                        dataKey="date"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        tickFormatter={formatShortDate}
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        width={42}
                        tickFormatter={(v) => `${v}k`}
                      />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Area
                        type="monotone"
                        dataKey="tokensK"
                        stroke="var(--color-tokensK)"
                        strokeWidth={2}
                        fill="url(#analyticsTokensFill)"
                      />
                    </AreaChart>
                  )}
                </ChartContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Ranked Project Spend & Reliability Comparison */}
        <Card className="flex flex-col lg:col-span-5">
          <CardHeader className="border-b border-border/60 pb-4">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <FolderIcon className="size-4 text-primary" aria-hidden="true" />
                Spend by Project
              </CardTitle>
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                {projectBreakdown.length} {projectBreakdown.length === 1 ? "repo" : "repos"}
              </span>
            </div>
            <CardDescription className="text-xs">
              Sorted descending by total cost with run pass ratio.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col pt-4">
            {projectBreakdown.length === 0 ? (
              <Empty className="border border-dashed py-10">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FolderIcon />
                  </EmptyMedia>
                  <EmptyTitle>No project spend yet</EmptyTitle>
                  <EmptyDescription>
                    Costs and pass counts aggregate per project automatically as runs finish.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="flex max-h-68 flex-col gap-3.5 overflow-y-auto pr-1">
                {projectBreakdown.map((p) => {
                  const barPct =
                    p.cost > 0 ? Math.max(4, Math.round((p.cost / maxProjectCost) * 100)) : 0;
                  const sharePct =
                    totalProjectCost > 0 ? Math.round((p.cost / totalProjectCost) * 100) : 0;
                  const passPct = p.runs > 0 ? Math.round((p.passed / p.runs) * 100) : 0;
                  return (
                    <div key={p.project} className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate font-medium text-foreground">{p.project}</span>
                          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-2xs text-muted-foreground tabular-nums">
                            {p.passed}/{p.runs} ({passPct}%)
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-2 font-mono tabular-nums">
                          {sharePct > 0 && (
                            <span className="text-xs text-muted-foreground">{sharePct}%</span>
                          )}
                          <span className="font-semibold text-foreground">{formatUsd(p.cost)}</span>
                        </div>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary/85 transition-all duration-300"
                          style={{ width: `${barPct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Sortable & Filterable Agent / Model Scorecard (Agent CV) */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
          <div className="flex flex-col gap-1">
            <CardTitle className="text-sm font-semibold">
              Agent &amp; Model Scorecard (Agent CV)
            </CardTitle>
            <CardDescription className="text-xs">
              Compare reliability, active token consumption, and average cost by role and model
              tier. Click column headers to sort.
            </CardDescription>
          </div>

          {scorecard.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-48 sm:w-56">
                <SearchIcon
                  className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  value={roleSearch}
                  onChange={(e) => setRoleSearch(e.target.value)}
                  placeholder="Search role or model…"
                  aria-label="Search agent role or model"
                  className="h-8 pl-8 text-xs"
                />
              </div>

            </div>
          )}
        </CardHeader>

        <CardContent className="p-0">
          {filteredScorecard.length === 0 ? (
            <div className="p-6">
              <Empty className="border border-dashed py-8">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <SparklesIcon />
                  </EmptyMedia>
                  <EmptyTitle>
                    {scorecard.length === 0
                      ? "No agent scorecards recorded yet"
                      : "No agents match this filter"}
                  </EmptyTitle>
                  <EmptyDescription>
                    {scorecard.length === 0
                      ? "Agent role metrics populate automatically as orchestrators and subagents complete runs."
                      : "Try clearing the search query."}
                  </EmptyDescription>
                </EmptyHeader>
                {scorecard.length > 0 && (
                  <EmptyContent>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setRoleSearch("");
                      }}
                      className="cursor-pointer"
                    >
                      Reset filters
                    </Button>
                  </EmptyContent>
                )}
              </Empty>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead
                      className="pl-5"
                      aria-sort={
                        sortField === "role"
                          ? sortDir === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort("role")}
                        className="inline-flex cursor-pointer items-center gap-1 font-medium text-muted-foreground transition-colors hover:text-foreground"
                      >
                        Role
                        {renderSortIcon("role")}
                      </button>
                    </TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead
                      className="text-right"
                      aria-sort={
                        sortField === "runs"
                          ? sortDir === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort("runs")}
                        className="inline-flex cursor-pointer items-center gap-1 font-medium text-muted-foreground transition-colors hover:text-foreground"
                      >
                        Executions
                        {renderSortIcon("runs")}
                      </button>
                    </TableHead>
                    <TableHead
                      aria-sort={
                        sortField === "passRate"
                          ? sortDir === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort("passRate")}
                        className="inline-flex cursor-pointer items-center gap-1 font-medium text-muted-foreground transition-colors hover:text-foreground"
                      >
                        Pass Rate
                        {renderSortIcon("passRate")}
                      </button>
                    </TableHead>
                    <TableHead
                      className="text-right"
                      aria-sort={
                        sortField === "tokens"
                          ? sortDir === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort("tokens")}
                        className="inline-flex cursor-pointer items-center gap-1 font-medium text-muted-foreground transition-colors hover:text-foreground"
                      >
                        Active Tokens
                        {renderSortIcon("tokens")}
                      </button>
                    </TableHead>
                    <TableHead
                      className="pr-5 text-right"
                      aria-sort={
                        sortField === "avgCostUsd"
                          ? sortDir === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort("avgCostUsd")}
                        className="inline-flex cursor-pointer items-center gap-1 font-medium text-muted-foreground transition-colors hover:text-foreground"
                      >
                        Avg Cost
                        {renderSortIcon("avgCostUsd")}
                      </button>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredScorecard.map((s) => (
                    <TableRow key={`${s.role}-${s.model}`}>
                      <TableCell className="pl-5 font-medium capitalize text-foreground">
                        {s.role.replace(/-/g, " ")}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {s.model}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {s.runs}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                            <div
                              className={`h-full rounded-full ${
                                s.passRate >= 80
                                  ? "bg-primary"
                                  : s.passRate >= 50
                                    ? "bg-[var(--warning)]"
                                    : "bg-destructive"
                              }`}
                              style={{ width: `${s.passRate}%` }}
                            />
                          </div>
                          <span className="font-mono text-xs tabular-nums">{s.passRate}%</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {formatCompactTokens(s.tokens)}
                      </TableCell>
                      <TableCell className="pr-5 text-right font-mono text-xs font-medium tabular-nums">
                        {formatUsd(s.avgCostUsd)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
