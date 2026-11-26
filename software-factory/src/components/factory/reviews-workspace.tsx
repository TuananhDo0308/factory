"use client";

import * as React from "react";
import Link from "next/link";
import {
  CheckCircle2Icon,
  ExternalLinkIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  ScaleIcon,
} from "lucide-react";
import { toast } from "sonner";
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
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatRelativeTime, StatusDot } from "@/components/factory/factory-primitives";
import { useFactoryStream } from "@/components/factory/use-factory-stream";
import type { getReviewsData } from "@/lib/workspace-data";

type PrItem = Awaited<ReturnType<typeof getReviewsData>>[number];

export function ReviewsWorkspace({ initialPrs }: { initialPrs: PrItem[] }) {
  const [prs, setPrs] = React.useState<PrItem[]>(initialPrs);
  const [selectedId, setSelectedId] = React.useState<string | null>(initialPrs[0]?.id ?? null);
  const [busy, setBusy] = React.useState(false);

  const reload = React.useCallback(async () => {
    const res = await fetch("/api/reviews", { cache: "no-store" });
    if (res.ok) {
      const json = (await res.json()) as { pullRequests?: PrItem[] };
      if (json.pullRequests) setPrs(json.pullRequests);
    }
  }, []);

  useFactoryStream(() => void reload());

  const selected = prs.find((p) => p.id === selectedId) ?? prs[0] ?? null;

  const openPrs = prs.filter((p) => p.state === "open" || p.state === "draft");
  const closedPrs = prs.filter((p) => p.state === "closed");
  const mergedPrs = prs.filter((p) => p.state === "merged");

  async function patchPr(id: string, body: Record<string, unknown>, okMessage: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/reviews/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        toast.success(okMessage);
        await reload();
      } else {
        toast.error("Failed to update PR");
      }
    } finally {
      setBusy(false);
    }
  }

  if (prs.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <Empty className="max-w-lg border py-14">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <GitPullRequestIcon />
            </EmptyMedia>
            <EmptyTitle>No Pull Requests yet</EmptyTitle>
            <EmptyDescription>
              Pull requests opened by Factory runs,{" "}
              <code className="font-mono">ui-refine-loop</code>, or synced via API appear here with
              Walkthrough, Diff, QC screenshots, and{" "}
              <code className="font-mono">pr-judge</code> verdicts.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden">
      <ResizablePanelGroup orientation="horizontal">
        {/* LEFT PANE: Selected PR Review Workspace — mirrors pr-review.webp */}
        <ResizablePanel defaultSize="66%" minSize="45%">
          {selected && (
            <div className="flex h-full flex-col">
              {/* PR Header */}
              <div className="flex flex-col gap-2 border-b bg-sidebar/50 px-5 py-3.5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <GitPullRequestIcon className="size-4 shrink-0 text-success" />
                      <h1 className="truncate text-base font-medium">
                        {selected.title}{" "}
                        <span className="font-mono text-muted-foreground">
                          {selected.projectSlug} #{selected.number}
                        </span>
                      </h1>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground">
                      <span>
                        {selected.baseBranch} ← {selected.headBranch}
                      </span>
                      <span className="text-success">+{selected.additions}</span>
                      <span className="text-destructive">-{selected.deletions}</span>
                      {selected.judgeVerdict && (
                        <Badge
                          variant={
                            selected.judgeVerdict === "pass"
                              ? "default"
                              : selected.judgeVerdict === "fail"
                                ? "destructive"
                                : "secondary"
                          }
                        >
                          pr-judge: {selected.judgeVerdict}
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Switch
                        checked={selected.autoFix}
                        onCheckedChange={(checked) =>
                          void patchPr(
                            selected.id,
                            { autoFix: checked },
                            checked ? "Auto-fix enabled" : "Auto-fix disabled",
                          )
                        }
                      />
                      <span>Auto-fix</span>
                    </label>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void patchPr(
                          selected.id,
                          { action: "run_pr_judge" },
                          "Queued independent pr-judge run",
                        )
                      }
                    >
                      <ScaleIcon data-icon="inline-start" />
                      Run PR Judge
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy || selected.state === "merged"}
                      onClick={() =>
                        void patchPr(
                          selected.id,
                          { action: "enqueue_merge" },
                          "Queued PR in Merge Queue",
                        )
                      }
                    >
                      <GitMergeIcon data-icon="inline-start" />
                      {selected.queueStatus === "queued" ? "Queued" : "Merge"}
                    </Button>
                  </div>
                </div>
              </div>

              {/* 4-Tab PR Inspector: Conversation | Diff | Walkthrough | Validation */}
              <Tabs defaultValue="conversation" className="flex min-h-0 flex-1 flex-col gap-0">
                <div className="flex items-center justify-between border-b px-5 pt-2">
                  <TabsList variant="line">
                    <TabsTrigger value="conversation">Conversation</TabsTrigger>
                    <TabsTrigger value="diff">Diff</TabsTrigger>
                    <TabsTrigger value="walkthrough">Walkthrough</TabsTrigger>
                    <TabsTrigger value="validation">
                      Validation ({selected.artifacts.length})
                    </TabsTrigger>
                  </TabsList>
                  <div className="flex items-center gap-2 pb-1">
                    {selected.runId && (
                      <Button
                        size="xs"
                        variant="ghost"
                        nativeButton={false}
                        render={<Link href={`/sessions/${selected.runId}`} />}
                      >
                        Open Session
                      </Button>
                    )}
                    {selected.url && (
                      <Button
                        size="xs"
                        variant="ghost"
                        nativeButton={false}
                        render={<a href={selected.url} target="_blank" rel="noreferrer" />}
                      >
                        <ExternalLinkIcon data-icon="inline-start" />
                        GitHub
                      </Button>
                    )}
                  </div>
                </div>

                <ScrollArea className="flex-1">
                  <TabsContent value="conversation" className="flex flex-col gap-3 p-5">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2 text-sm">
                          <CheckCircle2Icon className="size-4 text-success" />
                          Merge Readiness · CI: {selected.ciStatus}
                        </CardTitle>
                        <CardDescription>
                          Merge policy: {selected.mergeDecision} · Queue: {selected.queueStatus}
                        </CardDescription>
                      </CardHeader>
                      {selected.mergeReasons.length > 0 && (
                        <CardContent className="flex flex-col gap-1 text-xs text-muted-foreground">
                          {selected.mergeReasons.map((reason, idx) => (
                            <div key={idx}>• {reason}</div>
                          ))}
                        </CardContent>
                      )}
                    </Card>
                  </TabsContent>

                  <TabsContent value="diff" className="p-5">
                    <pre className="overflow-auto rounded-lg border bg-muted p-4 font-mono text-xs leading-relaxed">
                      {selected.diffSummary || "No diff summary uploaded for this PR yet."}
                    </pre>
                  </TabsContent>

                  <TabsContent value="walkthrough" className="p-5">
                    <div className="rounded-lg border bg-card p-4 text-sm whitespace-pre-wrap leading-relaxed">
                      {selected.walkthroughMd ||
                        "No AI walkthrough recorded yet. Run Code Walkthrough or link a Factory run."}
                    </div>
                  </TabsContent>

                  <TabsContent value="validation" className="flex flex-col gap-4 p-5">
                    {selected.judgeReport && (
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm">
                            Independent <code className="font-mono">pr-judge</code> Report
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <pre className="max-h-72 overflow-auto rounded-md border bg-muted p-3 font-mono text-xs">
                            {JSON.stringify(selected.judgeReport, null, 2)}
                          </pre>
                        </CardContent>
                      </Card>
                    )}

                    <div className="grid gap-3 sm:grid-cols-2">
                      {selected.artifacts.map((art) => (
                        <Card key={art.id}>
                          <CardHeader className="pb-2">
                            <CardTitle className="text-xs">{art.title}</CardTitle>
                            <CardDescription className="font-mono text-[11px]">
                              {art.kind}
                            </CardDescription>
                          </CardHeader>
                          <CardContent>
                            {/\.(png|jpe?g|webp|svg)$/i.test(art.pathOrUrl) ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={`/api/artifacts/file?id=${encodeURIComponent(art.id)}`}
                                alt={art.title}
                                className="max-h-56 w-full rounded-md border object-cover"
                              />
                            ) : (
                              <a
                                href={`/api/artifacts/file?id=${encodeURIComponent(art.id)}`}
                                target="_blank"
                                rel="noreferrer"
                                className="font-mono text-xs underline"
                              >
                                Open artifact
                              </a>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </TabsContent>
                </ScrollArea>
              </Tabs>
            </div>
          )}
        </ResizablePanel>

        <ResizableHandle />

        {/* RIGHT PANE: PRs grouped by Open / Closed / Merged — mirrors pr-review.webp */}
        <ResizablePanel defaultSize="34%" minSize="24%">
          <div className="flex h-full flex-col border-l bg-sidebar/30">
            <div className="border-b px-4 py-3 text-xs font-medium text-muted-foreground">
              PRs ({prs.length})
            </div>
            <ScrollArea className="flex-1">
              <div className="flex flex-col gap-4 p-3">
                {[
                  { label: "Open", items: openPrs },
                  { label: "Closed", items: closedPrs },
                  { label: "Merged", items: mergedPrs },
                ].map((group) => (
                  <div key={group.label} className="flex flex-col gap-1">
                    <div className="px-2 font-mono text-[11px] text-muted-foreground">
                      {group.label} {group.items.length}
                    </div>
                    {group.items.map((pr) => (
                      <button
                        key={pr.id}
                        type="button"
                        onClick={() => setSelectedId(pr.id)}
                        className={`flex w-full items-start justify-between gap-2 rounded-md border px-2.5 py-2 text-left text-xs ${
                          selected?.id === pr.id
                            ? "border-border bg-accent text-accent-foreground"
                            : "border-transparent hover:bg-muted/60"
                        }`}
                      >
                        <div className="flex min-w-0 items-start gap-2">
                          <span className="mt-1">
                            <StatusDot status={pr.ciStatus} />
                          </span>
                          <div className="flex min-w-0 flex-col">
                            <span className="truncate font-medium">{pr.title}</span>
                            <span className="font-mono text-[11px] text-muted-foreground">
                              {pr.projectSlug} #{pr.number}
                            </span>
                          </div>
                        </div>
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                          {formatRelativeTime(pr.updatedAt)}
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
