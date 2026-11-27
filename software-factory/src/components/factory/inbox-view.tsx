"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircleIcon,
  CheckCheckIcon,
  CheckIcon,
  ExternalLinkIcon,
  InboxIcon,
  XIcon,
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
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DecisionAnswer } from "@/components/factory/decision-answer";
import { formatRelativeTime, StatusDot } from "@/components/factory/factory-primitives";
import { useFactoryStream } from "@/components/factory/use-factory-stream";
import type { getInboxData } from "@/lib/workspace-data";

type InboxPayload = Awaited<ReturnType<typeof getInboxData>>;
type DismissKind = "interaction" | "run" | "issue";
type InboxScope = "all" | "questions" | "runs" | "issues";

export function InboxView({ initialData }: { initialData: InboxPayload }) {
  const router = useRouter();
  const [data, setData] = React.useState<InboxPayload>(initialData);
  const [activeTab, setActiveTab] = React.useState<InboxScope>("all");
  const [answers, setAnswers] = React.useState<Record<string, string>>({});
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const reload = React.useCallback(async () => {
    const res = await fetch("/api/inbox", { cache: "no-store" });
    if (res.ok) {
      const json = (await res.json()) as InboxPayload;
      setData(json);
    }
  }, []);

  useFactoryStream(() => void reload());

  // A ticket with a pending decision is listed once, as its decision.
  const decidedIssues = new Set(
    data.interactions
      .filter((i) => i.type === "decision")
      .map((i) => `${i.projectId}:#${Number((i.payload as { issue?: unknown }).issue)}`),
  );
  const looseIssues = data.needsHumanIssues.filter(
    (iss) => !decidedIssues.has(`${iss.projectId}:${iss.issueKey}`),
  );
  const totalCount = data.interactions.length + data.attentionRuns.length + looseIssues.length;

  async function dismissOne(kind: DismissKind, id: string, label: string) {
    setBusyId(`close:${id}`);
    try {
      const res = await fetch("/api/inbox/dismiss", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, id }),
      });
      if (res.ok) {
        toast.success(`Closed "${label.slice(0, 42)}"`);
        await reload();
        router.refresh();
      } else {
        toast.error("Could not close notification");
      }
    } finally {
      setBusyId(null);
    }
  }

  async function dismissAll(scope: InboxScope) {
    setBusyId(`close-all:${scope}`);
    try {
      const res = await fetch("/api/inbox/dismiss", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ all: true, scope }),
      });
      if (res.ok) {
        const json = (await res.json().catch(() => null)) as { dismissedCount?: number } | null;
        toast.success(`Cleared ${json?.dismissedCount ?? "all"} notification(s)`);
        await reload();
        router.refresh();
      } else {
        toast.error("Could not clear notifications");
      }
    } finally {
      setBusyId(null);
    }
  }

  async function resolveInteraction(
    runId: string,
    interactionId: string,
    decision: "approved" | "dismissed",
  ) {
    setBusyId(interactionId);
    try {
      const res = await fetch(`/api/sessions/${runId}/steer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          interactionId,
          decision,
          message: answers[interactionId] || "",
        }),
      });
      if (res.ok) {
        toast.success(decision === "approved" ? "Approved & resumed" : "Dismissed question");
        await reload();
        router.refresh();
      }
    } finally {
      setBusyId(null);
    }
  }

  function renderEmptySection(title: string, description: string) {
    return (
      <Empty className="border py-14">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <InboxIcon />
          </EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const interactionRows = data.interactions.map((inter) =>
    inter.type === "decision" ? (
      <div key={`inter-${inter.id}`} className="flex flex-col gap-2 px-4 py-3.5">
        <span className="font-mono text-xs text-muted-foreground" suppressHydrationWarning>
          {inter.projectName} · {inter.runTitle} · {formatRelativeTime(inter.createdAt)}
        </span>
        <DecisionAnswer
          runId={inter.runId}
          interactionId={inter.id}
          issue={Number((inter.payload as { issue?: unknown }).issue) || null}
          question={String((inter.payload as { question?: unknown }).question ?? inter.prompt ?? "")}
          reason={String((inter.payload as { reason?: unknown }).reason ?? "")}
          onAnswered={(retryRunId) => {
            void reload();
            if (retryRunId) router.push(`/sessions/${retryRunId}`);
          }}
        />
      </div>
    ) : (
    <div
      key={`inter-${inter.id}`}
      className="flex flex-col gap-3 px-4 py-3.5 transition-colors hover:bg-muted/25"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/sessions/${inter.runId}`}
                className="text-sm font-medium text-foreground hover:underline"
              >
                {inter.title}
              </Link>
              <Badge variant="outline">{inter.type}</Badge>
            </div>
            <span className="font-mono text-xs text-muted-foreground" suppressHydrationWarning>
              {inter.projectName} · {inter.phase} · {formatRelativeTime(inter.createdAt)}
            </span>
            {inter.prompt && (
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                {inter.prompt}
              </p>
            )}
          </div>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          title="Close notification"
          disabled={busyId !== null}
          onClick={() => void dismissOne("interaction", inter.id, inter.title)}
        >
          <XIcon />
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 pl-6.5">
        <Input
          className="h-8 min-w-56 flex-1 text-xs"
          placeholder="Reply to unblock agent..."
          value={answers[inter.id] || ""}
          onChange={(e) =>
            setAnswers((prev) => ({ ...prev, [inter.id]: e.target.value }))
          }
        />
        <Button
          size="xs"
          disabled={busyId !== null}
          onClick={() => void resolveInteraction(inter.runId, inter.id, "approved")}
        >
          <CheckIcon data-icon="inline-start" />
          Answer &amp; resume
        </Button>
        <Button
          size="xs"
          variant="outline"
          nativeButton={false}
          render={<Link href={`/sessions/${inter.runId}`} />}
        >
          <ExternalLinkIcon data-icon="inline-start" />
          Open
        </Button>
      </div>
    </div>
    ),
  );

  const runRows = data.attentionRuns.map((run) => {
    const isWarning = run.status === "awaiting_input";
    return (
      <div
        key={`run-${run.id}`}
        className="flex flex-col gap-2.5 px-4 py-3.5 transition-colors hover:bg-muted/25 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-1.5 shrink-0">
            <StatusDot status={run.status} />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/sessions/${run.id}`}
                className="truncate text-sm font-medium text-foreground hover:underline"
              >
                {run.title}
              </Link>
              <span
                className={`inline-flex items-center rounded-[2px] border px-1.5 py-px font-mono text-2xs font-medium ${
                  isWarning
                    ? "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                    : "border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300"
                }`}
              >
                {run.status.replace("_", " ")}
              </span>
            </div>
            <span className="font-mono text-xs text-muted-foreground" suppressHydrationWarning>
              {run.projectName} · {run.currentPhase} · {formatRelativeTime(run.updatedAt)}
            </span>
            {run.summary && (
              <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                {run.summary}
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 pl-5 sm:pl-0">
          <Button
            size="xs"
            variant="outline"
            nativeButton={false}
            render={<Link href={`/sessions/${run.id}`} />}
          >
            Open
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            title="Close notification"
            disabled={busyId !== null}
            onClick={() => void dismissOne("run", run.id, run.title)}
          >
            <XIcon />
          </Button>
        </div>
      </div>
    );
  });

  const issueRows = looseIssues.map((iss) => (
    <div
      key={`iss-${iss.id}`}
      className="flex flex-col gap-2.5 px-4 py-3.5 transition-colors hover:bg-muted/25 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="mt-0.5 shrink-0 font-mono text-xs font-semibold text-primary">
          {iss.issueKey}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Link
              href={`/projects/${iss.projectId}?tab=issues`}
              className="truncate text-sm font-medium text-foreground hover:underline"
            >
              {iss.title}
            </Link>
            {iss.epicNumber !== null && <Badge variant="outline">Epic #{iss.epicNumber}</Badge>}
          </div>
          <span className="font-mono text-xs text-muted-foreground">
            {iss.projectName} · Needs a decision
          </span>
          {(iss.summary || iss.goal) && (
            <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">
              {iss.summary || iss.goal}
            </p>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          size="xs"
          variant="outline"
          nativeButton={false}
          render={<Link href={`/projects/${iss.projectId}?tab=issues`} />}
        >
          Board
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          title="Close notification"
          disabled={busyId !== null}
          onClick={() => void dismissOne("issue", iss.id, `${iss.issueKey} ${iss.title}`)}
        >
          <XIcon />
        </Button>
      </div>
    </div>
  ));

  const allRows = [...interactionRows, ...runRows, ...issueRows];

  function renderFeed(rows: React.ReactNode[], emptyTitle: string, emptyDesc: string) {
    if (rows.length === 0) {
      return renderEmptySection(emptyTitle, emptyDesc);
    }
    return (
      <div className="divide-y divide-border overflow-hidden rounded-[4px] border bg-card">
        {rows}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-medium tracking-tight">Inbox</h1>
          <Badge variant={totalCount > 0 ? "secondary" : "outline"}>
            {totalCount > 0 ? `${totalCount} open` : "All clear"}
          </Badge>
        </div>

        {totalCount > 0 && (
          <div className="flex items-center gap-2">
            {activeTab !== "all" && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busyId !== null}
                onClick={() => void dismissAll(activeTab)}
              >
                <XIcon data-icon="inline-start" />
                Close tab
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busyId !== null}
              onClick={() => void dismissAll("all")}
            >
              {busyId === "close-all:all" ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <CheckCheckIcon data-icon="inline-start" />
              )}
              Close All
            </Button>
          </div>
        )}
      </div>

      {totalCount === 0 ? (
        renderEmptySection(
          "Inbox is clear",
          "New questions, blocked runs, or approvals will appear here and trigger a notification.",
        )
      ) : (
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as InboxScope)}
          className="flex flex-col gap-4"
        >
          <TabsList variant="line" className="w-full justify-start border-b">
            <TabsTrigger value="all">All ({totalCount})</TabsTrigger>
            {data.interactions.length > 0 && (
              <TabsTrigger value="questions">
                Questions ({data.interactions.length})
              </TabsTrigger>
            )}
            {data.attentionRuns.length > 0 && (
              <TabsTrigger value="runs">
                Runs ({data.attentionRuns.length})
              </TabsTrigger>
            )}
            {looseIssues.length > 0 && (
              <TabsTrigger value="issues">Tickets ({looseIssues.length})</TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="all">
            {renderFeed(allRows, "Inbox is clear", "Nothing waiting on you.")}
          </TabsContent>
          <TabsContent value="questions">
            {renderFeed(interactionRows, "No pending questions", "Agents have no open questions.")}
          </TabsContent>
          <TabsContent value="runs">
            {renderFeed(runRows, "No blocked or stalled runs", "All runs are healthy.")}
          </TabsContent>
          <TabsContent value="issues">
            {renderFeed(issueRows, "No tickets waiting", "No ticket needs a decision.")}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
