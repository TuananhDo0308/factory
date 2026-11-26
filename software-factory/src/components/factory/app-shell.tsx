"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronRightIcon,
  FolderIcon,
  InboxIcon,
  PlugIcon,
  PlusIcon,
  SettingsIcon,
  SunMoonIcon,
  TerminalIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  FactoryMark,
  FactoryWordmark,
  formatRelativeTime,
  StatusDot,
} from "@/components/factory/factory-primitives";
import { NewProjectDialog } from "@/components/factory/new-project-dialog";
import { useFactoryStream } from "@/components/factory/use-factory-stream";
import type { SidebarData } from "@/lib/workspace-data";

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
  const seenInboxKeysRef = React.useRef<Set<string>>(
    new Set((initialData.inboxAlerts ?? []).map((a) => a.key)),
  );

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
    <SidebarProvider open>
      <Sidebar collapsible="offcanvas">
        <SidebarHeader className="px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <Link
              href="/sessions"
              className="flex items-center gap-2 overflow-hidden text-foreground"
            >
              <FactoryMark className="size-5 text-foreground" />
              <FactoryWordmark className="text-[17px] text-foreground" />
            </Link>
          </div>
        </SidebarHeader>

        <SidebarContent className="overflow-x-hidden">
          {/* Primary Nav — mirrors app.factory.ai sidebar */}
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={pathname === "/sessions"}
                    tooltip="New Session"
                    render={<Link href="/sessions" />}
                  >
                    <PlusIcon />
                    <span>New Session</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>

                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={pathname.startsWith("/inbox")}
                    tooltip="Inbox"
                    render={<Link href="/inbox" />}
                  >
                    <InboxIcon />
                    <span>Inbox</span>
                  </SidebarMenuButton>
                  {data.inboxCount > 0 && (
                    <SidebarMenuBadge>{data.inboxCount}</SidebarMenuBadge>
                  )}
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarSeparator />

          {/* Projects + nested recent sessions */}
          <SidebarGroup>
            <SidebarGroupLabel>Projects</SidebarGroupLabel>
            <SidebarGroupAction
              title="Add Project"
              onClick={() => setNewProjectOpen(true)}
            >
              <PlusIcon />
              <span className="sr-only">Add Project</span>
            </SidebarGroupAction>
            <SidebarGroupContent>
              <SidebarMenu>
                {data.projects.length === 0 ? (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      size="sm"
                      onClick={() => setNewProjectOpen(true)}
                    >
                      <FolderIcon />
                      <span>Add your first repo</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ) : (
                  data.projects.map((project) => {
                    const isProjectOpen = expandedProjectIds[project.id] ?? true;
                    return (
                      <Collapsible
                        key={project.id}
                        open={isProjectOpen}
                        onOpenChange={(next) =>
                          setExpandedProjectIds((prev) => ({ ...prev, [project.id]: next }))
                        }
                      >
                        <SidebarMenuItem className="min-w-0">
                          <div className="flex w-full min-w-0 items-center gap-0.5">
                            <CollapsibleTrigger
                              render={
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  aria-label={isProjectOpen ? `Collapse ${project.name}` : `Expand ${project.name}`}
                                  className="size-5 shrink-0"
                                >
                                  <ChevronRightIcon
                                    className={`transition-transform duration-150 ${
                                      isProjectOpen ? "rotate-90" : ""
                                    }`}
                                  />
                                </Button>
                              }
                            />
                            <SidebarMenuButton
                              size="sm"
                              isActive={pathname === `/projects/${project.id}`}
                              tooltip={project.name}
                              className="min-w-0 flex-1"
                              render={<Link href={`/projects/${project.id}`} />}
                            >
                              <FolderIcon />
                              <span className="min-w-0 flex-1 truncate font-medium">
                                {project.name}
                              </span>
                              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                                {project.engine === "claude" ? "claude" : "agy"}
                              </span>
                            </SidebarMenuButton>
                          </div>

                          <CollapsibleContent className="min-w-0 overflow-hidden">
                            <SidebarMenuSub className="mx-0 ml-2.5 mr-0 pl-2 pr-0">
                              {project.recentRuns.map((run) => {
                                const skillLabel = getSidebarSkillLabel(run.mode);
                                const subagents = run.agents ?? [];
                                const hasSubagents = subagents.length > 0;
                                const isCurrentRun = pathname === `/sessions/${run.id}`;
                                const isExpanded =
                                  expandedRunIds[run.id] ?? (isCurrentRun && run.status === "running");

                                return (
                                  <SidebarMenuSubItem key={run.id} className="min-w-0">
                                    <div className="flex w-full min-w-0 items-center gap-0.5">
                                      {hasSubagents ? (
                                        <button
                                          type="button"
                                          aria-expanded={isExpanded}
                                          aria-label={isExpanded ? "Hide subagents" : "Show subagents"}
                                          title={isExpanded ? "Hide subagents" : "Show subagents"}
                                          onClick={() =>
                                            setExpandedRunIds((prev) => ({
                                              ...prev,
                                              [run.id]: !isExpanded,
                                            }))
                                          }
                                          className="flex size-4 shrink-0 items-center justify-center rounded-[3px] text-muted-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-foreground"
                                        >
                                          <ChevronRightIcon
                                            className={`size-3 transition-transform duration-150 ${
                                              isExpanded ? "rotate-90" : ""
                                            }`}
                                          />
                                        </button>
                                      ) : (
                                        <span className="size-4 shrink-0" aria-hidden="true" />
                                      )}
                                      <SidebarMenuSubButton
                                        isActive={isCurrentRun}
                                        render={<Link href={`/sessions/${run.id}`} />}
                                        className="min-w-0 flex-1 translate-x-0 justify-between gap-1.5 px-1.5"
                                      >
                                        <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                                          <StatusDot status={run.status} />
                                          {skillLabel && (
                                            <span className="shrink-0 rounded-[3px] bg-muted px-1 py-px font-mono text-[9.5px] leading-tight text-muted-foreground">
                                              {skillLabel}
                                            </span>
                                          )}
                                          <span className="min-w-0 flex-1 truncate">{run.title}</span>
                                        </span>
                                        <span
                                          suppressHydrationWarning
                                          className="shrink-0 pl-1 font-mono text-[10px] text-muted-foreground tabular-nums"
                                        >
                                          {formatRelativeTime(run.updatedAt)}
                                        </span>
                                      </SidebarMenuSubButton>
                                    </div>

                                    {hasSubagents && isExpanded && (
                                      <div className="mt-1 ml-2 flex max-h-56 min-w-0 flex-col gap-0.5 overflow-x-hidden overflow-y-auto border-l border-sidebar-border/80 pl-2">
                                        {subagents.map((ag) => (
                                          <Link
                                            key={ag.id}
                                            href={`/sessions/${run.id}?agent=${encodeURIComponent(ag.id)}`}
                                            title={ag.name}
                                            className="flex w-full min-w-0 items-center justify-between gap-1.5 rounded-[4px] px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
                                          >
                                            <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                                              <StatusDot status={ag.status} />
                                              <span className="min-w-0 flex-1 truncate">
                                                {compactAgentLabel(ag)}
                                              </span>
                                            </span>
                                            <span className="shrink-0 font-mono text-[9.5px] opacity-75">
                                              {ag.status === "working"
                                                ? "run"
                                                : ag.status === "passed"
                                                  ? "ok"
                                                  : ag.status === "failed"
                                                    ? "fail"
                                                    : ""}
                                            </span>
                                          </Link>
                                        ))}
                                      </div>
                                    )}
                                  </SidebarMenuSubItem>
                                );
                              })}
                            </SidebarMenuSub>
                          </CollapsibleContent>
                        </SidebarMenuItem>
                      </Collapsible>
                    );
                  })
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="gap-2 p-2.5">
          {/* Finish setup card — mirrors app.factory.ai bottom-left onboarding card */}
          {setupCompleted < 2 && (
            <div className="flex flex-col gap-2.5 rounded-[4px] border bg-card p-3 group-data-[collapsible=icon]:hidden">
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

          {/* Minimal footer row — Avatar + Name + single Settings gear */}
          <div className="flex items-center justify-between gap-2 px-1 py-0.5">
            <Link
              href="/settings"
              className="flex min-w-0 items-center gap-2 text-sidebar-foreground hover:text-foreground"
            >
              <Avatar className="size-6">
                {data.user?.avatarUrl && (
                  <AvatarImage src={data.user.avatarUrl} alt={userName} />
                )}
                <AvatarFallback className="text-[10px] font-medium">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <span className="truncate text-xs font-medium group-data-[collapsible=icon]:hidden">
                {userName}
              </span>
            </Link>

            <Button
              variant="ghost"
              size="icon-xs"
              title="Settings"
              className="group-data-[collapsible=icon]:hidden"
              nativeButton={false}
              render={<Link href="/settings" />}
            >
              <SettingsIcon />
            </Button>
          </div>
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
                        router.push(`/sessions/${run.id}`);
                      }}
                    >
                      <StatusDot status={run.status} />
                      <span className="truncate">{run.title}</span>
                      <span className="ml-auto font-mono text-xs text-muted-foreground">
                        {p.name} · {run.currentPhase}
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
