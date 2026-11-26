"use client";

import * as React from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ActivityIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
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

const chartConfig = {
  runs: {
    label: "Runs",
    color: "var(--chart-1)",
  },
  passed: {
    label: "Passed",
    color: "var(--chart-3)",
  },
  cost: {
    label: "Cost (USD)",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

export function AnalyticsWorkspace({ data }: { data: AnalyticsPayload }) {
  const { summary, dailySeries, projectBreakdown, scorecard } = data;
  const totalTime = summary.totalWorkMs + summary.totalWaitMs;
  const waitRatio =
    totalTime > 0 ? Math.round((summary.totalWaitMs / totalTime) * 100) : 0;

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-medium tracking-tight">Analytics &amp; Agent Effectiveness</h1>
        <p className="text-sm text-muted-foreground">
          Token efficiency, Work Time vs Human Wait Time, and per-role Model Scorecards.
        </p>
      </div>

      {/* Top 4 KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Runs · Pass Rate</CardDescription>
            <CardTitle className="font-mono text-2xl tabular-nums">
              {summary.totalRuns}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                ({summary.passRate !== null ? `${summary.passRate}%` : "—"})
              </span>
            </CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Spend · Cache Hit</CardDescription>
            <CardTitle className="font-mono text-2xl tabular-nums">
              {formatUsd(summary.totalCostUsd)}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                ({summary.cacheHitRate}% cached)
              </span>
            </CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Work Time vs Wait Time</CardDescription>
            <CardTitle className="font-mono text-lg tabular-nums">
              {formatClockDuration(summary.totalWorkMs)}{" "}
              <span className="text-xs font-normal text-muted-foreground">
                / {formatClockDuration(summary.totalWaitMs)} ({waitRatio}% wait)
              </span>
            </CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Avg Human Interventions</CardDescription>
            <CardTitle className="font-mono text-2xl tabular-nums">
              {summary.avgInterventions}{" "}
              <span className="text-sm font-normal text-muted-foreground">/ run</span>
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Daily Runs & Cost Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Daily Throughput (Runs vs Passed)</CardTitle>
            <CardDescription>Last 30 active days across all projects</CardDescription>
          </CardHeader>
          <CardContent>
            {dailySeries.length === 0 ? (
              <Empty className="py-8">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ActivityIcon />
                  </EmptyMedia>
                  <EmptyTitle>No run metrics yet</EmptyTitle>
                  <EmptyDescription>
                    Run a Factory session or sync runs via{" "}
                    <code className="font-mono">sf</code> to populate charts.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ChartContainer config={chartConfig} className="h-56 w-full">
                <BarChart data={dailySeries}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} />
                  <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="runs" fill="var(--color-runs)" radius={4} />
                  <Bar dataKey="passed" fill="var(--color-passed)" radius={4} />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Spend by Project</CardTitle>
            <CardDescription>Aggregate cost and pass counts per repository</CardDescription>
          </CardHeader>
          <CardContent>
            {projectBreakdown.length === 0 ? (
              <div className="rounded-md border border-dashed p-8 text-center text-xs text-muted-foreground">
                No project spend data recorded yet.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead>Runs</TableHead>
                    <TableHead>Passed</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projectBreakdown.map((p) => (
                    <TableRow key={p.project}>
                      <TableCell className="font-medium">{p.project}</TableCell>
                      <TableCell className="font-mono text-xs">{p.runs}</TableCell>
                      <TableCell className="font-mono text-xs">{p.passed}</TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {formatUsd(p.cost)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Agent / Model Scorecard (Agent CV) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Agent &amp; Model Scorecard (Agent CV)</CardTitle>
          <CardDescription>
            Compare reliability and cost by role, model tier, and engine to optimize routing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {scorecard.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">
              Agent performance stats populate automatically as runs execute.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Role</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Engine</TableHead>
                  <TableHead>Executions</TableHead>
                  <TableHead>Pass Rate</TableHead>
                  <TableHead>Tokens</TableHead>
                  <TableHead className="text-right">Avg Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scorecard.map((s) => (
                  <TableRow key={`${s.role}-${s.model}-${s.engine}`}>
                    <TableCell className="font-medium capitalize">{s.role}</TableCell>
                    <TableCell className="font-mono text-xs">{s.model}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{s.engine}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{s.runs}</TableCell>
                    <TableCell className="font-mono text-xs">{s.passRate}%</TableCell>
                    <TableCell className="font-mono text-xs">
                      {formatCompactTokens(s.tokens)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {formatUsd(s.avgCostUsd)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
