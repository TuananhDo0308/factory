"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FolderIcon,
  MessageSquareIcon,
  PauseIcon,
  PlayIcon,
  UsersIcon,
  WrenchIcon,
  ZapIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ContextLakeViewer, type ContextLakeFile } from "@/components/factory/context-lake-viewer";
import { StatusDot } from "@/components/factory/factory-primitives";
import { KanbanBoard } from "@/components/factory/kanban-board";
import { ProjectDashboard } from "@/components/factory/project-dashboard";
import { ProjectPrototypesWorkspace } from "@/components/factory/prototype-viewer";
import { SettingsTeamPanel } from "@/components/factory/settings-team-panel";
import { useFactoryStream } from "@/components/factory/use-factory-stream";
import type { ProjectBoardSnapshot } from "@/lib/board-data";

type ProjectWorkspaceProps = {
  project: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    engine: string;
    source: string;
    localPath: string | null;
    githubFullName: string | null;
    githubUrl: string | null;
    defaultBranch: string;
    initStatus: string;
    readinessScore: number | null;
  };
  myRole: "owner" | "member" | "viewer";
  currentUserId: string;
  ownerLogin: string;
  memberCount: number;
  initialBoard: ProjectBoardSnapshot;
  missions: Array<{
    id: string;
    title: string;
    goal: string;
    status: string;
    autonomy: string;
    validationContractMd: string;
    issueCount: number;
    passedCount: number;
    updatedAt: string;
  }>;
  contextLake: {
    files: ContextLakeFile[];
    source: "local" | "daemon" | "github" | "none";
    syncedAt: string | null;
  };
  defaultTab?: string;
};

export function ProjectWorkspace({
  project,
  myRole,
  currentUserId,
  ownerLogin,
  memberCount: initialMemberCount,
  initialBoard,
  contextLake: initialContextLake,
  defaultTab = "dashboard",
}: ProjectWorkspaceProps) {
  const router = useRouter();
  const canWrite = myRole === "owner" || myRole === "member";
  const [teamOpen, setTeamOpen] = React.useState(defaultTab === "team");
  const [activeTab, setActiveTab] = React.useState<string>(() =>
    defaultTab === "team" || defaultTab === "missions" || defaultTab === "runs"
      ? "dashboard"
      : defaultTab,
  );
  const [memberCount, setMemberCount] = React.useState(initialMemberCount);
  const mounted = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const origin =
    mounted && typeof window !== "undefined" ? window.location.origin : "http://localhost:8787";
  const [board, setBoard] = React.useState<ProjectBoardSnapshot>(initialBoard);
  const [contextLake, setContextLake] = React.useState(initialContextLake);
  const [contextSyncing, setContextSyncing] = React.useState(false);
  const [dispatchBusy, setDispatchBusy] = React.useState<string | null>(null);
  const issues = board.issues;
  const readyCount = React.useMemo(
    () => issues.filter((i) => i.status === "ready").length,
    [issues],
  );

  const refreshTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshBoard = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${project.id}/board`, { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { board?: ProjectBoardSnapshot };
        if (data.board) setBoard(data.board);
      }
    } catch {
      // Ignore transient poll error.
    }
  }, [project.id]);

  const refreshContextLake = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${project.id}/context`, { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as {
          files?: ContextLakeFile[];
          source?: "local" | "daemon" | "github" | "none";
          syncedAt?: string | null;
        };
        if (Array.isArray(data.files)) {
          setContextLake({
            files: data.files,
            source: data.source ?? "none",
            syncedAt: data.syncedAt ?? null,
          });
        }
      }
    } catch {
      // Ignore transient refresh error.
    }
  }, [project.id]);

  const handleSyncContext = React.useCallback(async () => {
    setContextSyncing(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/context`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "auto" }),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        files?: ContextLakeFile[];
        source?: "local" | "daemon" | "github" | "none";
        syncedAt?: string | null;
        savedCount?: number;
        queuedRunnerName?: string | null;
        message?: string;
        error?: string;
      } | null;
      if (!res.ok) {
        toast.error(data?.error || "Could not sync Context Lake");
        return;
      }
      if (Array.isArray(data?.files)) {
        setContextLake({
          files: data.files,
          source: data.source ?? "none",
          syncedAt: data.syncedAt ?? new Date().toISOString(),
        });
      }
      if (data?.queuedRunnerName && !data.savedCount) {
        toast.success(`Requested live sync from runner "${data.queuedRunnerName}"`);
        setTimeout(() => void refreshContextLake(), 2500);
      } else {
        toast.success(
          `Synced ${data?.savedCount ?? data?.files?.length ?? 0} file(s)${data?.source ? ` (${data.source})` : ""}`,
        );
      }
      await refreshBoard();
    } finally {
      setContextSyncing(false);
    }
  }, [project.id, refreshBoard, refreshContextLake]);

  const scheduleBoardRefresh = React.useCallback(() => {
    if (refreshTimerRef.current) return;
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      void refreshBoard();
    }, 300);
  }, [refreshBoard]);

  React.useEffect(() => {
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  useFactoryStream((eventType) => {
    scheduleBoardRefresh();
    if (eventType === "context:updated") {
      void refreshContextLake();
    }
  });

  async function handleDispatchPolicy(
    action: "start_auto" | "stop_auto" | "set_auto_approve",
    extra?: { autoApprove?: boolean },
  ) {
    setDispatchBusy(action);
    try {
      const res = await fetch(`/api/projects/${project.id}/dispatch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        autoDispatch?: boolean;
        autoApprove?: boolean;
        approvedCount?: number;
        dispatched?: Array<{ issueKey: string; runId: string }>;
        skippedReason?: string | null;
        error?: string;
      } | null;

      if (!res.ok) {
        toast.error(data?.error || "Could not update Auto-Run settings");
        return;
      }

      if (action === "stop_auto") {
        toast.success("Auto-Run paused (running tasks will finish normally)");
      } else if (action === "set_auto_approve") {
        if (data?.autoApprove) {
          const parts: string[] = ["No-approval mode enabled"];
          if ((data.approvedCount ?? 0) > 0) {
            parts.push(`auto-approved ${data.approvedCount} review ticket(s)`);
          }
          if ((data.dispatched?.length ?? 0) > 0) {
            parts.push(`started ${data.dispatched!.map((d) => d.issueKey).join(", ")}`);
          }
          toast.success(parts.join(" · "));
        } else {
          toast.success("Manual approval restored before marking tickets done");
        }
      } else {
        const modeLabel = data?.autoApprove ? "Full Auto (No Approval)" : "Auto-Run";
        const count = data?.dispatched?.length ?? 0;
        const approved = data?.approvedCount ?? 0;
        if (count > 0) {
          toast.success(
            `${modeLabel} active — started ${data!.dispatched!.map((d) => d.issueKey).join(", ")}`,
          );
        } else if (data?.skippedReason === "project_not_initialized") {
          toast.warning(
            `${modeLabel} enabled, but Factory Init must be completed first before unattended builds start`,
          );
        } else if (data?.skippedReason === "no_online_runner") {
          toast.warning(`${modeLabel} enabled, waiting for an online \`sf daemon\` runner`);
        } else if (approved > 0) {
          toast.success(`${modeLabel} active — auto-approved ${approved} ticket(s)`);
        } else {
          toast.success(`${modeLabel} enabled for this project`);
        }
      }
      await refreshBoard();
    } finally {
      setDispatchBusy(null);
    }
  }

  async function handleRunProjectInit() {
    setDispatchBusy("run_init");
    try {
      const res = await fetch(`/api/projects/${project.id}/dispatch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "run_init" }),
      });
      const data = (await res.json().catch(() => null)) as {
        run?: { id: string };
        error?: string;
      } | null;
      if (!res.ok || !data?.run) {
        toast.error(data?.error || "Could not start /factory init session");
        return;
      }
      toast.success("Opened interactive /factory init chat");
      router.push(`/sessions/${data.run.id}`);
    } finally {
      setDispatchBusy(null);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      {/* Project Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
        <div className="flex items-center gap-2.5">
          <FolderIcon className="size-4.5 text-muted-foreground" />
          <h1 className="text-xl font-medium tracking-tight">{project.name}</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canWrite && (
            <>
              <label
                htmlFor="project-no-approval"
                title="Auto-merge passed branches, skip approval gates, and advance dependent tickets automatically"
                className={`flex h-8 cursor-pointer items-center gap-2 rounded-md border px-2.5 text-xs transition-colors select-none ${
                  board.autoApprove
                    ? "border-primary/40 bg-primary/10 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                <Switch
                  id="project-no-approval"
                  size="sm"
                  checked={board.autoApprove}
                  disabled={dispatchBusy !== null}
                  onCheckedChange={(checked) =>
                    void handleDispatchPolicy("set_auto_approve", {
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
                  onClick={() => void handleDispatchPolicy("stop_auto")}
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
                    void handleDispatchPolicy("start_auto", {
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

          <Button variant="outline" size="sm" onClick={() => setTeamOpen(true)}>
            <UsersIcon data-icon="inline-start" />
            Team ({memberCount})
          </Button>
        </div>
      </div>

      {/* Stage 1: Project-level /factory init gate banner (once per project, before unattended builds) */}
      {board.initStatus !== "complete" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/35 bg-primary/5 px-4 py-3 text-xs">
          <div className="flex min-w-0 items-center gap-2.5">
            {board.activeInitRun ? (
              <StatusDot
                status={
                  board.activeInitRun.status === "awaiting_input" ? "waiting_on_you" : "working"
                }
              />
            ) : (
              <WrenchIcon className="size-4 shrink-0 text-primary" />
            )}
            <div className="flex min-w-0 flex-col gap-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-foreground">
                  {board.activeInitRun
                    ? "Stage 1 · Factory Init session in progress"
                    : "Stage 1 · Run /factory init once before building tickets"}
                </span>
                <Badge variant="outline">Init required</Badge>
              </div>
              <span className="text-muted-foreground">
                Set up <code className="font-mono">.factory/project.json</code>, checks, design tokens, and stack skills interactively so every <code className="font-mono">/factory</code> build runs 100% unattended.
              </span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {board.activeInitRun ? (
              <Button
                size="sm"
                nativeButton={false}
                render={<Link href={`/sessions/${board.activeInitRun.id}`} />}
              >
                <MessageSquareIcon data-icon="inline-start" />
                Open Init Chat
              </Button>
            ) : canWrite ? (
              <Button
                size="sm"
                disabled={dispatchBusy !== null}
                onClick={() => void handleRunProjectInit()}
              >
                {dispatchBusy === "run_init" ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <MessageSquareIcon data-icon="inline-start" />
                )}
                Run Factory Init
              </Button>
            ) : null}
          </div>
        </div>
      )}

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="border-b border-border/70">
          <TabsList variant="line">
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="issues">Kanban Board ({issues.length})</TabsTrigger>
            <TabsTrigger value="prototypes">
              Prototypes ({board.prototypes?.length ?? 0})
            </TabsTrigger>
            <TabsTrigger value="context">Context Lake ({contextLake.files.length})</TabsTrigger>
          </TabsList>
        </div>

        {/* DASHBOARD OVERVIEW TAB (Default) */}
        <TabsContent value="dashboard" className="pt-5">
          <ProjectDashboard
            engine={project.engine}
            board={board}
            onOpenKanban={() => setActiveTab("issues")}
          />
        </TabsContent>

        {/* KANBAN BOARD / ISSUES TAB */}
        <TabsContent value="issues" className="pt-5">
          <KanbanBoard
            project={{
              id: project.id,
              name: project.name,
              slug: project.slug,
              engine: project.engine,
              defaultBranch: project.defaultBranch,
              localPath: project.localPath,
            }}
            canWrite={canWrite}
            board={board}
            onRefresh={refreshBoard}
          />
        </TabsContent>

        {/* INTERACTIVE PROTOTYPES TAB */}
        <TabsContent value="prototypes" className="pt-5">
          <ProjectPrototypesWorkspace
            projectId={project.id}
            prototypes={board.prototypes ?? []}
            canWrite={canWrite}
            onRefresh={refreshBoard}
          />
        </TabsContent>

        {/* CONTEXT LAKE (.factory/) TAB */}
        <TabsContent value="context" className="pt-5">
          <ContextLakeViewer
            files={contextLake.files}
            source={contextLake.source}
            syncedAt={contextLake.syncedAt}
            githubFullName={project.githubFullName}
            canWrite={canWrite}
            syncing={contextSyncing}
            onSync={handleSyncContext}
          />
        </TabsContent>
      </Tabs>

      {/* In-Place Project Team Dialog (with GitHub User Autocomplete & Runner Share toggle) */}
      <Dialog open={teamOpen} onOpenChange={setTeamOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader className="border-b pb-4 pr-8">
            <div className="flex items-start gap-3">
              <span
                className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary"
                aria-hidden="true"
              >
                <UsersIcon className="size-4.5" />
              </span>
              <div className="flex min-w-0 flex-col gap-1">
                <DialogTitle className="text-base font-semibold tracking-tight">
                  Team · {project.name}
                </DialogTitle>
                <DialogDescription className="text-xs leading-relaxed">
                  Add signed-in GitHub users, share an invite link, or toggle Team Share on your
                  runner daemon.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="max-h-[65vh] overflow-y-auto pr-1">
            <SettingsTeamPanel
              lockedProjectId={project.id}
              projects={[
                {
                  id: project.id,
                  name: project.name,
                  engine: project.engine,
                  isOwner: myRole === "owner",
                  ownerLogin,
                  memberCount,
                },
              ]}
              currentUserId={currentUserId}
              origin={origin}
              onMemberCountChange={setMemberCount}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => setTeamOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
