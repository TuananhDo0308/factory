"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  CheckIcon,
  CopyIcon,
  FolderIcon,
  Link2Icon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";
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
import {
  formatRelativeTime,
  StatusDot,
} from "@/components/factory/factory-primitives";

export type SettingsTeamProject = {
  id: string;
  name: string;
  isOwner: boolean;
  ownerLogin: string;
  memberCount: number;
};

type MemberRecord = {
  id: string;
  userId: string | null;
  githubLogin: string;
  name: string | null;
  avatarUrl: string | null;
  role: string;
  pending: boolean;
  joinedAt: string;
};

type InviteRecord = {
  id: string;
  token: string;
  role: string;
  usesCount: number;
  expiresAt: string | null;
  createdAt: string;
};

type RunnerRecord = {
  id: string;
  name: string;
  hostname: string;
  os: string;
  visibility: string;
  isOwn: boolean;
  ownerLogin: string;
  status: string;
};

type UserSuggestion = {
  id: string;
  githubLogin: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  isGitHub: boolean;
};

type TeamPayload = {
  myRole: "owner" | "member" | "viewer";
  owner: {
    id: string;
    githubLogin: string;
    name: string | null;
    avatarUrl: string | null;
  } | null;
  members: MemberRecord[];
  invites: InviteRecord[];
  runners: RunnerRecord[];
};

function initialsFor(name: string | null | undefined, login: string): string {
  const src = (name || login || "U").trim();
  return src
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0] || "")
    .join("")
    .toUpperCase();
}

export function SettingsTeamPanel({
  projects,
  initialProjectId,
  lockedProjectId,
  currentUserId,
  origin,
  onGoToRunners,
  onMemberCountChange,
}: {
  projects: SettingsTeamProject[];
  initialProjectId?: string;
  lockedProjectId?: string;
  currentUserId: string;
  origin: string;
  onGoToRunners?: () => void;
  onMemberCountChange?: (count: number) => void;
}) {
  const router = useRouter();
  const [selectedProjectId, setSelectedProjectId] = React.useState<string>(() => {
    if (lockedProjectId) return lockedProjectId;
    if (initialProjectId && projects.some((p) => p.id === initialProjectId)) {
      return initialProjectId;
    }
    return projects[0]?.id ?? "";
  });
  const activeProjectId = lockedProjectId || selectedProjectId;

  const [teamData, setTeamData] = React.useState<TeamPayload | null>(null);
  const [loadingProjectId, setLoadingProjectId] = React.useState<string>("");
  const [togglingRunnerId, setTogglingRunnerId] = React.useState<string | null>(null);

  const [query, setQuery] = React.useState("");
  const [suggestions, setSuggestions] = React.useState<UserSuggestion[]>([]);
  const [dropdownOpen, setDropdownOpen] = React.useState(false);
  const [memberRole, setMemberRole] = React.useState<"member" | "viewer">("member");
  const [addingMember, setAddingMember] = React.useState(false);

  const [inviteRole, setInviteRole] = React.useState<"member" | "viewer">("member");
  const [creatingInvite, setCreatingInvite] = React.useState(false);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const comboRef = React.useRef<HTMLDivElement>(null);

  const fetchTeam = React.useCallback(
    async (projectId: string) => {
      if (!projectId) return;
      setLoadingProjectId(projectId);
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/members`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as TeamPayload;
        setTeamData(data);
        onMemberCountChange?.((data.members?.length ?? 0) + 1);
      } finally {
        setLoadingProjectId("");
      }
    },
    [onMemberCountChange],
  );

  React.useEffect(() => {
    if (!activeProjectId) return;
    let cancelled = false;
    void fetch(`/api/projects/${encodeURIComponent(activeProjectId)}/members`, {
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: TeamPayload | null) => {
        if (!cancelled && data) {
          setTeamData(data);
          onMemberCountChange?.((data.members?.length ?? 0) + 1);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeProjectId, onMemberCountChange]);

  React.useEffect(() => {
    if (!dropdownOpen || !activeProjectId) return;
    let cancelled = false;
    const t = setTimeout(() => {
      const qs = new URLSearchParams();
      if (query.trim()) qs.set("q", query.trim());
      qs.set("excludeProjectId", activeProjectId);
      void fetch(`/api/users/search?${qs.toString()}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { users?: UserSuggestion[] } | null) => {
          if (!cancelled && data?.users) setSuggestions(data.users);
        })
        .catch(() => {});
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, dropdownOpen, activeProjectId]);

  React.useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedProject = projects.find((p) => p.id === activeProjectId) ?? null;
  const isOwner = teamData?.myRole === "owner" || Boolean(selectedProject?.isOwner);

  async function toggleRunnerShare(runner: RunnerRecord, shareWithTeam: boolean) {
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
      toast.success(
        shareWithTeam
          ? `"${runner.name}" shared with project team`
          : `"${runner.name}" set to Personal only`,
      );
      await fetchTeam(activeProjectId);
      router.refresh();
    } finally {
      setTogglingRunnerId(null);
    }
  }

  async function addHandle(rawHandle: string) {
    const clean = rawHandle.trim().replace(/^@+/, "");
    if (!clean || !activeProjectId) return;
    setAddingMember(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(activeProjectId)}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ githubLogin: clean, role: memberRole }),
      });
      const data = (await res.json().catch(() => null)) as {
        member?: MemberRecord;
        error?: string;
      } | null;
      if (!res.ok || !data?.member) {
        toast.error(data?.error || "Could not add member");
        return;
      }
      setQuery("");
      setDropdownOpen(false);
      toast.success(`Added @${data.member.githubLogin} to ${selectedProject?.name || "project"}`);
      await fetchTeam(activeProjectId);
      router.refresh();
    } finally {
      setAddingMember(false);
    }
  }

  async function handleRoleChange(memberId: string, role: "member" | "viewer") {
    if (!activeProjectId) return;
    const res = await fetch(`/api/projects/${encodeURIComponent(activeProjectId)}/members`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ memberId, role }),
    });
    if (res.ok) {
      toast.success("Member role updated");
      await fetchTeam(activeProjectId);
    } else {
      toast.error("Failed to update role");
    }
  }

  async function handleRemoveMember(memberId: string, login: string) {
    if (!activeProjectId) return;
    const res = await fetch(
      `/api/projects/${encodeURIComponent(activeProjectId)}/members?memberId=${encodeURIComponent(memberId)}`,
      { method: "DELETE" },
    );
    if (res.ok) {
      toast.success(`Removed @${login}`);
      await fetchTeam(activeProjectId);
      router.refresh();
    } else {
      toast.error("Failed to remove member");
    }
  }

  async function handleGenerateInvite() {
    if (!activeProjectId) return;
    setCreatingInvite(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(activeProjectId)}/invites`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: inviteRole, expiresInDays: 7 }),
      });
      const data = (await res.json().catch(() => null)) as {
        invite?: InviteRecord;
        inviteUrl?: string;
        error?: string;
      } | null;
      if (!res.ok || !data?.invite) {
        toast.error(data?.error || "Could not create invite link");
        return;
      }
      const link = data.inviteUrl || `${origin}/invite/${data.invite.token}`;
      void navigator.clipboard.writeText(link).catch(() => {});
      setCopiedId(data.invite.id);
      setTimeout(() => setCopiedId(null), 1800);
      toast.success("Invite link created & copied");
      await fetchTeam(activeProjectId);
    } finally {
      setCreatingInvite(false);
    }
  }

  async function handleRevokeInvite(inviteId: string) {
    if (!activeProjectId) return;
    const res = await fetch(
      `/api/projects/${encodeURIComponent(activeProjectId)}/invites?inviteId=${encodeURIComponent(inviteId)}`,
      { method: "DELETE" },
    );
    if (res.ok) {
      toast.success("Invite link revoked");
      await fetchTeam(activeProjectId);
    }
  }

  function copyLink(id: string, token: string) {
    void navigator.clipboard.writeText(`${origin}/invite/${token}`);
    setCopiedId(id);
    toast.success("Copied invite link");
    setTimeout(() => setCopiedId(null), 1600);
  }

  if (projects.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-card/40 px-6 py-8 text-center">
        <p className="text-sm font-medium text-foreground">No projects yet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Create or connect a project first to add collaborators and share runners.
        </p>
      </div>
    );
  }

  const cleanQuery = query.trim().replace(/^@+/, "");
  const totalMembers = (teamData?.members.length ?? 0) + (teamData?.owner ? 1 : 0);

  return (
    <div className="flex flex-col gap-7">
      {/* Project Scope Bar */}
      {!lockedProjectId && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <FolderIcon className="size-4 text-muted-foreground" aria-hidden="true" />
            <label htmlFor="team-project-select" className="text-xs font-medium text-foreground">
              Project
            </label>
          </div>
          <Select
            value={activeProjectId}
            onValueChange={(v) => {
              if (v) setSelectedProjectId(v);
            }}
          >
            <SelectTrigger id="team-project-select" className="w-60 text-xs">
              <SelectValue>{selectedProject?.name || "Select project"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} ({p.memberCount})
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Invite Collaborators & Links (Unified Card) */}
      {isOwner && (
        <section className="flex flex-col gap-2.5">
          <h2 className="font-mono text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Invite Collaborators
          </h2>
          <div className="divide-y rounded-lg border bg-card">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void addHandle(query);
              }}
              className="flex flex-col gap-2.5 p-5"
            >
              <label htmlFor="team-member-search" className="text-xs font-medium text-foreground">
                Add by GitHub username
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <div ref={comboRef} className="relative min-w-52 flex-1">
                  <SearchIcon
                    aria-hidden="true"
                    className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    id="team-member-search"
                    value={query}
                    onFocus={() => setDropdownOpen(true)}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setDropdownOpen(true);
                    }}
                    placeholder="Search @username or name..."
                    className="pl-8 text-xs"
                  />

                  {dropdownOpen && (
                    <div className="absolute top-full right-0 left-0 z-30 mt-1.5 overflow-hidden rounded-lg border bg-popover shadow-lg">
                      <div className="border-b px-3 py-1.5 font-mono text-2xs uppercase tracking-wider text-muted-foreground">
                        Signed-in users ({suggestions.length})
                      </div>
                      <div className="max-h-56 overflow-y-auto py-1">
                        {suggestions.length === 0 ? (
                          <div className="px-3 py-2 text-xs text-muted-foreground">
                            {cleanQuery
                              ? `No signed-in user matching "${cleanQuery}".`
                              : "No other users signed in yet."}
                          </div>
                        ) : (
                          suggestions.map((u) => (
                            <button
                              key={u.id}
                              type="button"
                              onClick={() => {
                                setQuery(u.githubLogin);
                                setDropdownOpen(false);
                              }}
                              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-accent"
                            >
                              <div className="flex min-w-0 items-center gap-2.5">
                                <Avatar className="size-6">
                                  {u.avatarUrl && (
                                    <AvatarImage src={u.avatarUrl} alt={u.githubLogin} />
                                  )}
                                  <AvatarFallback className="text-2xs">
                                    {initialsFor(u.name, u.githubLogin)}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="flex min-w-0 flex-col">
                                  <span className="truncate font-medium text-foreground">
                                    {u.name || u.githubLogin}
                                  </span>
                                  <span className="truncate font-mono text-xs text-muted-foreground">
                                    @{u.githubLogin}
                                    {u.email ? ` · ${u.email}` : ""}
                                  </span>
                                </div>
                              </div>
                              {u.isGitHub && (
                                <Badge variant="secondary" className="shrink-0 text-2xs">
                                  GitHub
                                </Badge>
                              )}
                            </button>
                          ))
                        )}

                        {cleanQuery &&
                          !suggestions.some(
                            (u) => u.githubLogin.toLowerCase() === cleanQuery.toLowerCase(),
                          ) && (
                            <button
                              type="button"
                              onClick={() => void addHandle(cleanQuery)}
                              className="flex w-full items-center gap-2 border-t px-3 py-2 text-left text-xs text-primary hover:bg-accent"
                            >
                              <PlusIcon className="size-3.5" aria-hidden="true" />
                              <span>
                                Add <code className="font-mono">@{cleanQuery}</code> (auto-links on
                                sign-in)
                              </span>
                            </button>
                          )}
                      </div>
                    </div>
                  )}
                </div>

                <Select
                  value={memberRole}
                  onValueChange={(v) => v && setMemberRole(v === "viewer" ? "viewer" : "member")}
                >
                  <SelectTrigger aria-label="Member role" className="w-28 text-xs">
                    <SelectValue>{memberRole === "viewer" ? "Viewer" : "Member"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="member">Member</SelectItem>
                      <SelectItem value="viewer">Viewer</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>

                <Button type="submit" size="sm" disabled={addingMember || !cleanQuery}>
                  {addingMember ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <PlusIcon data-icon="inline-start" />
                  )}
                  Add
                </Button>
              </div>
            </form>

            {/* Shareable Invite Links */}
            <div className="flex flex-col gap-3 px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-medium text-foreground">Invite links</span>
                  <span className="text-xs text-muted-foreground">
                    Share a 7-day link so teammates can join directly.
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={inviteRole}
                    onValueChange={(v) => v && setInviteRole(v === "viewer" ? "viewer" : "member")}
                  >
                    <SelectTrigger aria-label="Invite link role" className="h-8 w-28 text-xs">
                      <SelectValue>{inviteRole === "viewer" ? "Viewer" : "Member"}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="member">Member</SelectItem>
                        <SelectItem value="viewer">Viewer</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={creatingInvite}
                    onClick={() => void handleGenerateInvite()}
                  >
                    {creatingInvite ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <Link2Icon data-icon="inline-start" />
                    )}
                    Create link
                  </Button>
                </div>
              </div>

              {teamData && teamData.invites.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {teamData.invites.map((inv) => (
                    <div
                      key={inv.id}
                      className="flex items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 font-mono text-xs"
                    >
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">
                        {origin}/invite/{inv.token}
                      </span>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Badge variant="secondary" className="text-2xs">
                          {inv.role} · {inv.usesCount} used
                        </Badge>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label="Copy invite link"
                          onClick={() => copyLink(inv.id, inv.token)}
                        >
                          {copiedId === inv.id ? (
                            <CheckIcon className="text-success" />
                          ) : (
                            <CopyIcon />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label="Revoke invite link"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => void handleRevokeInvite(inv.id)}
                        >
                          <Trash2Icon />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Members Table */}
      <section className="flex flex-col gap-2.5">
        <h2 className="font-mono text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Members ({totalMembers})
        </h2>
        <div className="overflow-hidden rounded-lg border bg-card">
          {loadingProjectId === activeProjectId && !teamData ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
              <Spinner />
              <span>Loading members...</span>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {teamData?.owner && (
                  <TableRow>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <Avatar className="size-7">
                          {teamData.owner.avatarUrl && (
                            <AvatarImage
                              src={teamData.owner.avatarUrl}
                              alt={teamData.owner.githubLogin}
                            />
                          )}
                          <AvatarFallback className="text-2xs">
                            {initialsFor(teamData.owner.name, teamData.owner.githubLogin)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col">
                          <span className="font-medium text-foreground">
                            {teamData.owner.name || teamData.owner.githubLogin}
                          </span>
                          <span className="font-mono text-xs text-muted-foreground">
                            @{teamData.owner.githubLogin}
                          </span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">Owner</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">Active</TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">—</TableCell>
                  </TableRow>
                )}

                {(teamData?.members || []).map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <Avatar className="size-7">
                          {m.avatarUrl && <AvatarImage src={m.avatarUrl} alt={m.githubLogin} />}
                          <AvatarFallback className="text-2xs">
                            {initialsFor(m.name, m.githubLogin)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col">
                          <span className="font-medium text-foreground">
                            {m.name || `@${m.githubLogin}`}
                          </span>
                          <span className="font-mono text-xs text-muted-foreground">
                            @{m.githubLogin}
                          </span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {isOwner ? (
                        <Select
                          value={m.role}
                          onValueChange={(v) =>
                            v && void handleRoleChange(m.id, v === "viewer" ? "viewer" : "member")
                          }
                        >
                          <SelectTrigger
                            aria-label={`Role for ${m.githubLogin}`}
                            className="h-7 w-28 text-xs"
                          >
                            <SelectValue>
                              {m.role === "viewer" ? "Viewer" : "Member"}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="member">Member</SelectItem>
                              <SelectItem value="viewer">Viewer</SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="secondary" className="capitalize">
                          {m.role}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {m.pending ? (
                        <Badge variant="outline">Pending sign-in</Badge>
                      ) : (
                        <span suppressHydrationWarning>
                          Joined {formatRelativeTime(m.joinedAt)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {(isOwner || m.userId === currentUserId) && (
                        <Button
                          variant="ghost"
                          size="xs"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => void handleRemoveMember(m.id, m.githubLogin)}
                        >
                          <Trash2Icon data-icon="inline-start" />
                          {m.userId === currentUserId ? "Leave" : "Remove"}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </section>

      {/* Project Runners */}
      <section className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-mono text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Available Runners ({teamData?.runners.length ?? 0})
          </h2>
          {onGoToRunners && (
            <Button variant="ghost" size="xs" onClick={onGoToRunners}>
              Manage runners
            </Button>
          )}
        </div>

        {teamData && teamData.runners.length > 0 ? (
          <div className="divide-y rounded-lg border bg-card">
            {teamData.runners.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-xs"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <StatusDot status={r.status} />
                  <span className="truncate font-medium text-foreground">{r.name}</span>
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {r.os} · @{r.ownerLogin}
                  </span>
                </div>
                {r.isOwn ? (
                  <div className="flex shrink-0 items-center gap-2.5">
                    <Switch
                      id={`team-runner-share-${r.id}`}
                      aria-label={`Share ${r.name} with team`}
                      checked={r.visibility === "team"}
                      disabled={togglingRunnerId === r.id}
                      onCheckedChange={(checked) => void toggleRunnerShare(r, checked === true)}
                    />
                    <label
                      htmlFor={`team-runner-share-${r.id}`}
                      className="w-14 cursor-pointer text-xs text-muted-foreground"
                    >
                      {r.visibility === "team" ? "Shared" : "Personal"}
                    </label>
                  </div>
                ) : (
                  <Badge variant="outline" className="font-mono text-2xs">
                    Shared by @{r.ownerLogin}
                  </Badge>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed bg-card/40 px-5 py-6 text-center text-xs text-muted-foreground">
            No runners available for this project yet.
          </div>
        )}
      </section>
    </div>
  );
}
