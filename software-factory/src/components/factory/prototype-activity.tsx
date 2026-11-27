"use client";

import * as React from "react";
import { ArrowUpRightIcon, Columns3Icon, SparklesIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { PrototypeActivity } from "@/lib/prototype-capture";
import { buildSandboxedPrototypeDocument, type SerializedPrototype } from "@/lib/prototypes";
import { cn } from "@/lib/utils";

/** A live, non-interactive miniature of an HTML drawing. */
function PrototypeThumbnail({ html, title, className }: { html: string; title: string; className?: string }) {
  const doc = React.useMemo(() => buildSandboxedPrototypeDocument(html), [html]);
  return (
    <div className={cn("relative overflow-hidden rounded-md border bg-background", className)}>
      {/* 1440×900 page drawn at 1/6 scale */}
      <iframe
        title={`${title} preview`}
        srcDoc={doc}
        sandbox="allow-scripts"
        tabIndex={-1}
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-0 h-[900px] w-[1440px] origin-top-left scale-[0.1667] border-0"
      />
    </div>
  );
}

/** The chat card under the steps where the BA drew a prototype or its design directions. */
export function PrototypeActivityCard({
  activity,
  prototypes,
  drawing,
  isOpen,
  onOpen,
}: {
  activity: PrototypeActivity;
  prototypes: SerializedPrototype[];
  drawing: boolean;
  isOpen: boolean;
  onOpen: () => void;
}) {
  const rows =
    activity.type === "prototype"
      ? prototypes.filter((p) => p.slug === activity.slug)
      : activity.slugs
          .map((slug) => prototypes.find((p) => p.slug === slug))
          .filter((p): p is SerializedPrototype => Boolean(p));
  const ready = rows.length > 0;
  const heading =
    activity.type === "prototype"
      ? drawing
        ? "Drawing the prototype"
        : rows[0]?.title || activity.title
      : drawing
        ? "Drawing design directions"
        : `${rows.length} design direction${rows.length === 1 ? "" : "s"} to choose from`;
  const detail =
    activity.type === "prototype"
      ? rows[0]
        ? `Version ${rows[0].version} · ${rows[0].manifest.screens.length || 1} screen${rows[0].manifest.screens.length === 1 ? "" : "s"}`
        : "Waiting for the first draft"
      : rows.map((p) => p.title.replace(/^Direction\s+/i, "")).join(" · ") || "Waiting for the first draft";

  return (
    <button
      type="button"
      disabled={!ready}
      onClick={onOpen}
      className={cn(
        "group/proto ml-9 flex max-w-2xl items-center gap-3.5 rounded-lg border bg-card p-2.5 pr-3.5 text-left transition-colors",
        ready && "hover:border-primary/40 hover:bg-muted/40",
        isOpen && "border-primary/50 ring-1 ring-primary/20",
      )}
    >
      <div className="flex shrink-0 gap-1">
        {ready ? (
          rows.slice(0, 3).map((p) => (
            <PrototypeThumbnail
              key={p.id}
              html={p.htmlContent}
              title={p.title}
              className={activity.type === "prototype" ? "h-[90px] w-[144px]" : "h-[50px] w-20"}
            />
          ))
        ) : (
          <div className="flex h-[60px] w-24 items-center justify-center rounded-md border border-dashed bg-muted/40">
            <SparklesIcon className="size-4 text-muted-foreground" />
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          {drawing ? (
            <Spinner className="size-3.5 text-primary" />
          ) : (
            <SparklesIcon className="size-3.5 shrink-0 text-primary" />
          )}
          <span className="line-clamp-2">{heading}</span>
        </span>
        <span className="truncate text-xs text-muted-foreground">{detail}</span>
      </div>

      {ready && (
        <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground transition-colors group-hover/proto:text-foreground">
          {activity.type === "prototype" ? "Open" : "Compare"}
          <ArrowUpRightIcon className="size-3.5" />
        </span>
      )}
    </button>
  );
}

/** Right pane: every design direction side by side, each opening in the Prototype Studio. */
export function DirectionsCompare({
  directions,
  onOpen,
  onClose,
}: {
  directions: SerializedPrototype[];
  onOpen: (p: SerializedPrototype) => void;
  onClose: () => void;
}) {
  return (
    <div className="flex h-full flex-col border-l bg-sidebar/20">
      <div className="flex items-center justify-between gap-2 border-b bg-card px-3 py-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-foreground">
          <Columns3Icon className="size-3.5 shrink-0 text-primary" />
          <span className="truncate">Design directions</span>
        </span>
        <Button type="button" variant="ghost" size="icon-xs" title="Close" onClick={onClose}>
          <XIcon />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {directions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No direction has been drawn yet.</p>
        ) : (
          directions.map((p) => (
            <div key={p.id} className="flex flex-col overflow-hidden rounded-lg border bg-card">
              <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                <span className="truncate text-sm font-medium text-foreground">{p.title}</span>
                <Button type="button" size="xs" variant="outline" onClick={() => onOpen(p)}>
                  Open
                  <ArrowUpRightIcon data-icon="inline-end" />
                </Button>
              </div>
              <DirectionFrame html={p.htmlContent} title={p.title} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/** One direction at desktop width, scaled to the pane and still clickable. */
function DirectionFrame({ html, title }: { html: string; title: string }) {
  const doc = React.useMemo(() => buildSandboxedPrototypeDocument(html), [html]);
  const boxRef = React.useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = React.useState(0.4);

  React.useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(([entry]) => {
      setScale(entry.contentRect.width / 1440);
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={boxRef} className="relative w-full overflow-hidden" style={{ height: 900 * scale }}>
      <iframe
        title={title}
        srcDoc={doc}
        sandbox="allow-scripts allow-forms"
        className="absolute top-0 left-0 h-[900px] w-[1440px] origin-top-left border-0"
        style={{ transform: `scale(${scale})` }}
      />
    </div>
  );
}
