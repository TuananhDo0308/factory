"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowRightIcon,
  CheckCircle2Icon,
  CoinsIcon,
  CpuIcon,
  EyeIcon,
  LayersIcon,
  SparklesIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  formatCompactTokens,
  formatRelativeTime,
  formatUsd,
  StatusDot,
} from "@/components/factory/factory-primitives";
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

function Kpi({
  label,
  icon,
  value,
  foot,
  title,
}: {
  label: string;
  icon: React.ReactNode;
  value: React.ReactNode;
  foot: React.ReactNode;
  title?: string;
}) {
  return (
    <section
      title={title}
      className="flex min-h-[128px] flex-col justify-between gap-3 rounded-xl border border-border/80 bg-card p-5"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {icon}
      </div>
      <span className="font-mono text-3xl font-semibold tracking-tight text-foreground tabular-nums">
        {value}
      </span>
      <div className="border-t border-border/60 pt-2.5 font-mono text-xs text-muted-foreground tabular-nums">
        {foot}
      </div>
    </section>
  );
}

export function ProjectDashboard({
  board,
  onOpenKanban,
}: {
  board: ProjectBoardSnapshot;
  onOpenKanban: () => void;
}) {
  const tickets = board.issues;
  const merged = tickets.filter((i) => i.status === "passed").length;
  const needsDecision = tickets.filter((i) => i.status === "needs_human").length;
  const inProgress = tickets.filter((i) => i.status === "in_progress").length;
  const pct = tickets.length > 0 ? Math.round((merged / tickets.length) * 100) : 0;

  // Totals are summed server-side over every run of the project; each run's numbers are the
  // sum of its steps' increments, so nothing here is estimated or counted twice.
  const t = board.totals;
  const activeTokens = t.inputTokens + t.outputTokens;
  const cacheBase = t.inputTokens + t.cacheReadTokens;
  const cacheHitPct = cacheBase > 0 ? Math.round((t.cacheReadTokens / cacheBase) * 100) : 0;

  const activeEpics = board.epics.filter((e) => e.activeRunId);
  const deliveredEpics = board.epics.filter((e) => e.status === "passed").length;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Tickets merged into staging"
          icon={<CheckCircle2Icon className="size-4 text-primary/75" />}
          value={
            <>
              {merged}
              <span className="text-lg font-normal text-muted-foreground">/{tickets.length}</span>
            </>
          }
          foot={`${pct}% · ${inProgress} in progress · ${needsDecision} need a decision`}
        />
        <Kpi
          label="Epics"
          icon={<LayersIcon className="size-4 text-muted-foreground/70" />}
          value={board.epics.length}
          foot={`${deliveredEpics} delivered · ${activeEpics.length} running`}
        />
        <Kpi
          label="Tokens"
          icon={<CpuIcon className="size-4 text-muted-foreground/70" />}
          title={`Input (incl. cache writes): ${t.inputTokens.toLocaleString()} · Output: ${t.outputTokens.toLocaleString()} · Cache reads: ${t.cacheReadTokens.toLocaleString()}`}
          value={formatCompactTokens(activeTokens)}
          foot={`in ${formatCompactTokens(t.inputTokens)} · out ${formatCompactTokens(t.outputTokens)} · ${formatCompactTokens(t.cacheReadTokens)} cache reads (${cacheHitPct}%)`}
        />
        <Kpi
          label="Total spend"
          icon={<CoinsIcon className="size-4 text-muted-foreground/70" />}
          value={formatUsd(t.costUsd)}
          foot={`${t.runs} ${t.runs === 1 ? "run" : "runs"} · ${formatCompactDuration(t.durationMs)}`}
        />
      </div>

      {(activeEpics.length > 0 || board.activeBaRun) && (
        <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-primary/30 bg-primary/[0.04]">
          {activeEpics.map((e) => (
            <div key={e.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <StatusDot status="running" />
                <span className="font-mono text-xs font-semibold text-foreground">Epic #{e.number}</span>
                <span className="truncate text-sm font-medium text-foreground">{e.title}</span>
                {e.latestRun && (
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">
                    · {e.latestRun.currentPhase} · {e.mergedCount}/{e.ticketCount} merged ·{" "}
                    {formatUsd(e.latestRun.costUsd)}
                  </span>
                )}
              </div>
              <Button size="sm" nativeButton={false} render={<Link href={`/sessions/${e.activeRunId}`} />}>
                <EyeIcon data-icon="inline-start" />
                Watch
              </Button>
            </div>
          ))}
          {board.activeBaRun && (
            <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <SparklesIcon className="size-4 shrink-0 text-primary" />
                <span className="truncate text-sm font-medium text-foreground">{board.activeBaRun.title}</span>
              </div>
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                render={<Link href={`/sessions/${board.activeBaRun.id}`} />}
              >
                Open BA session
              </Button>
            </div>
          )}
        </div>
      )}

      <section className="flex flex-col gap-3 rounded-xl border border-border/80 bg-card p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">Recent runs</h2>
          <button
            type="button"
            onClick={onOpenKanban}
            className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Kanban
            <ArrowRightIcon className="size-3.5" />
          </button>
        </div>
        {board.runs.length === 0 ? (
          <p className="py-4 text-xs text-muted-foreground">No runs yet.</p>
        ) : (
          <div className="divide-y divide-border/60">
            {board.runs.slice(0, 12).map((r) => (
              <Link
                key={r.id}
                href={`/sessions/${r.id}`}
                className="flex items-center justify-between gap-3 py-2 text-xs hover:bg-muted/40"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <StatusDot status={r.status} />
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-2xs uppercase text-muted-foreground">
                    {r.mode === "epic" ? "epic" : "ba"}
                  </span>
                  <span className="truncate font-medium text-foreground">{r.title}</span>
                </span>
                <span className="flex shrink-0 items-center gap-3 font-mono text-xs text-muted-foreground tabular-nums">
                  <span>{r.currentPhase}</span>
                  <span>{formatCompactTokens(r.inputTokens + r.outputTokens)}</span>
                  <span className="text-foreground">{formatUsd(r.costUsd)}</span>
                  <span>{formatRelativeTime(r.updatedAt)}</span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
