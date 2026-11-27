"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BarChart3Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FolderIcon,
  InboxIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  LaptopIcon,
  PaletteIcon,
  PlugIcon,
  PlusIcon,
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
  ba: "ba",
  epic: "epic",
};

function getSidebarSkillLabel(mode: string | null | undefined): string | null {
  const m = (mode || "").toLowerCase().trim();
  if (!m) return null;
  return SKILL_TAG_LABELS[m] ?? m;
}

function compactAgentLabel(agent: {
  name: string;
  role: string;
  specId: string | null;
}): string {
  // Epic-run agents are named like "#12 implementer · build"; keep the ticket and the role.
  const ticket = /#(\d+)/.exec(agent.name)?.[1];
  if (ticket && agent.role) return `#${ticket} ${agent.role}`;
  if (agent.role === "qc") return "QC";
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

type SidebarView =
  | { kind: "root" }
  | { kind: "project"; projectId: string }
  | { kind: "settings" };

type SidebarProject = SidebarData["projects"][number];
type SidebarRun = SidebarProject["recentRuns"][number];

/** The sidebar view that matches the current page, Vercel-style drill-in. */
function deriveSidebarView(
  pathname: string,
  projects: SidebarProject[],
  projectParam: string | null,
): SidebarView {
  if (pathname.startsWith("/settings")) return { kind: "settings" };
  // "New Session" opened from inside a project keeps the sidebar in that project.
  if (pathname === "/sessions" && projectParam && projects.some((p) => p.id === projectParam)) {
    return { kind: "project", projectId: projectParam };
  }
  const projectMatch = pathname.match(/^\/projects\/([^/]+)/);
  if (projectMatch && projects.some((p) => p.id === projectMatch[1])) {
    return { kind: "project", projectId: projectMatch[1] };
  }
  const sessionMatch = pathname.match(/^\/sessions\/([^/]+)/);
  if (sessionMatch) {
    const owner = projects.find((p) => p.recentRuns.some((r) => r.id === sessionMatch[1]));
    if (owner) return { kind: "project", projectId: owner.id };
  }
  return { kind: "root" };
}

/** Back arrow + centered title row at the top of a drilled-in sidebar view. */
function SidebarViewHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <SidebarGroup className="px-2.5 pt-1.5 pb-1 group-data-[collapsible=icon]:px-2">
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Back"
              onClick={onBack}
              aria-label="Back"
              className="relative h-9 gap-2.5 rounded-lg px-2.5 text-sm font-medium"
            >
              <ChevronLeftIcon className="size-4 shrink-0 text-sidebar-foreground/80" />
              <span className="pointer-events-none absolute inset-x-9 truncate text-center group-data-[collapsible=icon]:hidden">
                {title}
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/** Settings tabs shown when the sidebar is drilled into Settings. */
function SettingsSidebarNav({
  pathname,
  onlineRunnerCount,
  totalRunnerCount,
}: {
  pathname: string;
  onlineRunnerCount: number;
  totalRunnerCount: number;
}) {
  const searchParams = useSearchParams();
  const isOnSettings = pathname.startsWith("/settings");
  const activeSettingsTab = isOnSettings ? searchParams.get("tab") || "general" : null;

  return (
    <SidebarMenu className="gap-0.5">
      {SETTINGS_SUB_ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive = activeSettingsTab === item.id;
        return (
          <SidebarMenuItem key={item.id}>
            <SidebarMenuButton
              isActive={isActive}
              tooltip={item.label}
              className="h-9 gap-2.5 rounded-lg px-2.5 text-sm"
              render={<Link href={`/settings?tab=${item.id}`} />}
            >
              <Icon className="size-4" />
              <span>{item.label}</span>
            </SidebarMenuButton>
            {item.id === "runners" && totalRunnerCount > 0 && (
              <SidebarMenuBadge className="top-2 right-2 font-mono text-2xs tabular-nums">
                {onlineRunnerCount}/{totalRunnerCount}
              </SidebarMenuBadge>
            )}
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

/** One project's sessions, with expandable subagents. */
function ProjectRunList({
  runs,
  pathname,
  unreadFinishedRuns,
  markRunSeen,
  expandedRunIds,
  onToggleRun,
}: {
  runs: SidebarRun[];
  pathname: string;
  unreadFinishedRuns: Record<string, string>;
  markRunSeen: (runId: string) => void;
  expandedRunIds: Record<string, boolean>;
  onToggleRun: (runId: string, open: boolean) => void;
}) {
  return (
    <ul className="flex min-w-0 flex-col gap-0.5">
      {runs.map((run) => {
        const skillLabel = getSidebarSkillLabel(run.mode);
        const subagents = run.agents ?? [];
        const hasSubagents = subagents.length > 0;
        const isCurrentRun = pathname === `/sessions/${run.id}`;
        const isUnreadFinished = Boolean(unreadFinishedRuns[run.id]);
        const indicatorKind = getSidebarIndicatorKind(run.status, isUnreadFinished);
        const isExpanded = expandedRunIds[run.id] ?? (isCurrentRun && run.status === "running");

        return (
          <li key={run.id} className="min-w-0">
            <Link
              href={`/sessions/${run.id}`}
              onClick={() => markRunSeen(run.id)}
              aria-current={isCurrentRun ? "page" : undefined}
              title={`${run.title} · ${run.status.replace("_", " ")}`}
              className={cn(
                "flex h-8 min-w-0 items-center justify-between gap-2 rounded-lg px-2.5 text-sm transition-colors",
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
                    aria-label={isExpanded ? "Hide subagents" : "Show subagents"}
                    title={isExpanded ? "Hide subagents" : "Show subagents"}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onToggleRun(run.id, !isExpanded);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        onToggleRun(run.id, !isExpanded);
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
                  <span className="shrink-0 rounded-[3px] bg-muted px-1 py-px font-mono text-2xs leading-tight text-muted-foreground">
                    {skillLabel}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate">{run.title}</span>
              </span>

              <div className="flex shrink-0 items-center justify-end">
                {indicatorKind ? (
                  <SidebarStatusIndicator status={run.status} unread={isUnreadFinished} />
                ) : (
                  <span
                    suppressHydrationWarning
                    className="pl-1 font-mono text-2xs text-muted-foreground/70 tabular-nums"
                  >
                    {formatRelativeTime(run.updatedAt)}
                  </span>
                )}
              </div>
            </Link>

            {hasSubagents && (
              <SmoothCollapse open={isExpanded}>
                <div className="mt-0.5 ml-3 flex max-h-56 min-w-0 flex-col gap-0.5 overflow-x-hidden overflow-y-auto border-l border-sidebar-border/80 py-0.5 pl-2.5">
                  {subagents.map((ag) => (
                    <Link
                      key={ag.id}
                      href={`/sessions/${run.id}?agent=${encodeURIComponent(ag.id)}`}
                      title={`${ag.name} · ${ag.status.replace("_", " ")}`}
                      className="flex h-7 w-full min-w-0 items-center justify-between gap-2 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground"
                    >
                      <span className="min-w-0 flex-1 truncate">{compactAgentLabel(ag)}</span>
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
  const searchParams = useSearchParams();
  const projectParam = searchParams.get("project");
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [liveOverride, setLiveOverride] = React.useState<{
    base: SidebarData;
    fresh: SidebarData;
  } | null>(null);
  const data = liveOverride?.base === initialData ? liveOverride.fresh : initialData;
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [newProjectOpen, setNewProjectOpen] = React.useState(false);
  // Last page that showed the root sidebar view; "Back" navigates there.
  const lastRootPathRef = React.useRef("/sessions");
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

  React.useEffect(() => {
    if (deriveSidebarView(pathname, data.projects, projectParam).kind === "root") {
      lastRootPathRef.current = pathname;
    }
  }, [data.projects, pathname, projectParam]);

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

  // The sidebar view always follows the URL (Vercel-style), so "Back" is a real navigation.
  const view = deriveSidebarView(pathname, data.projects, projectParam);
  const currentProject =
    view.kind === "project" ? data.projects.find((p) => p.id === view.projectId) : undefined;
  const goToRootView = () => router.push(lastRootPathRef.current);

  return (
    <SidebarProvider defaultOpen>
      <Sidebar collapsible="icon">
        <SidebarBrandHeader />

        <SidebarContent className="overflow-x-hidden">
          <div
            key={view.kind === "project" ? `project:${view.projectId}` : view.kind}
            className={cn(
              "flex min-w-0 flex-col duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] animate-in fade-in motion-reduce:animate-none",
              view.kind === "root" ? "slide-in-from-left-3" : "slide-in-from-right-3",
            )}
          >
            {view.kind === "root" && (
              <>
                {/* Primary Nav */}
                <SidebarGroup className="px-2.5 py-1.5 group-data-[collapsible=icon]:px-2">
                  <SidebarGroupContent>
                    <SidebarMenu className="gap-0.5">
                      <SidebarMenuItem>
                        <SidebarMenuButton
                          isActive={pathname === "/sessions"}
                          tooltip="New Session"
                          className="h-9 gap-2.5 rounded-lg px-2.5 text-sm"
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
                          className="h-9 gap-2.5 rounded-lg px-2.5 text-sm"
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
                          isActive={pathname.startsWith("/analytics")}
                          tooltip="Analytics"
                          className="h-9 gap-2.5 rounded-lg px-2.5 text-sm"
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

                {/* Projects — click drills into the project view */}
                <SidebarGroup className="px-2.5 py-1 group-data-[collapsible=icon]:px-2">
                  <SidebarGroupLabel className="px-2.5 font-mono text-2xs uppercase tracking-wider text-muted-foreground/80">
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
                    <SidebarMenu className="gap-0.5">
                      {data.projects.length === 0 ? (
                        <SidebarMenuItem>
                          <SidebarMenuButton
                            tooltip="Add your first repo"
                            className="h-9 gap-2.5 rounded-lg px-2.5 text-sm"
                            onClick={() => setNewProjectOpen(true)}
                          >
                            <FolderIcon className="size-4" />
                            <span>Add your first repo</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ) : (
                        data.projects.map((project) => {
                          const activeRun = project.recentRuns.find((r) =>
                            isRunActiveStatus(r.status),
                          );
                          const unreadRun = project.recentRuns.find((r) =>
                            Boolean(unreadFinishedRuns[r.id]),
                          );
                          return (
                            <SidebarMenuItem key={project.id} className="group/proj min-w-0">
                              <SidebarMenuButton
                                tooltip={project.name}
                                className="h-9 min-w-0 gap-2.5 rounded-lg px-2.5 text-sm font-medium"
                                render={<Link href={`/projects/${project.id}`} />}
                              >
                                <FolderIcon className="size-4 shrink-0 text-sidebar-foreground/80" />
                                <span className="min-w-0 flex-1 truncate">{project.name}</span>
                                <span className="flex shrink-0 items-center gap-1.5 group-data-[collapsible=icon]:hidden">
                                  {activeRun ? (
                                    <SidebarStatusIndicator status={activeRun.status} />
                                  ) : unreadRun ? (
                                    <SidebarStatusIndicator status={unreadRun.status} unread />
                                  ) : null}
                                  <ChevronRightIcon className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover/proj:opacity-100" />
                                </span>
                              </SidebarMenuButton>
                            </SidebarMenuItem>
                          );
                        })
                      )}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              </>
            )}

            {view.kind === "project" && currentProject && (
              <>
                <SidebarViewHeader title={currentProject.name} onBack={goToRootView} />
                <SidebarGroup className="px-2.5 py-1 group-data-[collapsible=icon]:px-2">
                  <SidebarGroupContent>
                    <SidebarMenu className="gap-0.5">
                      <SidebarMenuItem>
                        <SidebarMenuButton
                          isActive={pathname === `/projects/${currentProject.id}`}
                          tooltip="Overview"
                          className="h-9 gap-2.5 rounded-lg px-2.5 text-sm"
                          render={<Link href={`/projects/${currentProject.id}`} />}
                        >
                          <LayoutDashboardIcon className="size-4" />
                          <span>Overview</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                      <SidebarMenuItem>
                        <SidebarMenuButton
                          isActive={pathname === "/sessions"}
                          tooltip="New Session"
                          className="h-9 gap-2.5 rounded-lg px-2.5 text-sm"
                          render={<Link href={`/sessions?project=${currentProject.id}`} />}
                        >
                          <PlusIcon className="size-4" />
                          <span>New Session</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>

                {currentProject.recentRuns.length > 0 && (
                  <SidebarGroup className="px-2.5 py-1 group-data-[collapsible=icon]:hidden">
                    <SidebarGroupLabel className="px-2.5 font-mono text-2xs uppercase tracking-wider text-muted-foreground/80">
                      Sessions
                    </SidebarGroupLabel>
                    <SidebarGroupContent>
                      <ProjectRunList
                        runs={currentProject.recentRuns}
                        pathname={pathname}
                        unreadFinishedRuns={unreadFinishedRuns}
                        markRunSeen={markRunSeen}
                        expandedRunIds={expandedRunIds}
                        onToggleRun={(runId, open) =>
                          setExpandedRunIds((prev) => ({ ...prev, [runId]: open }))
                        }
                      />
                    </SidebarGroupContent>
                  </SidebarGroup>
                )}
              </>
            )}

            {view.kind === "settings" && (
              <>
                <SidebarViewHeader title="Settings" onBack={goToRootView} />
                <SidebarGroup className="px-2.5 py-1 group-data-[collapsible=icon]:px-2">
                  <SidebarGroupContent>
                    <React.Suspense fallback={null}>
                      <SettingsSidebarNav
                        pathname={pathname}
                        onlineRunnerCount={onlineRunners.length}
                        totalRunnerCount={data.runners.length}
                      />
                    </React.Suspense>
                  </SidebarGroupContent>
                </SidebarGroup>
              </>
            )}
          </div>
        </SidebarContent>

        <SidebarFooter className="gap-2 border-t border-sidebar-border/70 p-2.5 group-data-[collapsible=icon]:p-2">
          {/* Finish setup card */}
          {setupCompleted < 2 && (
            <div className="flex flex-col gap-2.5 rounded-lg border bg-card p-3 group-data-[collapsible=icon]:hidden">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Finish setup</span>
                <span className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
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

          {/* Settings — pinned to the bottom, drills into the settings view */}
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={view.kind === "settings"}
                tooltip="Settings"
                className="h-9 gap-2.5 rounded-lg px-2.5 text-sm"
                render={<Link href="/settings" />}
              >
                <SettingsIcon className="size-4" />
                <span>Settings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>

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
              <AvatarFallback className="text-2xs font-medium">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-1 flex-col group-data-[collapsible=icon]:hidden">
              <span className="truncate text-xs font-medium leading-tight">{userName}</span>
              {data.user?.githubLogin && (
                <span className="truncate font-mono text-2xs text-muted-foreground">
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
