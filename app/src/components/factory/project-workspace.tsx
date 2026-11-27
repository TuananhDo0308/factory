"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckIcon,
  FolderIcon,
  GitBranchIcon,
  LaptopIcon,
  MessageSquarePlusIcon,
  MoreHorizontalIcon,
  SettingsIcon,
  Trash2Icon,
  UsersIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ContextLakeViewer, type ContextLakeFile } from "@/components/factory/context-lake-viewer";
import { StatusDot } from "@/components/factory/factory-primitives";
import { KanbanBoard } from "@/components/factory/kanban-board";
import { GithubTrackingCard } from "@/components/factory/github-tracking-card";
import { ProjectDashboard } from "@/components/factory/project-dashboard";
import { ProjectPrototypesWorkspace } from "@/components/factory/prototype-viewer";
import { SettingsTeamPanel } from "@/components/factory/settings-team-panel";
import { useFactoryStream } from "@/components/factory/use-factory-stream";
import type { ProjectBoardSnapshot } from "@/lib/board-data";

type ProjectRunnerOption = {
  id: string;
  name: string;
  hostname: string;
  os: string;
  status: "online" | "offline";
  isOwn: boolean;
  ownerLogin: string;
  visibility: "personal" | "team";
};

type ProjectWorkspaceProps = {
  project: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    source: string;
    localPath: string | null;
    githubFullName: string | null;
    githubUrl: string | null;
    defaultBranch: string;
    defaultRunnerId: string | null;
  };
  runners: ProjectRunnerOption[];
  myRole: "owner" | "member" | "viewer";
  currentUserId: string;
  ownerLogin: string;
  memberCount: number;
  initialBoard: ProjectBoardSnapshot;
  contextLake: {
    files: ContextLakeFile[];
    source: "local" | "daemon" | "github" | "none";
    syncedAt: string | null;
  };
  /** The page of the project shown (each has its own route and sidebar entry). */
  section: ProjectSection;
  openTeam?: boolean;
};

export type ProjectSection = "overview" | "kanban" | "prototypes" | "context";

const SECTION_TITLES: Record<ProjectSection, string> = {
  overview: "Overview",
  kanban: "Kanban",
  prototypes: "Prototypes",
  context: "Context Lake",
};

function ProjectTabCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-2xl border border-transparent bg-background shadow-none ring-0 transition-[background-color,border-color,box-shadow] duration-300 ease-out group-data-[card-state=elevated]/tab-card:border-border/90 group-data-[card-state=elevated]/tab-card:bg-card group-data-[card-state=elevated]/tab-card:shadow-lg group-data-[card-state=elevated]/tab-card:ring-1 group-data-[card-state=elevated]/tab-card:ring-black/5 dark:group-data-[card-state=elevated]/tab-card:shadow-2xl dark:group-data-[card-state=elevated]/tab-card:shadow-black/50 dark:group-data-[card-state=elevated]/tab-card:ring-white/5">
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 sm:px-3 sm:py-3">{children}</div>
    </div>
  );
}

export function ProjectWorkspace({
  project,
  runners,
  myRole,
  currentUserId,
  ownerLogin,
  memberCount: initialMemberCount,
  initialBoard,
  contextLake: initialContextLake,
  section,
  openTeam = false,
}: ProjectWorkspaceProps) {
  const router = useRouter();
  const canWrite = myRole === "owner" || myRole === "member";
  const [teamOpen, setTeamOpen] = React.useState(openTeam);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deletingProject, setDeletingProject] = React.useState(false);
  const [memberCount, setMemberCount] = React.useState(initialMemberCount);
  const [defaultRunnerId, setDefaultRunnerId] = React.useState<string | null>(
    project.defaultRunnerId,
  );
  const [savingRunner, setSavingRunner] = React.useState(false);
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
  const [repoOpen, setRepoOpen] = React.useState(false);
  const [repoDraft, setRepoDraft] = React.useState(project.githubFullName ?? "");
  const [githubFullName, setGithubFullName] = React.useState(project.githubFullName);
  const [savingRepo, setSavingRepo] = React.useState(false);
  const isMountedRef = React.useRef(true);
  React.useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  const autoFallbackRunner = React.useMemo(
    () =>
      runners.find((r) => r.status === "online" && r.isOwn) ??
      runners.find((r) => r.status === "online") ??
      null,
    [runners],
  );

  async function handleSelectDefaultRunner(nextRunnerId: string | null) {
    if (nextRunnerId === defaultRunnerId || savingRunner) return;
    setSavingRunner(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ defaultRunnerId: nextRunnerId }),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        project?: { defaultRunnerId?: string | null };
        error?: string;
      } | null;
      if (!res.ok) {
        toast.error(data?.error || "Could not update default daemon");
        return;
      }
      const savedId = data?.project?.defaultRunnerId ?? nextRunnerId;
      setDefaultRunnerId(savedId);
      const chosen = savedId ? runners.find((r) => r.id === savedId) : null;
      toast.success(
        chosen
          ? `Default daemon for ${project.name} set to "${chosen.name}"`
          : `Default daemon for ${project.name} set to Auto`,
      );
      router.refresh();
    } finally {
      setSavingRunner(false);
    }
  }

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
        body: JSON.stringify({
          source: "auto",
          runnerId: defaultRunnerId || undefined,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        files?: ContextLakeFile[];
        source?: "local" | "daemon" | "github" | "none";
        syncedAt?: string | null;
        savedCount?: number;
        queuedRunnerName?: string | null;
        commandId?: string | null;
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
      if (data?.queuedRunnerName && data.commandId) {
        toast.info(`Syncing Context Lake via "${data.queuedRunnerName}"…`);
        // Poll until the runner finishes pushing `.factory/` (works reliably on Vercel Serverless where SSE cannot cross lambdas)
        let settled = false;
        for (let attempt = 0; attempt < 12; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          if (!isMountedRef.current) return;
          const pollRes = await fetch(
            `/api/projects/${project.id}/context?commandId=${encodeURIComponent(data.commandId)}`,
            { cache: "no-store" },
          ).catch(() => null);
          if (!pollRes?.ok) continue;
          const pollData = (await pollRes.json().catch(() => null)) as {
            files?: ContextLakeFile[];
            source?: "local" | "daemon" | "github" | "none";
            syncedAt?: string | null;
            commandStatus?: string;
            commandError?: string | null;
          } | null;
          if (!pollData) continue;
          if (Array.isArray(pollData.files) && pollData.files.length > 0) {
            setContextLake({
              files: pollData.files,
              source: pollData.source ?? "daemon",
              syncedAt: pollData.syncedAt ?? new Date().toISOString(),
            });
          }
          if (pollData.commandStatus === "done") {
            settled = true;
            toast.success(
              `Synced ${pollData.files?.length ?? 0} file(s) from "${data.queuedRunnerName}"`,
            );
            break;
          }
          if (pollData.commandStatus === "failed") {
            settled = true;
            toast.error(
              pollData.commandError ||
                `Runner "${data.queuedRunnerName}" could not sync Context Lake`,
            );
            break;
          }
        }
        if (!settled && isMountedRef.current) {
          toast.warning(
            `Still waiting on runner "${data.queuedRunnerName}". Make sure \`sf daemon\` is up to date and pointing at this server.`,
          );
        }
      } else if (data?.queuedRunnerName && !data.savedCount) {
        toast.success(`Requested live sync from runner "${data.queuedRunnerName}"`);
        setTimeout(() => void refreshContextLake(), 2500);
      } else {
        toast.success(
          `Synced ${data?.savedCount ?? data?.files?.length ?? 0} file(s)${data?.source ? ` (${data.source})` : ""}`,
        );
      }
      await refreshBoard();
    } finally {
      if (isMountedRef.current) setContextSyncing(false);
    }
  }, [defaultRunnerId, project.id, refreshBoard, refreshContextLake]);

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
    if (eventType === "context:updated" || (eventType === "poll:tick" && section === "context")) {
      void refreshContextLake();
    }
  });

  async function handleSaveRepo() {
    setSavingRepo(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ githubFullName: repoDraft.trim() }),
      });
      const data = (await res.json().catch(() => null)) as {
        project?: { githubFullName?: string | null };
        error?: string;
      } | null;
      if (!res.ok) {
        toast.error(data?.error || "Could not save the repository");
        return;
      }
      setGithubFullName(data?.project?.githubFullName ?? null);
      setRepoOpen(false);
      toast.success("GitHub repository saved");
      await refreshBoard();
    } finally {
      setSavingRepo(false);
    }
  }

  async function handleDeleteProject() {
    if (deletingProject) return;
    setDeletingProject(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;
      if (!res.ok) {
        toast.error(data?.error || "Could not delete project");
        return;
      }
      toast.success(`Deleted project "${project.name}"`);
      setDeleteOpen(false);
      router.push("/sessions");
      router.refresh();
    } finally {
      setDeletingProject(false);
    }
  }

  return (
    <div className="flex h-[calc(100dvh-2.75rem)] min-h-0 min-w-0 flex-1 flex-col gap-3 px-3 pt-3 pb-3 sm:px-4 sm:pt-3.5 sm:pb-4 md:h-[100dvh]">
      {/* Project Header */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b pb-3">
        <div className="flex items-center gap-2.5">
          <FolderIcon className="size-4.5 text-muted-foreground" />
          <h1 className="text-xl font-medium tracking-tight">
            {project.name}
            {section !== "overview" && (
              <span className="text-muted-foreground"> / {SECTION_TITLES[section]}</span>
            )}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Quick New Chat shortcut pre-selecting this project + its default daemon */}
          <Button
            variant="default"
            size="sm"
            nativeButton={false}
            render={<Link href={`/sessions?project=${encodeURIComponent(project.id)}`} />}
          >
            <MessageSquarePlusIcon data-icon="inline-start" />
            New Chat
          </Button>

          <Button variant="outline" size="sm" onClick={() => setTeamOpen(true)}>
            <UsersIcon data-icon="inline-start" />
            Team ({memberCount})
          </Button>

          {/* Compact project options menu (Default Daemon + Delete Project) */}
          {canWrite && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    disabled={savingRunner}
                    title="Project options (Default daemon & Delete)"
                    aria-label="Project options"
                  >
                    {savingRunner ? <Spinner /> : <MoreHorizontalIcon />}
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Default Daemon</DropdownMenuLabel>
                  <DropdownMenuItem
                    onClick={() => void handleSelectDefaultRunner(null)}
                    className="justify-between gap-2"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <LaptopIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      <div className="flex min-w-0 flex-col">
                        <span className="text-xs font-medium">Auto (best online)</span>
                        {autoFallbackRunner && (
                          <span className="truncate font-mono text-2xs text-muted-foreground">
                            Currently {autoFallbackRunner.name}
                          </span>
                        )}
                      </div>
                    </div>
                    {defaultRunnerId === null && <CheckIcon className="size-3.5 shrink-0" />}
                  </DropdownMenuItem>
                  {runners.map((r) => (
                    <DropdownMenuItem
                      key={r.id}
                      onClick={() => void handleSelectDefaultRunner(r.id)}
                      className="justify-between gap-2"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <StatusDot status={r.status} />
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate font-mono text-xs">{r.name}</span>
                          <span className="truncate text-2xs text-muted-foreground">
                            {r.status}
                            {!r.isOwn ? ` · @${r.ownerLogin}` : ""}
                          </span>
                        </div>
                      </div>
                      {defaultRunnerId === r.id && <CheckIcon className="size-3.5 shrink-0" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>

                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    setRepoDraft(githubFullName ?? "");
                    setRepoOpen(true);
                  }}
                  className="gap-2 text-xs"
                >
                  <GitBranchIcon className="size-3.5" />
                  <span className="truncate">GitHub repository: {githubFullName || "not set"}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => router.push("/settings?tab=runners")}
                  className="gap-2 text-xs text-muted-foreground"
                >
                  <SettingsIcon className="size-3.5" />
                  <span>Manage daemons…</span>
                </DropdownMenuItem>

                {myRole === "owner" && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setDeleteOpen(true)}
                      className="gap-2 text-xs text-destructive focus:bg-destructive/10 focus:text-destructive"
                    >
                      <Trash2Icon className="size-3.5" />
                      <span>Delete project…</span>
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* One page per section; the sidebar switches between them. */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {section === "overview" && (
                  <ProjectTabCard>
                    <GithubTrackingCard
                      projectId={project.id}
                      defaultLink={project.githubUrl ?? githubFullName}
                      canWrite={canWrite}
                      onSynced={() => void refreshBoard()}
                    />
                    <ProjectDashboard
                      board={board}
                      onOpenKanban={() => router.push(`/projects/${project.id}/kanban`)}
                    />
                  </ProjectTabCard>
        )}
        {section === "kanban" && (
                  <ProjectTabCard>
                    <KanbanBoard
                      project={{
                        id: project.id,
                        name: project.name,
                        githubFullName,
                      }}
                      canWrite={canWrite}
                      board={board}
                      onRefresh={refreshBoard}
                    />
                  </ProjectTabCard>
        )}
        {section === "prototypes" && (
                  <ProjectTabCard>
                    <ProjectPrototypesWorkspace
                      projectId={project.id}
                      prototypes={board.prototypes ?? []}
                      canWrite={canWrite}
                      onRefresh={refreshBoard}
                    />
                  </ProjectTabCard>
        )}
        {section === "context" && (
                  <ProjectTabCard>
                    <ContextLakeViewer
                      files={contextLake.files}
                      source={contextLake.source}
                      syncedAt={contextLake.syncedAt}
                      githubFullName={project.githubFullName}
                      canWrite={canWrite}
                      syncing={contextSyncing}
                      onSync={handleSyncContext}
                    />
                  </ProjectTabCard>
        )}
      </div>

      <Dialog open={repoOpen} onOpenChange={setRepoOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>GitHub repository</DialogTitle>
            <DialogDescription>
              The repository new-ba publishes epics to and new-factory builds them in, as{" "}
              <code className="font-mono">owner/name</code>.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={repoDraft}
            onChange={(e) => setRepoDraft(e.target.value)}
            placeholder="owner/name"
            className="font-mono text-xs"
          />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRepoOpen(false)} disabled={savingRepo}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void handleSaveRepo()} disabled={savingRepo}>
              {savingRepo && <Spinner data-icon="inline-start" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Project Confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <Trash2Icon />
            </AlertDialogMedia>
            <AlertDialogTitle>Delete &ldquo;{project.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the project and its tracked sessions, Kanban tickets, prototypes, and
              Context Lake snapshots from Software Factory. Your local files on disk and GitHub
              repository will not be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingProject}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deletingProject}
              onClick={() => void handleDeleteProject()}
            >
              {deletingProject ? <Spinner data-icon="inline-start" /> : <Trash2Icon data-icon="inline-start" />}
              {deletingProject ? "Deleting…" : "Delete project"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
                <DialogTitle className="text-lg font-semibold tracking-tight">
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
