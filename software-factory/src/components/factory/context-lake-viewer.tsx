"use client";

import * as React from "react";
import {
  CheckIcon,
  ChevronRightIcon,
  CloudIcon,
  Code2Icon,
  CopyIcon,
  EyeIcon,
  FileCodeIcon,
  FileJsonIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
  HardDriveIcon,
  LaptopIcon,
  RefreshCwIcon,
  SearchIcon,
  WrapTextIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { MarkdownContent } from "@/components/factory/markdown-content";
import { cn } from "@/lib/utils";

export type ContextLakeFile = {
  path: string;
  content: string;
  bytes: number;
  source?: string;
  updatedAt?: string;
};

type FileKind = "markdown" | "json" | "code";

function detectFileKind(filePath: string): FileKind {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".mdx")) return "markdown";
  if (lower.endsWith(".json")) return "json";
  return "code";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function splitFilePath(relPath: string): { dir: string; name: string } {
  const idx = relPath.lastIndexOf("/");
  if (idx === -1) return { dir: "", name: relPath };
  return { dir: relPath.slice(0, idx), name: relPath.slice(idx + 1) };
}

function FileKindIcon({ kind, className }: { kind: FileKind; className?: string }) {
  if (kind === "markdown") return <FileTextIcon className={className} />;
  if (kind === "json") return <FileJsonIcon className={className} />;
  return <FileCodeIcon className={className} />;
}

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function highlightJsonLine(line: string): React.ReactNode {
  const tokens: React.ReactNode[] = [];
  const tokenRe =
    /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let k = 0;

  while ((match = tokenRe.exec(line)) !== null) {
    if (match.index > lastIdx) {
      tokens.push(
        <span key={k++} className="text-muted-foreground/75">
          {line.slice(lastIdx, match.index)}
        </span>,
      );
    }

    const [full, strLit, colonSuffix, boolOrNull, numLit] = match;
    if (strLit !== undefined) {
      if (colonSuffix !== undefined) {
        tokens.push(
          <span key={k++} className="text-sky-600 dark:text-sky-400">
            {strLit}
          </span>,
        );
        tokens.push(
          <span key={k++} className="text-muted-foreground/75">
            {colonSuffix}
          </span>,
        );
      } else {
        const inner = strLit.slice(1, -1);
        const isHex = HEX_COLOR_RE.test(inner);
        tokens.push(
          <span key={k++} className="text-emerald-700 dark:text-emerald-400">
            {isHex && (
              <span
                className="mr-1.5 inline-block size-2.5 translate-y-[1px] rounded-[2px] border border-border/80 align-baseline"
                style={{ backgroundColor: inner }}
                aria-hidden="true"
              />
            )}
            {strLit}
          </span>,
        );
      }
    } else if (boolOrNull !== undefined) {
      tokens.push(
        <span key={k++} className="text-amber-600 dark:text-amber-400">
          {boolOrNull}
        </span>,
      );
    } else if (numLit !== undefined) {
      tokens.push(
        <span key={k++} className="text-violet-600 dark:text-violet-400">
          {numLit}
        </span>,
      );
    } else {
      tokens.push(<span key={k++}>{full}</span>);
    }
    lastIdx = tokenRe.lastIndex;
  }

  if (lastIdx < line.length) {
    tokens.push(
      <span key={k++} className="text-muted-foreground/75">
        {line.slice(lastIdx)}
      </span>,
    );
  }
  return tokens.length > 0 ? tokens : " ";
}

function CodeLinesView({
  content,
  wrap,
  highlightJson = false,
}: {
  content: string;
  wrap: boolean;
  highlightJson?: boolean;
}) {
  const lines = React.useMemo(() => content.replace(/\r\n/g, "\n").split("\n"), [content]);
  const gutterChars = Math.max(2, String(lines.length).length);

  return (
    <div className="w-full py-4 font-mono text-[12.5px] leading-6">
      <table className="w-full border-collapse">
        <tbody>
          {lines.map((line, idx) => (
            <tr key={idx} className="hover:bg-muted/35">
              <td
                style={{ width: `${gutterChars + 3}ch` }}
                className="select-none border-r border-border/40 pr-3 pl-4 text-right align-top text-[11px] text-muted-foreground/45 tabular-nums"
              >
                {idx + 1}
              </td>
              <td
                className={cn(
                  "pr-6 pl-4 align-top text-foreground/90",
                  wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre",
                )}
              >
                {highlightJson ? highlightJsonLine(line) : line || " "}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type TreeNode =
  | {
      type: "folder";
      name: string;
      path: string;
      children: TreeNode[];
    }
  | {
      type: "file";
      name: string;
      path: string;
      file: ContextLakeFile;
    };

function buildFileTree(files: ContextLakeFile[]): TreeNode[] {
  type FolderBuilder = {
    name: string;
    path: string;
    folders: Map<string, FolderBuilder>;
    files: Array<{ name: string; path: string; file: ContextLakeFile }>;
  };

  const root: FolderBuilder = { name: "", path: "", folders: new Map(), files: [] };

  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    if (parts.length === 0) continue;
    let cur = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const seg = parts[i];
      const nextPath = cur.path ? `${cur.path}/${seg}` : seg;
      let child = cur.folders.get(seg);
      if (!child) {
        child = { name: seg, path: nextPath, folders: new Map(), files: [] };
        cur.folders.set(seg, child);
      }
      cur = child;
    }
    cur.files.push({
      name: parts[parts.length - 1],
      path: file.path,
      file,
    });
  }

  function toNodes(builder: FolderBuilder): TreeNode[] {
    const folderNodes: TreeNode[] = Array.from(builder.folders.values()).map((f) => ({
      type: "folder",
      name: f.name,
      path: f.path,
      children: toNodes(f),
    }));
    const fileNodes: TreeNode[] = builder.files.map((f) => ({
      type: "file",
      name: f.name,
      path: f.path,
      file: f.file,
    }));
    return [...folderNodes, ...fileNodes];
  }

  return toNodes(root);
}

function FileTreeBranch({
  nodes,
  activePath,
  expandedFolders,
  forceOpen,
  onToggleFolder,
  onSelectFile,
}: {
  nodes: TreeNode[];
  activePath: string | null;
  expandedFolders: Record<string, boolean>;
  forceOpen: boolean;
  onToggleFolder: (folderPath: string, open: boolean) => void;
  onSelectFile: (filePath: string) => void;
}) {
  return (
    <ul className="flex min-w-0 flex-col gap-0.5">
      {nodes.map((node) => {
        if (node.type === "folder") {
          const isOpen = forceOpen ? true : (expandedFolders[node.path] ?? true);
          return (
            <li key={`dir:${node.path}`} className="min-w-0">
              <Collapsible
                open={isOpen}
                onOpenChange={(next) => onToggleFolder(node.path, next)}
              >
                <CollapsibleTrigger
                  render={
                    <button
                      type="button"
                      title={node.path}
                      className="flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left text-xs text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    >
                      <ChevronRightIcon
                        className={cn(
                          "size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-150",
                          isOpen && "rotate-90",
                        )}
                      />
                      {isOpen ? (
                        <FolderOpenIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1 truncate font-medium">{node.name}</span>
                    </button>
                  }
                />
                <CollapsibleContent className="min-w-0 overflow-hidden">
                  <div className="mt-0.5 ml-3 border-l border-sidebar-border/80 pl-2">
                    <FileTreeBranch
                      nodes={node.children}
                      activePath={activePath}
                      expandedFolders={expandedFolders}
                      forceOpen={forceOpen}
                      onToggleFolder={onToggleFolder}
                      onSelectFile={onSelectFile}
                    />
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </li>
          );
        }

        const isSelected = activePath === node.path;
        const kind = detectFileKind(node.path);
        return (
          <li key={`file:${node.path}`} className="min-w-0">
            <button
              type="button"
              title={node.path}
              onClick={() => onSelectFile(node.path)}
              className={cn(
                "flex h-7 w-full min-w-0 items-center justify-between gap-2 rounded-md px-2 text-left text-xs transition-colors",
                isSelected
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
              )}
            >
              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                <FileKindIcon
                  kind={kind}
                  className={cn(
                    "size-3.5 shrink-0",
                    isSelected ? "text-primary" : "text-muted-foreground/75",
                  )}
                />
                <span className="min-w-0 flex-1 truncate">{node.name}</span>
              </span>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70 tabular-nums">
                {formatBytes(node.file.bytes)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function sourceLabel(source?: string): { text: string; icon: "local" | "daemon" | "github" } {
  if (source === "github") return { text: "GitHub", icon: "github" };
  if (source === "daemon") return { text: "Runner sync", icon: "daemon" };
  return { text: "Local disk", icon: "local" };
}

export function ContextLakeViewer({
  files,
  source = "none",
  syncedAt = null,
  githubFullName = null,
  canWrite = false,
  syncing = false,
  onSync,
}: {
  files: ContextLakeFile[];
  source?: "local" | "daemon" | "github" | "none";
  syncedAt?: string | null;
  githubFullName?: string | null;
  canWrite?: boolean;
  syncing?: boolean;
  onSync?: () => Promise<void> | void;
}) {
  const [selectedPath, setSelectedPath] = React.useState<string>(files[0]?.path ?? "");
  const [query, setQuery] = React.useState("");
  const [expandedFolders, setExpandedFolders] = React.useState<Record<string, boolean>>({});
  const [viewMode, setViewMode] = React.useState<"preview" | "raw">("preview");
  const [wrapRaw, setWrapRaw] = React.useState(true);
  const [copied, setCopied] = React.useState(false);

  const activeFile = files.find((f) => f.path === selectedPath) ?? files[0] ?? null;

  const filteredFiles = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) => f.path.toLowerCase().includes(q));
  }, [files, query]);

  const fileTree = React.useMemo(() => buildFileTree(filteredFiles), [filteredFiles]);

  const totalBytes = React.useMemo(
    () => files.reduce((sum, f) => sum + f.bytes, 0),
    [files],
  );

  const activeKind = activeFile ? detectFileKind(activeFile.path) : "code";

  const formattedJson = React.useMemo(() => {
    if (!activeFile || activeKind !== "json") return null;
    try {
      return JSON.stringify(JSON.parse(activeFile.content), null, 2);
    } catch {
      return null;
    }
  }, [activeFile, activeKind]);

  const activeLineCount = React.useMemo(() => {
    if (!activeFile) return 0;
    const text =
      activeKind === "json" && viewMode === "preview" && formattedJson
        ? formattedJson
        : activeFile.content;
    return text.replace(/\r\n/g, "\n").split("\n").length;
  }, [activeFile, activeKind, viewMode, formattedJson]);

  const isTruncated = Boolean(
    activeFile && activeFile.bytes > new TextEncoder().encode(activeFile.content).length + 32,
  );

  async function handleCopyContent() {
    if (!activeFile) return;
    try {
      await navigator.clipboard.writeText(activeFile.content);
      setCopied(true);
      toast.success(`Copied ${splitFilePath(activeFile.path).name}`);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Could not copy to clipboard");
    }
  }

  if (files.length === 0) {
    return (
      <Empty className="border py-14">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileCodeIcon />
          </EmptyMedia>
          <EmptyTitle>No Context Lake files synced yet</EmptyTitle>
          <EmptyDescription>
            Remote deployments (like Vercel) cannot read your local folder directly.{" "}
            {githubFullName ? (
              <>
                Click <strong>Sync Context</strong> to pull{" "}
                <code className="font-mono">.factory/</code> &amp; docs from{" "}
                <code className="font-mono">{githubFullName}</code>, or keep{" "}
                <code className="font-mono">sf daemon</code> running locally to push uncommitted
                files automatically.
              </>
            ) : (
              <>
                Keep <code className="font-mono">sf daemon</code> running on your machine (or run{" "}
                <code className="font-mono">sf sync-context</code>) after{" "}
                <code className="font-mono">/factory init</code> to sync{" "}
                <code className="font-mono">.factory/</code> files to the cloud database.
              </>
            )}
          </EmptyDescription>
        </EmptyHeader>
        {canWrite && onSync && (
          <Button size="sm" disabled={syncing} onClick={() => void onSync()}>
            {syncing ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <RefreshCwIcon data-icon="inline-start" />
            )}
            Sync Context Now
          </Button>
        )}
      </Empty>
    );
  }

  const activeParts = activeFile ? splitFilePath(activeFile.path) : { dir: "", name: "" };
  const canPreview = activeKind === "markdown" || (activeKind === "json" && formattedJson !== null);
  const showingPreview = canPreview && viewMode === "preview";
  const srcMeta = sourceLabel(source);

  return (
    <div className="flex h-full min-h-[520px] flex-col overflow-hidden rounded-lg border bg-card md:flex-row">
      {/* LEFT SIDEBAR: Nested Collapsible Folder Tree (mirrors App Sidebar style) */}
      <aside className="flex w-full shrink-0 flex-col border-b bg-sidebar text-sidebar-foreground md:w-64 md:border-r md:border-b-0 lg:w-72">
        <div className="flex items-center justify-between gap-2 border-b border-sidebar-border px-2.5 py-2">
          <div
            className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground"
            title={syncedAt ? `Last synced: ${new Date(syncedAt).toLocaleString()}` : undefined}
          >
            {srcMeta.icon === "github" ? (
              <CloudIcon className="size-3.5 shrink-0 text-primary" />
            ) : srcMeta.icon === "daemon" ? (
              <LaptopIcon className="size-3.5 shrink-0 text-primary" />
            ) : (
              <HardDriveIcon className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate font-medium text-foreground/85">{srcMeta.text}</span>
          </div>
          {canWrite && onSync && (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              disabled={syncing}
              onClick={() => void onSync()}
              title="Refresh Context Lake from local daemon or GitHub"
            >
              {syncing ? <Spinner data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}
              Sync
            </Button>
          )}
        </div>

        {files.length >= 5 && (
          <div className="border-b border-sidebar-border p-2">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter files..."
                className="h-7 pl-8 text-xs"
              />
            </div>
          </div>
        )}

        <ScrollArea className="min-h-0 flex-1">
          <div className="p-2">
            {fileTree.length === 0 ? (
              <div className="px-2 py-6 text-center text-xs text-muted-foreground">
                No matching files
              </div>
            ) : (
              <FileTreeBranch
                nodes={fileTree}
                activePath={activeFile?.path ?? null}
                expandedFolders={expandedFolders}
                forceOpen={query.trim().length > 0}
                onToggleFolder={(folderPath, open) =>
                  setExpandedFolders((prev) => ({ ...prev, [folderPath]: open }))
                }
                onSelectFile={(filePath) => {
                  setSelectedPath(filePath);
                  setViewMode("preview");
                }}
              />
            )}
          </div>
        </ScrollArea>

        <div className="flex items-center justify-between border-t border-sidebar-border px-3 py-2 font-mono text-[10px] text-muted-foreground tabular-nums">
          <span>{files.length} files</span>
          <span>{formatBytes(totalBytes)}</span>
        </div>
      </aside>

      {/* RIGHT PANE: Rich Document / Code Viewer */}
      {activeFile && (
        <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-background/40">
          {/* Sticky File Header */}
          <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-card px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <FileKindIcon kind={activeKind} className="size-4 shrink-0 text-primary" />
              <div className="flex min-w-0 items-center gap-1 font-mono text-xs">
                {activeParts.dir && (
                  <>
                    <span className="hidden truncate text-muted-foreground sm:inline">
                      {activeParts.dir}
                    </span>
                    <span className="hidden text-muted-foreground/50 sm:inline">/</span>
                  </>
                )}
                <span className="truncate font-semibold text-foreground">{activeParts.name}</span>
              </div>
              <Badge variant="outline">
                {activeKind === "markdown" ? "Markdown" : activeKind === "json" ? "JSON" : "Text"}
              </Badge>
              <span className="hidden font-mono text-[11px] text-muted-foreground tabular-nums lg:inline">
                {activeLineCount} lines · {formatBytes(activeFile.bytes)}
              </span>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              {canPreview && (
                <div className="flex items-center rounded-md border bg-muted/40 p-0.5">
                  <Button
                    type="button"
                    variant={showingPreview ? "secondary" : "ghost"}
                    size="xs"
                    onClick={() => setViewMode("preview")}
                  >
                    <EyeIcon data-icon="inline-start" />
                    {activeKind === "json" ? "Formatted" : "Preview"}
                  </Button>
                  <Button
                    type="button"
                    variant={!showingPreview ? "secondary" : "ghost"}
                    size="xs"
                    onClick={() => setViewMode("raw")}
                  >
                    <Code2Icon data-icon="inline-start" />
                    Raw
                  </Button>
                </div>
              )}

              {(!showingPreview || activeKind === "json") && (
                <Button
                  type="button"
                  variant={wrapRaw ? "secondary" : "outline"}
                  size="xs"
                  title={wrapRaw ? "Disable line wrapping" : "Wrap long lines"}
                  onClick={() => setWrapRaw((v) => !v)}
                >
                  <WrapTextIcon data-icon="inline-start" />
                  Wrap
                </Button>
              )}

              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => void handleCopyContent()}
              >
                {copied ? (
                  <CheckIcon data-icon="inline-start" />
                ) : (
                  <CopyIcon data-icon="inline-start" />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </header>

          {isTruncated && (
            <div className="border-b bg-muted/40 px-4 py-1.5 font-mono text-[11px] text-muted-foreground">
              Showing first 32 KB of {formatBytes(activeFile.bytes)} for fast preview.
            </div>
          )}

          {/* Document Body */}
          <ScrollArea className="min-h-0 flex-1">
            {activeKind === "markdown" && showingPreview ? (
              <article className="mx-auto w-full max-w-4xl px-6 py-6 sm:px-8">
                <MarkdownContent content={activeFile.content} variant="document" />
              </article>
            ) : activeKind === "json" && showingPreview && formattedJson ? (
              <div className="overflow-x-auto">
                <CodeLinesView content={formattedJson} wrap={wrapRaw} highlightJson />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <CodeLinesView content={activeFile.content} wrap={wrapRaw} />
              </div>
            )}
          </ScrollArea>
        </section>
      )}
    </div>
  );
}
