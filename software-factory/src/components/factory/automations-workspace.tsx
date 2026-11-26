"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertCircleIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  CheckIcon,
  ClockIcon,
  CopyIcon,
  CpuIcon,
  GitBranchIcon,
  GitMergeIcon,
  LaptopIcon,
  LayersIcon,
  RefreshCwIcon,
  SearchIcon,
  SettingsIcon,
  ShieldCheckIcon,
  TerminalIcon,
  ZapIcon,
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
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
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
import { formatRelativeTime, StatusDot } from "@/components/factory/factory-primitives";
import { useFactoryStream } from "@/components/factory/use-factory-stream";

type AutomationsData = {
  projects: Array<{
    id: string;
    name: string;
    slug: string;
    engine: string;
    autoDispatch: boolean;
    autoApprove: boolean;
    maxConcurrency: number;
    stallTimeoutMinutes: number;
    readyIssues: number;
    activeRuns: number;
  }>;
  runners: Array<{
    id: string;
    name: string;
    hostname: string;
    os: string;
    engines: string[];
    status: string;
    maxConcurrency: number;
    activeRuns: number;
    lastHeartbeatAt: string;
  }>;
  commands: Array<{
    id: string;
    type: string;
    status: string;
    error: string | null;
    projectName: string | null;
    runKey: string | null;
    createdAt: string;
  }>;
  mergeQueue: Array<{
    id: string;
    number: number;
    title: string;
    headBranch: string;
    baseBranch: string;
    ciStatus: string;
    queueStatus: string;
    projectName: string;
    updatedAt: string;
  }>;
};

type ProjectFilter = "all" | "auto" | "ready";
type CommandFilter = "all" | "active" | "failed";

function queueStatusBadgeVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "conflict") return "destructive";
  if (status === "verifying" || status === "rebasing") return "default";
  return "secondary";
}

function commandStatusTone(status: string): string {
  if (status === "failed") return "text-destructive";
  if (status === "done") return "text-success";
  if (status === "claimed" || status === "pending") return "text-primary";
  return "text-muted-foreground";
}

export function AutomationsWorkspace({ initialData }: { initialData: AutomationsData }) {
  const [data, setData] = React.useState(initialData);
  const [sweeping, setSweeping] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [busyToggle, setBusyToggle] = React.useState<string | null>(null);
  const [copiedCmd, setCopiedCmd] = React.useState(false);
  const [projectSearch, setProjectSearch] = React.useState("");
  const [projectFilter, setProjectFilter] = React.useState<ProjectFilter>("all");
  const [commandFilter, setCommandFilter] = React.useState<CommandFilter>("all");

  const reload = React.useCallback(async () => {
    try {
      const res = await fetch("/api/automations", { cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as AutomationsData;
        setData(json);
      }
    } catch {
      // Ignore transient poll error.
    }
  }, []);

  useFactoryStream(() => void reload());

  async function handleManualRefresh() {
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  }

  async function toggleAutoDispatch(projectId: string, autoDispatch: boolean) {
    const key = `dispatch:${projectId}`;
    setBusyToggle(key);
    try {
      const res = await fetch("/api/automations", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, autoDispatch }),
      });
      if (!res.ok) {
        toast.error("Could not update Auto-Dispatch setting");
        return;
      }
      toast.success(autoDispatch ? "Auto-dispatch enabled" : "Auto-dispatch disabled");
      await reload();
    } finally {
      setBusyToggle(null);
    }
  }

  async function toggleAutoApprove(projectId: string, autoApprove: boolean) {
    const key = `approve:${projectId}`;
    setBusyToggle(key);
    try {
      const res = await fetch("/api/automations", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, autoApprove }),
      });
      const json = (await res.json().catch(() => null)) as {
        approvedCount?: number;
        dispatched?: Array<{ issueKey: string }>;
        error?: string;
      } | null;
      if (!res.ok) {
        toast.error(json?.error || "Could not update approval mode");
        return;
      }
      if (autoApprove) {
        const parts = ["No-approval mode enabled"];
        if ((json?.approvedCount ?? 0) > 0) {
          parts.push(`auto-approved ${json!.approvedCount} ticket(s)`);
        }
        if ((json?.dispatched?.length ?? 0) > 0) {
          parts.push(`started ${json!.dispatched!.map((d) => d.issueKey).join(", ")}`);
        }
        toast.success(parts.join(" · "));
      } else {
        toast.success("Manual approval restored");
      }
      await reload();
    } finally {
      setBusyToggle(null);
    }
  }

  async function runWatchdogNow() {
    setSweeping(true);
    try {
      const res = await fetch("/api/automations", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "run_watchdog" }),
      });
      if (!res.ok) {
        toast.error("Watchdog check failed");
        return;
      }
      const json = (await res.json().catch(() => null)) as { stalled?: number } | null;
      toast.success(`Watchdog check complete (${json?.stalled ?? 0} stalled flagged)`);
      await reload();
    } finally {
      setSweeping(false);
    }
  }

  async function copyDaemonCommand() {
    try {
      await navigator.clipboard.writeText("sf daemon");
      setCopiedCmd(true);
      toast.success("Copied `sf daemon`");
      setTimeout(() => setCopiedCmd(false), 1800);
    } catch {
      toast.error("Could not copy command");
    }
  }

  // Fleet KPI metrics
  const onlineRunners = data.runners.filter((r) => r.status === "online");
  const totalSlots = onlineRunners.reduce((s, r) => s + r.maxConcurrency, 0);
  const usedSlots = onlineRunners.reduce((s, r) => s + r.activeRuns, 0);
  const capacityPct = totalSlots > 0 ? Math.min(100, Math.round((usedSlots / totalSlots) * 100)) : 0;

  const autoEnabledProjects = data.projects.filter((p) => p.autoDispatch).length;
  const fullAutoProjects = data.projects.filter((p) => p.autoDispatch && p.autoApprove).length;
  const totalReadyIssues = data.projects.reduce((s, p) => s + p.readyIssues, 0);
  const totalActiveRuns = data.projects.reduce((s, p) => s + p.activeRuns, 0);
  const failedCommands = data.commands.filter((c) => c.status === "failed").length;
  const activeCommands = data.commands.filter(
    (c) => c.status === "pending" || c.status === "claimed",
  ).length;
  const conflictPrs = data.mergeQueue.filter((pr) => pr.queueStatus === "conflict").length;

  const filteredProjects = React.useMemo(() => {
    const q = projectSearch.trim().toLowerCase();
    return data.projects.filter((p) => {
      if (projectFilter === "auto" && !p.autoDispatch) return false;
      if (projectFilter === "ready" && p.readyIssues === 0) return false;
      if (q && !p.name.toLowerCase().includes(q) && !p.engine.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [data.projects, projectFilter, projectSearch]);

  const filteredCommands = React.useMemo(() => {
    return data.commands.filter((c) => {
      if (commandFilter === "active") return c.status === "pending" || c.status === "claimed";
      if (commandFilter === "failed") return c.status === "failed";
      return true;
    });
  }, [data.commands, commandFilter]);

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
      {/* Page Header */}
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border/70 pb-4">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              Automations &amp; Fleet Ops
            </h1>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11px] font-medium ${
                onlineRunners.length > 0
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-border bg-muted text-muted-foreground"
              }`}
            >
              <StatusDot status={onlineRunners.length > 0 ? "online" : "offline"} />
              {onlineRunners.length > 0
                ? `${onlineRunners.length} runner${onlineRunners.length === 1 ? "" : "s"} online`
                : "No runners online"}
            </span>
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Control Auto-Dispatch policies, unattended approval gates, stall watchdog checks, merge
            queue health, and connected <code className="font-mono text-xs">sf daemon</code>{" "}
            runners.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={refreshing}
            onClick={() => void handleManualRefresh()}
            className="cursor-pointer"
          >
            <RefreshCwIcon
              data-icon="inline-start"
              className={refreshing ? "animate-spin" : undefined}
            />
            Refresh
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href="/settings?tab=runners" />}
          >
            <SettingsIcon data-icon="inline-start" />
            Manage Runners
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={sweeping}
            onClick={() => void runWatchdogNow()}
            className="cursor-pointer"
          >
            {sweeping ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <ShieldCheckIcon data-icon="inline-start" />
            )}
            {sweeping ? "Checking…" : "Run Watchdog"}
          </Button>
        </div>
      </header>

      {/* Fleet Health Bento KPI Strip (2+1 / 1+2 asymmetric matching app tokens) */}
      <section
        aria-label="Fleet health metrics"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <div className="flex flex-col justify-between gap-3 rounded-xl border border-primary/20 bg-primary/[0.035] p-4 transition-colors hover:border-primary/35 dark:border-primary/25 dark:bg-primary/[0.06]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">Fleet capacity</span>
            <LaptopIcon className="size-4 text-primary/75" aria-hidden="true" />
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-2xl font-semibold tracking-tight text-foreground tabular-nums">
              {usedSlots}
              <span className="text-base font-normal text-muted-foreground">/{totalSlots}</span>
            </span>
            <span className="rounded-md bg-primary/12 px-2 py-0.5 font-mono text-xs font-medium text-primary tabular-nums">
              {onlineRunners.length}/{data.runners.length} online
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-primary/15">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${capacityPct}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground tabular-nums">
              {totalSlots > 0
                ? `${capacityPct}% concurrent slots in use`
                : "Start a local daemon to allocate slots"}
            </span>
          </div>
        </div>

        <div className="flex flex-col justify-between gap-3 rounded-xl border border-border/80 bg-card p-4 transition-colors hover:border-border">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">Auto-dispatch fleet</span>
            <ZapIcon className="size-4 text-muted-foreground/70" aria-hidden="true" />
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-2xl font-semibold tracking-tight text-foreground tabular-nums">
              {autoEnabledProjects}
              <span className="text-base font-normal text-muted-foreground">
                /{data.projects.length}
              </span>
            </span>
            <span className="text-xs text-muted-foreground">projects</span>
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2 text-xs text-muted-foreground tabular-nums">
            <span>{fullAutoProjects} full-auto (no approval)</span>
            <span className="font-mono text-foreground/80">{totalReadyIssues} ready</span>
          </div>
        </div>

        <div className="flex flex-col justify-between gap-3 rounded-xl border border-border/80 bg-card p-4 transition-colors hover:border-border">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">Active queue</span>
            <LayersIcon className="size-4 text-muted-foreground/70" aria-hidden="true" />
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-2xl font-semibold tracking-tight text-foreground tabular-nums">
              {totalActiveRuns}
            </span>
            <span className="text-xs text-muted-foreground">
              {totalActiveRuns === 1 ? "active run" : "active runs"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2 text-xs text-muted-foreground tabular-nums">
            <span>{data.mergeQueue.length} in merge queue</span>
            {conflictPrs > 0 ? (
              <span className="font-mono font-medium text-destructive">
                {conflictPrs} conflict
              </span>
            ) : (
              <span className="font-mono text-success">Clean</span>
            )}
          </div>
        </div>

        <div className="flex flex-col justify-between gap-3 rounded-xl border border-border/80 bg-card p-4 transition-colors hover:border-border">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">Command dispatch</span>
            <TerminalIcon className="size-4 text-muted-foreground/70" aria-hidden="true" />
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-2xl font-semibold tracking-tight text-foreground tabular-nums">
              {data.commands.length}
            </span>
            <span className="text-xs text-muted-foreground">recent</span>
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2 text-xs text-muted-foreground tabular-nums">
            <span>{activeCommands} in flight</span>
            {failedCommands > 0 ? (
              <span className="font-mono font-medium text-destructive">
                {failedCommands} failed
              </span>
            ) : (
              <span className="font-mono text-success">0 errors</span>
            )}
          </div>
        </div>
      </section>

      {/* Connected Local Runners */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
          <div className="flex flex-col gap-1">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <LaptopIcon className="size-4 text-primary" aria-hidden="true" />
              Connected Runners
              <Badge variant="secondary" className="font-mono text-[11px]">
                {onlineRunners.length}/{data.runners.length}
              </Badge>
            </CardTitle>
            <CardDescription className="text-xs">
              Local <code className="font-mono">sf daemon</code> machines executing web-dispatched
              Antigravity &amp; Claude Code worktrees.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => void copyDaemonCommand()}
            className="cursor-pointer font-mono"
          >
            {copiedCmd ? (
              <CheckIcon data-icon="inline-start" className="text-success" />
            ) : (
              <CopyIcon data-icon="inline-start" />
            )}
            {copiedCmd ? "Copied" : "sf daemon"}
          </Button>
        </CardHeader>
        <CardContent className="pt-4">
          {data.runners.length === 0 ? (
            <Empty className="border border-dashed py-8">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <LaptopIcon />
                </EmptyMedia>
                <EmptyTitle>No runners connected yet</EmptyTitle>
                <EmptyDescription>
                  Pair your machine once with <code className="font-mono">sf login</code> and run{" "}
                  <code className="font-mono">sf daemon</code> to execute sessions and automated
                  builds.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent className="flex flex-wrap items-center justify-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  nativeButton={false}
                  render={<Link href="/settings?tab=runners" />}
                >
                  Open Runner Setup
                  <ArrowRightIcon data-icon="inline-end" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void copyDaemonCommand()}
                  className="cursor-pointer font-mono"
                >
                  <CopyIcon data-icon="inline-start" />
                  Copy sf daemon
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {data.runners.map((r) => {
                const isOnline = r.status === "online";
                const slotPct =
                  r.maxConcurrency > 0
                    ? Math.min(100, Math.round((r.activeRuns / r.maxConcurrency) * 100))
                    : 0;
                return (
                  <div
                    key={r.id}
                    className={`flex flex-col justify-between gap-3 rounded-xl border p-3.5 transition-colors ${
                      isOnline
                        ? "border-border/90 bg-card hover:border-primary/40"
                        : "border-border/60 bg-muted/25 opacity-80"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <StatusDot status={r.status} />
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate text-sm font-medium text-foreground">
                            {r.name}
                          </span>
                          <span className="truncate font-mono text-[11px] text-muted-foreground">
                            {r.hostname} · {r.os}
                          </span>
                        </div>
                      </div>
                      <Badge
                        variant={isOnline ? "default" : "secondary"}
                        className="shrink-0 capitalize"
                      >
                        {r.status}
                      </Badge>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground tabular-nums">
                        <span className="inline-flex items-center gap-1">
                          <CpuIcon className="size-3" aria-hidden="true" />
                          Slots: <strong className="font-mono text-foreground">{r.activeRuns}/{r.maxConcurrency}</strong>
                        </span>
                        <span className="inline-flex items-center gap-1 font-mono">
                          <ClockIcon className="size-3" aria-hidden="true" />
                          {formatRelativeTime(r.lastHeartbeatAt)}
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            isOnline ? "bg-primary" : "bg-muted-foreground/40"
                          }`}
                          style={{ width: `${slotPct}%` }}
                        />
                      </div>
                    </div>

                    {r.engines.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        {r.engines.map((eng) => (
                          <span
                            key={eng}
                            className="rounded border border-border/70 bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                          >
                            {eng}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Project Dispatch & Watchdog Policies */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
          <div className="flex flex-col gap-1">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <RefreshCwIcon className="size-4 text-primary" aria-hidden="true" />
              Project Dispatch &amp; Watchdog Policies
            </CardTitle>
            <CardDescription className="text-xs">
              Configure automatic ticket pickup, approval gates, concurrency caps, and stall
              timeouts per repository.
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-48 sm:w-56">
              <SearchIcon
                className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={projectSearch}
                onChange={(e) => setProjectSearch(e.target.value)}
                placeholder="Filter projects…"
                aria-label="Filter projects"
                className="h-8 pl-8 text-xs"
              />
            </div>

            <div
              role="group"
              aria-label="Project policy filter"
              className="inline-flex items-center rounded-md border border-border bg-muted/40 p-0.5"
            >
              {(
                [
                  { id: "all", label: `All (${data.projects.length})` },
                  { id: "auto", label: `Auto (${autoEnabledProjects})` },
                  { id: "ready", label: "Has Ready" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setProjectFilter(tab.id)}
                  className={`cursor-pointer rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    projectFilter === tab.id
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {filteredProjects.length === 0 ? (
            <div className="p-6">
              <Empty className="border border-dashed py-8">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <RefreshCwIcon />
                  </EmptyMedia>
                  <EmptyTitle>
                    {data.projects.length === 0
                      ? "No projects configured yet"
                      : "No projects match this filter"}
                  </EmptyTitle>
                  <EmptyDescription>
                    {data.projects.length === 0
                      ? "Create or connect a repository first to configure Auto-Dispatch policies."
                      : "Try clearing the search query or switching back to All projects."}
                  </EmptyDescription>
                </EmptyHeader>
                {data.projects.length > 0 && (
                  <EmptyContent>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setProjectSearch("");
                        setProjectFilter("all");
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
                    <TableHead className="pl-5">Project</TableHead>
                    <TableHead>Engine</TableHead>
                    <TableHead className="text-right">Ready</TableHead>
                    <TableHead>Concurrency</TableHead>
                    <TableHead>Stall Timeout</TableHead>
                    <TableHead className="text-right">Auto-Dispatch</TableHead>
                    <TableHead className="pr-5 text-right">No Approval</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProjects.map((p) => {
                    const pct =
                      p.maxConcurrency > 0
                        ? Math.min(100, Math.round((p.activeRuns / p.maxConcurrency) * 100))
                        : 0;
                    const dispatchPending = busyToggle === `dispatch:${p.id}`;
                    const approvePending = busyToggle === `approve:${p.id}`;
                    return (
                      <TableRow key={p.id} className="group transition-colors">
                        <TableCell className="pl-5">
                          <Link
                            href={`/projects/${p.id}?tab=issues`}
                            className="inline-flex items-center gap-1.5 font-medium text-foreground transition-colors hover:text-primary"
                          >
                            <span>{p.name}</span>
                            <ArrowRightIcon
                              className="size-3.5 opacity-0 transition-opacity group-hover:opacity-70"
                              aria-hidden="true"
                            />
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-mono text-[11px]">
                            {p.engine}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          <span
                            className={
                              p.readyIssues > 0
                                ? "rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary"
                                : "text-muted-foreground"
                            }
                          >
                            {p.readyIssues}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-primary transition-all duration-300"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="font-mono text-xs text-muted-foreground tabular-nums">
                              {p.activeRuns}/{p.maxConcurrency}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">
                          {p.stallTimeoutMinutes}m
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="inline-flex items-center justify-end gap-2">
                            {dispatchPending && <Spinner className="size-3.5" />}
                            <Switch
                              aria-label={`Toggle Auto-Dispatch for ${p.name}`}
                              checked={p.autoDispatch}
                              disabled={dispatchPending}
                              onCheckedChange={(v) => void toggleAutoDispatch(p.id, v)}
                            />
                          </div>
                        </TableCell>
                        <TableCell className="pr-5 text-right">
                          <div className="inline-flex items-center justify-end gap-2">
                            {approvePending && <Spinner className="size-3.5" />}
                            <Switch
                              aria-label={`Toggle No Approval mode for ${p.name}`}
                              checked={p.autoApprove}
                              disabled={approvePending}
                              onCheckedChange={(v) => void toggleAutoApprove(p.id, v)}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bottom Operational Deck: Merge Queue + Recent Runner Commands */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col">
          <CardHeader className="border-b border-border/60 pb-4">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <GitMergeIcon className="size-4 text-primary" aria-hidden="true" />
                Refinery Merge Queue
              </CardTitle>
              <Badge variant={conflictPrs > 0 ? "destructive" : "secondary"} className="font-mono">
                {data.mergeQueue.length}
              </Badge>
            </div>
            <CardDescription className="text-xs">
              Serial rebase → verify → squash-merge pipeline preventing branch collisions.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-2.5 pt-4">
            {data.mergeQueue.length === 0 ? (
              <Empty className="border border-dashed py-8">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <CheckCircle2Icon />
                  </EmptyMedia>
                  <EmptyTitle>Merge queue is clear</EmptyTitle>
                  <EmptyDescription>
                    Passed pull requests waiting for serial rebase and CI verification will queue
                    here automatically.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="flex max-h-80 flex-col gap-2 overflow-y-auto pr-1">
                {data.mergeQueue.map((pr) => (
                  <div
                    key={pr.id}
                    className="flex flex-col gap-2 rounded-lg border border-border/80 bg-card p-3 transition-colors hover:border-border"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                          <span className="font-mono text-muted-foreground">#{pr.number}</span>
                          <span className="truncate">{pr.title}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                          <span className="font-sans text-foreground/80">{pr.projectName}</span>
                          <span>·</span>
                          <span className="inline-flex items-center gap-1">
                            <GitBranchIcon className="size-3" aria-hidden="true" />
                            {pr.headBranch} → {pr.baseBranch}
                          </span>
                        </div>
                      </div>
                      <Badge
                        variant={queueStatusBadgeVariant(pr.queueStatus)}
                        className="shrink-0 capitalize"
                      >
                        {pr.queueStatus}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between border-t border-border/50 pt-1.5 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <StatusDot status={pr.ciStatus === "passing" ? "passed" : pr.ciStatus === "failing" ? "failed" : "working"} />
                        CI: <span className="capitalize text-foreground/80">{pr.ciStatus}</span>
                      </span>
                      <span className="font-mono tabular-nums">
                        {formatRelativeTime(pr.updatedAt)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-4">
            <div className="flex flex-col gap-1">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <TerminalIcon className="size-4 text-primary" aria-hidden="true" />
                Runner Command Log
              </CardTitle>
              <CardDescription className="text-xs">
                Commands dispatched from Web UI to local{" "}
                <code className="font-mono">sf daemon</code>.
              </CardDescription>
            </div>
            <div
              role="group"
              aria-label="Filter runner commands"
              className="inline-flex items-center rounded-md border border-border bg-muted/40 p-0.5"
            >
              {(
                [
                  { id: "all", label: "All" },
                  { id: "active", label: `Active (${activeCommands})` },
                  { id: "failed", label: `Failed (${failedCommands})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setCommandFilter(tab.id)}
                  className={`cursor-pointer rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
                    commandFilter === tab.id
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </CardHeader>

          <CardContent className="flex flex-1 flex-col gap-2 pt-4">
            {filteredCommands.length === 0 ? (
              <Empty className="border border-dashed py-8">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <TerminalIcon />
                  </EmptyMedia>
                  <EmptyTitle>
                    {data.commands.length === 0
                      ? "No commands dispatched yet"
                      : "No commands match this filter"}
                  </EmptyTitle>
                  <EmptyDescription>
                    {data.commands.length === 0
                      ? "Start a session or trigger Auto-Run from any project to dispatch work to your runner."
                      : "Switch back to All to inspect the complete recent command history."}
                  </EmptyDescription>
                </EmptyHeader>
                {data.commands.length === 0 && (
                  <EmptyContent>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      nativeButton={false}
                      render={<Link href="/sessions" />}
                    >
                      New Session
                      <ArrowRightIcon data-icon="inline-end" />
                    </Button>
                  </EmptyContent>
                )}
              </Empty>
            ) : (
              <div className="flex max-h-80 flex-col gap-2 overflow-y-auto pr-1">
                {filteredCommands.slice(0, 15).map((c) => (
                  <div
                    key={c.id}
                    className={`flex flex-col gap-1.5 rounded-lg border px-3 py-2.5 text-xs transition-colors ${
                      c.status === "failed"
                        ? "border-destructive/35 bg-destructive/[0.04]"
                        : "border-border/80 bg-card hover:border-border"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <StatusDot status={c.status} />
                        <span className="truncate font-mono font-medium text-foreground">
                          {c.type}
                        </span>
                        {c.projectName && (
                          <span className="hidden truncate rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline">
                            {c.projectName}
                          </span>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2 font-mono text-[11px] tabular-nums">
                        <span className={`capitalize ${commandStatusTone(c.status)}`}>
                          {c.status}
                        </span>
                        <span className="text-muted-foreground">
                          {formatRelativeTime(c.createdAt)}
                        </span>
                      </div>
                    </div>

                    {c.runKey && (
                      <div className="truncate pl-4 font-mono text-[11px] text-muted-foreground">
                        {c.runKey}
                      </div>
                    )}

                    {c.error && (
                      <div className="mt-0.5 flex items-start gap-1.5 rounded-md border border-destructive/25 bg-destructive/10 px-2.5 py-1.5 font-mono text-[11px] text-destructive">
                        <AlertCircleIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                        <span className="line-clamp-2 break-words">{c.error}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
