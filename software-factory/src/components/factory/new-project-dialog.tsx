"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckIcon,
  FolderIcon,
  FolderPlusIcon,
  GitBranchIcon,
  LaptopIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { StatusDot } from "@/components/factory/factory-primitives";

type NewProjectDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
};

type WorkspaceFolderItem = {
  name: string;
  path: string;
  isGit: boolean;
  hasFactoryInit: boolean;
  defaultBranch: string;
  githubFullName: string | null;
  alreadyImported: boolean;
  linkedProjectId: string | null;
};

type WorkspaceRunnerInfo = {
  id: string;
  name: string;
  status: string;
  isOwn: boolean;
  ownerLogin: string;
  workspaceDir: string | null;
  folderCount: number;
};

type WorkspaceResponse = {
  activeRunner: {
    id: string;
    name: string;
    status: string;
    isOwn: boolean;
    ownerLogin: string;
    workspaceDir: string;
  } | null;
  workspaceDir: string;
  runners: WorkspaceRunnerInfo[];
  folders: WorkspaceFolderItem[];
};

function toSlugPreview(raw: string): string {
  return (
    raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "my-project"
  );
}

export function NewProjectDialog({ open, onOpenChange, onCreated }: NewProjectDialogProps) {
  const router = useRouter();
  const [tab, setTab] = React.useState("create");
  const [workspace, setWorkspace] = React.useState<WorkspaceResponse | null>(null);
  const [selectedRunnerId, setSelectedRunnerId] = React.useState<string>("");
  const [loadingWorkspace, setLoadingWorkspace] = React.useState(false);
  const [folderQuery, setFolderQuery] = React.useState("");
  const [importingPath, setImportingPath] = React.useState<string | null>(null);

  // Create New Project form state
  const [name, setName] = React.useState("");
  const [defaultBranch, setDefaultBranch] = React.useState("main");
  const [description, setDescription] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const loadWorkspace = React.useCallback(async (runnerId?: string) => {
    setLoadingWorkspace(true);
    try {
      const qs = runnerId ? `?runnerId=${encodeURIComponent(runnerId)}` : "";
      const res = await fetch(`/api/runners/workspace${qs}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as WorkspaceResponse;
      setWorkspace(data);
      if (!runnerId && data.activeRunner?.id) {
        setSelectedRunnerId(data.activeRunner.id);
      }
    } finally {
      setLoadingWorkspace(false);
    }
  }, []);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const qs = selectedRunnerId ? `?runnerId=${encodeURIComponent(selectedRunnerId)}` : "";
    void fetch(`/api/runners/workspace${qs}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: WorkspaceResponse | null) => {
        if (!cancelled && data) {
          setWorkspace(data);
          if (!selectedRunnerId && data.activeRunner?.id) {
            setSelectedRunnerId(data.activeRunner.id);
          }
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, selectedRunnerId]);

  async function handleCreateNew(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Enter a project name.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "new",
          name: name.trim(),
          description: description.trim(),
          defaultBranch: defaultBranch.trim() || "main",
          runnerId: selectedRunnerId || undefined,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        project?: { id: string; name: string };
        createdPath?: string;
        error?: string;
      } | null;
      if (!res.ok || !data?.project) {
        toast.error(data?.error || "Failed to create project");
        return;
      }
      toast.success(
        data.createdPath
          ? `Created "${data.project.name}" in ${data.createdPath}`
          : `Created project "${data.project.name}"`,
      );
      setName("");
      setDescription("");
      onOpenChange(false);
      onCreated?.();
      router.push(`/projects/${data.project.id}`);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConnectFolder(folder: WorkspaceFolderItem) {
    setImportingPath(folder.path);
    try {
      const res = await fetch("/api/projects/local", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: folder.name,
          localPath: folder.path,
          defaultBranch: folder.defaultBranch || "main",
          githubFullName: folder.githubFullName || undefined,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        project?: { id: string; name: string };
        error?: string;
      } | null;
      if (!res.ok || !data?.project) {
        toast.error(data?.error || "Failed to connect folder");
        return;
      }
      toast.success(`Connected "${data.project.name}"`);
      onOpenChange(false);
      onCreated?.();
      router.push(`/projects/${data.project.id}`);
      router.refresh();
    } finally {
      setImportingPath(null);
    }
  }

  const workspaceDir = workspace?.workspaceDir || "~/factory-projects";
  const slugPreview = toSlugPreview(name);
  const filteredFolders = (workspace?.folders || []).filter(
    (f) => !folderQuery.trim() || f.name.toLowerCase().includes(folderQuery.trim().toLowerCase()),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="border-b pb-4 pr-8">
          <div className="flex items-start gap-3">
            <span
              className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary"
              aria-hidden="true"
            >
              <FolderPlusIcon className="size-4.5" />
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <DialogTitle className="text-lg font-semibold tracking-tight">
                Add Project
              </DialogTitle>
              <DialogDescription className="text-xs leading-relaxed">
                Create a new workspace project or connect an existing folder from your local daemon.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto pr-0.5">
          {/* Active Daemon Default Workspace Banner */}
          <div className="flex min-w-0 items-center justify-between gap-2.5 rounded-md border bg-muted/35 px-3 py-2.5 text-xs">
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              {workspace?.activeRunner ? (
                <StatusDot status={workspace.activeRunner.status} />
              ) : (
                <LaptopIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-mono text-2xs uppercase tracking-wider text-muted-foreground">
                  Workspace Root
                  {workspace?.activeRunner ? ` · ${workspace.activeRunner.name}` : ""}
                </span>
                <span
                  title={workspaceDir}
                  className="truncate font-mono text-xs font-medium text-foreground"
                >
                  {workspaceDir}
                </span>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              {workspace && workspace.runners.length > 1 && (
                <Select
                  value={selectedRunnerId}
                  onValueChange={(v) => {
                    if (v) setSelectedRunnerId(v);
                  }}
                >
                  <SelectTrigger className="h-7 w-36 text-xs" aria-label="Select runner">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {workspace.runners.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Rescan daemon workspace"
                title="Rescan daemon workspace"
                disabled={loadingWorkspace}
                onClick={() => void loadWorkspace(selectedRunnerId || undefined)}
              >
                <RefreshCwIcon className={loadingWorkspace ? "animate-spin" : ""} aria-hidden="true" />
              </Button>
            </div>
          </div>

          <Tabs value={tab} onValueChange={setTab} className="flex flex-col gap-4">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="create">
                <FolderPlusIcon aria-hidden="true" />
                Create New
              </TabsTrigger>
              <TabsTrigger value="workspace">
                <FolderIcon aria-hidden="true" />
                From Folder ({workspace?.folders.length ?? 0})
              </TabsTrigger>
            </TabsList>

            {/* TAB 1: CREATE NEW PROJECT INSIDE DAEMON WORKSPACE DIR */}
            <TabsContent value="create" className="mt-0">
              <form
                id="sf-new-project-form"
                onSubmit={handleCreateNew}
                className="flex flex-col gap-4"
              >
                <FieldGroup className="gap-4">
                  <Field>
                    <FieldLabel htmlFor="sf-new-name">Project name</FieldLabel>
                    <Input
                      id="sf-new-name"
                      autoFocus
                      required
                      placeholder="e.g. nova-saas"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                    <FieldDescription className="flex items-center gap-1.5 font-mono text-xs">
                      <span className="text-muted-foreground">Folder:</span>
                      <span className="truncate rounded-[2px] bg-muted px-1.5 py-0.5 text-foreground">
                        {workspaceDir.replace(/\/+$/, "")}/{slugPreview}
                      </span>
                    </FieldDescription>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="sf-new-desc">Description (optional)</FieldLabel>
                    <Textarea
                      id="sf-new-desc"
                      rows={2}
                      placeholder="Short product or architecture summary"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </Field>
                </FieldGroup>

                <div className="grid grid-cols-1 gap-4">
                  <Field>
                    <FieldLabel htmlFor="sf-branch">Default branch</FieldLabel>
                    <Input
                      id="sf-branch"
                      value={defaultBranch}
                      onChange={(e) => setDefaultBranch(e.target.value)}
                      className="font-mono text-xs"
                    />
                  </Field>
                </div>
              </form>
            </TabsContent>

            {/* TAB 2: PICK EXISTING FOLDER FROM DAEMON WORKSPACE DIR */}
            <TabsContent value="workspace" className="mt-0 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <SearchIcon
                    className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    aria-label="Filter daemon folders"
                    value={folderQuery}
                    onChange={(e) => setFolderQuery(e.target.value)}
                    placeholder="Filter folders..."
                    className="h-8 pl-8 text-xs"
                  />
                </div>
              </div>

              <div className="max-h-60 overflow-y-auto rounded-md border bg-card">
                {loadingWorkspace && !workspace ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
                    <Spinner />
                    <span>Scanning daemon workspace...</span>
                  </div>
                ) : filteredFolders.length === 0 ? (
                  <div className="flex flex-col items-center gap-1.5 p-6 text-center text-xs text-muted-foreground">
                    <span>No project folders found in {workspaceDir}.</span>
                    <span>
                      Use <strong>Create New</strong> to scaffold one automatically, or set{" "}
                      <code className="font-mono text-foreground">
                        sf daemon --projects-dir &lt;dir&gt;
                      </code>
                      .
                    </span>
                  </div>
                ) : (
                  <div className="divide-y">
                    {filteredFolders.map((folder) => (
                      <div
                        key={folder.path}
                        className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs transition-colors hover:bg-muted/35"
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <FolderIcon
                            className="size-4 shrink-0 text-primary"
                            aria-hidden="true"
                          />
                          <div className="flex min-w-0 flex-col gap-0.5">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate font-medium text-foreground">
                                {folder.name}
                              </span>
                              {folder.isGit && (
                                <Badge variant="outline">
                                  <GitBranchIcon data-icon="inline-start" aria-hidden="true" />
                                  {folder.defaultBranch}
                                </Badge>
                              )}
                              {folder.hasFactoryInit && (
                                <Badge variant="secondary">.factory</Badge>
                              )}
                            </div>
                            <span className="truncate font-mono text-2xs text-muted-foreground">
                              {folder.path}
                            </span>
                          </div>
                        </div>

                        {folder.alreadyImported && folder.linkedProjectId ? (
                          <Button
                            size="xs"
                            variant="secondary"
                            nativeButton={false}
                            render={<Link href={`/projects/${folder.linkedProjectId}`} />}
                            onClick={() => onOpenChange(false)}
                          >
                            <CheckIcon data-icon="inline-start" aria-hidden="true" />
                            Open
                          </Button>
                        ) : (
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={importingPath === folder.path}
                            onClick={() => void handleConnectFolder(folder)}
                          >
                            {importingPath === folder.path ? (
                              <Spinner data-icon="inline-start" />
                            ) : (
                              <PlusIcon data-icon="inline-start" aria-hidden="true" />
                            )}
                            Connect
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter className="items-center sm:justify-between">
          {tab === "workspace" ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              nativeButton={false}
              render={<Link href="/settings?tab=runners" />}
              onClick={() => onOpenChange(false)}
            >
              Configure Daemon Folder
            </Button>
          ) : (
            <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
              Initialized with git automatically
            </span>
          )}

          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            {tab === "create" && (
              <Button
                type="submit"
                form="sf-new-project-form"
                size="sm"
                disabled={submitting || !name.trim()}
              >
                {submitting ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <PlusIcon data-icon="inline-start" aria-hidden="true" />
                )}
                Create Project
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
