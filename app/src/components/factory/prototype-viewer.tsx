"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  CheckCircle2Icon,
  CheckIcon,
  Code2Icon,
  DownloadIcon,
  ExternalLinkIcon,
  EyeIcon,
  LayersIcon,
  Maximize2Icon,
  Minimize2Icon,
  MessageSquareIcon,
  MonitorIcon,
  MoonIcon,
  PaletteIcon,
  RefreshCwIcon,
  SmartphoneIcon,
  SparklesIcon,
  SunIcon,
  TabletIcon,
  Trash2Icon,
  UploadIcon,
  WorkflowIcon,
  ChevronRightIcon,
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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  buildSandboxedPrototypeDocument,
  extractScreensFromHtml,
  type ParsedChatPrototype,
  type PrototypeScreen,
  type SerializedPrototype,
} from "@/lib/prototypes";
import { cn } from "@/lib/utils";

type ViewportMode = "fluid" | "desktop" | "tablet" | "mobile";

export type PrototypeViewModel = {
  id?: string;
  projectId?: string;
  slug: string;
  title: string;
  kind: "first_screen" | "ticket" | "whole_flow" | "existing";
  binding: "flow" | "look";
  status: "draft" | "approved" | "superseded";
  issueKeys: string[];
  htmlContent: string;
  screens: PrototypeScreen[];
  notShown: Array<{ criterion: string; why: string }>;
  localPath?: string | null;
  branchName?: string | null;
  version?: number;
  updatedAt?: string;
};

export function toPrototypeViewModel(p: SerializedPrototype): PrototypeViewModel {
  const screens =
    p.manifest.screens.length > 0
      ? p.manifest.screens
      : extractScreensFromHtml(p.htmlContent);
  return {
    id: p.id,
    projectId: p.projectId,
    slug: p.slug,
    title: p.title,
    kind: p.kind,
    binding: p.binding,
    status: p.status,
    issueKeys: p.issueKeys,
    htmlContent: p.htmlContent,
    screens,
    notShown: p.manifest.notShown ?? [],
    localPath: p.localPath,
    branchName: p.branchName,
    version: p.version,
    updatedAt: p.updatedAt,
  };
}

export function kindLabel(kind: PrototypeViewModel["kind"]): string {
  if (kind === "first_screen") return "First Screen";
  if (kind === "whole_flow") return "Whole-Flow Demo";
  if (kind === "existing") return "Imported";
  return "Ticket Prototype";
}

function viewportWidthPx(mode: ViewportMode): number | null {
  if (mode === "desktop") return 1440;
  if (mode === "tablet") return 768;
  if (mode === "mobile") return 390;
  return null;
}

export function PrototypeStudio({
  prototype,
  projectId,
  canWrite = false,
  compact = false,
  onUpdated,
  onDeleted,
  onSteer,
}: {
  prototype: PrototypeViewModel;
  projectId?: string;
  canWrite?: boolean;
  compact?: boolean;
  onUpdated?: (updated: SerializedPrototype) => void;
  onDeleted?: (id: string) => void;
  onSteer?: (message: string) => Promise<void> | void;
}) {
  const effectiveProjectId = projectId || prototype.projectId;
  const screens = React.useMemo(
    () =>
      prototype.screens.length > 0
        ? prototype.screens
        : extractScreensFromHtml(prototype.htmlContent),
    [prototype.screens, prototype.htmlContent],
  );

  const [activeScreenId, setActiveScreenId] = React.useState<string>(screens[0]?.id ?? "");
  const [notShownOpen, setNotShownOpen] = React.useState(false);
  const [viewport, setViewport] = React.useState<ViewportMode>(compact ? "fluid" : "fluid");
  const [protoTheme, setProtoTheme] = React.useState<"light" | "dark">("light");
  const [viewMode, setViewMode] = React.useState<"preview" | "code">("preview");
  const [fullscreen, setFullscreen] = React.useState(false);
  const [busyAction, setBusyAction] = React.useState<string | null>(null);
  const [feedbackOpen, setFeedbackOpen] = React.useState(false);
  const [feedbackText, setFeedbackText] = React.useState("");
  const [localBinding, setLocalBinding] = React.useState<"flow" | "look">(prototype.binding);
  const [localStatus, setLocalStatus] = React.useState<"draft" | "approved" | "superseded">(
    prototype.status,
  );

  const [prevProtoKey, setPrevProtoKey] = React.useState(
    `${prototype.id}:${prototype.binding}:${prototype.status}`,
  );
  if (prevProtoKey !== `${prototype.id}:${prototype.binding}:${prototype.status}`) {
    setPrevProtoKey(`${prototype.id}:${prototype.binding}:${prototype.status}`);
    setLocalBinding(prototype.binding);
    setLocalStatus(prototype.status);
  }

  const screensKey = screens.map((s) => s.id).join(",");
  const [prevScreensKey, setPrevScreensKey] = React.useState(screensKey);
  if (prevScreensKey !== screensKey) {
    setPrevScreensKey(screensKey);
    if (screens.length > 0 && !screens.some((s) => s.id === activeScreenId)) {
      setActiveScreenId(screens[0].id);
    }
  }

  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
  const fullscreenIframeRef = React.useRef<HTMLIFrameElement | null>(null);

  const firstScreenId = screens[0]?.id ?? "";
  const sandboxDoc = React.useMemo(
    () =>
      buildSandboxedPrototypeDocument(prototype.htmlContent, {
        initialScreenId: firstScreenId,
        theme: protoTheme,
      }),
    [prototype.htmlContent, firstScreenId, protoTheme],
  );

  const postToFrames = React.useCallback((payload: Record<string, unknown>) => {
    try {
      iframeRef.current?.contentWindow?.postMessage(payload, "*");
    } catch {
      // Ignore cross-origin frame errors.
    }
    try {
      fullscreenIframeRef.current?.contentWindow?.postMessage(payload, "*");
    } catch {
      // Ignore.
    }
  }, []);

  React.useEffect(() => {
    if (activeScreenId) {
      postToFrames({ type: "sf-proto:set-screen", screenId: activeScreenId });
    }
  }, [activeScreenId, postToFrames]);

  React.useEffect(() => {
    postToFrames({ type: "sf-proto:set-theme", theme: protoTheme });
  }, [protoTheme, postToFrames]);

  // Listen for user clicks inside the sandboxed prototype that change #hash screen
  React.useEffect(() => {
    function handleMessage(ev: MessageEvent) {
      const fromOurFrame =
        ev.source === iframeRef.current?.contentWindow ||
        ev.source === fullscreenIframeRef.current?.contentWindow;
      if (!fromOurFrame) return;
      const data = ev.data as { type?: string; screenId?: string } | null;
      if (data?.type === "sf-proto:screen-changed" && typeof data.screenId === "string" && data.screenId) {
        setActiveScreenId(data.screenId);
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const activeScreen = screens.find((s) => s.id === activeScreenId) ?? screens[0] ?? null;

  React.useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  async function patchPrototype(patch: { binding?: "flow" | "look"; status?: "draft" | "approved" }) {
    if (!prototype.id || !effectiveProjectId) return;
    setBusyAction(patch.status ? "status" : "binding");
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(effectiveProjectId)}/prototypes/${encodeURIComponent(prototype.id)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      const data = (await res.json().catch(() => null)) as {
        prototype?: SerializedPrototype;
        error?: string;
      } | null;
      if (!res.ok || !data?.prototype) {
        toast.error(data?.error || "Could not update prototype");
        return;
      }
      setLocalBinding(data.prototype.binding);
      setLocalStatus(data.prototype.status);
      onUpdated?.(data.prototype);
      if (patch.status === "approved") {
        toast.success(
          `Approved prototype (${data.prototype.binding === "look" ? "Look + Flow locked" : "Flow locked"})`,
        );
      } else if (patch.binding) {
        toast.success(
          patch.binding === "look"
            ? "Locked visual look + flow for Factory build"
            : "Set binding to flow only (elements, copy & states)",
        );
      }
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDelete() {
    if (!prototype.id || !effectiveProjectId) return;
    setBusyAction("delete");
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(effectiveProjectId)}/prototypes/${encodeURIComponent(prototype.id)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        toast.error("Could not delete prototype");
        return;
      }
      toast.success(`Deleted prototype "${prototype.title}"`);
      onDeleted?.(prototype.id);
    } finally {
      setBusyAction(null);
    }
  }

  function handleDownload() {
    const blob = new Blob([prototype.htmlContent], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${prototype.slug || "prototype"}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function handleSendSteer(msg: string) {
    if (!onSteer || !msg.trim()) return;
    setBusyAction("steer");
    try {
      await onSteer(msg.trim());
      setFeedbackText("");
      setFeedbackOpen(false);
    } finally {
      setBusyAction(null);
    }
  }

  const rawHref = prototype.id
    ? `/api/prototypes/${encodeURIComponent(prototype.id)}/raw?theme=${protoTheme}${activeScreenId ? `&screen=${encodeURIComponent(activeScreenId)}` : ""}`
    : null;

  function renderStage(targetRef: React.RefObject<HTMLIFrameElement | null>) {
    if (viewMode === "code") {
      return (
        <ScrollArea className="h-full w-full bg-background">
          <pre className="p-4 font-mono text-xs leading-relaxed text-foreground/90 whitespace-pre-wrap break-all">
            {prototype.htmlContent}
          </pre>
        </ScrollArea>
      );
    }

    const fixedW = viewportWidthPx(viewport);

    return (
      <div
        className={cn(
          "relative flex h-full w-full justify-center overflow-auto",
          fixedW ? "bg-muted/40 p-4" : "bg-background",
        )}
      >
        <div
          style={fixedW ? { width: `${fixedW}px`, minWidth: `${fixedW}px` } : undefined}
          className={cn(
            "relative flex h-full flex-col overflow-hidden bg-background transition-all",
            fixedW
              ? "rounded-lg border border-border shadow-md"
              : "w-full",
            viewport === "mobile" && "max-h-[820px] min-h-[580px] rounded-[24px] border-4 border-foreground/15",
          )}
        >
          <iframe
            ref={targetRef}
            title={prototype.title}
            srcDoc={sandboxDoc}
            sandbox="allow-scripts allow-forms allow-modals"
            onLoad={() => {
              postToFrames({ type: "sf-proto:set-theme", theme: protoTheme });
              if (activeScreenId) {
                postToFrames({ type: "sf-proto:set-screen", screenId: activeScreenId });
              }
            }}
            className="h-full min-h-[380px] w-full flex-1 border-0 bg-white dark:bg-zinc-950"
          />
        </div>
      </div>
    );
  }

  const showRail = screens.length > 1 && (!compact || fullscreen);

  function renderHeader(inFullscreen: boolean) {
    return (
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-card px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{prototype.title}</span>
          {(!compact || inFullscreen) && (
            <Badge variant="outline" className="shrink-0">
              {kindLabel(prototype.kind)}
            </Badge>
          )}
          {prototype.version ? (
            <span className="shrink-0 font-mono text-2xs text-muted-foreground">v{prototype.version}</span>
          ) : null}
          {localStatus === "approved" && (
            <Badge variant="secondary" className="shrink-0 gap-1">
              <CheckCircle2Icon className="size-3" />
              Approved
            </Badge>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {/* Compact panes pick the screen from a menu instead of a rail */}
          {compact && !inFullscreen && screens.length > 1 && (
            <Select value={activeScreen?.id ?? ""} onValueChange={(v) => v && setActiveScreenId(v)}>
              <SelectTrigger size="sm" className="h-7 w-44 text-xs" aria-label="Screen">
                <SelectValue>{activeScreen?.title ?? "Screen"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {screens.map((sc) => (
                    <SelectItem key={sc.id} value={sc.id}>
                      {sc.title}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          )}
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          {/* Viewport Switcher */}
          <div className="flex items-center rounded-md border bg-muted/40 p-0.5">
            {(
              [
                { id: "fluid", label: "Fit", icon: LayersIcon },
                { id: "desktop", label: "1440", icon: MonitorIcon },
                { id: "tablet", label: "768", icon: TabletIcon },
                { id: "mobile", label: "390", icon: SmartphoneIcon },
              ] as const
            ).map((vp) => {
              const Icon = vp.icon;
              return (
                <Button
                  key={vp.id}
                  type="button"
                  size="xs"
                  variant={viewport === vp.id ? "secondary" : "ghost"}
                  title={`Viewport: ${vp.label}`}
                  onClick={() => setViewport(vp.id)}
                  className="h-6 px-1.5 text-xs"
                >
                  <Icon className="size-3" />
                  {(!compact || inFullscreen) && <span className="ml-1 hidden sm:inline">{vp.label}</span>}
                </Button>
              );
            })}
          </div>

          {/* Light / Dark preview theme toggle */}
          <Button
            type="button"
            size="icon-xs"
            variant="outline"
            title={`Switch prototype theme (currently ${protoTheme})`}
            onClick={() => setProtoTheme((t) => (t === "light" ? "dark" : "light"))}
          >
            {protoTheme === "dark" ? <MoonIcon /> : <SunIcon />}
          </Button>

          {/* Preview vs HTML Source */}
          <Button
            type="button"
            size="icon-xs"
            variant={viewMode === "code" ? "secondary" : "outline"}
            title={viewMode === "code" ? "Show interactive preview" : "Inspect HTML source"}
            onClick={() => setViewMode((m) => (m === "preview" ? "code" : "preview"))}
          >
            {viewMode === "code" ? <EyeIcon /> : <Code2Icon />}
          </Button>

          {rawHref && (
            <Button
              type="button"
              size="icon-xs"
              variant="outline"
              title="Open sandboxed prototype in new tab"
              nativeButton={false}
              render={<a href={rawHref} target="_blank" rel="noreferrer" />}
            >
              <ExternalLinkIcon />
            </Button>
          )}

          <Button
            type="button"
            size="icon-xs"
            variant="outline"
            title="Download HTML"
            onClick={handleDownload}
          >
            <DownloadIcon />
          </Button>

          <Button
            type="button"
            size="icon-xs"
            variant="outline"
            title={inFullscreen ? "Exit fullscreen (Esc)" : "Fullscreen preview"}
            onClick={() => setFullscreen((v) => !v)}
          >
            {inFullscreen ? <Minimize2Icon /> : <Maximize2Icon />}
          </Button>

          {canWrite && prototype.id && onDeleted && (
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              title="Delete prototype"
              disabled={busyAction !== null}
              onClick={() => void handleDelete()}
            >
              <Trash2Icon className="text-muted-foreground hover:text-destructive" />
            </Button>
          )}
        </div>
        </div>
      </div>
    );
  }

  function renderScreenRail() {
    return (
      <nav aria-label="Screens" className="flex w-56 shrink-0 flex-col border-r bg-muted/20">
        <div className="flex items-center justify-between px-3 pt-3 pb-2">
          <span className="text-xs font-medium text-muted-foreground">Screens</span>
          <span className="font-mono text-2xs text-muted-foreground tabular-nums">{screens.length}</span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
          {screens.map((sc) => {
            const active = sc.id === activeScreen?.id;
            return (
              <button
                key={sc.id}
                type="button"
                onClick={() => setActiveScreenId(sc.id)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "flex w-full flex-col gap-0.5 rounded-md px-2.5 py-1.5 text-left transition-colors",
                  active ? "bg-background shadow-xs ring-1 ring-border" : "hover:bg-muted/60",
                )}
              >
                <span className={cn("truncate text-xs", active ? "font-medium text-foreground" : "text-foreground/85")}>
                  {sc.title}
                </span>
                <span className="truncate font-mono text-2xs text-muted-foreground">
                  #{sc.id}
                  {sc.criteria.length > 0 ? ` · ${sc.criteria.length} criteria` : ""}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    );
  }

  function renderScreenInfo() {
    if (!activeScreen || (!activeScreen.shows && activeScreen.criteria.length === 0)) return null;
    const shown = activeScreen.criteria.slice(0, 6);
    const more = activeScreen.criteria.length - shown.length;
    return (
      <div className="flex shrink-0 items-center gap-2 border-b bg-muted/20 px-3 py-1.5 text-xs text-muted-foreground">
        <span className="shrink-0 font-mono text-2xs text-primary">#{activeScreen.id}</span>
        <span className="min-w-0 flex-1 truncate" title={activeScreen.shows}>
          {activeScreen.shows}
        </span>
        {shown.length > 0 && (
          <span
            className="flex shrink-0 items-center gap-1 font-mono text-2xs"
            title={activeScreen.criteria.join(", ")}
          >
            {shown.map((c) => (
              <span key={c} className="rounded bg-muted px-1 py-px">
                {c}
              </span>
            ))}
            {more > 0 && <span>+{more}</span>}
          </span>
        )}
      </div>
    );
  }

  function renderFooter() {
    const hasNotShown = prototype.notShown.length > 0;
    if (!hasNotShown && !canWrite && !onSteer) return null;
    return (
      <div className="flex shrink-0 flex-col border-t bg-card">
        {notShownOpen && hasNotShown && (
          <div className="flex max-h-40 flex-wrap gap-x-3 gap-y-1 overflow-y-auto border-b bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            {prototype.notShown.map((ns) => (
              <span key={ns.criterion}>
                <strong className="font-mono text-foreground/85">{ns.criterion}</strong> {ns.why}
              </span>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <div className="flex flex-wrap items-center gap-3">
            {hasNotShown && (
              <button
                type="button"
                onClick={() => setNotShownOpen((v) => !v)}
                aria-expanded={notShownOpen}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <ChevronRightIcon className={cn("size-3 transition-transform", notShownOpen && "rotate-90")} />
                Not drawn ({prototype.notShown.length})
              </button>
            )}
            {(canWrite || onSteer) && (
            <>
            {/* Binding Switch: Flow vs Look + Flow */}
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-2xs uppercase tracking-wider text-muted-foreground">
                Binding:
              </span>
              <div className="flex items-center rounded-md border bg-muted/40 p-0.5">
                <Button
                  type="button"
                  size="xs"
                  variant={localBinding === "flow" ? "secondary" : "ghost"}
                  disabled={!canWrite || !prototype.id || busyAction !== null}
                  onClick={() => void patchPrototype({ binding: "flow" })}
                  className="h-6 px-2 text-xs"
                  title="Factory builds matching elements, order, copy & states using product styling"
                >
                  <WorkflowIcon className="mr-1 size-3" />
                  Flow
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant={localBinding === "look" ? "secondary" : "ghost"}
                  disabled={!canWrite || !prototype.id || busyAction !== null}
                  onClick={() => void patchPrototype({ binding: "look" })}
                  className="h-6 px-2 text-xs"
                  title="Factory must match exact layout, colours, typography, copy & states"
                >
                  <PaletteIcon className="mr-1 size-3" />
                  Look + Flow
                </Button>
              </div>
            </div>

            </>
            )}
          </div>
          {(canWrite || onSteer) && (
            <>
            {/* Action buttons */}
            <div className="flex flex-wrap items-center gap-1.5">
              {onSteer && (
                <>
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    disabled={busyAction !== null}
                    onClick={() => setFeedbackOpen((v) => !v)}
                  >
                    <MessageSquareIcon data-icon="inline-start" />
                    Request changes
                  </Button>
                  {prototype.kind === "first_screen" && (
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      disabled={busyAction !== null}
                      onClick={() =>
                        void handleSendSteer(
                          `Try another visual direction for "${prototype.title}" — keep the same user flow but give me a noticeably different aesthetic direction.`,
                        )
                      }
                    >
                      <RefreshCwIcon data-icon="inline-start" />
                      Another direction
                    </Button>
                  )}
                </>
              )}

              {canWrite && prototype.id && localStatus !== "approved" && (
                <Button
                  type="button"
                  size="xs"
                  variant={onSteer && prototype.kind === "first_screen" ? "default" : "secondary"}
                  disabled={busyAction !== null}
                  onClick={async () => {
                    await patchPrototype({ status: "approved" });
                    if (onSteer && prototype.kind === "first_screen") {
                      await handleSendSteer(
                        `Approved the first-screen direction for "${prototype.title}" (binding: ${localBinding}). Go ahead and draw the remaining screens & finalize the tickets.`,
                      );
                    }
                  }}
                >
                  {busyAction === "status" ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <CheckIcon data-icon="inline-start" />
                  )}
                  {onSteer && prototype.kind === "first_screen"
                    ? "Approve & Go On"
                    : "Approve Prototype"}
                </Button>
              )}
            </div>
            </>
          )}
        </div>
          {feedbackOpen && onSteer && (
            <div className="flex items-center gap-2 px-3 pb-2">
              <Input
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && feedbackText.trim()) {
                    e.preventDefault();
                    const screenNote = activeScreen ? ` (screen #${activeScreen.id})` : "";
                    void handleSendSteer(
                      `Prototype feedback on "${prototype.title}"${screenNote}: ${feedbackText.trim()}`,
                    );
                  }
                }}
                placeholder={
                  activeScreen
                    ? `Describe changes for #${activeScreen.id}...`
                    : "Describe changes to this prototype..."
                }
                className="h-8 text-xs"
              />
              <Button
                type="button"
                size="xs"
                disabled={busyAction !== null || !feedbackText.trim()}
                onClick={() => {
                  const screenNote = activeScreen ? ` (screen #${activeScreen.id})` : "";
                  void handleSendSteer(
                    `Prototype feedback on "${prototype.title}"${screenNote}: ${feedbackText.trim()}`,
                  );
                }}
              >
                Send
              </Button>
            </div>
          )}
      </div>
    );
  }

  function renderStudio(ref: React.RefObject<HTMLIFrameElement | null>, inFullscreen: boolean) {
    return (
      <>
        {renderHeader(inFullscreen)}
        {renderScreenInfo()}
        <div className="flex min-h-0 flex-1">
          {showRail && renderScreenRail()}
          <div className="min-h-80 min-w-0 flex-1 overflow-hidden">{renderStage(ref)}</div>
        </div>
        {renderFooter()}
      </>
    );
  }

  return (
    <>
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border bg-card">
        {renderStudio(iframeRef, false)}
      </div>
      {/* Fullscreen: a full-viewport layer with the same studio, Esc closes it */}
      {fullscreen &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${prototype.title}, fullscreen`}
            className="fixed inset-0 z-50 flex flex-col bg-background"
          >
            {renderStudio(fullscreenIframeRef, true)}
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * Compact clickable Prototype Card rendered inline in BA / Clarify chat transcripts.
 */
export function PrototypeChatCard({
  prototype,
  resolvedDbPrototype,
  isSelected,
  onOpen,
}: {
  prototype: ParsedChatPrototype;
  resolvedDbPrototype?: SerializedPrototype | null;
  isSelected?: boolean;
  onOpen: (vm: PrototypeViewModel) => void;
}) {
  const vm: PrototypeViewModel = React.useMemo(() => {
    if (resolvedDbPrototype) return toPrototypeViewModel(resolvedDbPrototype);
    return {
      slug: prototype.slug,
      title: prototype.title,
      kind: prototype.kind,
      binding: prototype.binding,
      status: "draft",
      issueKeys: prototype.issueKeys,
      htmlContent: prototype.htmlContent || "",
      screens: prototype.screens,
      notShown: prototype.notShown,
      localPath: prototype.htmlPath || null,
    };
  }, [prototype, resolvedDbPrototype]);

  const hasHtml = vm.htmlContent.trim().length > 0;

  return (
    <div
      className={cn(
        "my-2 flex flex-col overflow-hidden rounded-xl border bg-card transition-colors",
        isSelected && "border-primary/50 ring-1 ring-primary/20",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <SparklesIcon className="size-3.5 shrink-0 text-primary" />
          <span className="truncate text-xs font-semibold text-foreground">{vm.title}</span>
          <Badge variant="outline" className="text-2xs">
            {kindLabel(vm.kind)}
          </Badge>
          <Badge variant="secondary" className="text-2xs">
            {vm.binding === "look" ? "Look + Flow" : "Flow"}
          </Badge>
          {vm.status === "approved" && (
            <Badge variant="secondary" className="text-2xs text-emerald-700 dark:text-emerald-400">
              Approved
            </Badge>
          )}
        </div>
        <Button
          type="button"
          size="xs"
          variant={isSelected ? "secondary" : "default"}
          disabled={!hasHtml}
          onClick={() => hasHtml && onOpen(vm)}
        >
          <EyeIcon data-icon="inline-start" />
          {hasHtml ? (isSelected ? "Viewing Preview" : "Open Interactive Preview") : "Uploading HTML…"}
        </Button>
      </div>

      <div className="flex flex-col gap-2 px-4 py-3 text-xs">
        <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
          {vm.issueKeys.length > 0 && (
            <>
              <span>Tickets:</span>
              {vm.issueKeys.map((k) => (
                <Badge key={k} variant="outline" className="font-mono text-2xs">
                  {k}
                </Badge>
              ))}
              <span>·</span>
            </>
          )}
          <span>{vm.screens.length || 1} interactive {vm.screens.length === 1 ? "state" : "states"}</span>
          {vm.localPath && (
            <>
              <span>·</span>
              <code className="truncate font-mono text-xs">{vm.localPath}</code>
            </>
          )}
        </div>

        {vm.screens.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {vm.screens.slice(0, 8).map((sc) => (
              <button
                key={sc.id}
                type="button"
                disabled={!hasHtml}
                onClick={() => hasHtml && onOpen(vm)}
                className="inline-flex items-center gap-1 rounded-md border bg-muted/35 px-2 py-0.5 text-xs text-foreground/90 transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:opacity-50"
              >
                <span className="font-mono text-2xs text-primary">#{sc.id}</span>
                <span>{sc.title}</span>
                {sc.criteria.length > 0 && (
                  <span className="font-mono text-2xs text-muted-foreground">
                    ({sc.criteria.join(",")})
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Dedicated Prototypes Tab inside Project Workspace:
 * browse all BA-generated prototypes & whole-flow demos, toggle Flow/Look binding,
 * approve them, or import an existing HTML prototype ("I have one" flow).
 */
export function ProjectPrototypesWorkspace({
  projectId,
  prototypes,
  canWrite,
  onRefresh,
}: {
  projectId: string;
  prototypes: SerializedPrototype[];
  canWrite: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [selectedId, setSelectedId] = React.useState<string>(prototypes[0]?.id ?? "");
  const [importOpen, setImportOpen] = React.useState(false);
  const [importTitle, setImportTitle] = React.useState("");
  const [importIssues, setImportIssues] = React.useState("");
  const [importBinding, setImportBinding] = React.useState<"flow" | "look">("look");
  const [importHtml, setImportHtml] = React.useState("");
  const [importing, setImporting] = React.useState(false);

  const selected = prototypes.find((p) => p.id === selectedId) ?? prototypes[0] ?? null;
  const baHref = `/sessions?project=${encodeURIComponent(projectId)}`;

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setImportHtml(text);
    if (!importTitle.trim()) {
      setImportTitle(file.name.replace(/\.html?$/i, "").replace(/[-_]+/g, " "));
    }
  }

  async function handleImportSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!importHtml.trim()) {
      toast.error("Upload or paste an HTML prototype first");
      return;
    }
    setImporting(true);
    try {
      const issueKeys = importIssues
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/prototypes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: importTitle.trim() || "Imported Prototype",
          kind: "existing",
          binding: importBinding,
          issueKeys,
          htmlContent: importHtml,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        prototype?: SerializedPrototype;
        error?: string;
      } | null;
      if (!res.ok || !data?.prototype) {
        toast.error(data?.error || "Could not import prototype");
        return;
      }
      toast.success(`Imported prototype "${data.prototype.title}"`);
      setImportOpen(false);
      setImportTitle("");
      setImportIssues("");
      setImportHtml("");
      setSelectedId(data.prototype.id);
      await onRefresh();
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            Clickable HTML prototypes produced during <code className="font-mono">/new-ba</code>{" "}
            or imported by your team. Approved prototypes guide every{" "}
            <code className="font-mono">/factory</code> UI build &amp; QC run.
          </span>
        </div>
        {canWrite && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
              <UploadIcon data-icon="inline-start" />
              Import HTML
            </Button>
            <Button size="sm" nativeButton={false} render={<Link href={baHref} />}>
              <SparklesIcon data-icon="inline-start" />
              New BA + Prototype
            </Button>
          </div>
        )}
      </div>

      {prototypes.length === 0 ? (
        <Empty className="border py-14">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SparklesIcon />
            </EmptyMedia>
            <EmptyTitle>No interactive prototypes yet</EmptyTitle>
            <EmptyDescription>
              Start a <code className="font-mono">/new-ba</code> session to design clickable
              multi-state HTML prototypes (first screen, per-ticket states, and whole-flow demos)
              before Factory writes any code — or import your own HTML prototype.
            </EmptyDescription>
          </EmptyHeader>
          {canWrite && (
            <div className="flex items-center gap-2">
              <Button size="sm" nativeButton={false} render={<Link href={baHref} />}>
                <SparklesIcon data-icon="inline-start" />
                Start BA &amp; Prototype
              </Button>
              <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
                <UploadIcon data-icon="inline-start" />
                Import HTML
              </Button>
            </div>
          )}
        </Empty>
      ) : (
        <div className="flex min-h-[600px] flex-col overflow-hidden rounded-lg border bg-card md:h-[calc(100vh-250px)] md:flex-row">
          {/* Left Prototype List */}
          <aside className="flex w-full shrink-0 flex-col border-b bg-sidebar text-sidebar-foreground md:w-72 md:border-r md:border-b-0">
            <div className="border-b border-sidebar-border px-3 py-2.5 text-xs font-medium text-muted-foreground">
              Prototypes ({prototypes.length})
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <div className="flex flex-col gap-1 p-2">
                {prototypes.map((proto) => {
                  const active = proto.id === selected?.id;
                  return (
                    <button
                      key={proto.id}
                      type="button"
                      onClick={() => setSelectedId(proto.id)}
                      className={cn(
                        "flex w-full flex-col gap-1.5 rounded-md border p-2.5 text-left text-xs transition-colors",
                        active
                          ? "border-primary/40 bg-sidebar-accent text-sidebar-accent-foreground"
                          : "border-transparent hover:bg-sidebar-accent/60",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">{proto.title}</span>
                        <span className="shrink-0 font-mono text-2xs text-muted-foreground">
                          v{proto.version}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge variant="outline" className="h-4 px-1.5 text-2xs">
                          {kindLabel(proto.kind)}
                        </Badge>
                        <Badge variant="secondary" className="h-4 px-1.5 text-2xs">
                          {proto.binding === "look" ? "Look" : "Flow"}
                        </Badge>
                        {proto.status === "approved" && (
                          <CheckCircle2Icon className="size-3 text-emerald-600 dark:text-emerald-400" />
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2 font-mono text-2xs text-muted-foreground">
                        <span className="truncate">
                          {proto.issueKeys.length > 0 ? proto.issueKeys.join(", ") : proto.slug}
                        </span>
                        <span>{proto.manifest.screens.length || 1} screens</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </aside>

          {/* Right Interactive Studio */}
          <div className="min-h-0 min-w-0 flex-1 p-2">
            {selected && (
              <PrototypeStudio
                key={selected.id}
                prototype={toPrototypeViewModel(selected)}
                projectId={projectId}
                canWrite={canWrite}
                onUpdated={() => void onRefresh()}
                onDeleted={() => {
                  setSelectedId("");
                  void onRefresh();
                }}
              />
            )}
          </div>
        </div>
      )}

      {/* Import HTML Prototype Dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Import HTML Prototype</DialogTitle>
            <DialogDescription>
              Upload a self-contained HTML prototype (&quot;I have one&quot;) so BA criteria and
              Factory builds reference it directly.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => void handleImportSubmit(e)} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="proto-title" className="text-xs">Title</Label>
                <Input
                  id="proto-title"
                  value={importTitle}
                  onChange={(e) => setImportTitle(e.target.value)}
                  placeholder="e.g. Orders Export Flow"
                  className="h-8 text-xs"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="proto-issues" className="text-xs">Linked Tickets (optional)</Label>
                <Input
                  id="proto-issues"
                  value={importIssues}
                  onChange={(e) => setImportIssues(e.target.value)}
                  placeholder="I1, I2"
                  className="h-8 font-mono text-xs"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Label className="text-xs">Binding:</Label>
              <Button
                type="button"
                size="xs"
                variant={importBinding === "flow" ? "secondary" : "outline"}
                onClick={() => setImportBinding("flow")}
              >
                Flow only
              </Button>
              <Button
                type="button"
                size="xs"
                variant={importBinding === "look" ? "secondary" : "outline"}
                onClick={() => setImportBinding("look")}
              >
                Look + Flow
              </Button>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="proto-file" className="text-xs">Upload .html file or paste HTML</Label>
              <Input
                id="proto-file"
                type="file"
                accept=".html,.htm,text/html"
                onChange={(e) => void handleFileUpload(e)}
                className="h-8 text-xs"
              />
              <Textarea
                value={importHtml}
                onChange={(e) => setImportHtml(e.target.value)}
                rows={7}
                placeholder="<!doctype html>..."
                className="font-mono text-xs"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setImportOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={importing || !importHtml.trim()}>
                {importing && <Spinner data-icon="inline-start" />}
                Import Prototype
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
