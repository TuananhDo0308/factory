"use client";

import * as React from "react";
import { GitMergeIcon } from "lucide-react";
import { buildEpicGantt, type GanttAgentInput, type GanttBar } from "@/lib/epic-gantt";
import { cn } from "@/lib/utils";

const ROLE_STYLE: Record<string, { bar: string; dot: string; label: string }> = {
  implementer: { bar: "bg-chart-2", dot: "bg-chart-2", label: "Implement" },
  reviewer: { bar: "bg-chart-1", dot: "bg-chart-1", label: "Review" },
  diagnoser: { bar: "bg-chart-5", dot: "bg-chart-5", label: "Diagnose" },
  qc: { bar: "bg-chart-4", dot: "bg-chart-4", label: "QC" },
};
const OTHER_STYLE = { bar: "bg-muted-foreground/60", dot: "bg-muted-foreground/60", label: "Other" };

const LANE_PX = 18;

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function Bar({ bar, onInspect }: { bar: GanttBar; onInspect: (id: string) => void }) {
  const style = ROLE_STYLE[bar.role] ?? OTHER_STYLE;
  const isFix = /^fix\b/i.test(bar.task);
  const failed = bar.status === "failed" || bar.status === "blocked";
  return (
    <button
      type="button"
      onClick={() => onInspect(bar.id)}
      title={`${bar.name}\n${fmtDuration(bar.endMs - bar.startMs)} · ${bar.status}`}
      style={{ left: `${bar.left}%`, width: `${bar.width}%`, top: bar.lane * LANE_PX + 3 }}
      className={cn(
        "group absolute flex h-3 min-w-1 cursor-pointer items-center overflow-hidden rounded-sm transition-[filter,box-shadow] hover:brightness-110 hover:ring-2 hover:ring-foreground/25",
        style.bar,
        isFix && "opacity-70 [background-image:repeating-linear-gradient(135deg,transparent_0_3px,rgb(255_255_255/0.35)_3px_5px)]",
        failed && "ring-2 ring-destructive",
        bar.running && "animate-pulse",
      )}
    />
  );
}

export function EpicGantt({
  runStartedAt,
  runFinishedAt,
  agents,
  tickets,
  mergedAt,
  onInspectAgent,
}: {
  runStartedAt: string;
  runFinishedAt: string | null;
  agents: GanttAgentInput[];
  tickets: Array<{ number: number; key: string | null; title: string }>;
  mergedAt: Map<number, string>;
  onInspectAgent: (agentId: string) => void;
}) {
  const live = !runFinishedAt;
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, [live]);

  const g = React.useMemo(
    () =>
      buildEpicGantt({
        runStartedAt,
        runFinishedAt,
        nowMs: now,
        agents,
        mergedAt,
        tickets: tickets.map((t) => t.number),
      }),
    [runStartedAt, runFinishedAt, now, agents, mergedAt, tickets],
  );
  const titleOf = new Map(tickets.map((t) => [t.number, t]));
  const roles = [...new Set(g.rows.flatMap((r) => r.bars.map((b) => b.role)))];
  const workMs = g.rows.flatMap((r) => r.bars).reduce((s, b) => s + (b.endMs - b.startMs), 0);
  const wallMs = g.endMs - g.startMs;

  if (g.rows.every((r) => r.bars.length === 0)) return null;

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-4 py-2.5">
        <div className="flex items-baseline gap-3">
          <span className="text-sm font-medium">Timeline</span>
          <span className="font-mono text-2xs text-muted-foreground tabular-nums">
            up to {g.peak} agents at once · {fmtDuration(workMs)} of agent work in {fmtDuration(wallMs)}
            {wallMs > 0 ? ` (${(workMs / wallMs).toFixed(1)}× parallel)` : ""}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-2xs text-muted-foreground">
          {roles.map((r) => {
            const s = ROLE_STYLE[r] ?? OTHER_STYLE;
            return (
              <span key={r} className="flex items-center gap-1.5">
                <span className={cn("h-2 w-3 rounded-sm", s.dot)} />
                {s.label}
              </span>
            );
          })}
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-3 rounded-sm bg-chart-2 opacity-70 [background-image:repeating-linear-gradient(135deg,transparent_0_3px,rgb(255_255_255/0.35)_3px_5px)]" />
            Fix round
          </span>
          <span className="flex items-center gap-1">
            <GitMergeIcon className="size-3 text-purple-500" />
            Merged
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[640px] px-4 py-3">
          {/* Axis */}
          <div className="flex">
            <div className="w-64 shrink-0" />
            <div className="relative h-5 flex-1">
              {g.ticks.map((t) => (
                <span
                  key={t.left}
                  className="absolute -translate-x-1/2 font-mono text-2xs text-muted-foreground tabular-nums first:translate-x-0"
                  style={{ left: `${t.left}%` }}
                >
                  {t.label}
                </span>
              ))}
            </div>
          </div>

          {g.rows.map((row) => {
            const meta = row.ticket !== null ? titleOf.get(row.ticket) : undefined;
            return (
              <div key={row.ticket ?? "epic"} className="group/row flex items-stretch border-t border-border/50">
                <div className="flex w-64 shrink-0 items-center gap-1.5 py-1.5 pr-3 text-xs">
                  <span className="w-8 shrink-0 font-mono text-2xs text-muted-foreground">
                    {row.ticket !== null ? `#${row.ticket}` : "QC"}
                  </span>
                  <span className="truncate" title={meta?.title}>
                    {row.ticket === null ? "Final check & QC" : meta?.title ?? `Ticket #${row.ticket}`}
                  </span>
                </div>
                <div
                  className="relative flex-1 group-hover/row:bg-muted/30"
                  style={{ height: row.lanes * LANE_PX + 6 }}
                >
                  {g.ticks.map((t) => (
                    <span key={t.left} className="absolute inset-y-0 w-px bg-border/50" style={{ left: `${t.left}%` }} />
                  ))}
                  {row.bars.map((b) => (
                    <Bar key={b.id} bar={b} onInspect={onInspectAgent} />
                  ))}
                  {row.mergedAt !== null && (
                    <span
                      className="absolute top-1/2 flex size-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border bg-background"
                      style={{ left: `${row.mergedAt}%` }}
                      title={`#${row.ticket} merged into staging`}
                    >
                      <GitMergeIcon className="size-2.5 text-purple-500" />
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
