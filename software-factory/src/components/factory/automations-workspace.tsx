"use client";

import * as React from "react";
import {
  GitMergeIcon,
  LaptopIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  TerminalIcon,
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

export function AutomationsWorkspace({ initialData }: { initialData: AutomationsData }) {
  const [data, setData] = React.useState(initialData);
  const [sweeping, setSweeping] = React.useState(false);

  const reload = React.useCallback(async () => {
    const res = await fetch("/api/automations", { cache: "no-store" });
    if (res.ok) {
      const json = (await res.json()) as AutomationsData;
      setData(json);
    }
  }, []);

  useFactoryStream(() => void reload());

  async function toggleAutoDispatch(projectId: string, autoDispatch: boolean) {
    const res = await fetch("/api/automations", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId, autoDispatch }),
    });
    if (res.ok) {
      toast.success(autoDispatch ? "Auto-dispatch enabled" : "Auto-dispatch disabled");
      await reload();
    }
  }

  async function toggleAutoApprove(projectId: string, autoApprove: boolean) {
    const res = await fetch("/api/automations", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId, autoApprove }),
    });
    const json = (await res.json().catch(() => null)) as {
      approvedCount?: number;
      dispatched?: Array<{ issueKey: string }>;
    } | null;
    if (res.ok) {
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
      const json = (await res.json().catch(() => null)) as { stalled?: number } | null;
      toast.success(`Watchdog check complete (${json?.stalled ?? 0} stalled flagged)`);
      await reload();
    } finally {
      setSweeping(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-medium tracking-tight">Automations &amp; Fleet Ops</h1>
          <p className="text-sm text-muted-foreground">
            Manage Auto-Dispatch, Refinery Merge Queue, Watchdog stall detection, and local{" "}
            <code className="font-mono">sf daemon</code> runners.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={sweeping}
          onClick={() => void runWatchdogNow()}
        >
          <ShieldCheckIcon data-icon="inline-start" />
          Run Watchdog Check
        </Button>
      </div>

      {/* Connected Local Runners */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <LaptopIcon className="size-4" />
            Local Runners (<code className="font-mono text-xs">sf daemon</code>)
          </CardTitle>
          <CardDescription>
            Machines executing Antigravity / Claude Code worktrees and watching live dashboard
            snapshots.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.runners.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 font-mono text-xs text-muted-foreground">
              No runners online. Start one via: node /Users/tuananhdo/factory/software-factory/cli/sf.ts daemon --root /Users/tuananhdo/factory
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {data.runners.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between rounded-lg border px-3.5 py-3 text-sm"
                >
                  <div className="flex items-center gap-2.5">
                    <StatusDot status={r.status} />
                    <div className="flex flex-col">
                      <span className="font-medium">{r.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {r.hostname} ({r.os}) · {r.activeRuns}/{r.maxConcurrency} slots ·{" "}
                        {formatRelativeTime(r.lastHeartbeatAt)}
                      </span>
                    </div>
                  </div>
                  <Badge variant={r.status === "online" ? "default" : "secondary"}>
                    {r.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Project Dispatch & Watchdog Policy */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <RefreshCwIcon className="size-4" />
            Project Dispatch &amp; Watchdog Policies
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Engine</TableHead>
                <TableHead>Ready Issues</TableHead>
                <TableHead>Active Runs</TableHead>
                <TableHead>Stall Timeout</TableHead>
                <TableHead className="text-right">Auto-Dispatch</TableHead>
                <TableHead className="text-right">No Approval</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.projects.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{p.engine}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{p.readyIssues}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {p.activeRuns}/{p.maxConcurrency}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {p.stallTimeoutMinutes}m
                  </TableCell>
                  <TableCell className="text-right">
                    <Switch
                      checked={p.autoDispatch}
                      onCheckedChange={(v) => void toggleAutoDispatch(p.id, v)}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Switch
                      checked={p.autoApprove}
                      onCheckedChange={(v) => void toggleAutoApprove(p.id, v)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Merge Queue + Recent Runner Commands */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <GitMergeIcon className="size-4" />
              Merge Queue ({data.mergeQueue.length})
            </CardTitle>
            <CardDescription>
              Serial rebase → verify → squash-merge queue preventing branch collisions.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {data.mergeQueue.length === 0 ? (
              <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                Merge queue is empty.
              </div>
            ) : (
              data.mergeQueue.map((pr) => (
                <div
                  key={pr.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-xs"
                >
                  <div className="flex flex-col">
                    <span className="font-medium">
                      #{pr.number} {pr.title}
                    </span>
                    <span className="font-mono text-muted-foreground">
                      {pr.projectName} · {pr.baseBranch} ← {pr.headBranch}
                    </span>
                  </div>
                  <Badge variant="outline">{pr.queueStatus}</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <TerminalIcon className="size-4" />
              Recent Runner Commands ({data.commands.length})
            </CardTitle>
            <CardDescription>
              Two-way commands dispatched from Web UI to local{" "}
              <code className="font-mono">sf daemon</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {data.commands.length === 0 ? (
              <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                No commands dispatched yet.
              </div>
            ) : (
              data.commands.slice(0, 10).map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <StatusDot status={c.status} />
                    <span className="font-mono font-medium">{c.type}</span>
                    {c.runKey && (
                      <span className="font-mono text-muted-foreground">{c.runKey}</span>
                    )}
                  </div>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {c.status} · {formatRelativeTime(c.createdAt)}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
