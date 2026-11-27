"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
  ExternalLinkIcon,
  TerminalIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DecisionAnswer } from "@/components/factory/decision-answer";
import {
  formatClockDuration,
  formatCompactTokens,
  formatRelativeTime,
  formatUsd,
  StatusDot,
} from "@/components/factory/factory-primitives";
import { EPIC_PHASES, epicPhaseIndex, summarizeAgentsByTicket, type StepKind } from "@/lib/epics";
import { formatModelLabel } from "@/lib/models";
import type { RunDetailData } from "@/lib/workspace-data";

type Step = RunDetailData["steps"][number];

function stepData(step: Step): Record<string, unknown> | null {
  return step.data && typeof step.data === "object" && !Array.isArray(step.data)
    ? (step.data as Record<string, unknown>)
    : null;
}

function stepKind(step: Step): StepKind | string {
  return String(stepData(step)?.kind ?? "");
}

const MILESTONE_KINDS = new Set(["lifecycle", "ticket", "alarm", "epic", "turn_metrics"]);

function ticketStatusLabel(status: string): string {
  switch (status) {
    case "ready":
      return "ready";
    case "in_progress":
      return "running";
    case "blocked":
      return "waiting / blocked";
    case "needs_human":
      return "needs a decision";
    case "passed":
      return "merged";
    default:
      return status.replace(/_/g, " ");
  }
}

function Kpi({ label, value, foot }: { label: string; value: React.ReactNode; foot?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border bg-card px-4 py-3">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="truncate font-mono text-xl font-semibold tabular-nums text-foreground">{value}</span>
      {foot && <span className="truncate font-mono text-xs text-muted-foreground tabular-nums">{foot}</span>}
    </div>
  );
}

function StepLine({ step }: { step: Step }) {
  const data = stepData(step);
  const kind = stepKind(step);
  let text = step.label || step.step;
  if (kind === "tool_call") {
    const input = data?.input;
    const inputText =
      typeof input === "string" ? input : input && typeof input === "object" ? JSON.stringify(input) : "";
    text = `${String(data?.tool ?? step.label ?? "tool")}${inputText ? ` ${inputText}` : ""}`;
  } else if (kind === "ticket") {
    text = `#${String(data?.issue ?? "?")} → ${String(data?.status ?? "")}${
      Number(data?.rounds) > 0 ? ` (round ${String(data?.rounds)})` : ""
    }`;
  } else if (kind === "alarm") {
    text = `Alarm on #${String(data?.issue ?? "?")} at ${String(data?.step ?? "?")}: ${String(data?.reason ?? "")}${
      data?.handled ? " (handled)" : ""
    }`;
  } else if (kind === "epic") {
    text = `Epic #${String(data?.epic ?? "?")} · ${String(data?.repo ?? "")}`;
  } else if (kind === "turn_metrics") {
    text = `turn: ${formatUsd(Number(data?.costUsd) || 0)} · ${Math.round((Number(data?.durationMs) || 0) / 1000)}s`;
  } else if (kind === "assistant_message" && step.summary) {
    text = step.summary;
  }
  return (
    <div className="flex items-start gap-2 px-3 py-1.5 text-xs">
      <span className="mt-1.5">
        <StatusDot status={kind === "alarm" ? "failed" : step.status} />
      </span>
      <span className="w-14 shrink-0 font-mono text-2xs text-muted-foreground">{step.phase}</span>
      <span className="min-w-0 flex-1">
        {step.agentId && step.role && step.role !== "human" && (
          <span className="mr-1.5 font-mono text-2xs text-muted-foreground">{step.agentId}</span>
        )}
        <span className={`break-words ${kind === "alarm" ? "text-destructive" : "text-foreground/90"}`}>
          {text.length > 400 ? `${text.slice(0, 400)}…` : text}
        </span>
      </span>
      <span className="shrink-0 font-mono text-2xs text-muted-foreground" suppressHydrationWarning>
        {formatRelativeTime(step.createdAt)}
      </span>
    </div>
  );
}

export function EpicRunView({
  run,
  elapsedMs,
  onRefresh,
  onInspectAgent,
  onOpenChat,
}: {
  run: RunDetailData;
  elapsedMs: number;
  onRefresh: () => Promise<void> | void;
  onInspectAgent: (agentId: string) => void;
  onOpenChat?: () => void;
}) {
  const [showActivity, setShowActivity] = React.useState(false);
  const tickets = run.epicTickets ?? [];
  const merged = tickets.filter((t) => t.status === "passed").length;
  const groups = React.useMemo(() => summarizeAgentsByTicket(run.agents), [run.agents]);
  const groupByTicket = new Map(groups.map((g) => [g.ticket, g]));
  const decisions = run.interactions.filter((i) => i.type === "decision" && i.status === "pending");
  const alarms = run.steps.filter((s) => stepKind(s) === "alarm");
  const openAlarms = alarms.filter((s) => !stepData(s)?.handled);
  const phaseIdx = epicPhaseIndex(run.currentPhase);
  const finished = ["passed", "failed", "blocked", "cancelled", "stalled"].includes(run.status);
  const epicStep = run.steps.find((s) => stepKind(s) === "epic");
  const epicUrl = typeof stepData(epicStep as Step)?.url === "string" ? String(stepData(epicStep as Step)?.url) : null;

  const timeline = React.useMemo(() => {
    const list = showActivity ? run.steps : run.steps.filter((s) => MILESTONE_KINDS.has(stepKind(s)) || !stepKind(s));
    return list.slice(-300).reverse();
  }, [run.steps, showActivity]);

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-5">
        {/* Phases */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid flex-1 grid-cols-5 gap-1">
            {EPIC_PHASES.map((phase, idx) => {
              const done = finished ? run.status === "passed" || idx < phaseIdx : idx < phaseIdx;
              const current = !finished && idx === phaseIdx;
              return (
                <div
                  key={phase}
                  className={`flex items-center justify-center gap-1 rounded border px-2 py-1 font-mono text-xs ${
                    done
                      ? "border-success/35 bg-success/10 text-success"
                      : current
                        ? "border-primary/45 bg-primary/10 font-medium text-primary"
                        : "border-border/60 bg-muted/30 text-muted-foreground/70"
                  }`}
                >
                  {current && <span className="size-1.5 animate-pulse rounded-full bg-primary" />}
                  {phase}
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            {epicUrl && (
              <Button size="xs" variant="ghost" nativeButton={false} render={<a href={epicUrl} target="_blank" rel="noreferrer" />}>
                <ExternalLinkIcon data-icon="inline-start" />
                Epic on GitHub
              </Button>
            )}
            {onOpenChat && (
              <Button size="xs" variant="outline" onClick={onOpenChat}>
                <TerminalIcon data-icon="inline-start" />
                Agent traces
              </Button>
            )}
          </div>
        </div>

        {/* KPIs: the run's own totals (summed server-side from step increments) */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Kpi
            label="Status"
            value={<span className="capitalize">{run.status.replace(/_/g, " ")}</span>}
            foot={run.currentPhase}
          />
          <Kpi label="Elapsed" value={formatClockDuration(elapsedMs)} foot={`${run.agents.length} agents`} />
          <Kpi
            label="Tickets merged"
            value={`${merged}/${tickets.length}`}
            foot={decisions.length > 0 ? `${decisions.length} need a decision` : "into staging"}
          />
          <Kpi
            label="Tokens"
            value={formatCompactTokens(run.inputTokens + run.outputTokens)}
            foot={`in ${formatCompactTokens(run.inputTokens)} · out ${formatCompactTokens(run.outputTokens)} · cache ${formatCompactTokens(run.cacheReadTokens)}`}
          />
          <Kpi label="Cost" value={formatUsd(run.costUsd)} foot={run.runner ? `on ${run.runner.name}` : undefined} />
        </div>

        {run.summary && finished && (
          <div className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-xs text-foreground/90">
            {run.summary}
          </div>
        )}

        {/* Decisions */}
        {decisions.length > 0 && (
          <div className="flex flex-col gap-2">
            {decisions.map((d) => (
              <DecisionAnswer
                key={d.id}
                runId={run.id}
                interactionId={d.id}
                issue={Number(d.payload.issue) || null}
                question={String(d.payload.question ?? d.prompt ?? "")}
                reason={String(d.payload.reason ?? "")}
                onAnswered={() => void onRefresh()}
              />
            ))}
          </div>
        )}

        {/* Alarms */}
        {alarms.length > 0 && (
          <div className="flex flex-col gap-1 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs">
            <span className="flex items-center gap-1.5 font-medium text-destructive">
              <AlertTriangleIcon className="size-3.5" />
              Alarms ({openAlarms.length} open of {alarms.length})
            </span>
            {alarms.slice(-10).map((a) => {
              const d = stepData(a) ?? {};
              return (
                <div key={a.id} className="flex items-center justify-between gap-2 font-mono text-xs">
                  <span className={d.handled ? "text-muted-foreground line-through" : "text-foreground"}>
                    #{String(d.issue ?? "?")} · {String(d.step ?? "?")} · {String(d.reason ?? "")}
                  </span>
                  <span className="text-muted-foreground" suppressHydrationWarning>
                    {formatRelativeTime(a.createdAt)}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Tickets with their agents */}
        <div className="overflow-hidden rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Ticket</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Agents</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="pr-4 text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tickets.length === 0 && groups.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-xs text-muted-foreground">
                    Waiting for the orchestrator to plan the epic…
                  </TableCell>
                </TableRow>
              )}
              {tickets.map((t) => {
                const g = t.githubIssueNumber ? groupByTicket.get(t.githubIssueNumber) : undefined;
                return (
                  <React.Fragment key={t.id}>
                    <TableRow>
                      <TableCell className="pl-4">
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="flex items-center gap-1.5 text-xs font-medium">
                            <span className="font-mono text-muted-foreground">{t.issueKey}</span>
                            {t.ticketKey && <span className="font-mono text-2xs text-muted-foreground">{t.ticketKey}</span>}
                            <span className="truncate">{t.title}</span>
                          </span>
                          <span className="font-mono text-2xs text-muted-foreground">
                            size {t.complexity}
                            {t.wave !== null ? ` · wave ${t.wave}` : ""}
                            {(t.rounds ?? 0) > 0 ? ` · round ${t.rounds}` : ""}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5 text-xs">
                          {t.status === "passed" ? (
                            <CheckCircle2Icon className="size-3.5 text-success" />
                          ) : t.status === "ready" ? (
                            <CircleDashedIcon className="size-3.5 text-muted-foreground" />
                          ) : (
                            <StatusDot status={t.status} />
                          )}
                          {ticketStatusLabel(t.status)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {(g?.agents ?? []).map((a) => (
                            <button
                              key={a.id}
                              type="button"
                              onClick={() => onInspectAgent(a.id)}
                              title={`${a.name} · ${formatModelLabel(a.model)} · ${formatCompactTokens(a.inputTokens + a.outputTokens)} tokens · ${formatUsd(a.costUsd)}`}
                              className="inline-flex cursor-pointer items-center gap-1 rounded border bg-muted/40 px-1.5 py-0.5 font-mono text-2xs hover:border-foreground/30"
                            >
                              <StatusDot status={a.status} />
                              {a.role}
                            </button>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {g ? formatCompactTokens(g.inputTokens + g.outputTokens) : "—"}
                      </TableCell>
                      <TableCell className="pr-4 text-right font-mono text-xs tabular-nums">
                        {g ? formatUsd(g.costUsd) : "—"}
                      </TableCell>
                    </TableRow>
                  </React.Fragment>
                );
              })}
              {groups
                .filter((g) => g.ticket === null || !tickets.some((t) => t.githubIssueNumber === g.ticket))
                .map((g) => (
                  <TableRow key={`g-${g.ticket ?? "epic"}`}>
                    <TableCell className="pl-4 text-xs font-medium">
                      {g.ticket === null ? "Epic (QC and others)" : `#${g.ticket}`}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">—</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {g.agents.map((a) => (
                          <button
                            key={a.id}
                            type="button"
                            onClick={() => onInspectAgent(a.id)}
                            title={`${a.name} · ${formatModelLabel(a.model)}`}
                            className="inline-flex cursor-pointer items-center gap-1 rounded border bg-muted/40 px-1.5 py-0.5 font-mono text-2xs hover:border-foreground/30"
                          >
                            <StatusDot status={a.status} />
                            {a.role}
                          </button>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {formatCompactTokens(g.inputTokens + g.outputTokens)}
                    </TableCell>
                    <TableCell className="pr-4 text-right font-mono text-xs tabular-nums">
                      {formatUsd(g.costUsd)}
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>

        {/* Agents */}
        {run.agents.length > 0 && (
          <div className="overflow-hidden rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Agent</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">In / out / cache</TableHead>
                  <TableHead className="pr-4 text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.flatMap((g) =>
                  g.agents.map((a) => (
                    <TableRow key={a.id} className="cursor-pointer" onClick={() => onInspectAgent(a.id)}>
                      <TableCell className="pl-4">
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate text-xs font-medium">{a.name}</span>
                          {a.activity && a.status === "working" && (
                            <span className="truncate text-2xs text-muted-foreground">{a.activity}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{a.role}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {formatModelLabel(a.model)}
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5 text-xs">
                          <StatusDot status={a.status} />
                          {a.status.replace(/_/g, " ")}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {formatCompactTokens(a.inputTokens)} / {formatCompactTokens(a.outputTokens)} /{" "}
                        {formatCompactTokens(a.cacheReadTokens)}
                      </TableCell>
                      <TableCell className="pr-4 text-right font-mono text-xs tabular-nums">
                        {formatUsd(a.costUsd)}
                      </TableCell>
                    </TableRow>
                  )),
                )}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Steps timeline */}
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
            <span className="text-xs font-medium">Steps ({run.steps.length})</span>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <Switch size="sm" checked={showActivity} onCheckedChange={(v) => setShowActivity(v === true)} />
              Agent activity
            </label>
          </div>
          <div className="max-h-[520px] divide-y divide-border/50 overflow-y-auto">
            {timeline.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">No steps yet.</div>
            ) : (
              timeline.map((s) => <StepLine key={s.id} step={s} />)
            )}
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            size="xs"
            variant="ghost"
            nativeButton={false}
            render={<Link href={`/projects/${run.project.id}?tab=issues`} />}
          >
            Open the board
          </Button>
        </div>
      </div>
    </ScrollArea>
  );
}
