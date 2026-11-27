"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ExternalLinkIcon,
  EyeIcon,
  GitBranchIcon,
  HelpCircleIcon,
  Link2Icon,
  PlayIcon,
  RotateCcwIcon,
  SparklesIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { DecisionAnswer } from "@/components/factory/decision-answer";
import {
  formatCompactTokens,
  formatRelativeTime,
  formatUsd,
  StatusDot,
} from "@/components/factory/factory-primitives";
import { MarkdownContent } from "@/components/factory/markdown-content";
import { PrototypeStudio, toPrototypeViewModel } from "@/components/factory/prototype-viewer";
import { formatModelLabel } from "@/lib/models";
import type { BoardEpic, EnrichedBoardIssue, ProjectBoardSnapshot } from "@/lib/board-data";

type ColumnId = "ready" | "in_progress" | "blocked" | "needs_human" | "done";

const COLUMNS: Array<{ id: ColumnId; title: string; dot: string; matches: (s: string) => boolean }> = [
  { id: "ready", title: "Ready", dot: "idle", matches: (s) => s === "ready" || s === "backlog" },
  { id: "in_progress", title: "In progress", dot: "in_progress", matches: (s) => s === "in_progress" || s === "in_review" },
  { id: "blocked", title: "Waiting / blocked", dot: "blocked", matches: (s) => s === "blocked" || s === "failed" },
  { id: "needs_human", title: "Needs decision", dot: "needs_human", matches: (s) => s === "needs_human" },
  { id: "done", title: "Merged", dot: "passed", matches: (s) => s === "passed" },
];

const ALL = "all";
const NO_EPIC = "none";

function statusLabel(status: string): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "in_progress":
      return "In progress";
    case "blocked":
      return "Waiting / blocked";
    case "needs_human":
      return "Needs decision";
    case "passed":
      return "Merged";
    case "failed":
      return "Failed";
    default:
      return status.replace(/_/g, " ");
  }
}

function sumAgents(issue: EnrichedBoardIssue) {
  return issue.agents.reduce(
    (acc, a) => ({
      cost: acc.cost + a.costUsd,
      tokens: acc.tokens + a.inputTokens + a.outputTokens,
    }),
    { cost: 0, tokens: 0 },
  );
}

function RunEpicDialog({
  epic,
  projectId,
  open,
  onOpenChange,
  onStarted,
}: {
  epic: BoardEpic | null;
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStarted: (runId: string) => void;
}) {
  const [createStaging, setCreateStaging] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function start() {
    if (!epic) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/epics/${epic.number}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ createStaging, note: note.trim() || undefined }),
      });
      const data = (await res.json().catch(() => null)) as {
        run?: { id: string };
        activeRunId?: string;
        dispatchedToRunner?: string;
        error?: string;
      } | null;
      if (!res.ok || !data?.run) {
        toast.error(data?.error || "Could not start the epic run");
        if (data?.activeRunId) onStarted(data.activeRunId);
        return;
      }
      toast.success(`Epic #${epic.number} queued on "${data.dispatchedToRunner}"`);
      onOpenChange(false);
      onStarted(data.run.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Run epic #{epic?.number}</DialogTitle>
          <DialogDescription>
            new-factory builds every ready ticket of this epic in its own worktree and merges each
            one into <code className="font-mono">staging</code> as soon as it passes. It never
            touches <code className="font-mono">main</code>. A run that stopped goes on from its
            state.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-xs">
          <label className="flex cursor-pointer items-start gap-2">
            <Checkbox
              checked={createStaging}
              onCheckedChange={(checked) => setCreateStaging(checked === true)}
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium text-foreground">Create staging if missing</span>
              <span className="text-muted-foreground">
                Creates the <code className="font-mono">staging</code> branch from{" "}
                <code className="font-mono">main</code> when the repository has none.
              </span>
            </span>
          </label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note for the run"
            className="min-h-14 text-xs"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void start()} disabled={busy || !epic}>
            {busy ? <Spinner data-icon="inline-start" /> : <PlayIcon data-icon="inline-start" />}
            Run epic
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EpicHeader({
  epic,
  canWrite,
  onRun,
}: {
  epic: BoardEpic;
  canWrite: boolean;
  onRun: (epic: BoardEpic) => void;
}) {
  const run = epic.latestRun;
  const pct = epic.ticketCount > 0 ? Math.round((epic.mergedCount / epic.ticketCount) * 100) : 0;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusDot status={epic.status} />
          <span className="font-mono text-xs font-semibold text-muted-foreground">Epic #{epic.number}</span>
          <span className="truncate text-sm font-medium text-foreground">{epic.title}</span>
          {epic.url && (
            <a
              href={epic.url}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:text-foreground"
              title="Open on GitHub"
            >
              <ExternalLinkIcon className="size-3.5" />
            </a>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground tabular-nums">
          <span>
            {epic.mergedCount}/{epic.ticketCount} merged ({pct}%)
          </span>
          {run && (
            <span>
              last run {run.status} · {run.currentPhase} · {formatUsd(run.costUsd)} ·{" "}
              {formatRelativeTime(run.updatedAt)}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {epic.activeRunId ? (
          <Button
            size="sm"
            variant="secondary"
            nativeButton={false}
            render={<Link href={`/sessions/${epic.activeRunId}`} />}
          >
            <EyeIcon data-icon="inline-start" />
            Watch run
          </Button>
        ) : (
          <>
            {run && (
              <Button
                size="sm"
                variant="ghost"
                nativeButton={false}
                render={<Link href={`/sessions/${run.id}`} />}
              >
                Last run
              </Button>
            )}
            {canWrite && (
              <Button size="sm" onClick={() => onRun(epic)}>
                {run ? <RotateCcwIcon data-icon="inline-start" /> : <PlayIcon data-icon="inline-start" />}
                Run epic
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function TicketCard({
  issue,
  unmet,
  onOpen,
}: {
  issue: EnrichedBoardIssue;
  unmet: string[];
  onOpen: () => void;
}) {
  const totals = sumAgents(issue);
  const working = issue.agents.filter((a) => a.status === "working").length;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={`flex cursor-pointer flex-col gap-2 rounded-md border bg-card p-3 text-left transition-colors hover:border-foreground/25 ${
        issue.status === "in_progress"
          ? "border-primary/45"
          : issue.status === "needs_human"
            ? "border-primary/60"
            : issue.status === "failed"
              ? "border-destructive/45"
              : "border-border"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-xs font-medium text-muted-foreground">{issue.issueKey}</span>
          {issue.ticketKey && (
            <span className="font-mono text-2xs text-muted-foreground/80">{issue.ticketKey}</span>
          )}
          {issue.decision && <HelpCircleIcon className="size-3 text-primary" />}
        </div>
        <div className="flex items-center gap-1.5 font-mono text-2xs text-muted-foreground">
          {issue.wave !== null && <span title="Wave">W{issue.wave}</span>}
          <span title="Size">{issue.complexity}</span>
          <span title="Acceptance criteria">{issue.criteria.length}C</span>
        </div>
      </div>
      <p className="line-clamp-2 text-xs font-medium leading-snug text-foreground">{issue.title}</p>
      {unmet.length > 0 && issue.status !== "passed" && (
        <div className="flex items-center gap-1 font-mono text-2xs text-muted-foreground">
          <Link2Icon className="size-3 shrink-0" />
          <span className="truncate">Waits on {unmet.join(", ")}</span>
        </div>
      )}
      {(issue.agents.length > 0 || (issue.rounds ?? 0) > 0) && (
        <div className="flex items-center justify-between gap-2 border-t border-border/50 pt-2 font-mono text-2xs text-muted-foreground tabular-nums">
          <span className="truncate">
            {issue.agents.length} agent{issue.agents.length === 1 ? "" : "s"}
            {working > 0 ? ` · ${working} working` : ""}
            {(issue.rounds ?? 0) > 0 ? ` · round ${issue.rounds}` : ""}
          </span>
          {totals.cost > 0 && <span>{formatUsd(totals.cost)}</span>}
        </div>
      )}
    </div>
  );
}

export function KanbanBoard({
  project,
  canWrite,
  board,
  onRefresh,
}: {
  project: { id: string; name: string; githubFullName: string | null };
  canWrite: boolean;
  board: ProjectBoardSnapshot;
  onRefresh: () => Promise<void>;
}) {
  const router = useRouter();
  const baSessionHref = `/sessions?project=${encodeURIComponent(project.id)}`;
  const [epicFilter, setEpicFilter] = React.useState<string>(() =>
    board.epics[0] ? String(board.epics[0].number) : ALL,
  );
  const [selectedIssueId, setSelectedIssueId] = React.useState<string | null>(null);
  const [protoIdx, setProtoIdx] = React.useState(0);
  const [runEpic, setRunEpic] = React.useState<BoardEpic | null>(null);

  const selectedIssue = React.useMemo(
    () => board.issues.find((i) => i.id === selectedIssueId) ?? null,
    [board.issues, selectedIssueId],
  );
  const statusByKey = React.useMemo(
    () => new Map(board.issues.map((i) => [i.issueKey.toUpperCase(), i.status])),
    [board.issues],
  );
  const unmetDependencies = (issue: EnrichedBoardIssue) =>
    issue.dependsOn.filter((dep) => {
      const st = statusByKey.get(dep.trim().toUpperCase());
      return st !== undefined && st !== "passed";
    });

  const visibleEpics =
    epicFilter === ALL
      ? board.epics
      : board.epics.filter((e) => String(e.number) === epicFilter);
  const visibleIssues = board.issues.filter((i) =>
    epicFilter === ALL
      ? true
      : epicFilter === NO_EPIC
        ? i.epicNumber === null
        : String(i.epicNumber) === epicFilter,
  );
  const hasLooseTickets = board.issues.some((i) => i.epicNumber === null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {(board.epics.length > 0 || hasLooseTickets) && (
            <Select value={epicFilter} onValueChange={(v) => v && setEpicFilter(v)}>
              <SelectTrigger className="h-8 w-72 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={ALL}>All epics</SelectItem>
                  {board.epics.map((e) => (
                    <SelectItem key={e.id} value={String(e.number)}>
                      Epic #{e.number} · {e.title}
                    </SelectItem>
                  ))}
                  {hasLooseTickets && <SelectItem value={NO_EPIC}>Tickets without an epic</SelectItem>}
                </SelectGroup>
              </SelectContent>
            </Select>
          )}
          {!board.repo && (
            <span className="flex items-center gap-1 text-xs text-warning">
              <GitBranchIcon className="size-3.5" />
              No GitHub repository: epics cannot run
            </span>
          )}
        </div>
        {canWrite && (
          <Button size="sm" variant="outline" nativeButton={false} render={<Link href={baSessionHref} />}>
            <SparklesIcon data-icon="inline-start" />
            New BA session
          </Button>
        )}
      </div>

      {board.activeBaRun && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary/35 bg-primary/5 px-3.5 py-2.5 text-xs">
          <div className="flex min-w-0 items-center gap-2.5">
            <StatusDot status={board.activeBaRun.status === "awaiting_input" ? "waiting_on_you" : "working"} />
            <span className="font-medium text-foreground">
              {board.activeBaRun.status === "awaiting_input"
                ? "The BA is waiting for your answer"
                : "The BA is writing an epic…"}
            </span>
            <span className="truncate text-muted-foreground">{board.activeBaRun.title}</span>
          </div>
          <Button
            size="xs"
            variant="outline"
            nativeButton={false}
            render={<Link href={`/sessions/${board.activeBaRun.id}`} />}
          >
            <EyeIcon data-icon="inline-start" />
            Open BA session
          </Button>
        </div>
      )}

      {board.issues.length === 0 && board.epics.length === 0 ? (
        <Empty className="border py-14">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SparklesIcon />
            </EmptyMedia>
            <EmptyTitle>No epics yet</EmptyTitle>
            <EmptyDescription>
              Start a BA session with <code className="font-mono">/new-ba</code>: it turns a request
              into an epic of ready tickets on GitHub. The epic shows up here, and{" "}
              <strong>Run epic</strong> builds it into <code className="font-mono">staging</code>.
            </EmptyDescription>
          </EmptyHeader>
          {canWrite && (
            <Button size="sm" nativeButton={false} render={<Link href={baSessionHref} />}>
              <SparklesIcon data-icon="inline-start" />
              New BA session
            </Button>
          )}
        </Empty>
      ) : (
        <>
          {visibleEpics.map((epic) => (
            <EpicHeader key={epic.id} epic={epic} canWrite={canWrite && Boolean(board.repo)} onRun={setRunEpic} />
          ))}
          <div className="grid min-h-[420px] grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {COLUMNS.map((col) => {
              const items = visibleIssues.filter((i) => col.matches(i.status));
              return (
                <div
                  key={col.id}
                  className="flex max-h-[calc(100vh-260px)] min-h-[320px] flex-col overflow-hidden rounded-lg border border-border/70 bg-muted/25"
                >
                  <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3 py-2.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <StatusDot status={col.dot} />
                      <span className="truncate text-xs font-medium text-foreground">{col.title}</span>
                    </div>
                    <span className="font-mono text-xs text-muted-foreground tabular-nums">{items.length}</span>
                  </div>
                  <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
                    {items.length === 0 ? (
                      <div className="flex flex-1 items-center justify-center py-8 text-center text-xs text-muted-foreground/50">
                        No tickets
                      </div>
                    ) : (
                      items.map((iss) => (
                        <TicketCard
                          key={iss.id}
                          issue={iss}
                          unmet={unmetDependencies(iss)}
                          onOpen={() => {
                            setSelectedIssueId(iss.id);
                            setProtoIdx(0);
                          }}
                        />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <RunEpicDialog
        epic={runEpic}
        projectId={project.id}
        open={Boolean(runEpic)}
        onOpenChange={(open) => {
          if (!open) setRunEpic(null);
        }}
        onStarted={(runId) => {
          void onRefresh();
          router.push(`/sessions/${runId}`);
        }}
      />

      <Sheet
        open={Boolean(selectedIssue)}
        onOpenChange={(open) => {
          if (!open) setSelectedIssueId(null);
        }}
      >
        <SheetContent side="right" className="w-full data-[side=right]:sm:max-w-2xl data-[side=right]:lg:max-w-3xl">
          {selectedIssue && (
            <>
              <SheetHeader className="gap-2 border-b px-6 pt-5 pb-4">
                <div className="flex flex-wrap items-center gap-1.5 pr-10">
                  <Badge variant="outline">{selectedIssue.issueKey}</Badge>
                  {selectedIssue.ticketKey && <Badge variant="secondary">{selectedIssue.ticketKey}</Badge>}
                  {selectedIssue.epicNumber !== null && (
                    <Badge variant="secondary">Epic #{selectedIssue.epicNumber}</Badge>
                  )}
                  <Badge variant="secondary">Size {selectedIssue.complexity}</Badge>
                  {selectedIssue.wave !== null && <Badge variant="secondary">Wave {selectedIssue.wave}</Badge>}
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <StatusDot status={selectedIssue.status} />
                    {statusLabel(selectedIssue.status)}
                    {(selectedIssue.rounds ?? 0) > 0 ? ` · round ${selectedIssue.rounds}` : ""}
                  </span>
                </div>
                <SheetTitle className="text-lg leading-snug">{selectedIssue.title}</SheetTitle>
                {selectedIssue.githubIssueUrl && (
                  <SheetDescription>
                    <a
                      href={selectedIssue.githubIssueUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs hover:text-foreground"
                    >
                      <ExternalLinkIcon className="size-3" />
                      Open on GitHub
                    </a>
                  </SheetDescription>
                )}
              </SheetHeader>
              <ScrollArea className="min-h-0 flex-1 px-6">
                <div className="flex flex-col gap-5 py-4">
                  {selectedIssue.decision ? (
                    <DecisionAnswer
                      runId={selectedIssue.decision.runId}
                      interactionId={selectedIssue.decision.interactionId}
                      issue={selectedIssue.githubIssueNumber}
                      question={selectedIssue.decision.question}
                      reason={selectedIssue.decision.reason}
                      canWrite={canWrite}
                      onAnswered={(retryRunId) => {
                        void onRefresh();
                        if (retryRunId) router.push(`/sessions/${retryRunId}`);
                      }}
                    />
                  ) : (
                    selectedIssue.status === "needs_human" &&
                    selectedIssue.summary && (
                      <div className="rounded-md border border-primary/35 bg-primary/5 p-3 text-xs whitespace-pre-wrap">
                        {selectedIssue.summary}
                      </div>
                    )
                  )}

                  {selectedIssue.dependsOn.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="font-mono text-xs text-muted-foreground">Depends on:</span>
                      {selectedIssue.dependsOn.map((dep) => (
                        <Badge key={dep} variant="outline">
                          {dep}
                        </Badge>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-col gap-2">
                    <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                      Acceptance criteria
                    </span>
                    {selectedIssue.criteria.length === 0 ? (
                      <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                        No criteria listed.
                      </div>
                    ) : (
                      selectedIssue.criteria.map((c) => (
                        <div key={c.id} className="flex items-start gap-2.5 rounded-md border bg-card p-3 text-sm">
                          <span className="font-mono text-xs font-semibold text-foreground">{c.id}</span>
                          <span className="leading-relaxed text-foreground/85">{c.text}</span>
                        </div>
                      ))
                    )}
                  </div>

                  {selectedIssue.agents.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                        Agents (latest run)
                      </span>
                      <div className="divide-y rounded-md border">
                        {selectedIssue.agents.map((a) => (
                          <div key={a.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                            <div className="flex min-w-0 items-center gap-2">
                              <StatusDot status={a.status} />
                              <span className="truncate font-medium">{a.name}</span>
                              <span className="text-muted-foreground">{formatModelLabel(a.model)}</span>
                            </div>
                            <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                              {formatCompactTokens(a.inputTokens + a.outputTokens)} · {formatUsd(a.costUsd)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedIssue.prototypes.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                        Prototype
                      </span>
                      {selectedIssue.prototypes.length > 1 && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {selectedIssue.prototypes.map((proto, idx) => (
                            <Button
                              key={proto.id}
                              type="button"
                              size="xs"
                              variant={idx === protoIdx ? "secondary" : "outline"}
                              onClick={() => setProtoIdx(idx)}
                            >
                              {proto.title}
                            </Button>
                          ))}
                        </div>
                      )}
                      <div className="h-[480px]">
                        <PrototypeStudio
                          key={(selectedIssue.prototypes[protoIdx] ?? selectedIssue.prototypes[0]).id}
                          prototype={toPrototypeViewModel(
                            selectedIssue.prototypes[protoIdx] ?? selectedIssue.prototypes[0],
                          )}
                          projectId={project.id}
                          canWrite={canWrite}
                          compact
                          onUpdated={() => void onRefresh()}
                        />
                      </div>
                    </div>
                  )}

                  {selectedIssue.body && (
                    <div className="flex flex-col gap-2">
                      <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                        Ticket
                      </span>
                      <div className="rounded-md border bg-card p-3">
                        <MarkdownContent content={selectedIssue.body} />
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
