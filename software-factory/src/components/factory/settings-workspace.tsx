"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckIcon,
  CopyIcon,
  CpuIcon,
  GitBranchIcon,
  KeyRoundIcon,
  LaptopIcon,
  LogOutIcon,
  PaletteIcon,
  PlugIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  TerminalIcon,
  Trash2Icon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  formatRelativeTime,
  StatusDot,
} from "@/components/factory/factory-primitives";
import {
  SettingsTeamPanel,
  type SettingsTeamProject,
} from "@/components/factory/settings-team-panel";
import { cn } from "@/lib/utils";

type TokenItem = {
  id: string;
  label: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
};

type RunnerItem = {
  id: string;
  name: string;
  hostname: string;
  os: string;
  engines: string[];
  models: Array<{ id: string; label: string; engine: string }>;
  allowedRoots: string[];
  workspaceDir: string | null;
  discoveredCount: number;
  cliVersion: string | null;
  visibility: "personal" | "team";
  isOwn: boolean;
  ownerLogin: string;
  status: string;
  maxConcurrency: number;
  activeRuns: number;
  lastHeartbeatAt: string;
};

type SettingsWorkspaceProps = {
  initialTab: string;
  initialProjectId?: string;
  currentUserId: string;
  user: {
    name: string | null;
    githubLogin: string;
    email: string | null;
    avatarUrl: string | null;
  };
  isLocalMode: boolean;
  hasGithubOauth: boolean;
  projectCount: number;
  githubRepoCount: number;
  teamProjects: SettingsTeamProject[];
  runners: RunnerItem[];
  initialTokens: TokenItem[];
};

const ACCENT_PRESETS = [
  { id: "default", label: "Signal Green", hex: "#27B066" },
  { id: "forest", label: "Forest Green", hex: "#1A7F48" },
  { id: "amber", label: "Signal Amber", hex: "#E5A31B" },
  { id: "blue", label: "Build Blue", hex: "#5AAEF0" },
] as const;

const CONTRAST_PRESETS = [
  { label: "Low", value: 20 },
  { label: "Default", value: 50 },
  { label: "High", value: 85 },
] as const;

const NAV_ITEMS = [
  {
    id: "general",
    label: "General",
    icon: SettingsIcon,
    title: "General",
    description: "Account profile, connected providers, and session defaults.",
    keywords: "account profile workspace github git engine autonomy preferences",
  },
  {
    id: "appearance",
    label: "Appearance",
    icon: PaletteIcon,
    title: "Appearance",
    description: "Theme mode, accent color, surface contrast, and typography.",
    keywords: "theme dark light system accent color contrast font geist typography",
  },
  {
    id: "team",
    label: "Team",
    icon: UsersIcon,
    title: "Team & Access",
    description: "Manage project collaborators, invite links, and shared runner access.",
    keywords: "members invite link collaborators role owner viewer project access",
  },
  {
    id: "runners",
    label: "Runners",
    icon: LaptopIcon,
    title: "Runners",
    description: "Local machines executing Factory pipelines via sf daemon.",
    keywords: "droid daemon machine local worktree share cli install setup doctor",
  },
  {
    id: "keys",
    label: "API Keys",
    icon: KeyRoundIcon,
    title: "API Keys & CLI",
    description: "Personal tokens for sf CLI, daemon sync, and headless automation.",
    keywords: "token key auth secret cli login revoke",
  },
  {
    id: "mcp",
    label: "MCP",
    icon: PlugIcon,
    title: "MCP Context Lake",
    description: "Expose workspace projects, issues, alerts, and lessons over stdio JSON-RPC.",
    keywords: "mcp context lake json rpc claude antigravity tools stdio",
  },
] as const;

const MCP_TOOLS = [
  {
    name: "sf_workspace_summary",
    desc: "Projects, active missions, online runners, and inbox counts.",
  },
  {
    name: "sf_list_issues",
    desc: "Kanban tickets with full goal, body, criteria, priority, tier, and status.",
  },
  {
    name: "sf_list_runs",
    desc: "Recent Factory runs/sessions with status, phase, engine, model, and cost.",
  },
  {
    name: "sf_get_inbox",
    desc: "Pending approvals, blocked runs, and human-attention items.",
  },
  {
    name: "sf_get_lessons",
    desc: "Recurring failure patterns and accepted engineering lessons.",
  },
] as const;

function readStoredString(key: string, fallback: string): string {
  try {
    const val = localStorage.getItem(key);
    return val !== null && val !== "" ? val : fallback;
  } catch {
    return fallback;
  }
}

function readStoredBool(key: string, fallback: boolean): boolean {
  try {
    const val = localStorage.getItem(key);
    if (val === "true") return true;
    if (val === "false") return false;
    return fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore private-browsing storage errors.
  }
}

function ThemePreviewCard({
  mode,
  label,
  active,
  onClick,
}: {
  mode: "system" | "light" | "dark";
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className="group flex flex-col gap-2 text-left outline-none focus-visible:[&>div]:ring-2 focus-visible:[&>div]:ring-ring"
    >
      <div
        className={cn(
          "relative aspect-[16/10] w-full overflow-hidden rounded-lg border transition-all",
          active
            ? "border-primary ring-1 ring-primary"
            : "border-border group-hover:border-muted-foreground/50",
        )}
      >
        {mode === "system" ? (
          <div className="grid h-full w-full grid-cols-2">
            <div className="flex h-full bg-[#ffffff]">
              <div className="flex w-[42%] flex-col gap-1.5 border-r border-[#e4e4e7] bg-[#f7f7f8] p-2">
                <div className="h-1.5 w-7 rounded-[1px] bg-[#d4d4d8]" />
                <div className="h-1.5 w-9 rounded-[1px] bg-[#d4d4d8]" />
                <div className="h-1.5 w-5 rounded-[1px] bg-[#e4e4e7]" />
              </div>
              <div className="flex flex-1 flex-col gap-1.5 p-2.5">
                <div className="h-1.5 w-10 rounded-[1px] bg-[#d4d4d8]" />
                <div className="h-1.5 w-full rounded-[1px] bg-[#e4e4e7]" />
                <div className="mt-1 h-1.5 w-8 rounded-[1px] bg-[#1a7f48]" />
              </div>
            </div>
            <div className="flex h-full flex-col gap-1.5 bg-[#121213] p-2.5">
              <div className="h-1.5 w-12 rounded-[1px] bg-[#3f3f46]" />
              <div className="h-1.5 w-full rounded-[1px] bg-[#27272a]" />
              <div className="mt-1 h-1.5 w-9 rounded-[1px] bg-[#27b066]" />
            </div>
          </div>
        ) : mode === "light" ? (
          <div className="flex h-full w-full bg-[#ffffff]">
            <div className="flex w-[28%] flex-col gap-1.5 border-r border-[#e4e4e7] bg-[#f7f7f8] p-2">
              <div className="h-1.5 w-8 rounded-[1px] bg-[#d4d4d8]" />
              <div className="h-1.5 w-10 rounded-[1px] bg-[#d4d4d8]" />
              <div className="h-1.5 w-6 rounded-[1px] bg-[#e4e4e7]" />
            </div>
            <div className="flex flex-1 flex-col gap-1.5 p-2.5">
              <div className="h-1.5 w-20 rounded-[1px] bg-[#d4d4d8]" />
              <div className="h-1.5 w-4/5 rounded-[1px] bg-[#e4e4e7]" />
              <div className="mt-1 h-1.5 w-12 rounded-[1px] bg-[#1a7f48]" />
            </div>
          </div>
        ) : (
          <div className="flex h-full w-full bg-[#121213]">
            <div className="flex w-[28%] flex-col gap-1.5 border-r border-[#242428] bg-[#0e0e10] p-2">
              <div className="h-1.5 w-8 rounded-[1px] bg-[#3f3f46]" />
              <div className="h-1.5 w-10 rounded-[1px] bg-[#3f3f46]" />
              <div className="h-1.5 w-6 rounded-[1px] bg-[#27272a]" />
            </div>
            <div className="flex flex-1 flex-col gap-1.5 p-2.5">
              <div className="h-1.5 w-20 rounded-[1px] bg-[#3f3f46]" />
              <div className="h-1.5 w-4/5 rounded-[1px] bg-[#27272a]" />
              <div className="mt-1 h-1.5 w-12 rounded-[1px] bg-[#27b066]" />
            </div>
          </div>
        )}
        {active && (
          <span className="absolute right-2 bottom-2 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xs">
            <CheckIcon className="size-2.5 stroke-[2.5]" />
          </span>
        )}
      </div>
      <div className="flex items-center justify-between px-0.5">
        <span
          className={cn(
            "text-xs transition-colors",
            active ? "font-medium text-foreground" : "text-muted-foreground group-hover:text-foreground",
          )}
        >
          {label}
        </span>
        {active && (
          <span className="font-mono text-[10px] text-primary">Active</span>
        )}
      </div>
    </button>
  );
}

function CommandRow({
  label,
  command,
  copied,
  onCopy,
}: {
  label?: string;
  command: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      )}
      <div className="flex items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 font-mono text-xs">
        <code className="min-w-0 flex-1 truncate text-foreground">{command}</code>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={label ? `Copy ${label} command` : "Copy command"}
          onClick={onCopy}
        >
          {copied ? <CheckIcon className="text-success" /> : <CopyIcon />}
        </Button>
      </div>
    </div>
  );
}

export function SettingsWorkspace({
  initialTab,
  initialProjectId,
  currentUserId,
  user,
  isLocalMode,
  hasGithubOauth,
  projectCount,
  githubRepoCount,
  teamProjects,
  runners,
  initialTokens,
}: SettingsWorkspaceProps) {
  const router = useRouter();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const mounted = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const validTab = NAV_ITEMS.some((t) => t.id === initialTab) ? initialTab : "general";
  const [tabOverride, setTabOverride] = React.useState<{ base: string; value: string } | null>(
    null,
  );
  const activeTab = tabOverride?.base === validTab ? tabOverride.value : validTab;
  const [search, setSearch] = React.useState("");

  function selectTab(nextTab: string) {
    setTabOverride({ base: validTab, value: nextTab });
    router.replace(`/settings?tab=${encodeURIComponent(nextTab)}`, { scroll: false });
  }

  // General preferences persisted in localStorage
  const [engineOverride, setEngineOverride] = React.useState<string | null>(null);
  const [autonomyOverride, setAutonomyOverride] = React.useState<string | null>(null);
  const [staticStatusOverride, setStaticStatusOverride] = React.useState<boolean | null>(null);
  const [autoArtifactsOverride, setAutoArtifactsOverride] = React.useState<boolean | null>(null);
  const [openPrOverride, setOpenPrOverride] = React.useState<boolean | null>(null);

  const storedEngine = React.useSyncExternalStore(
    () => () => {},
    () => readStoredString("sf.pref.engine", "antigravity"),
    () => "antigravity",
  );
  const storedAutonomy = React.useSyncExternalStore(
    () => () => {},
    () => readStoredString("sf.pref.autonomy", "high"),
    () => "high",
  );
  const storedStaticStatus = React.useSyncExternalStore(
    () => () => {},
    () => readStoredBool("sf.pref.disableDynamicStatus", false),
    () => false,
  );
  const storedAutoArtifacts = React.useSyncExternalStore(
    () => () => {},
    () => readStoredBool("sf.pref.autoOpenArtifacts", false),
    () => false,
  );
  const storedOpenPr = React.useSyncExternalStore(
    () => () => {},
    () => readStoredBool("sf.pref.openPrInReview", true),
    () => true,
  );

  const defaultEngine = engineOverride ?? storedEngine;
  const defaultAutonomy = autonomyOverride ?? storedAutonomy;
  const disableDynamicStatus = staticStatusOverride ?? storedStaticStatus;
  const autoOpenArtifacts = autoArtifactsOverride ?? storedAutoArtifacts;
  const openPrInReview = openPrOverride ?? storedOpenPr;

  function updateEngine(val: string) {
    setEngineOverride(val);
    writeStored("sf.pref.engine", val);
    toast.success(`Default engine set to ${val === "claude" ? "Claude Code" : "Antigravity"}`);
  }

  function updateAutonomy(val: string) {
    setAutonomyOverride(val);
    writeStored("sf.pref.autonomy", val);
    toast.success(`Default autonomy set to ${val}`);
  }

  function updateBoolPref(
    key: string,
    val: boolean,
    setter: React.Dispatch<React.SetStateAction<boolean | null>>,
  ) {
    setter(val);
    writeStored(key, String(val));
  }

  // Appearance state
  const [accentOverride, setAccentOverride] = React.useState<string | null>(null);
  const [contrastOverride, setContrastOverride] = React.useState<number | null>(null);
  const storedAccent = React.useSyncExternalStore(
    () => () => {},
    () => {
      const a = readStoredString("sf.appearance.accent", "#27B066");
      return /^#[0-9a-fA-F]{6}$/.test(a) && a.toUpperCase() !== "#FF5A00"
        ? a.toUpperCase()
        : "#27B066";
    },
    () => "#27B066",
  );
  const storedContrast = React.useSyncExternalStore(
    () => () => {},
    () => {
      const raw = readStoredString("sf.appearance.contrast", "50");
      const c = Number(raw);
      return Number.isFinite(c) && c >= 0 && c <= 100 ? c : 50;
    },
    () => 50,
  );
  const accentHex = accentOverride ?? storedAccent;
  const contrast = contrastOverride ?? storedContrast;

  // Runners & API Tokens state
  const [runnerList, setRunnerList] = React.useState<RunnerItem[]>(runners);
  const [togglingRunnerId, setTogglingRunnerId] = React.useState<string | null>(null);
  const [tokens, setTokens] = React.useState<TokenItem[]>(initialTokens);
  const [tokenLabel, setTokenLabel] = React.useState("Local CLI / Daemon");
  const [newToken, setNewToken] = React.useState<string | null>(null);
  const [creatingToken, setCreatingToken] = React.useState(false);
  const [revokingId, setRevokingId] = React.useState<string | null>(null);
  const [copiedKey, setCopiedKey] = React.useState<string | null>(null);

  async function toggleRunnerShare(runner: RunnerItem, shareWithTeam: boolean) {
    setTogglingRunnerId(runner.id);
    const nextVisibility = shareWithTeam ? "team" : "personal";
    try {
      const res = await fetch(`/api/runners/${runner.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ visibility: nextVisibility }),
      });
      if (!res.ok) {
        toast.error("Could not update runner sharing");
        return;
      }
      setRunnerList((prev) =>
        prev.map((r) => (r.id === runner.id ? { ...r, visibility: nextVisibility } : r)),
      );
      toast.success(
        shareWithTeam
          ? `"${runner.name}" is now shared with your project teammates`
          : `"${runner.name}" set to Personal only`,
      );
      router.refresh();
    } finally {
      setTogglingRunnerId(null);
    }
  }

  function applyAccent(hex: string) {
    const clean = hex.toUpperCase();
    setAccentOverride(clean);
    const root = document.documentElement;
    root.style.setProperty("--primary", clean);
    root.style.setProperty("--ring", clean);
    root.style.setProperty("--chart-1", clean);
    root.style.setProperty("--sidebar-primary", clean);
    root.style.setProperty("--sidebar-ring", clean);
    writeStored("sf.appearance.accent", clean);
  }

  function applyContrast(val: number) {
    setContrastOverride(val);
    document.documentElement.dataset.contrast =
      val >= 70 ? "high" : val <= 30 ? "low" : "normal";
    writeStored("sf.appearance.contrast", String(val));
  }

  function resetAppearance() {
    setAccentOverride(null);
    try {
      localStorage.removeItem("sf.appearance.accent");
      const root = document.documentElement;
      root.style.removeProperty("--primary");
      root.style.removeProperty("--ring");
      root.style.removeProperty("--chart-1");
      root.style.removeProperty("--sidebar-primary");
      root.style.removeProperty("--sidebar-ring");
    } catch {
      // Ignore storage errors.
    }
    applyContrast(50);
    toast.success("Theme reset to defaults");
  }

  function copyText(key: string, text: string) {
    void navigator.clipboard.writeText(text);
    setCopiedKey(key);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopiedKey(null), 1600);
  }

  async function createToken(e: React.FormEvent) {
    e.preventDefault();
    if (!tokenLabel.trim()) return;
    setCreatingToken(true);
    try {
      const res = await fetch("/api/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: tokenLabel.trim() }),
      });
      const data = (await res.json().catch(() => null)) as {
        token?: string;
        record?: TokenItem;
        error?: string;
      } | null;
      if (!res.ok || !data?.token) {
        toast.error(data?.error || "Could not create API token");
        return;
      }
      setNewToken(data.token);
      if (data.record) setTokens((prev) => [data.record!, ...prev]);
      toast.success("API key generated");
    } finally {
      setCreatingToken(false);
    }
  }

  async function revokeToken(id: string) {
    setRevokingId(id);
    try {
      const res = await fetch(`/api/tokens/${id}`, { method: "DELETE" });
      if (res.ok) {
        setTokens((prev) => prev.filter((t) => t.id !== id));
        toast.success("API key revoked");
      } else {
        toast.error("Could not revoke API key");
      }
    } finally {
      setRevokingId(null);
    }
  }

  async function handleLogout() {
    await fetch("/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const displayName = user.name || user.githubLogin || "Local Operator";
  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0] || "")
    .join("")
    .toUpperCase();

  const origin =
    mounted && typeof window !== "undefined" ? window.location.origin : "http://localhost:8787";
  const tokenPlaceholder = newToken || "<SF_TOKEN>";
  const installCmd = `curl -fsSL ${origin}/install.sh | bash`;
  const setupCmd = `sf setup --url ${origin}`;
  const doctorCmd = "sf doctor";
  const loginCmd = `sf login --url ${origin} --token ${tokenPlaceholder}`;
  const daemonCmd = "sf daemon --projects-dir ~/factory-projects";
  const mcpSnippet = JSON.stringify(
    {
      mcpServers: {
        "software-factory": {
          command: "~/.sf/bin/sf",
          args: ["mcp"],
        },
      },
    },
    null,
    2,
  );

  const isDark = !mounted || resolvedTheme === "dark";
  const onlineRunnerCount = runnerList.filter((r) => r.status === "online").length;

  const q = search.trim().toLowerCase();
  const filteredNav = NAV_ITEMS.filter(
    (item) =>
      !q ||
      item.label.toLowerCase().includes(q) ||
      item.title.toLowerCase().includes(q) ||
      item.keywords.includes(q),
  );
  const effectiveTab =
    q && filteredNav.length > 0 && !filteredNav.some((item) => item.id === activeTab)
      ? filteredNav[0].id
      : activeTab;
  const currentMeta = NAV_ITEMS.find((n) => n.id === effectiveTab) ?? NAV_ITEMS[0];

  const surfaceSwatches = isDark
    ? [
        { label: "Background", hex: "#121213" },
        { label: "Card", hex: "#18181B" },
        { label: "Muted", hex: "#232327" },
        { label: "Foreground", hex: "#F4F4F5" },
      ]
    : [
        { label: "Background", hex: "#FFFFFF" },
        { label: "Sidebar", hex: "#F7F7F8" },
        { label: "Muted", hex: "#F4F4F5" },
        { label: "Foreground", hex: "#111113" },
      ];

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6 p-5 sm:px-8 sm:py-7 lg:px-12">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 pb-10">
        {/* Consistent Page Header — Settings sub-nav lives in the shared left sidebar */}
        <div className="flex flex-wrap items-end justify-between gap-4 border-b pb-5">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              {currentMeta.title}
            </h1>
            <p className="text-xs text-muted-foreground">{currentMeta.description}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-44 sm:w-52">
              <label htmlFor="settings-nav-search" className="sr-only">
                Search settings
              </label>
              <SearchIcon
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id="settings-nav-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Find a setting..."
                className="h-8 pr-7 pl-8 text-xs"
              />
              {search && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setSearch("")}
                  className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <XIcon className="size-3.5" />
                </button>
              )}
            </div>

            {effectiveTab === "appearance" && (
              <>
                <Button variant="outline" size="sm" onClick={resetAppearance}>
                  Reset
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    copyText(
                      "theme",
                      JSON.stringify(
                        {
                          mode: isDark ? "dark" : "light",
                          accent: accentHex,
                          contrast,
                          fonts: { brand: "Space Grotesk", ui: "Geist", mono: "Geist Mono" },
                        },
                        null,
                        2,
                      ),
                    )
                  }
                >
                  {copiedKey === "theme" ? (
                    <CheckIcon data-icon="inline-start" className="text-success" />
                  ) : (
                    <CopyIcon data-icon="inline-start" />
                  )}
                  Copy JSON
                </Button>
              </>
            )}

            {effectiveTab === "runners" && (
              <Badge variant={onlineRunnerCount > 0 ? "secondary" : "outline"} className="gap-1.5">
                <StatusDot status={onlineRunnerCount > 0 ? "online" : "offline"} />
                {onlineRunnerCount} of {runnerList.length} online
              </Badge>
            )}
          </div>
        </div>

        {/* Mobile section switcher & instant search-match bar */}
        <div className={cn("no-scrollbar overflow-x-auto", !q && "md:hidden")}>
          {filteredNav.length === 0 ? (
            <p className="py-1 text-xs text-muted-foreground">No matching settings sections.</p>
          ) : (
            <Tabs value={effectiveTab} onValueChange={(v) => selectTab(String(v))}>
              <TabsList variant="line" className="w-max justify-start border-b border-border/70">
                {filteredNav.map((item) => {
                  const Icon = item.icon;
                  return (
                    <TabsTrigger key={item.id} value={item.id} className="shrink-0 gap-1.5 px-2.5">
                      <Icon className="size-3.5" aria-hidden="true" />
                      <span>{item.label}</span>
                      {item.id === "runners" && runnerList.length > 0 && (
                        <span className="ml-0.5 flex items-center gap-1 font-mono text-[10px] text-muted-foreground tabular-nums">
                          <StatusDot status={onlineRunnerCount > 0 ? "online" : "offline"} />
                          {onlineRunnerCount}/{runnerList.length}
                        </span>
                      )}
                      {item.id === "keys" && tokens.length > 0 && (
                        <span className="ml-0.5 font-mono text-[10px] text-muted-foreground tabular-nums">
                          {tokens.length}
                        </span>
                      )}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </Tabs>
          )}
        </div>

        {/* Settings Section Body */}
        <div className="flex flex-col gap-7">
          {/* SECTION 1: GENERAL */}
          {effectiveTab === "general" && (
            <>
              <section className="flex flex-col gap-2.5">
                <h2 className="font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Account &amp; Workspace
                </h2>
                <div className="divide-y rounded-lg border bg-card">
                  <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                    <div className="flex min-w-0 items-center gap-3.5">
                      <Avatar className="size-10 rounded-md">
                        {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt={displayName} />}
                        <AvatarFallback className="rounded-md text-xs font-medium">
                          {initials}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-foreground">
                            {displayName}
                          </span>
                          {isLocalMode && (
                            <Badge variant="secondary" className="text-[10px]">
                              Local Mode
                            </Badge>
                          )}
                        </div>
                        <span className="truncate font-mono text-xs text-muted-foreground">
                          {user.email || `@${user.githubLogin}`}
                        </span>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleLogout()}
                    >
                      <LogOutIcon data-icon="inline-start" />
                      Sign out
                    </Button>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex size-9 items-center justify-center rounded-md border bg-secondary font-mono text-xs font-medium text-foreground">
                        {initials}
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm font-medium text-foreground">
                          {displayName}&apos;s Factory
                        </span>
                        <span className="font-mono text-xs text-muted-foreground tabular-nums">
                          {projectCount} project{projectCount === 1 ? "" : "s"} · {runnerList.length}{" "}
                          runner{runnerList.length === 1 ? "" : "s"}
                        </span>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      nativeButton={false}
                      render={<Link href="/sessions" />}
                    >
                      Open Sessions
                    </Button>
                  </div>
                </div>
              </section>

              <section className="flex flex-col gap-2.5">
                <h2 className="font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Code Providers
                </h2>
                <div className="divide-y rounded-lg border bg-card">
                  <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted/60 text-foreground">
                        <GitBranchIcon className="size-4" aria-hidden="true" />
                      </span>
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">GitHub</span>
                          <StatusDot status={hasGithubOauth ? "online" : "offline"} />
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {hasGithubOauth
                            ? `Connected · ${githubRepoCount} synced repositories`
                            : "Sync repositories, issues, and pull requests via OAuth."}
                        </span>
                      </div>
                    </div>
                    <Button
                      variant={hasGithubOauth ? "outline" : "default"}
                      size="sm"
                      nativeButton={false}
                      render={<a href="/auth/github/login" />}
                    >
                      {hasGithubOauth ? "Manage" : "Connect"}
                    </Button>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted/60 text-foreground">
                        <LaptopIcon className="size-4" aria-hidden="true" />
                      </span>
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">
                            Local Git Worktrees
                          </span>
                          <StatusDot status={onlineRunnerCount > 0 ? "online" : "offline"} />
                        </div>
                        <span className="text-xs text-muted-foreground">
                          Run local repositories and stream live progress via{" "}
                          <code className="font-mono text-foreground">sf daemon</code>.
                        </span>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => selectTab("runners")}
                    >
                      Configure
                    </Button>
                  </div>
                </div>
              </section>

              <section className="flex flex-col gap-2.5">
                <h2 className="font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Session Defaults
                </h2>
                <div className="divide-y rounded-lg border bg-card">
                  <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-3.5">
                    <div className="flex flex-col gap-0.5">
                      <label htmlFor="pref-engine" className="text-xs font-medium text-foreground">
                        Default engine
                      </label>
                      <span className="text-xs text-muted-foreground">
                        Pre-selected engine when starting a new session.
                      </span>
                    </div>
                    <Select value={defaultEngine} onValueChange={(v) => v && updateEngine(v)}>
                      <SelectTrigger id="pref-engine" className="w-44">
                        <SelectValue>
                          {defaultEngine === "claude" ? "Claude Code" : "Antigravity"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="antigravity">Antigravity</SelectItem>
                          <SelectItem value="claude">Claude Code</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-3.5">
                    <div className="flex flex-col gap-0.5">
                      <label
                        htmlFor="pref-autonomy"
                        className="text-xs font-medium text-foreground"
                      >
                        Default autonomy
                      </label>
                      <span className="text-xs text-muted-foreground">
                        Whether agents pause for approval between phases.
                      </span>
                    </div>
                    <Select value={defaultAutonomy} onValueChange={(v) => v && updateAutonomy(v)}>
                      <SelectTrigger id="pref-autonomy" className="w-44">
                        <SelectValue>
                          {defaultAutonomy === "high"
                            ? "High"
                            : defaultAutonomy === "low"
                              ? "Low"
                              : "Medium"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="low">Low</SelectItem>
                          <SelectItem value="medium">Medium</SelectItem>
                          <SelectItem value="high">High</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center justify-between gap-4 px-5 py-3.5">
                    <div className="flex flex-col gap-0.5">
                      <label
                        htmlFor="pref-static-status"
                        className="cursor-pointer text-xs font-medium text-foreground"
                      >
                        Static phase indicators
                      </label>
                      <span className="text-xs text-muted-foreground">
                        Disable pulsing animations on active run status dots.
                      </span>
                    </div>
                    <Switch
                      id="pref-static-status"
                      checked={disableDynamicStatus}
                      onCheckedChange={(v) =>
                        updateBoolPref("sf.pref.disableDynamicStatus", v, setStaticStatusOverride)
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between gap-4 px-5 py-3.5">
                    <div className="flex flex-col gap-0.5">
                      <label
                        htmlFor="pref-auto-artifacts"
                        className="cursor-pointer text-xs font-medium text-foreground"
                      >
                        Auto-open artifact previews
                      </label>
                      <span className="text-xs text-muted-foreground">
                        Show QC screenshots and mockups in the right inspector automatically.
                      </span>
                    </div>
                    <Switch
                      id="pref-auto-artifacts"
                      checked={autoOpenArtifacts}
                      onCheckedChange={(v) =>
                        updateBoolPref("sf.pref.autoOpenArtifacts", v, setAutoArtifactsOverride)
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between gap-4 px-5 py-3.5">
                    <div className="flex flex-col gap-0.5">
                      <label
                        htmlFor="pref-pr-review"
                        className="cursor-pointer text-xs font-medium text-foreground"
                      >
                        Open pull requests in Code Review
                      </label>
                      <span className="text-xs text-muted-foreground">
                        Route PR links inside sessions to the built-in review view.
                      </span>
                    </div>
                    <Switch
                      id="pref-pr-review"
                      checked={openPrInReview}
                      onCheckedChange={(v) =>
                        updateBoolPref("sf.pref.openPrInReview", v, setOpenPrOverride)
                      }
                    />
                  </div>
                </div>
              </section>
            </>
          )}

          {/* SECTION 2: APPEARANCE */}
          {effectiveTab === "appearance" && (
            <>
              <section className="flex flex-col gap-3">
                <h2 className="font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Theme Mode
                </h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <ThemePreviewCard
                    mode="system"
                    label="System"
                    active={mounted && theme === "system"}
                    onClick={() => setTheme("system")}
                  />
                  <ThemePreviewCard
                    mode="light"
                    label="Light"
                    active={mounted && theme === "light"}
                    onClick={() => setTheme("light")}
                  />
                  <ThemePreviewCard
                    mode="dark"
                    label="Dark"
                    active={mounted && theme === "dark"}
                    onClick={() => setTheme("dark")}
                  />
                </div>
              </section>

              <section className="flex flex-col gap-2.5">
                <h2 className="font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Color &amp; Contrast
                </h2>
                <div className="divide-y rounded-lg border bg-card">
                  {/* Interactive Accent Swatches */}
                  <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs font-medium text-foreground">Accent color</span>
                      <span className="text-xs text-muted-foreground">
                        Applied to primary actions, active states, and focus rings.
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {ACCENT_PRESETS.map((p) => {
                        const isSelected = accentHex === p.hex;
                        return (
                          <button
                            key={p.id}
                            type="button"
                            aria-pressed={isSelected}
                            onClick={() => applyAccent(p.hex)}
                            className={cn(
                              "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors",
                              isSelected
                                ? "border-primary bg-primary/10 font-medium text-foreground"
                                : "border-border bg-background text-muted-foreground hover:text-foreground",
                            )}
                          >
                            <span
                              aria-hidden="true"
                              className="size-3 rounded-full border border-black/15"
                              style={{ backgroundColor: p.hex }}
                            />
                            <span>{p.label.split(" ")[0]}</span>
                          </button>
                        );
                      })}
                      <span className="hidden rounded-md border bg-muted/40 px-2 py-1 font-mono text-[11px] text-muted-foreground sm:inline-block">
                        {accentHex}
                      </span>
                    </div>
                  </div>

                  {/* Surface Contrast */}
                  <div className="flex flex-col gap-3 px-5 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs font-medium text-foreground">
                          Border &amp; surface contrast
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Adjust visual separation between cards, borders, and secondary text.
                        </span>
                      </div>
                      <div className="flex items-center gap-1 rounded-md border bg-background p-0.5">
                        {CONTRAST_PRESETS.map((cp) => {
                          const isCurrent =
                            (cp.value === 20 && contrast <= 30) ||
                            (cp.value === 50 && contrast > 30 && contrast < 70) ||
                            (cp.value === 85 && contrast >= 70);
                          return (
                            <button
                              key={cp.label}
                              type="button"
                              aria-pressed={isCurrent}
                              onClick={() => applyContrast(cp.value)}
                              className={cn(
                                "rounded-[4px] px-2.5 py-1 text-xs transition-colors",
                                isCurrent
                                  ? "bg-secondary font-medium text-foreground"
                                  : "text-muted-foreground hover:text-foreground",
                              )}
                            >
                              {cp.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 pt-0.5">
                      <Slider
                        aria-label="Border and surface contrast"
                        value={[contrast]}
                        min={0}
                        max={100}
                        step={5}
                        onValueChange={(val) => {
                          const next = Array.isArray(val) ? val[0] : Number(val);
                          if (Number.isFinite(next)) applyContrast(next);
                        }}
                      />
                      <span className="w-8 text-right font-mono text-xs text-muted-foreground tabular-nums">
                        {contrast}
                      </span>
                    </div>
                  </div>

                  {/* Compact Active Palette Strip */}
                  <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                    <span className="text-xs font-medium text-foreground">
                      Active surface tokens ({isDark ? "Dark" : "Light"})
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      {surfaceSwatches.map((sw) => (
                        <span
                          key={sw.label}
                          title={`${sw.label}: ${sw.hex}`}
                          className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 font-mono text-[11px] text-muted-foreground"
                        >
                          <span
                            aria-hidden="true"
                            className="size-3 rounded-[2px] border border-border"
                            style={{ backgroundColor: sw.hex }}
                          />
                          <span>{sw.hex}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </section>

              <section className="flex flex-col gap-2.5">
                <h2 className="font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Typography
                </h2>
                <div className="grid grid-cols-1 divide-y rounded-lg border bg-card sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                  <div className="flex flex-col gap-1 px-5 py-4">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      Brand
                    </span>
                    <span className="font-brand text-base font-bold tracking-[-0.03em] text-foreground">
                      Space Grotesk
                    </span>
                    <span className="text-xs text-muted-foreground">Wordmark</span>
                  </div>
                  <div className="flex flex-col gap-1 px-5 py-4">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      Interface
                    </span>
                    <span className="text-base font-medium text-foreground">Geist</span>
                    <span className="text-xs text-muted-foreground">Labels &amp; prose</span>
                  </div>
                  <div className="flex flex-col gap-1 px-5 py-4">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      Telemetry
                    </span>
                    <span className="font-mono text-base font-medium text-foreground">
                      Geist Mono
                    </span>
                    <span className="text-xs text-muted-foreground">Logs, metrics &amp; CLI</span>
                  </div>
                </div>
              </section>
            </>
          )}

          {/* SECTION 3: TEAM */}
          {effectiveTab === "team" && (
            <SettingsTeamPanel
              projects={teamProjects}
              initialProjectId={initialProjectId}
              currentUserId={currentUserId}
              origin={origin}
              onGoToRunners={() => selectTab("runners")}
            />
          )}

          {/* SECTION 4: RUNNERS */}
          {effectiveTab === "runners" && (
            <>
              <section className="flex flex-col gap-2.5">
                <h2 className="font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Connected Machines ({runnerList.length})
                </h2>

                {runnerList.length === 0 ? (
                  <div className="rounded-lg border border-dashed bg-card/40 px-6 py-8 text-center">
                    <p className="text-sm font-medium text-foreground">No runners connected</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Install <code className="font-mono text-foreground">sf</code> below and start{" "}
                      <code className="font-mono text-foreground">sf daemon</code> to connect this
                      machine.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <div className="overflow-hidden rounded-lg border bg-card">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Machine</TableHead>
                            <TableHead>Engines</TableHead>
                            <TableHead>Access</TableHead>
                            <TableHead>Slots</TableHead>
                            <TableHead className="text-right">Heartbeat</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {runnerList.map((r) => (
                            <TableRow key={r.id}>
                              <TableCell className="max-w-[240px]">
                                <div className="flex flex-col gap-0.5">
                                  <div className="flex items-center gap-2">
                                    <StatusDot status={r.status} />
                                    <span className="truncate font-medium text-foreground">
                                      {r.name}
                                    </span>
                                    {r.cliVersion && (
                                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                                        v{r.cliVersion}
                                      </span>
                                    )}
                                  </div>
                                  <span
                                    className="truncate font-mono text-[11px] text-muted-foreground"
                                    title={
                                      r.workspaceDir
                                        ? `${r.hostname} (${r.os}) · ${r.workspaceDir}`
                                        : `${r.hostname} (${r.os})`
                                    }
                                  >
                                    {r.os}
                                    {!r.isOwn ? ` · @${r.ownerLogin}` : ""}
                                    {r.workspaceDir ? ` · ${r.discoveredCount} repos` : ""}
                                  </span>
                                </div>
                              </TableCell>

                              <TableCell>
                                <div className="flex flex-wrap items-center gap-1">
                                  {r.engines.map((e) => (
                                    <Badge key={e} variant="secondary">
                                      <CpuIcon data-icon="inline-start" />
                                      {e}
                                    </Badge>
                                  ))}
                                  {r.models.length > 0 && (
                                    <span className="font-mono text-[11px] text-muted-foreground">
                                      · {r.models.length} models
                                    </span>
                                  )}
                                </div>
                              </TableCell>

                              <TableCell>
                                {r.isOwn ? (
                                  <div className="flex items-center gap-2.5">
                                    <Switch
                                      id={`runner-share-${r.id}`}
                                      aria-label={`Share ${r.name} with team`}
                                      checked={r.visibility === "team"}
                                      disabled={togglingRunnerId === r.id}
                                      onCheckedChange={(checked) =>
                                        void toggleRunnerShare(r, checked === true)
                                      }
                                    />
                                    <label
                                      htmlFor={`runner-share-${r.id}`}
                                      className="cursor-pointer text-xs text-muted-foreground"
                                    >
                                      {r.visibility === "team" ? "Shared" : "Personal"}
                                    </label>
                                  </div>
                                ) : (
                                  <Badge variant="outline" className="font-mono text-[10px]">
                                    @{r.ownerLogin}
                                  </Badge>
                                )}
                              </TableCell>

                              <TableCell className="font-mono text-xs tabular-nums">
                                {r.activeRuns}/{r.maxConcurrency}
                              </TableCell>

                              <TableCell
                                className="text-right font-mono text-xs text-muted-foreground tabular-nums"
                                suppressHydrationWarning
                              >
                                {formatRelativeTime(r.lastHeartbeatAt)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Shared runners always isolate teammate jobs inside separate git worktrees.
                    </p>
                  </div>
                )}
              </section>

              <section className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <h2 className="font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Connect a Machine
                  </h2>
                  <Badge variant="secondary" className="font-mono text-[10px]">
                    OAuth Device Login
                  </Badge>
                </div>

                <div className="flex flex-col gap-4 rounded-lg border bg-card p-5">
                  <CommandRow
                    label="1-command install & authorize"
                    command={installCmd}
                    copied={copiedKey === "install"}
                    onCopy={() => copyText("install", installCmd)}
                  />

                  <div className="grid grid-cols-1 gap-3 border-t pt-4 sm:grid-cols-3">
                    <CommandRow
                      label="Setup"
                      command={setupCmd}
                      copied={copiedKey === "setup"}
                      onCopy={() => copyText("setup", setupCmd)}
                    />
                    <CommandRow
                      label="Health check"
                      command={doctorCmd}
                      copied={copiedKey === "doctor"}
                      onCopy={() => copyText("doctor", doctorCmd)}
                    />
                    <CommandRow
                      label="Start daemon"
                      command={daemonCmd}
                      copied={copiedKey === "daemon"}
                      onCopy={() => copyText("daemon", daemonCmd)}
                    />
                  </div>
                </div>
              </section>
            </>
          )}

          {/* SECTION 5: API KEYS */}
          {effectiveTab === "keys" && (
            <>
              <section className="flex flex-col gap-2.5">
                <h2 className="font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Generate Key
                </h2>
                <form
                  onSubmit={createToken}
                  className="flex flex-col gap-3 rounded-lg border bg-card p-5"
                >
                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="api-key-label"
                      className="text-xs font-medium text-foreground"
                    >
                      Key label
                    </label>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        id="api-key-label"
                        value={tokenLabel}
                        onChange={(e) => setTokenLabel(e.target.value)}
                        placeholder="e.g. MacBook Pro Daemon"
                        className="flex-1"
                      />
                      <Button type="submit" disabled={creatingToken || !tokenLabel.trim()}>
                        {creatingToken ? (
                          <Spinner data-icon="inline-start" />
                        ) : (
                          <PlusIcon data-icon="inline-start" />
                        )}
                        Generate Key
                      </Button>
                    </div>
                  </div>

                  {newToken && (
                    <div className="flex flex-col gap-2 rounded-md border border-primary/40 bg-primary/5 p-3.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-primary">
                          Copy this key now — it is only shown once.
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label="Dismiss key reveal"
                          onClick={() => setNewToken(null)}
                        >
                          <XIcon />
                        </Button>
                      </div>
                      <CommandRow
                        command={newToken}
                        copied={copiedKey === "tok"}
                        onCopy={() => copyText("tok", newToken)}
                      />
                    </div>
                  )}
                </form>
              </section>

              <section className="flex flex-col gap-2.5">
                <h2 className="font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Active Keys ({tokens.length})
                </h2>

                {tokens.length === 0 ? (
                  <div className="rounded-lg border border-dashed bg-card/40 px-6 py-8 text-center text-xs text-muted-foreground">
                    No active API keys yet.
                  </div>
                ) : (
                  <div className="divide-y rounded-lg border bg-card">
                    {tokens.map((t) => (
                      <div
                        key={t.id}
                        className="flex items-center justify-between gap-3 px-5 py-3.5"
                      >
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="truncate text-sm font-medium text-foreground">
                            {t.label}
                          </span>
                          <span className="font-mono text-xs text-muted-foreground tabular-nums">
                            {t.prefix}… ·{" "}
                            {t.lastUsedAt
                              ? `used ${formatRelativeTime(t.lastUsedAt)}`
                              : "never used"}
                          </span>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`Revoke ${t.label}`}
                          title="Revoke key"
                          disabled={revokingId === t.id}
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => void revokeToken(t.id)}
                        >
                          {revokingId === t.id ? <Spinner /> : <Trash2Icon />}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="flex flex-col gap-2.5">
                <h2 className="font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  CLI Authentication
                </h2>
                <div className="rounded-lg border bg-card p-5">
                  <CommandRow
                    command={loginCmd}
                    copied={copiedKey === "login"}
                    onCopy={() => copyText("login", loginCmd)}
                  />
                </div>
              </section>
            </>
          )}

          {/* SECTION 6: MCP CONTEXT LAKE */}
          {effectiveTab === "mcp" && (
            <>
              <section className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Client Configuration
                  </h2>
                  <span className="font-mono text-xs text-muted-foreground">
                    ~/.sf/mcp-config.json
                  </span>
                </div>

                <div className="overflow-hidden rounded-lg border bg-card">
                  <div className="flex items-center justify-between border-b px-4 py-2.5">
                    <span className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                      <TerminalIcon className="size-3.5" aria-hidden="true" />
                      stdio JSON-RPC 2.0
                    </span>
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => copyText("mcp", mcpSnippet)}
                    >
                      {copiedKey === "mcp" ? (
                        <CheckIcon data-icon="inline-start" className="text-success" />
                      ) : (
                        <CopyIcon data-icon="inline-start" />
                      )}
                      Copy JSON
                    </Button>
                  </div>
                  <pre className="overflow-x-auto bg-background/60 p-4 font-mono text-xs leading-relaxed text-foreground">
                    {mcpSnippet}
                  </pre>
                </div>
              </section>

              <section className="flex flex-col gap-2.5">
                <h2 className="font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Exposed Tools
                </h2>
                <div className="grid grid-cols-1 divide-y rounded-lg border bg-card sm:grid-cols-2 sm:divide-y-0">
                  {MCP_TOOLS.map((tool, idx) => (
                    <div
                      key={tool.name}
                      className={cn(
                        "flex flex-col gap-1 px-5 py-3.5",
                        idx % 2 === 1 && "sm:border-l",
                        idx >= 2 && "sm:border-t",
                      )}
                    >
                      <code className="font-mono text-xs font-medium text-foreground">
                        {tool.name}
                      </code>
                      <span className="text-xs text-muted-foreground">{tool.desc}</span>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
