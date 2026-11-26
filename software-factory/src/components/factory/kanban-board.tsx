"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CheckIcon,
  Columns3Icon,
  ExternalLinkIcon,
  EyeIcon,
  FileCodeIcon,
  GitPullRequestIcon,
  Link2Icon,
  MessageSquareIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  SparklesIcon,
  TableIcon,
  Trash2Icon,
  UserIcon,
  XCircleIcon,
  ZapIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
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
  formatCompactTokens,
  formatRelativeTime,
  formatUsd,
  StatusDot,
} from "@/components/factory/factory-primitives";
import { MarkdownContent } from "@/components/factory/markdown-content";
import {
  PrototypeStudio,
  toPrototypeViewModel,
} from "@/components/factory/prototype-viewer";
import type { EnrichedBoardIssue, ProjectBoardSnapshot } from "@/lib/board-data";
import { isFactoryInitIssue } from "@/lib/init-issue-shared";

const PIPELINE_PHASES = ["Spec", "Build", "Check", "Review", "QC"] as const;

type KanbanColumnId = "draft" | "ready" | "in_progress" | "review" | "done";

const COLUMNS: Array<{
  id: KanbanColumnId;
  title: string;
  dotStatus: string;
  matches: (status: string) => boolean;
}> = [
  {
    id: "draft",
    title: "Draft",
    dotStatus: "needs_human",
    matches: (s) => s === "backlog" || s === "needs_human",
  },
  {
    id: "ready",
    title: "Ready",
    dotStatus: "idle",
    matches: (s) => s === "ready",
  },
  {
    id: "in_progress",
    title: "In Progress",
    dotStatus: "in_progress",
    matches: (s) => s === "in_progress",
  },
  {
    id: "review",
    title: "Review",
    dotStatus: "blocked",
    matches: (s) => s === "in_review" || s === "blocked" || s === "failed",
  },
  {
    id: "done",
    title: "Done",
    dotStatus: "passed",
    matches: (s) => s === "passed",
  },
];

function priorityMeta(priority: string | null | undefined): {
  short: string;
  full: string;
  cls: string;
} {
  const p = (priority || "P2").toUpperCase();
  if (p === "P0") {
    return {
      short: "P0 · Urgent",
      full: "Priority P0 (Urgent / Critical)",
      cls: "border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300",
    };
  }
  if (p === "P1") {
    return {
      short: "P1 · High",
      full: "Priority P1 (High)",
      cls: "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    };
  }
  if (p === "P3") {
    return {
      short: "P3 · Low",
      full: "Priority P3 (Low)",
      cls: "border-border bg-muted text-muted-foreground",
    };
  }
  return {
    short: "P2 · Normal",
    full: "Priority P2 (Normal)",
    cls: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  };
}

function sizeMeta(complexity: string | null | undefined): {
  short: string;
  full: string;
} {
  const c = (complexity || "M").toUpperCase();
  if (c === "XS") return { short: "Size XS", full: "Size: XS (Extra Small)" };
  if (c === "S") return { short: "Size S", full: "Size: S (Small)" };
  if (c === "L") return { short: "Size L", full: "Size: L (Large)" };
  return { short: "Size M", full: "Size: M (Medium)" };
}

function riskMeta(tier: string | null | undefined): {
  label: string;
  cls: string;
} {
  const t = (tier || "medium").toLowerCase();
  if (t === "high") {
    return {
      label: "Risk: High",
      cls: "border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300",
    };
  }
  if (t === "low") {
    return {
      label: "Risk: Low",
      cls: "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    };
  }
  return {
    label: "Risk: Medium",
    cls: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  };
}

function autonomyLabel(autonomy: string | null | undefined): string {
  if (autonomy === "full_auto") return "Full auto";
  if (autonomy === "human_required") return "Manual review";
  return "Auto-build · Human merge";
}

function phaseIndex(phase: string | null | undefined): number {
  const p = (phase || "").toLowerCase();
  if (p.includes("verdict") || p.includes("done")) return 5;
  if (p.includes("qc")) return 4;
  if (p.includes("review")) return 3;
  if (p.includes("check")) return 2;
  if (p.includes("build") || p.includes("qa")) return 1;
  return 0;
}

function specStateBadge(state: string | undefined, label: string) {
  if (state === "ok") {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-[2px] border border-success/40 bg-success/10 px-1 py-0.5 font-mono text-[10px] text-success">
        <CheckIcon className="size-2.5" />
        {label}
      </span>
    );
  }
  if (state === "run") {
    return (
      <span className="inline-flex items-center gap-1 rounded-[2px] border border-primary/40 bg-primary/10 px-1 py-0.5 font-mono text-[10px] text-primary">
        <span className="size-1.5 animate-pulse rounded-full bg-primary" />
        {label}
      </span>
    );
  }
  if (state === "fail") {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-[2px] border border-destructive/40 bg-destructive/10 px-1 py-0.5 font-mono text-[10px] text-destructive">
        <XCircleIcon className="size-2.5" />
        {label}
      </span>
    );
  }
  if (state === "none") return null;
  return (
    <span className="inline-flex items-center rounded-[2px] border border-border bg-muted/40 px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
      {label}
    </span>
  );
}

function PhaseStepper({
  currentPhase,
  runStatus,
}: {
  currentPhase: string | null | undefined;
  runStatus: string | null | undefined;
}) {
  const isDone = runStatus === "passed";
  const isError = runStatus === "failed" || runStatus === "blocked";
  const activeIdx = isDone ? 5 : phaseIndex(currentPhase);

  return (
    <div className="grid grid-cols-5 gap-1">
      {PIPELINE_PHASES.map((phase, idx) => {
        const done = idx < activeIdx;
        const current = !isDone && idx === activeIdx;
        return (
          <div
            key={phase}
            className={`flex items-center justify-center gap-1 rounded-[2px] border px-1 py-0.5 font-mono text-[10px] ${
              done
                ? "border-success/35 bg-success/10 text-success"
                : current
                  ? isError
                    ? "border-destructive/40 bg-destructive/10 text-destructive"
                    : "border-primary/45 bg-primary/10 font-medium text-primary"
                  : "border-border/60 bg-muted/30 text-muted-foreground/70"
            }`}
          >
            {current && !isError && (
              <span className="size-1.5 animate-pulse rounded-full bg-primary" />
            )}
            <span className="truncate">{phase}</span>
          </div>
        );
      })}
    </div>
  );
}

export function KanbanBoard({
  project,
  canWrite,
  board,
  dispatchBusy = null,
  onDispatchPolicy,
  onRefresh,
}: {
  project: {
    id: string;
    name: string;
    slug: string;
    engine: string;
    defaultBranch: string;
    localPath: string | null;
  };
  canWrite: boolean;
  board: ProjectBoardSnapshot;
  dispatchBusy?: string | null;
  onDispatchPolicy?: (
    action: "start_auto" | "stop_auto" | "set_auto_approve",
    extra?: { autoApprove?: boolean },
  ) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const router = useRouter();
  const baSessionHref = `/sessions?project=${encodeURIComponent(project.id)}&skill=ba-ticket`;
  const [viewMode, setViewMode] = React.useState<"board" | "table">("board");
  const [selectedIssueId, setSelectedIssueId] = React.useState<string | null>(null);
  const [selectedProtoIdx, setSelectedProtoIdx] = React.useState<number>(0);
  const [busyKey, setBusyKey] = React.useState<string | null>(null);

  React.useEffect(() => {
    setSelectedProtoIdx(0);
  }, [selectedIssueId]);

  const selectedIssue = React.useMemo(
    () => board.issues.find((i) => i.id === selectedIssueId) ?? null,
    [board.issues, selectedIssueId],
  );

  const passedKeys = React.useMemo(
    () =>
      new Set(
        board.issues
          .filter((i) => i.status === "passed")
          .map((i) => i.issueKey.toUpperCase()),
      ),
    [board.issues],
  );

  const allIssueKeys = React.useMemo(
    () => new Set(board.issues.map((i) => i.issueKey.toUpperCase())),
    [board.issues],
  );

  const draftIssues = React.useMemo(
    () => board.issues.filter((i) => i.status === "backlog" || i.status === "needs_human"),
    [board.issues],
  );
  const readyCount = React.useMemo(
    () => board.issues.filter((i) => i.status === "ready").length,
    [board.issues],
  );

  function unmetDependencies(issue: EnrichedBoardIssue): string[] {
    return issue.dependsOn.filter((dep) => {
      const k = dep.trim().toUpperCase();
      return allIssueKeys.has(k) && !passedKeys.has(k);
    });
  }

  async function callDispatch(
    action: "confirm_all" | "confirm_and_run" | "run_issue" | "run_init" | "clarify_issue",
    extra?: { issueId?: string; issueIds?: string[]; autoApprove?: boolean },
  ) {
    setBusyKey(
      action === "clarify_issue"
        ? `clarify:${extra?.issueId || ""}`
        : extra?.issueId || action,
    );
    try {
      const res = await fetch(`/api/projects/${project.id}/dispatch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        autoApprove?: boolean;
        confirmedCount?: number;
        approvedCount?: number;
        needsInit?: boolean;
        code?: string;
        dispatched?: Array<{ issueKey: string; runId: string }>;
        skippedReason?: string | null;
        run?: { id: string; mode?: string };
        issueKey?: string;
        error?: string;
      } | null;

      if (!res.ok) {
        toast.error(data?.error || "Dispatch action failed");
        return;
      }

      const needsInit = Boolean(
        data?.needsInit || data?.skippedReason === "project_not_initialized",
      );
      if (action === "run_init" && data?.run) {
        toast.success("Opened interactive /factory init chat");
        router.push(`/sessions/${data.run.id}`);
        return;
      }
      if (action === "clarify_issue" && data?.run) {
        toast.success(`Opened /factory clarify for ${data.issueKey || "ticket"}`);
        router.push(`/sessions/${data.run.id}`);
        return;
      }
      if (action === "run_issue" && data?.run) {
        if (data.run.mode === "init") {
          toast.success("Opened interactive /factory init chat");
          router.push(`/sessions/${data.run.id}`);
          return;
        }
        toast.success(`Started unattended Factory build for ${data.issueKey || "ticket"}`);
      } else if (action === "confirm_all") {
        toast.success(
          needsInit
            ? `Confirmed ${data?.confirmedCount ?? 0} ticket(s) → Ready. Run /factory init once before building.`
            : `Confirmed ${data?.confirmedCount ?? 0} ticket(s) → Ready`,
        );
      } else {
        const modeLabel = data?.autoApprove ? "Full Auto" : "Auto-Run";
        const count = data?.dispatched?.length ?? 0;
        if (count > 0) {
          toast.success(
            `${modeLabel} active — started ${data!.dispatched!.map((d) => d.issueKey).join(", ")}`,
          );
        } else if (needsInit) {
          toast.warning(
            `Confirmed ${data?.confirmedCount ?? 0} ticket(s) — run /factory init once to unlock unattended builds`,
          );
        } else if (data?.skippedReason === "no_online_runner") {
          toast.warning(`${modeLabel} enabled, waiting for an online \`sf daemon\` runner`);
        } else {
          toast.success(
            `Confirmed ${data?.confirmedCount ?? 0} ticket(s) — ${modeLabel} enabled`,
          );
        }
      }
      await onRefresh();
    } finally {
      setBusyKey(null);
    }
  }

  async function updateIssueStatus(issueId: string, status: string) {
    setBusyKey(issueId);
    try {
      const res = await fetch(`/api/projects/${project.id}/issues/${issueId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(data?.error || "Could not update ticket status");
        return;
      }
      toast.success(`Moved ticket to ${status.replace("_", " ")}`);
      await onRefresh();
    } finally {
      setBusyKey(null);
    }
  }

  async function deleteIssue(issueId: string, key: string) {
    setBusyKey(issueId);
    try {
      const res = await fetch(`/api/projects/${project.id}/issues/${issueId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        toast.error("Could not delete ticket");
        return;
      }
      if (selectedIssueId === issueId) setSelectedIssueId(null);
      toast.success(`Deleted ${key}`);
      await onRefresh();
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Kanban Toolbar: Auto-Run & No-approval controls + Draft actions & View Switch */}
      {(canWrite || board.issues.length > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {canWrite && onDispatchPolicy && (
              <>
                <label
                  htmlFor="kanban-no-approval"
                  title="Auto-merge passed branches, skip human approval gates, and advance dependent tickets automatically"
                  className={`flex h-7 cursor-pointer items-center gap-2 rounded-md border px-2.5 text-xs transition-colors select-none ${
                    board.autoApprove
                      ? "border-primary/40 bg-primary/10 text-foreground"
                      : "border-border bg-card text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Switch
                    id="kanban-no-approval"
                    size="sm"
                    checked={board.autoApprove}
                    disabled={dispatchBusy !== null}
                    onCheckedChange={(checked) =>
                      void onDispatchPolicy("set_auto_approve", {
                        autoApprove: checked === true,
                      })
                    }
                  />
                  <span>No approval</span>
                </label>

                {board.autoDispatch ? (
                  <Button
                    variant="default"
                    size="sm"
                    disabled={dispatchBusy !== null}
                    onClick={() => void onDispatchPolicy("stop_auto")}
                  >
                    {dispatchBusy === "stop_auto" ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <PauseIcon data-icon="inline-start" />
                    )}
                    {board.autoApprove ? "Full Auto Active" : "Auto-Run Active"}
                  </Button>
                ) : (
                  <Button
                    variant={readyCount > 0 || board.autoApprove ? "default" : "outline"}
                    size="sm"
                    disabled={dispatchBusy !== null}
                    onClick={() =>
                      void onDispatchPolicy("start_auto", {
                        autoApprove: board.autoApprove,
                      })
                    }
                  >
                    {dispatchBusy === "start_auto" ? (
                      <Spinner data-icon="inline-start" />
                    ) : board.autoApprove ? (
                      <ZapIcon data-icon="inline-start" />
                    ) : (
                      <PlayIcon data-icon="inline-start" />
                    )}
                    {board.autoApprove
                      ? readyCount > 0
                        ? `Full Auto (${readyCount})`
                        : "Full Auto"
                      : readyCount > 0
                        ? `Auto-Run (${readyCount})`
                        : "Auto-Run"}
                  </Button>
                )}
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canWrite && draftIssues.length > 0 && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busyKey !== null}
                  onClick={() => void callDispatch("confirm_all")}
                >
                  {busyKey === "confirm_all" ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <CheckIcon data-icon="inline-start" />
                  )}
                  Confirm Drafts ({draftIssues.length})
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  disabled={busyKey !== null}
                  onClick={() =>
                    void callDispatch("confirm_and_run", { autoApprove: board.autoApprove })
                  }
                >
                  {busyKey === "confirm_and_run" ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <ZapIcon data-icon="inline-start" />
                  )}
                  {board.autoApprove ? "Confirm & Full Auto" : "Confirm & Auto-Run"}
                </Button>
              </>
            )}

            {board.issues.length > 0 && (
              <div className="flex items-center rounded-[3px] border bg-background p-0.5">
                <Button
                  type="button"
                  variant={viewMode === "board" ? "secondary" : "ghost"}
                  size="xs"
                  onClick={() => setViewMode("board")}
                >
                  <Columns3Icon data-icon="inline-start" />
                  Board
                </Button>
                <Button
                  type="button"
                  variant={viewMode === "table" ? "secondary" : "ghost"}
                  size="xs"
                  onClick={() => setViewMode("table")}
                >
                  <TableIcon data-icon="inline-start" />
                  Table
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Live BA Planner Banner */}
      {board.activeBaRun && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[4px] border border-primary/35 bg-primary/5 px-3.5 py-2.5 text-xs">
          <div className="flex min-w-0 items-center gap-2.5">
            <StatusDot
              status={
                board.activeBaRun.status === "awaiting_input" ? "waiting_on_you" : "working"
              }
            />
            <div className="flex min-w-0 flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span className="font-medium text-foreground">
                  {board.activeBaRun.status === "awaiting_input"
                    ? "BA finished drafting tickets — review & confirm"
                    : "BA Ticket Planner is analyzing your project..."}
                </span>
                <Badge variant="outline">{board.activeBaRun.currentPhase}</Badge>
              </div>
              <span className="truncate font-mono text-[11px] text-muted-foreground">
                {board.activeBaRun.activity || board.activeBaRun.title}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {canWrite && draftIssues.length > 0 && (
              <Button
                size="xs"
                disabled={busyKey !== null}
                onClick={() =>
                  void callDispatch("confirm_and_run", { autoApprove: board.autoApprove })
                }
              >
                <ZapIcon data-icon="inline-start" />
                {board.autoApprove ? "Confirm & Full Auto" : "Confirm & Auto-Run"} (
                {draftIssues.length})
              </Button>
            )}
            <Button
              size="xs"
              variant="outline"
              nativeButton={false}
              render={<Link href={`/sessions/${board.activeBaRun.id}`} />}
            >
              <EyeIcon data-icon="inline-start" />
              Watch BA Chat
            </Button>
          </div>
        </div>
      )}

      {/* Empty State */}
      {board.issues.length === 0 ? (
        <Empty className="border py-14">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SparklesIcon />
            </EmptyMedia>
            <EmptyTitle>No tickets on the board yet</EmptyTitle>
            <EmptyDescription>
              Run <code className="font-mono">/factory init</code> once per project, use{" "}
              <code className="font-mono">/ba-ticket</code> or{" "}
              <code className="font-mono">/factory clarify</code> to turn ideas into ready 1-PR
              tickets with <code className="font-mono">C1..Cn</code> criteria, then let the
              unattended Factory loop build through{" "}
              <code className="font-mono">Spec → Build → Check → Review → QC</code>.
            </EmptyDescription>
          </EmptyHeader>
          {canWrite && (
            <Button
              size="sm"
              nativeButton={false}
              render={<Link href={baSessionHref} />}
            >
              <SparklesIcon data-icon="inline-start" />
              Generate Tickets with BA
            </Button>
          )}
        </Empty>
      ) : viewMode === "board" ? (
        /* 5-COLUMN LINEAR-STYLE KANBAN BOARD — neutral surfaces, clean scannable cards */
        <div className="grid min-h-[460px] grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {COLUMNS.map((col) => {
            const items = board.issues.filter((iss) => col.matches(iss.status));
            return (
              <div
                key={col.id}
                className="flex max-h-[calc(100vh-230px)] min-h-[360px] flex-col overflow-hidden rounded-lg border border-border/70 bg-muted/25"
              >
                {/* Clean Column Header */}
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <StatusDot status={col.dotStatus} />
                    <span className="truncate text-xs font-medium text-foreground">
                      {col.title}
                    </span>
                  </div>
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">
                    {items.length}
                  </span>
                </div>

                {/* Scrollable Cards Stack */}
                <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
                  {items.length === 0 ? (
                    <div className="flex flex-1 items-center justify-center py-8 text-center text-xs text-muted-foreground/50">
                      No tickets
                    </div>
                  ) : (
                    items.map((iss) => {
                      const run = iss.latestRun;
                      const unmet = unmetDependencies(iss);
                      const totalCriteria =
                        run?.criteriaStatus.length || iss.criteria.length;
                      const specsDone =
                        run?.specs.filter(
                          (sp) => sp.impl === "ok" && (sp.test === "ok" || sp.test === "none"),
                        ).length ?? 0;
                      const activePhaseIdx =
                        run?.status === "passed"
                          ? 5
                          : phaseIndex(iss.currentPhase || run?.currentPhase);
                      const pUpper = (iss.priority || "P2").toUpperCase();
                      const isInit = isFactoryInitIssue(iss);

                      return (
                        <div
                          key={iss.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedIssueId(iss.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setSelectedIssueId(iss.id);
                            }
                          }}
                          className={`group flex cursor-pointer flex-col gap-2.5 rounded-md border bg-card p-3 text-left transition-colors hover:border-foreground/25 ${
                            iss.status === "in_progress"
                              ? "border-primary/45"
                              : iss.status === "failed" || iss.status === "blocked"
                                ? "border-destructive/45"
                                : isInit && col.id === "ready"
                                  ? "border-primary/40"
                                  : "border-border"
                          }`}
                        >
                          {/* Row 1: Key + Human Init badge or Priority (only P0/P1) + Criteria count */}
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-xs font-medium text-muted-foreground">
                                {iss.issueKey}
                              </span>
                              {isInit ? (
                                <span
                                  title="Assigned to human — discuss /factory init with AI"
                                  className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                                >
                                  <UserIcon className="size-2.5" />
                                  Human · Init
                                </span>
                              ) : (
                                <>
                                  {iss.status === "needs_human" && (
                                    <span
                                      title="Needs clarification before unattended Factory build"
                                      className="inline-flex items-center rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning"
                                    >
                                      Needs Info
                                    </span>
                                  )}
                                  {pUpper === "P0" && (
                                    <span
                                      title="Urgent priority"
                                      className="font-mono text-[10px] font-semibold text-destructive"
                                    >
                                      P0
                                    </span>
                                  )}
                                  {pUpper === "P1" && (
                                    <span
                                      title="High priority"
                                      className="font-mono text-[10px] font-semibold text-warning"
                                    >
                                      P1
                                    </span>
                                  )}
                                  {iss.tier === "high" && (
                                    <span
                                      title="High risk"
                                      className="size-1.5 rounded-full bg-warning"
                                    />
                                  )}
                                </>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5">
                              {iss.prototypes && iss.prototypes.length > 0 && (
                                <span
                                  title={`${iss.prototypes.length} interactive UI prototype(s) attached`}
                                  className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-primary"
                                >
                                  <EyeIcon className="size-2.5" />
                                  Proto
                                </span>
                              )}
                              <span
                                title={`${totalCriteria} acceptance criteria`}
                                className="font-mono text-[10px] text-muted-foreground"
                              >
                                {totalCriteria}C
                              </span>
                            </div>
                          </div>

                          {/* Row 2: Clean 2-line title (full spec/goal lives in the click-to-open Sheet) */}
                          <p className="line-clamp-2 text-xs font-medium leading-snug text-foreground">
                            {iss.title}
                          </p>

                          {/* Row 3 (optional): Minimal dependency pill when blocked */}
                          {unmet.length > 0 && col.id !== "done" && (
                            <div className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                              <Link2Icon className="size-3 shrink-0" />
                              <span className="truncate">Waiting on {unmet.join(", ")}</span>
                            </div>
                          )}

                          {/* Row 4 (optional): Compact slim pipeline progress for active/ran tickets */}
                          {run && !isInit && (
                            <div className="flex flex-col gap-1.5 pt-0.5">
                              <div className="grid grid-cols-5 gap-1">
                                {PIPELINE_PHASES.map((phase, idx) => {
                                  const done = idx < activePhaseIdx;
                                  const current = run.status !== "passed" && idx === activePhaseIdx;
                                  const isErr =
                                    current &&
                                    (run.status === "failed" ||
                                      run.status === "blocked" ||
                                      run.status === "stalled");
                                  return (
                                    <div
                                      key={phase}
                                      title={phase}
                                      className={`h-1 rounded-full ${
                                        done
                                          ? "bg-primary"
                                          : isErr
                                            ? "bg-destructive"
                                            : current
                                              ? "animate-pulse bg-primary/70"
                                              : "bg-muted"
                                      }`}
                                    />
                                  );
                                })}
                              </div>
                              <div className="flex items-center justify-between gap-2 font-mono text-[10px] text-muted-foreground tabular-nums">
                                <span className="truncate text-foreground/80">
                                  {iss.currentPhase || run.currentPhase}
                                  {run.specs.length > 0
                                    ? ` · ${specsDone}/${run.specs.length} specs`
                                    : ""}
                                </span>
                                {run.costUsd > 0 && <span>{formatUsd(run.costUsd)}</span>}
                              </div>
                              {run.pendingInteractionsCount > 0 && run.mode !== "factory" && (
                                <div className="flex items-center gap-1 text-[10px] font-medium text-warning">
                                  <AlertTriangleIcon className="size-3 shrink-0" />
                                  <span>{run.pendingInteractionsCount} waiting on you</span>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Row 5: Minimal action footer */}
                          <div
                            className="flex items-center justify-end gap-1.5 border-t border-border/50 pt-2"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {col.id === "draft" && canWrite && (
                              <>
                                {run &&
                                run.mode === "clarify" &&
                                (run.status === "running" ||
                                  run.status === "queued" ||
                                  run.status === "awaiting_input") ? (
                                  <Button
                                    size="xs"
                                    variant="outline"
                                    nativeButton={false}
                                    render={<Link href={`/sessions/${run.runId}`} />}
                                  >
                                    <MessageSquareIcon data-icon="inline-start" />
                                    Clarify Chat
                                  </Button>
                                ) : (
                                  <Button
                                    size="xs"
                                    variant="outline"
                                    disabled={busyKey === `clarify:${iss.id}`}
                                    onClick={() =>
                                      void callDispatch("clarify_issue", { issueId: iss.id })
                                    }
                                  >
                                    {busyKey === `clarify:${iss.id}` ? (
                                      <Spinner data-icon="inline-start" />
                                    ) : (
                                      <MessageSquareIcon data-icon="inline-start" />
                                    )}
                                    Clarify
                                  </Button>
                                )}
                                <Button
                                  size="xs"
                                  variant="secondary"
                                  disabled={busyKey === iss.id}
                                  onClick={() => void updateIssueStatus(iss.id, "ready")}
                                >
                                  {busyKey === iss.id ? (
                                    <Spinner data-icon="inline-start" />
                                  ) : (
                                    <CheckIcon data-icon="inline-start" />
                                  )}
                                  Confirm
                                </Button>
                              </>
                            )}

                            {col.id === "ready" && canWrite && (
                              <Button
                                size="xs"
                                variant={isInit ? "default" : "outline"}
                                title={
                                  !isInit && board.initStatus !== "complete"
                                    ? "Run /factory init once before building tickets"
                                    : undefined
                                }
                                disabled={
                                  busyKey === iss.id ||
                                  unmet.length > 0 ||
                                  (!isInit && board.initStatus !== "complete")
                                }
                                onClick={() =>
                                  void callDispatch("run_issue", { issueId: iss.id })
                                }
                              >
                                {busyKey === iss.id ? (
                                  <Spinner data-icon="inline-start" />
                                ) : isInit ? (
                                  <MessageSquareIcon data-icon="inline-start" />
                                ) : (
                                  <PlayIcon data-icon="inline-start" />
                                )}
                                {isInit ? "Start Init Chat" : "Run"}
                              </Button>
                            )}

                            {col.id === "in_progress" && run && (
                              <Button
                                size="xs"
                                variant={isInit ? "default" : "secondary"}
                                nativeButton={false}
                                render={<Link href={`/sessions/${run.runId}`} />}
                              >
                                {isInit ? (
                                  <MessageSquareIcon data-icon="inline-start" />
                                ) : (
                                  <EyeIcon data-icon="inline-start" />
                                )}
                                {isInit ? "Open Chat" : "Watch"}
                              </Button>
                            )}

                            {col.id === "review" && (
                              <>
                                {run && (
                                  <Button
                                    size="xs"
                                    variant="ghost"
                                    nativeButton={false}
                                    render={<Link href={`/sessions/${run.runId}`} />}
                                  >
                                    Inspect
                                  </Button>
                                )}
                                {canWrite && iss.status === "in_review" && (
                                  <Button
                                    size="xs"
                                    variant="default"
                                    disabled={busyKey === iss.id}
                                    onClick={() => void updateIssueStatus(iss.id, "passed")}
                                  >
                                    <CheckIcon data-icon="inline-start" />
                                    Done
                                  </Button>
                                )}
                                {canWrite &&
                                  (iss.status === "failed" || iss.status === "blocked") && (
                                    <>
                                      <Button
                                        size="xs"
                                        variant="secondary"
                                        disabled={busyKey === `clarify:${iss.id}`}
                                        onClick={() =>
                                          void callDispatch("clarify_issue", { issueId: iss.id })
                                        }
                                      >
                                        <MessageSquareIcon data-icon="inline-start" />
                                        Clarify
                                      </Button>
                                      <Button
                                        size="xs"
                                        variant="outline"
                                        disabled={
                                          busyKey === iss.id || board.initStatus !== "complete"
                                        }
                                        onClick={() =>
                                          void callDispatch("run_issue", { issueId: iss.id })
                                        }
                                      >
                                        <RotateCcwIcon data-icon="inline-start" />
                                        Retry
                                      </Button>
                                    </>
                                  )}
                              </>
                            )}

                            {col.id === "done" && (
                              <div className="flex w-full items-center justify-between">
                                <span className="flex items-center gap-1 text-[10px] text-success">
                                  <CheckCircle2Icon className="size-3" />
                                  Passed
                                </span>
                                {run && (
                                  <Button
                                    size="xs"
                                    variant="ghost"
                                    nativeButton={false}
                                    render={<Link href={`/sessions/${run.runId}`} />}
                                  >
                                    Inspect
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* TABLE VIEW */
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Key</TableHead>
                <TableHead>Title &amp; Criteria</TableHead>
                <TableHead>Specs</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Size &amp; Risk</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {board.issues.map((iss) => {
                const run = iss.latestRun;
                const activeLock = board.activeRunByIssueId[iss.id];
                return (
                  <TableRow
                    key={iss.id}
                    className="cursor-pointer"
                    onClick={() => setSelectedIssueId(iss.id)}
                  >
                    <TableCell className="font-mono text-xs font-medium">
                      {iss.issueKey}
                    </TableCell>
                    <TableCell className="max-w-md">
                      <div className="flex flex-col gap-0.5">
                        <span className="truncate font-medium">{iss.title}</span>
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {iss.criteria.length} criteria
                          {iss.dependsOn.length > 0
                            ? ` · depends on ${iss.dependsOn.join(", ")}`
                            : ""}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {run?.specs.length ? `${run.specs.length} spec(s)` : "—"}
                    </TableCell>
                    <TableCell>
                      <span
                        title={priorityMeta(iss.priority).full}
                        className={`inline-flex items-center rounded-[2px] border px-1.5 py-0.5 font-mono text-[11px] font-medium ${priorityMeta(iss.priority).cls}`}
                      >
                        {priorityMeta(iss.priority).short}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="inline-flex items-center rounded-[2px] border border-border bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                          {sizeMeta(iss.complexity).short}
                        </span>
                        <span
                          className={`inline-flex items-center rounded-[2px] border px-1.5 py-0.5 font-mono text-[11px] font-medium ${riskMeta(iss.tier).cls}`}
                        >
                          {riskMeta(iss.tier).label}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <span className="flex items-center gap-1.5 text-xs">
                          <StatusDot status={iss.status} />
                          <span>{iss.status}</span>
                          {iss.currentPhase && (
                            <span className="font-mono text-[11px] text-muted-foreground">
                              · {iss.currentPhase}
                            </span>
                          )}
                        </span>
                        {activeLock && (
                          <span className="font-mono text-[10px] text-primary">
                            locked by @{activeLock.triggeredBy}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell
                      className="text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {activeLock ? (
                        <Button
                          size="xs"
                          variant="secondary"
                          nativeButton={false}
                          render={<Link href={`/sessions/${activeLock.runId}`} />}
                        >
                          <EyeIcon data-icon="inline-start" />
                          Watch Live
                        </Button>
                      ) : iss.status === "backlog" || iss.status === "needs_human" ? (
                        <Button
                          size="xs"
                          variant="secondary"
                          disabled={!canWrite || busyKey === iss.id}
                          onClick={() => void updateIssueStatus(iss.id, "ready")}
                        >
                          <CheckIcon data-icon="inline-start" />
                          Confirm
                        </Button>
                      ) : (
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={!canWrite || busyKey === iss.id}
                          onClick={() => void callDispatch("run_issue", { issueId: iss.id })}
                        >
                          {busyKey === iss.id ? (
                            <Spinner data-icon="inline-start" />
                          ) : (
                            <PlayIcon data-icon="inline-start" />
                          )}
                          Run
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* TICKET & LIVE SPEC INSPECTOR SHEET */}
      <Sheet
        open={Boolean(selectedIssue)}
        onOpenChange={(open) => {
          if (!open) setSelectedIssueId(null);
        }}
      >
        <SheetContent
          side="right"
          className="w-full data-[side=right]:sm:max-w-2xl data-[side=right]:lg:max-w-3xl"
        >
          {selectedIssue && (
            <>
              <SheetHeader className="gap-2 border-b px-6 pt-5 pb-4">
                <div className="flex flex-wrap items-center gap-1.5 pr-10">
                  <Badge variant="outline">{selectedIssue.issueKey}</Badge>
                  <span
                    title={priorityMeta(selectedIssue.priority).full}
                    className={`inline-flex items-center rounded-[3px] border px-2 py-0.5 font-mono text-[11px] font-medium ${priorityMeta(selectedIssue.priority).cls}`}
                  >
                    {priorityMeta(selectedIssue.priority).short}
                  </span>
                  <span className="inline-flex items-center rounded-[3px] border border-border bg-muted/60 px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                    {sizeMeta(selectedIssue.complexity).full}
                  </span>
                  <span
                    className={`inline-flex items-center rounded-[3px] border px-2 py-0.5 font-mono text-[11px] font-medium ${riskMeta(selectedIssue.tier).cls}`}
                  >
                    {riskMeta(selectedIssue.tier).label}
                  </span>
                  <Badge variant="secondary">{autonomyLabel(selectedIssue.autonomy)}</Badge>
                </div>
                <SheetTitle className="text-lg leading-snug">{selectedIssue.title}</SheetTitle>
                {selectedIssue.goal && (
                  <SheetDescription className="text-sm leading-relaxed">
                    {selectedIssue.goal}
                  </SheetDescription>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">Status:</span>
                    <Select
                      value={selectedIssue.status}
                      disabled={!canWrite || busyKey === selectedIssue.id}
                      onValueChange={(v) => v && void updateIssueStatus(selectedIssue.id, v)}
                    >
                      <SelectTrigger className="h-8 w-44 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="backlog">backlog (Draft)</SelectItem>
                          <SelectItem value="needs_human">needs_human</SelectItem>
                          <SelectItem value="ready">ready</SelectItem>
                          <SelectItem value="in_progress">in_progress</SelectItem>
                          <SelectItem value="in_review">in_review</SelectItem>
                          <SelectItem value="blocked">blocked</SelectItem>
                          <SelectItem value="failed">failed</SelectItem>
                          <SelectItem value="passed">passed (Done)</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>

                  {selectedIssue.latestRun && (
                    <Button
                      size="sm"
                      variant="outline"
                      nativeButton={false}
                      render={<Link href={`/sessions/${selectedIssue.latestRun.runId}`} />}
                    >
                      <ExternalLinkIcon data-icon="inline-start" />
                      Open Live Run
                    </Button>
                  )}
                </div>
              </SheetHeader>

              <ScrollArea className="min-h-0 flex-1 px-6">
                <div className="flex flex-col gap-5 py-4">
                  {selectedIssue.status === "needs_human" && selectedIssue.summary && (
                    <div className="flex flex-col gap-1.5 rounded-[4px] border border-warning/40 bg-warning/10 p-3 text-xs">
                      <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-warning">
                        Needs Clarification (Returned from Factory)
                      </span>
                      <p className="whitespace-pre-wrap leading-relaxed text-foreground">
                        {selectedIssue.summary}
                      </p>
                    </div>
                  )}

                  {selectedIssue.latestRun && (
                    <div className="flex flex-col gap-2 rounded-[4px] border bg-muted/30 p-3">
                      <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                        <span className="flex items-center gap-1.5">
                          <StatusDot status={selectedIssue.latestRun.status} />
                          <span className="font-medium text-foreground">
                            {selectedIssue.latestRun.status} ·{" "}
                            {selectedIssue.latestRun.currentPhase}
                          </span>
                        </span>
                        <span className="text-muted-foreground tabular-nums">
                          {formatCompactTokens(
                            selectedIssue.latestRun.inputTokens +
                              selectedIssue.latestRun.outputTokens,
                          )}{" "}
                          · {formatUsd(selectedIssue.latestRun.costUsd)}
                        </span>
                      </div>
                      <PhaseStepper
                        currentPhase={
                          selectedIssue.currentPhase || selectedIssue.latestRun.currentPhase
                        }
                        runStatus={selectedIssue.latestRun.status}
                      />
                    </div>
                  )}

                  <Tabs
                    defaultValue={
                      selectedIssue.prototypes?.length
                        ? "prototype"
                        : selectedIssue.latestRun?.specs.length
                          ? "specs"
                          : "overview"
                    }
                  >
                    <TabsList className="w-full">
                      <TabsTrigger value="overview">
                        Criteria ({selectedIssue.criteria.length})
                      </TabsTrigger>
                      <TabsTrigger value="prototype">
                        Prototype ({selectedIssue.prototypes?.length ?? 0})
                      </TabsTrigger>
                      <TabsTrigger value="specs">
                        AI Specs ({selectedIssue.latestRun?.specs.length ?? 0})
                      </TabsTrigger>
                      <TabsTrigger value="agents">
                        Agents ({selectedIssue.latestRun?.agents.length ?? 0})
                      </TabsTrigger>
                    </TabsList>

                    {/* OVERVIEW & CRITERIA TAB */}
                    <TabsContent value="overview" className="flex flex-col gap-4 pt-3">
                      {selectedIssue.dependsOn.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 text-xs">
                          <span className="font-mono text-[11px] text-muted-foreground">
                            Depends on:
                          </span>
                          {selectedIssue.dependsOn.map((dep) => (
                            <Badge key={dep} variant="outline">
                              {dep}
                            </Badge>
                          ))}
                        </div>
                      )}

                      <div className="flex flex-col gap-2">
                        <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                          Acceptance Criteria
                        </span>
                        {selectedIssue.criteria.length === 0 ? (
                          <div className="rounded-[4px] border border-dashed p-3 text-xs text-muted-foreground">
                            No criteria listed.
                          </div>
                        ) : (
                          selectedIssue.criteria.map((c) => {
                            const liveCrit = selectedIssue.latestRun?.criteriaStatus.find(
                              (lc) => lc.id === c.id,
                            );
                            const st = liveCrit?.status;
                            return (
                              <div
                                key={c.id}
                                className="flex items-start gap-2.5 rounded-[4px] border bg-card p-3.5 text-sm"
                              >
                                {st === "met" ? (
                                  <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-success" />
                                ) : st === "not_met" ? (
                                  <XCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
                                ) : (
                                  <span className="mt-2 size-2 shrink-0 rounded-full bg-muted-foreground/40" />
                                )}
                                <div className="flex flex-col gap-1">
                                  <span className="font-mono text-xs font-semibold text-foreground">
                                    {c.id}
                                  </span>
                                  <span className="leading-relaxed text-foreground/85">
                                    {c.text}
                                  </span>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>

                      {selectedIssue.body && (
                        <div className="flex flex-col gap-2">
                          <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                            Specification &amp; Scope
                          </span>
                          <div className="rounded-[4px] border bg-card p-3">
                            <MarkdownContent content={selectedIssue.body} />
                          </div>
                        </div>
                      )}
                    </TabsContent>

                    {/* INTERACTIVE PROTOTYPE TAB */}
                    <TabsContent value="prototype" className="flex flex-col gap-3 pt-3">
                      {!selectedIssue.prototypes || selectedIssue.prototypes.length === 0 ? (
                        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">
                          <p>
                            No clickable prototype is attached to{" "}
                            <strong className="font-mono text-foreground">
                              {selectedIssue.issueKey}
                            </strong>{" "}
                            yet.
                          </p>
                          {canWrite && (
                            <Button
                              size="xs"
                              variant="outline"
                              disabled={busyKey === `clarify:${selectedIssue.id}`}
                              onClick={() =>
                                void callDispatch("clarify_issue", { issueId: selectedIssue.id })
                              }
                            >
                              <SparklesIcon data-icon="inline-start" />
                              Design Prototype in Clarify Chat
                            </Button>
                          )}
                        </div>
                      ) : (
                        <>
                          {selectedIssue.prototypes.length > 1 && (
                            <div className="flex flex-wrap items-center gap-1.5">
                              {selectedIssue.prototypes.map((proto, idx) => (
                                <Button
                                  key={proto.id}
                                  type="button"
                                  size="xs"
                                  variant={idx === selectedProtoIdx ? "secondary" : "outline"}
                                  onClick={() => setSelectedProtoIdx(idx)}
                                >
                                  {proto.title}
                                </Button>
                              ))}
                            </div>
                          )}
                          <div className="h-[520px]">
                            <PrototypeStudio
                              key={
                                (selectedIssue.prototypes[selectedProtoIdx] ??
                                  selectedIssue.prototypes[0]).id
                              }
                              prototype={toPrototypeViewModel(
                                selectedIssue.prototypes[selectedProtoIdx] ??
                                  selectedIssue.prototypes[0],
                              )}
                              projectId={project.id}
                              canWrite={canWrite}
                              compact
                              onUpdated={() => void onRefresh()}
                            />
                          </div>
                        </>
                      )}
                    </TabsContent>

                    {/* AI SPECS TAB */}
                    <TabsContent value="specs" className="flex flex-col gap-3 pt-3">
                      {!selectedIssue.latestRun || selectedIssue.latestRun.specs.length === 0 ? (
                        <div className="rounded-[4px] border border-dashed p-6 text-center text-xs text-muted-foreground">
                          AI-generated specs (<code className="font-mono">S1..Sn</code>) will
                          appear live here as soon as the Planner finishes the Spec phase.
                        </div>
                      ) : (
                        selectedIssue.latestRun.specs.map((sp) => (
                          <div
                            key={sp.id}
                            className="flex flex-col gap-2 rounded-[4px] border bg-card p-3 text-xs"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono font-semibold text-foreground">
                                  {sp.id}
                                </span>
                                <span className="font-medium text-foreground">
                                  {sp.title || "Untitled Spec"}
                                </span>
                                {sp.kind && <Badge variant="outline">{sp.kind}</Badge>}
                              </div>
                              <div className="flex items-center gap-1">
                                {specStateBadge(sp.impl, "Impl")}
                                {specStateBadge(sp.test, "QA")}
                              </div>
                            </div>

                            {sp.goal && (
                              <p className="leading-relaxed text-muted-foreground">{sp.goal}</p>
                            )}

                            {sp.criteria && sp.criteria.length > 0 && (
                              <div className="flex flex-wrap items-center gap-1">
                                <span className="font-mono text-[10px] text-muted-foreground">
                                  Covers:
                                </span>
                                {sp.criteria.map((cid) => (
                                  <Badge key={cid} variant="secondary">
                                    {cid}
                                  </Badge>
                                ))}
                              </div>
                            )}

                            {(sp.filesOwned?.length || sp.testFiles?.length) ? (
                              <div className="flex flex-col gap-1 rounded-[3px] border bg-muted/30 p-2 font-mono text-[11px]">
                                {sp.filesOwned?.map((f) => (
                                  <div key={f} className="flex items-center gap-1.5 truncate">
                                    <FileCodeIcon className="size-3 shrink-0 text-muted-foreground" />
                                    <span className="truncate">{f}</span>
                                  </div>
                                ))}
                                {sp.testFiles?.map((f) => (
                                  <div
                                    key={f}
                                    className="flex items-center gap-1.5 truncate text-muted-foreground"
                                  >
                                    <CheckCircle2Icon className="size-3 shrink-0" />
                                    <span className="truncate">{f}</span>
                                  </div>
                                ))}
                              </div>
                            ) : null}

                            {(sp.implNote || sp.testNote || sp.waitFor) && (
                              <div className="flex flex-col gap-0.5 font-mono text-[11px] text-muted-foreground">
                                {sp.waitFor && <span>Depends on spec: {sp.waitFor}</span>}
                                {sp.implNote && <span>{sp.implNote}</span>}
                                {sp.testNote && <span>{sp.testNote}</span>}
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </TabsContent>

                    {/* LIVE AGENTS & RECENT STEPS TAB */}
                    <TabsContent value="agents" className="flex flex-col gap-3 pt-3">
                      {!selectedIssue.latestRun ? (
                        <div className="rounded-[4px] border border-dashed p-6 text-center text-xs text-muted-foreground">
                          This ticket has not been run yet. Confirm it to Ready and click Run.
                        </div>
                      ) : (
                        <>
                          <div className="flex flex-col gap-1.5">
                            <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                              Agents ({selectedIssue.latestRun.agents.length})
                            </span>
                            {selectedIssue.latestRun.agents.map((ag) => (
                              <div
                                key={ag.id}
                                className="flex items-center justify-between gap-2 rounded-[4px] border bg-card px-2.5 py-2 text-xs"
                              >
                                <div className="flex min-w-0 items-center gap-2">
                                  <StatusDot status={ag.status} />
                                  <div className="flex min-w-0 flex-col">
                                    <span className="truncate font-medium">{ag.name}</span>
                                    <span className="truncate font-mono text-[11px] text-muted-foreground">
                                      {ag.activity || ag.role}
                                    </span>
                                  </div>
                                </div>
                                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                                  {formatRelativeTime(ag.updatedAt)}
                                </span>
                              </div>
                            ))}
                          </div>

                          {selectedIssue.latestRun.pullRequests.length > 0 && (
                            <div className="flex flex-col gap-1.5">
                              <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                                Pull Requests
                              </span>
                              {selectedIssue.latestRun.pullRequests.map((pr) => (
                                <div
                                  key={pr.id}
                                  className="flex items-center justify-between gap-2 rounded-[4px] border bg-card px-2.5 py-2 text-xs"
                                >
                                  <span className="flex items-center gap-1.5 truncate font-medium">
                                    <GitPullRequestIcon className="size-3.5 shrink-0" />
                                    #{pr.number} {pr.title}
                                  </span>
                                  <Badge variant="outline">{pr.state}</Badge>
                                </div>
                              ))}
                            </div>
                          )}

                          {selectedIssue.latestRun.recentSteps.length > 0 && (
                            <div className="flex flex-col gap-1.5">
                              <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                                Latest Trace Steps
                              </span>
                              {selectedIssue.latestRun.recentSteps.map((st) => (
                                <div
                                  key={st.id}
                                  className="flex items-center justify-between gap-2 rounded-[3px] border bg-card px-2.5 py-1.5 text-xs"
                                >
                                  <span className="flex min-w-0 items-center gap-1.5">
                                    <StatusDot status={st.status} />
                                    <span className="truncate font-mono text-[11px]">
                                      {st.label || st.step}
                                    </span>
                                  </span>
                                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                                    {st.phase} · {formatRelativeTime(st.createdAt)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </TabsContent>
                  </Tabs>
                </div>
              </ScrollArea>

              <SheetFooter className="border-t px-6 py-3.5 pr-16">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {canWrite && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busyKey === selectedIssue.id}
                      onClick={() =>
                        void deleteIssue(selectedIssue.id, selectedIssue.issueKey)
                      }
                    >
                      <Trash2Icon data-icon="inline-start" />
                      Delete
                    </Button>
                  )}

                  <div className="flex items-center gap-2">
                    {canWrite &&
                      (selectedIssue.status === "backlog" ||
                        selectedIssue.status === "needs_human" ||
                        selectedIssue.status === "blocked" ||
                        selectedIssue.status === "failed") && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyKey === `clarify:${selectedIssue.id}`}
                          onClick={() =>
                            void callDispatch("clarify_issue", { issueId: selectedIssue.id })
                          }
                        >
                          {busyKey === `clarify:${selectedIssue.id}` ? (
                            <Spinner data-icon="inline-start" />
                          ) : (
                            <MessageSquareIcon data-icon="inline-start" />
                          )}
                          Clarify
                        </Button>
                      )}
                    {canWrite &&
                      (selectedIssue.status === "backlog" ||
                        selectedIssue.status === "needs_human") && (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busyKey === selectedIssue.id}
                          onClick={() => void updateIssueStatus(selectedIssue.id, "ready")}
                        >
                          <CheckIcon data-icon="inline-start" />
                          Confirm → Ready
                        </Button>
                      )}
                    {canWrite &&
                      (selectedIssue.status === "ready" ||
                        selectedIssue.status === "blocked" ||
                        selectedIssue.status === "failed") && (
                        <Button
                          size="sm"
                          title={
                            board.initStatus !== "complete"
                              ? "Run /factory init once before building tickets"
                              : undefined
                          }
                          disabled={
                            busyKey === selectedIssue.id || board.initStatus !== "complete"
                          }
                          onClick={() =>
                            void callDispatch("run_issue", { issueId: selectedIssue.id })
                          }
                        >
                          {busyKey === selectedIssue.id ? (
                            <Spinner data-icon="inline-start" />
                          ) : (
                            <PlayIcon data-icon="inline-start" />
                          )}
                          Run Factory
                        </Button>
                      )}
                  </div>
                </div>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
