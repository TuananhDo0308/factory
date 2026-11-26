"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BarChart3Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  InboxIcon,
  KeyRoundIcon,
  LaptopIcon,
  PaletteIcon,
  PlugIcon,
  PlusIcon,
  RefreshCwIcon,
  SettingsIcon,
  SunMoonIcon,
  TerminalIcon,
  UsersIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  FactoryMark,
  FactoryWordmark,
  formatRelativeTime,
  getSidebarIndicatorKind,
  SidebarStatusIndicator,
} from "@/components/factory/factory-primitives";
import { NewProjectDialog } from "@/components/factory/new-project-dialog";
import { useFactoryStream } from "@/components/factory/use-factory-stream";
import { cn } from "@/lib/utils";
import type { SidebarData } from "@/lib/workspace-data";

const ACTIVE_RUNS_STORAGE_KEY = "sf.sidebar.activeRunIds";
const UNREAD_FINISHED_STORAGE_KEY = "sf.sidebar.unreadFinishedRuns";
const EMPTY_UNREAD_MAP: Record<string, string> = {};

const SETTINGS_SUB_ITEMS = [
  { id: "general", label: "General", icon: SettingsIcon },
  { id: "appearance", label: "Appearance", icon: PaletteIcon },
  { id: "team", label: "Team", icon: UsersIcon },
  { id: "runners", label: "Runners", icon: LaptopIcon },
  { id: "keys", label: "API Keys", icon: KeyRoundIcon },
  { id: "mcp", label: "MCP", icon: PlugIcon },
] as const;

function readJsonStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJsonStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore private-browsing storage errors.
  }
}

function isRunActiveStatus(status: string): boolean {
  const s = status.toLowerCase();
  return s === "running" || s === "queued" || s === "working" || s === "in_progress";
}

function isRunPassedStatus(status: string): boolean {
  const s = status.toLowerCase();
  return s === "passed" || s === "completed" || s === "merged";
}

let cachedUnreadRuns: Record<string, string> = EMPTY_UNREAD_MAP;
let unreadRunsHydrated = false;
const unreadRunsListeners = new Set<() => void>();

function notifyUnreadRunsListeners() {
  for (const listener of unreadRunsListeners) {
    listener();
  }
}

function subscribeUnreadRuns(listener: () => void) {
  unreadRunsListeners.add(listener);
  return () => {
    unreadRunsListeners.delete(listener);
  };
}

function getUnreadRunsServerSnapshot(): Record<string, string> {
  return EMPTY_UNREAD_MAP;
}

function getUnreadRunsClientSnapshot(): Record<string, string> {
  if (!unreadRunsHydrated && typeof window !== "undefined") {
    unreadRunsHydrated = true;
    const stored = readJsonStorage<Record<string, string>>(UNREAD_FINISHED_STORAGE_KEY, {});
    if (stored && typeof stored === "object" && !Array.isArray(stored)) {
      cachedUnreadRuns = stored;
    }
  }
  return cachedUnreadRuns;
}

function commitUnreadRuns(next: Record<string, string>) {
  const prevKeys = Object.keys(cachedUnreadRuns);
  const nextKeys = Object.keys(next);
  const unchanged =
    prevKeys.length === nextKeys.length &&
    nextKeys.every((k) => cachedUnreadRuns[k] === next[k]);
  writeJsonStorage(UNREAD_FINISHED_STORAGE_KEY, next);
  if (!unchanged) {
    cachedUnreadRuns = next;
    notifyUnreadRunsListeners();
  }
}

function clearUnreadRun(runId: string) {
  const current = getUnreadRunsClientSnapshot();
  if (!(runId in current)) return;
  const next = { ...current };
  delete next[runId];
  commitUnreadRuns(next);
}

function reconcileSidebarRunNotifications(
  projects: SidebarData["projects"],
  pathname: string,
) {
  const storedActive = readJsonStorage<string[]>(ACTIVE_RUNS_STORAGE_KEY, []);
  const activeSet = new Set(Array.isArray(storedActive) ? storedActive : []);
  const unreadMap: Record<string, string> = { ...getUnreadRunsClientSnapshot() };

  const visibleRunIds = new Set<string>();
  for (const project of projects) {
    for (const run of project.recentRuns) {
      visibleRunIds.add(run.id);
      const isCurrentRun = pathname === `/sessions/${run.id}`;

      if (isRunActiveStatus(run.status)) {
        activeSet.add(run.id);
        delete unreadMap[run.id];
      } else if (isRunPassedStatus(run.status)) {
        const justFinished = activeSet.has(run.id);
        activeSet.delete(run.id);
        if (isCurrentRun) {
          delete unreadMap[run.id];
        } else if (justFinished) {
          unreadMap[run.id] = run.updatedAt;
        }
      } else {
        activeSet.delete(run.id);
        delete unreadMap[run.id];
      }
    }
  }

  for (const runId of Object.keys(unreadMap)) {
    if (!visibleRunIds.has(runId)) {
      delete unreadMap[runId];
    }
  }

  writeJsonStorage(ACTIVE_RUNS_STORAGE_KEY, Array.from(activeSet));
  commitUnreadRuns(unreadMap);
}

const SKILL_TAG_LABELS: Record<string, string> = {
  factory: "factory",
  ba: "ba",
  clarify: "clarify",
  "ui-refine": "ui",
  "pr-judge": "judge",
  init: "init",
};

function getSidebarSkillLabel(mode: string | null | undefined): string | null {
  const m = (mode || "").toLowerCase().trim();
  if (!m || m === "normal") return null;
  return SKILL_TAG_LABELS[m] ?? m;
}

function compactAgentLabel(agent: {
  name: string;
  role: string;
  specId: string | null;
}): string {
  if (agent.role === "planner") return "Planner";
  if (agent.role === "checker") return "Checker";
  if (agent.role === "reviewer") return "Reviewer";
  if (agent.role === "qc") return "QC";
  if (agent.specId) {
    if (agent.role === "qa") return `${agent.specId} QA`;
    if (agent.role === "implementer") return `${agent.specId} Impl`;
    if (agent.role === "spec-reviewer") return `${agent.specId} Rev`;
  }
  return agent.name.length > 22 ? `${agent.name.slice(0, 21)}…` : agent.name;
}

function SetupRing({ completed, total }: { completed: number; total: number }) {
  const pct = total > 0 ? Math.min(1, Math.max(0, completed / total)) : 0;
  const r = 6;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 16 16" className="size-3.5 -rotate-90" aria-hidden="true">
      <circle
        cx="8"
        cy="8"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="text-border"
      />
      <circle
        cx="8"
        cy="8"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        strokeLinecap="round"
        className="text-success"
      />
    </svg>
  );
}

/** Smooth 60fps accordion panel using CSS Grid height + fade + subtle vertical glide */
function SmoothCollapse({
  open,
  children,
  className,
}: {
  open: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      data-state={open ? "open" : "closed"}
      aria-hidden={!open}
      inert={!open}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
        open ? "grid-rows-[1fr] opacity-100" : "pointer-events-none grid-rows-[0fr] opacity-0",
        className,
      )}
    >
      <div className="min-h-0 overflow-hidden">
        <div
          className={cn(
            "transition-transform duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
            open ? "translate-y-0" : "-translate-y-1.5",
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/** Header row with brand mark + smooth collapse/expand button */
function SidebarBrandHeader() {
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";

  return (
    <SidebarHeader className="px-3 py-3 group-data-[collapsible=icon]:px-2">
      <div
        className={cn(
          "flex items-center gap-2",
          isCollapsed ? "justify-center" : "justify-between",
        )}
      >
        {!isCollapsed && (
          <Link
            href="/sessions"
            className="flex min-w-0 items-center gap-2.5 overflow-hidden text-foreground"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-foreground text-background shadow-xs">
              <FactoryMark className="size-4" />
            </span>
            <FactoryWordmark className="truncate text-[16px] text-foreground" />
          </Link>
        )}

        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={toggleSidebar}
                aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                className="flex size-7 shrink-0 items-center justify-center rounded-md border border-sidebar-border/90 bg-sidebar-accent/40 text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
              >
                {isCollapsed ? (
                  <ArrowRightIcon className="size-3.5" />
                ) : (
                  <ArrowLeftIcon className="size-3.5" />
                )}
              </button>
            }
          />
          <TooltipContent side="right">
            {isCollapsed ? "Expand sidebar (⌘B)" : "Collapse sidebar (⌘B)"}
          </TooltipContent>
        </Tooltip>
      </div>
    </SidebarHeader>
  );
}

/** Collapsible Settings tree section inside the shared sidebar */
function SettingsSidebarTree({
  pathname,
  onlineRunnerCount,
  totalRunnerCount,
}: {
  pathname: string;
  onlineRunnerCount: number;
  totalRunnerCount: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { state, setOpen } = useSidebar();
  const isOnSettings = pathname.startsWith("/settings");
  const activeSettingsTab = isOnSettings ? searchParams.get("tab") || "general" : null;
  const [settingsToggle, setSettingsToggle] = React.useState<{
    onSettings: boolean;
    open: boolean;
  } | null>(null);

  const isSettingsOpen =
    settingsToggle?.onSettings === isOnSettings ? settingsToggle.open : isOnSettings;

  function handleSettingsHeaderClick() {
    if (state === "collapsed") {
      setOpen(true);
      setSettingsToggle({ onSettings: isOnSettings, open: true });
      if (!isOnSettings) router.push("/settings");
      return;
    }
    setSettingsToggle({ onSettings: isOnSettings, open: !isSettingsOpen });
  }

  return (
    <SidebarGroup className="px-2.5 py-1 group-data-[collapsible=icon]:px-2">
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Settings"
              onClick={handleSettingsHeaderClick}
              aria-expanded={isSettingsOpen}
              className={cn(
                "h-9 justify-between gap-2.5 rounded-lg px-2.5 text-[13.5px] font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
                isOnSettings && !isSettingsOpen && "bg-sidebar-accent text-sidebar-accent-foreground",
              )}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <SettingsIcon className="size-4 shrink-0 text-sidebar-foreground/80" />
                <span className="truncate group-data-[collapsible=icon]:hidden">Settings</span>
              </span>
              <ChevronDownIcon
                className={cn(
                  "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] group-data-[collapsible=icon]:hidden",
                  isSettingsOpen && "rotate-180",
                )}
              />
            </SidebarMenuButton>

            <SmoothCollapse
              open={isSettingsOpen}
              className="group-data-[collapsible=icon]:hidden"
            >
              <ul className="mt-1 ml-[17px] flex flex-col gap-0.5 border-l border-sidebar-border/80 pl-3">
                {SETTINGS_SUB_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const isActive = isOnSettings && activeSettingsTab === item.id;
                  return (
                    <li key={item.id} className="min-w-0">
                      <Link
                        href={`/settings?tab=${item.id}`}
                        aria-current={isActive ? "page" : undefined}
                        className={cn(
                          "flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-lg px-2.5 text-[13px] transition-colors",
                          isActive
                            ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                            : "text-sidebar-foreground/85 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-2.5">
                          <Icon className="size-3.5 shrink-0 opacity-80" aria-hidden="true" />
                          <span className="truncate">{item.label}</span>
                        </span>
                        {item.id === "runners" && totalRunnerCount > 0 && (
                          <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
                            {onlineRunnerCount}/{totalRunnerCount}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </SmoothCollapse>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export function AppShell({
  initialData,
  children,
}: {
  initialData: SidebarData;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [liveOverride, setLiveOverride] = React.useState<{
    base: SidebarData;
    fresh: SidebarData;
  } | null>(null);
  const data = liveOverride?.base === initialData ? liveOverride.fresh : initialData;
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [newProjectOpen, setNewProjectOpen] = React.useState(false);
  const [expandedProjectIds, setExpandedProjectIds] = React.useState<Record<string, boolean>>({});
  const [expandedRunIds, setExpandedRunIds] = React.useState<Record<string, boolean>>({});
  const unreadFinishedRuns = React.useSyncExternalStore(
    subscribeUnreadRuns,
    getUnreadRunsClientSnapshot,
    getUnreadRunsServerSnapshot,
  );
  const seenInboxKeysRef = React.useRef<Set<string>>(
    new Set((initialData.inboxAlerts ?? []).map((a) => a.key)),
  );

  const markRunSeen = React.useCallback((runId: string) => {
    clearUnreadRun(runId);
  }, []);

  React.useEffect(() => {
    reconcileSidebarRunNotifications(data.projects, pathname);
  }, [data.projects, pathname]);

  const refreshSidebar = React.useCallback(async () => {
    try {
      const res = await fetch("/api/workspace", { cache: "no-store" });
      if (res.ok) {
        const fresh = (await res.json()) as SidebarData;
        // Fire Sonner toast for any brand-new Inbox alert
        const newAlerts = (fresh.inboxAlerts ?? []).filter(
          (a) => !seenInboxKeysRef.current.has(a.key),
        );
        for (const alert of newAlerts.slice(0, 3)) {
          seenInboxKeysRef.current.add(alert.key);
          const fn = alert.severity === "warning" ? toast.warning : toast.info;
          fn(alert.title, {
            description: alert.subtitle,
            action: {
              label: "Open",
              onClick: () => router.push(alert.href),
            },
          });
        }
        setLiveOverride({ base: initialData, fresh });
      }
    } catch {
      // Ignore transient refresh failure.
    }
  }, [initialData, router]);

  useFactoryStream(() => {
    void refreshSidebar();
  });

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const userName = data.user?.name || data.user?.githubLogin || "Local Operator";
  const initials = userName
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0] || "")
    .join("")
    .toUpperCase();
  const onlineRunners = data.runners.filter((r) => r.status === "online");
  const setupCompleted = (data.projects.length > 0 ? 1 : 0) + (onlineRunners.length > 0 ? 1 : 0);

  return (
    <SidebarProvider defaultOpen>
      <Sidebar collapsible="icon">
        <SidebarBrandHeader />

        <SidebarContent className="overflow-x-hidden">
          {/* Primary Nav */}
          <SidebarGroup className="px-2.5 py-1.5 group-data-[collapsible=icon]:px-2">
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={pathname === "/sessions"}
                    tooltip="New Session"
                    className="h-9 gap-2.5 rounded-lg px-2.5 text-[13.5px]"
                    render={<Link href="/sessions" />}
                  >
                    <PlusIcon className="size-4" />
                    <span>New Session</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>

                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={pathname.startsWith("/inbox")}
                    tooltip="Inbox"
                    className="h-9 gap-2.5 rounded-lg px-2.5 text-[13.5px]"
                    render={<Link href="/inbox" />}
                  >
                    <InboxIcon className="size-4" />
                    <span>Inbox</span>
                  </SidebarMenuButton>
                  {data.inboxCount > 0 && (
                    <SidebarMenuBadge className="top-2 right-2">
                      {data.inboxCount}
                    </SidebarMenuBadge>
                  )}
                </SidebarMenuItem>

                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={pathname.startsWith("/automations")}
                    tooltip="Automations"
                    className="h-9 gap-2.5 rounded-lg px-2.5 text-[13.5px]"
                    render={<Link href="/automations" />}
                  >
                    <RefreshCwIcon className="size-4" />
                    <span>Automations</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>

                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={pathname.startsWith("/analytics")}
                    tooltip="Analytics"
                    className="h-9 gap-2.5 rounded-lg px-2.5 text-[13.5px]"
                    render={<Link href="/analytics" />}
                  >
                    <BarChart3Icon className="size-4" />
                    <span>Analytics</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarSeparator className="mx-3 my-1 bg-sidebar-border/80" />

          {/* Projects + smooth nested sessions */}
          <SidebarGroup className="px-2.5 py-1 group-data-[collapsible=icon]:px-2">
            <SidebarGroupLabel className="px-2.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
              Projects
            </SidebarGroupLabel>
            <SidebarGroupAction
              title="Add Project"
              className="top-2.5 right-3"
              onClick={() => setNewProjectOpen(true)}
            >
              <PlusIcon />
              <span className="sr-only">Add Project</span>
            </SidebarGroupAction>
            <SidebarGroupContent>
              <SidebarMenu className="gap-1">
                {data.projects.length === 0 ? (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      tooltip="Add your first repo"
                      className="h-9 gap-2.5 rounded-lg px-2.5 text-[13px]"
                      onClick={() => setNewProjectOpen(true)}
                    >
                      <FolderIcon className="size-4" />
                      <span>Add your first repo</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ) : (
                  data.projects.map((project) => {
                    const isProjectOpen = expandedProjectIds[project.id] ?? true;
                    const isProjectActive = pathname === `/projects/${project.id}`;
                    const hasRuns = project.recentRuns.length > 0;

                    return (
                      <SidebarMenuItem key={project.id} className="min-w-0">
                        <div className="group/proj relative flex w-full min-w-0 items-center">
                          <SidebarMenuButton
                            isActive={isProjectActive}
                            tooltip={project.name}
                            className={cn(
                              "h-9 min-w-0 flex-1 gap-2.5 rounded-lg px-2.5 text-[13.5px] font-medium",
                              hasRuns && "pr-8 group-data-[collapsible=icon]:pr-2",
                            )}
                            render={<Link href={`/projects/${project.id}`} />}
                          >
                            <FolderIcon className="size-4 shrink-0 text-sidebar-foreground/80" />
                            <span className="min-w-0 flex-1 truncate">{project.name}</span>
                          </SidebarMenuButton>

                          {hasRuns && (
                            <button
                              type="button"
                              aria-expanded={isProjectOpen}
                              aria-label={
                                isProjectOpen
                                  ? `Collapse ${project.name}`
                                  : `Expand ${project.name}`
                              }
                              onClick={() =>
                                setExpandedProjectIds((prev) => ({
                                  ...prev,
                                  [project.id]: !isProjectOpen,
                                }))
                              }
                              className="absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground group-data-[collapsible=icon]:hidden"
                            >
                              <ChevronDownIcon
                                className={cn(
                                  "size-3.5 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
                                  isProjectOpen && "rotate-180",
                                )}
                              />
                            </button>
                          )}
                        </div>

                        {hasRuns && (
                          <SmoothCollapse
                            open={isProjectOpen}
                            className="group-data-[collapsible=icon]:hidden"
                          >
                            <ul className="mt-1 ml-[17px] flex min-w-0 flex-col gap-0.5 border-l border-sidebar-border/80 pl-3">
                              {project.recentRuns.map((run) => {
                                const skillLabel = getSidebarSkillLabel(run.mode);
                                const subagents = run.agents ?? [];
                                const hasSubagents = subagents.length > 0;
                                const isCurrentRun = pathname === `/sessions/${run.id}`;
                                const isUnreadFinished = Boolean(unreadFinishedRuns[run.id]);
                                const indicatorKind = getSidebarIndicatorKind(
                                  run.status,
                                  isUnreadFinished,
                                );
                                const isExpanded =
                                  expandedRunIds[run.id] ?? (isCurrentRun && run.status === "running");

                                return (
                                  <li key={run.id} className="min-w-0">
                                    <div className="flex w-full min-w-0 items-center gap-0.5">
                                      <Link
                                        href={`/sessions/${run.id}`}
                                        onClick={() => markRunSeen(run.id)}
                                        aria-current={isCurrentRun ? "page" : undefined}
                                        title={`${run.title} · ${run.status.replace("_", " ")}`}
                                        className={cn(
                                          "flex h-8 min-w-0 flex-1 items-center justify-between gap-2 rounded-lg px-2.5 text-[13px] transition-colors",
                                          isCurrentRun
                                            ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground ring-1 ring-sidebar-border/90"
                                            : "text-sidebar-foreground/85 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                                        )}
                                      >
                                        <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                                          {hasSubagents && (
                                            <span
                                              role="button"
                                              tabIndex={0}
                                              aria-expanded={isExpanded}
                                              aria-label={
                                                isExpanded ? "Hide subagents" : "Show subagents"
                                              }
                                              title={
                                                isExpanded ? "Hide subagents" : "Show subagents"
                                              }
                                              onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                setExpandedRunIds((prev) => ({
                                                  ...prev,
                                                  [run.id]: !isExpanded,
                                                }));
                                              }}
                                              onKeyDown={(e) => {
                                                if (e.key === "Enter" || e.key === " ") {
                                                  e.preventDefault();
                                                  e.stopPropagation();
                                                  setExpandedRunIds((prev) => ({
                                                    ...prev,
                                                    [run.id]: !isExpanded,
                                                  }));
                                                }
                                              }}
                                              className="-ml-1 flex size-4 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground/75 transition-colors hover:bg-sidebar-border/60 hover:text-foreground"
                                            >
                                              <ChevronRightIcon
                                                className={cn(
                                                  "size-3 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
                                                  isExpanded && "rotate-90",
                                                )}
                                              />
                                            </span>
                                          )}
                                          {skillLabel && (
                                            <span className="shrink-0 rounded-[3px] bg-muted px-1 py-px font-mono text-[9.5px] leading-tight text-muted-foreground">
                                              {skillLabel}
                                            </span>
                                          )}
                                          <span className="min-w-0 flex-1 truncate">
                                            {run.title}
                                          </span>
                                        </span>

                                        <div className="flex shrink-0 items-center justify-end">
                                          {indicatorKind ? (
                                            <SidebarStatusIndicator
                                              status={run.status}
                                              unread={isUnreadFinished}
                                            />
                                          ) : (
                                            <span
                                              suppressHydrationWarning
                                              className="pl-1 font-mono text-[10px] text-muted-foreground/70 tabular-nums"
                                            >
                                              {formatRelativeTime(run.updatedAt)}
                                            </span>
                                          )}
                                        </div>
                                      </Link>
                                    </div>

                                    {hasSubagents && (
                                      <SmoothCollapse open={isExpanded}>
                                        <div className="mt-0.5 ml-3 flex max-h-56 min-w-0 flex-col gap-0.5 overflow-x-hidden overflow-y-auto border-l border-sidebar-border/80 pl-2.5 py-0.5">
                                          {subagents.map((ag) => (
                                            <Link
                                              key={ag.id}
                                              href={`/sessions/${run.id}?agent=${encodeURIComponent(ag.id)}`}
                                              title={`${ag.name} · ${ag.status.replace("_", " ")}`}
                                              className="flex h-7 w-full min-w-0 items-center justify-between gap-2 rounded-md px-2 text-[12px] text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground"
                                            >
                                              <span className="min-w-0 flex-1 truncate">
                                                {compactAgentLabel(ag)}
                                              </span>
                                              <SidebarStatusIndicator status={ag.status} />
                                            </Link>
                                          ))}
                                        </div>
                                      </SmoothCollapse>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          </SmoothCollapse>
                        )}
                      </SidebarMenuItem>
                    );
                  })
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarSeparator className="mx-3 my-1 bg-sidebar-border/80" />

          {/* Settings collapsible tree right inside the shared sidebar */}
          <React.Suspense fallback={null}>
            <SettingsSidebarTree
              pathname={pathname}
              onlineRunnerCount={onlineRunners.length}
              totalRunnerCount={data.runners.length}
            />
          </React.Suspense>
        </SidebarContent>

        <SidebarFooter className="gap-2 border-t border-sidebar-border/70 p-2.5 group-data-[collapsible=icon]:p-2">
          {/* Finish setup card */}
          {setupCompleted < 2 && (
            <div className="flex flex-col gap-2.5 rounded-lg border bg-card p-3 group-data-[collapsible=icon]:hidden">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Finish setup</span>
                <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                  <span>{setupCompleted}/2</span>
                  <SetupRing completed={setupCompleted} total={2} />
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                nativeButton={false}
                render={<Link href="/settings?tab=runners" />}
              >
                <PlugIcon data-icon="inline-start" />
                Connect your tools
              </Button>
            </div>
          )}

          {/* Clean footer row — Avatar + Name */}
          <Link
            href="/settings?tab=general"
            className={cn(
              "flex min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-sidebar-foreground transition-colors hover:bg-sidebar-accent/70 hover:text-foreground group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0",
              pathname.startsWith("/settings") && "text-sidebar-accent-foreground",
            )}
          >
            <Avatar className="size-6 shrink-0">
              {data.user?.avatarUrl && (
                <AvatarImage src={data.user.avatarUrl} alt={userName} />
              )}
              <AvatarFallback className="text-[10px] font-medium">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-1 flex-col group-data-[collapsible=icon]:hidden">
              <span className="truncate text-xs font-medium leading-tight">{userName}</span>
              {data.user?.githubLogin && (
                <span className="truncate font-mono text-[10px] text-muted-foreground">
                  @{data.user.githubLogin}
                </span>
              )}
            </div>
          </Link>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="min-w-0 bg-background">
        <div className="flex h-11 shrink-0 items-center gap-2.5 border-b bg-background px-3 md:hidden">
          <SidebarTrigger />
          <Link href="/sessions" className="flex items-center gap-2 text-foreground">
            <FactoryMark className="size-4" />
            <FactoryWordmark className="text-[15px]" />
          </Link>
        </div>
        {children}
      </SidebarInset>

      {/* Global Command Palette (⌘K) */}
      <CommandDialog open={searchOpen} onOpenChange={setSearchOpen}>
        <CommandInput placeholder="Jump to session, project, or action..." />
        <CommandList>
          <CommandEmpty>No matching results.</CommandEmpty>
          <CommandGroup heading="Quick Actions">
            <CommandItem
              onSelect={() => {
                setSearchOpen(false);
                router.push("/sessions");
              }}
            >
              <PlusIcon />
              <span>New Session</span>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setSearchOpen(false);
                setNewProjectOpen(true);
              }}
            >
              <FolderIcon />
              <span>Add Local / GitHub Project</span>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setSearchOpen(false);
                router.push("/settings?tab=runners");
              }}
            >
              <TerminalIcon />
              <span>Connect Local sf daemon / API Keys</span>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setTheme(resolvedTheme === "dark" ? "light" : "dark");
                setSearchOpen(false);
              }}
            >
              <SunMoonIcon />
              <span>Toggle Light / Dark Theme</span>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setSearchOpen(false);
                router.push("/settings?tab=appearance");
              }}
            >
              <SettingsIcon />
              <span>Open Settings &amp; Appearance</span>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setSearchOpen(false);
                router.push("/automations");
              }}
            >
              <RefreshCwIcon />
              <span>Automations</span>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setSearchOpen(false);
                router.push("/analytics");
              }}
            >
              <BarChart3Icon />
              <span>Usage &amp; Analytics</span>
            </CommandItem>
          </CommandGroup>

          {data.projects.length > 0 && (
            <CommandGroup heading="Projects">
              {data.projects.map((p) => (
                <CommandItem
                  key={p.id}
                  onSelect={() => {
                    setSearchOpen(false);
                    router.push(`/projects/${p.id}`);
                  }}
                >
                  <FolderIcon />
                  <span>{p.name}</span>
                  <span className="ml-auto font-mono text-xs text-muted-foreground">
                    {p.engine}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {data.projects.some((p) => p.recentRuns.length > 0) && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Recent Sessions">
                {data.projects.flatMap((p) =>
                  p.recentRuns.map((run) => (
                    <CommandItem
                      key={run.id}
                      onSelect={() => {
                        setSearchOpen(false);
                        markRunSeen(run.id);
                        router.push(`/sessions/${run.id}`);
                      }}
                    >
                      <span className="truncate">{run.title}</span>
                      <span className="ml-auto flex shrink-0 items-center gap-2 font-mono text-xs text-muted-foreground">
                        <span>
                          {p.name} · {run.currentPhase}
                        </span>
                        <SidebarStatusIndicator
                          status={run.status}
                          unread={Boolean(unreadFinishedRuns[run.id])}
                        />
                      </span>
                    </CommandItem>
                  )),
                )}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </CommandDialog>

      <NewProjectDialog
        open={newProjectOpen}
        onOpenChange={setNewProjectOpen}
        onCreated={() => {
          void refreshSidebar();
          router.refresh();
        }}
      />
    </SidebarProvider>
  );
}
