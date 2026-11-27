"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  FACTORY_ICON_PATH,
  FACTORY_ICON_VIEWBOX,
} from "@/components/factory/brand-paths";

/** Exact 4-petal turbine app emblem from uploaded reference #4 */
export function FactoryMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox={FACTORY_ICON_VIEWBOX}
      fill="currentColor"
      aria-hidden="true"
      className={cn("size-5 shrink-0", className)}
    >
      <path fillRule="evenodd" d={FACTORY_ICON_PATH} />
    </svg>
  );
}

/** Crisp geometric text wordmark (Space Grotesk) paired with the 4-petal turbine mark */
export function FactoryWordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center font-brand text-[17px] leading-none font-bold tracking-[-0.035em] select-none",
        className,
      )}
    >
      Factory
    </span>
  );
}

export function MeterBars({
  level,
  max = 4,
  activeTone = "primary",
}: {
  level: number;
  max?: number;
  activeTone?: "primary" | "muted";
}) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden="true">
      {Array.from({ length: max }).map((_, idx) => {
        const filled = idx < level;
        return (
          <span
            key={idx}
            className={cn(
              "inline-block h-2.5 w-[3px] rounded-[1px]",
              filled
                ? activeTone === "primary"
                  ? "bg-primary"
                  : "bg-foreground"
                : "bg-muted-foreground/30",
            )}
          />
        );
      })}
    </span>
  );
}

export function StatusDot({ status }: { status: string }) {
  const s = status.toLowerCase();
  const color =
    s === "waiting_on_you" || s === "awaiting_input" || s === "needs_human"
      ? "bg-primary animate-pulse"
      : s === "working" || s === "running" || s === "in_progress" || s === "queued"
        ? "bg-warning animate-pulse"
        : s === "passed" || s === "completed" || s === "online" || s === "passing" || s === "merged"
          ? "bg-success"
          : s === "failed" || s === "blocked" || s === "stalled" || s === "failing" || s === "conflict"
            ? "bg-destructive"
            : "bg-muted-foreground/40";
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", color)} />;
}

/** 2x2 four-dot chasing loader for active runs in the sidebar */
export function FourDotLoader({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      className={cn("size-3 shrink-0 text-foreground/90", className)}
    >
      <circle
        cx="3.2"
        cy="3.2"
        r="1.85"
        fill="currentColor"
        className="sf-loader-dot sf-loader-dot-1"
      />
      <circle
        cx="8.8"
        cy="3.2"
        r="1.85"
        fill="currentColor"
        className="sf-loader-dot sf-loader-dot-2"
      />
      <circle
        cx="8.8"
        cy="8.8"
        r="1.85"
        fill="currentColor"
        className="sf-loader-dot sf-loader-dot-3"
      />
      <circle
        cx="3.2"
        cy="8.8"
        r="1.85"
        fill="currentColor"
        className="sf-loader-dot sf-loader-dot-4"
      />
    </svg>
  );
}

export type SidebarIndicatorKind = "loading" | "failed" | "done" | null;

export function getSidebarIndicatorKind(
  status: string,
  unread = false,
): SidebarIndicatorKind {
  const s = status.toLowerCase();
  if (s === "working" || s === "running" || s === "in_progress" || s === "queued") {
    return "loading";
  }
  if (
    s === "failed" ||
    s === "blocked" ||
    s === "stalled" ||
    s === "failing" ||
    s === "conflict"
  ) {
    return "failed";
  }
  if (
    s === "waiting_on_you" ||
    s === "awaiting_input" ||
    s === "needs_human" ||
    ((s === "passed" || s === "completed" || s === "merged") && unread)
  ) {
    return "done";
  }
  return null;
}

/** Right-aligned status indicator for sidebar runs & subagents */
export function SidebarStatusIndicator({
  status,
  unread = false,
  className,
}: {
  status: string;
  unread?: boolean;
  className?: string;
}) {
  const kind = getSidebarIndicatorKind(status, unread);
  if (!kind) return null;

  if (kind === "loading") {
    return (
      <span
        role="status"
        aria-label="Running"
        className={cn("inline-flex size-4 shrink-0 items-center justify-center", className)}
      >
        <FourDotLoader />
      </span>
    );
  }

  if (kind === "failed") {
    return (
      <span
        aria-label="Failed"
        className={cn(
          "inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-red-500/20",
          className,
        )}
      >
        <span className="size-[6.5px] rounded-full bg-red-500" />
      </span>
    );
  }

  return (
    <span
      aria-label="Finished"
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-[#3b82f6]/20",
        className,
      )}
    >
      <span className="size-[6.5px] rounded-full bg-[#3b82f6]" />
    </span>
  );
}

export type AgentStatusKind = "running" | "done" | "failed" | "waiting" | "idle";

/** What a subagent is doing now, from its RunAgent status: every state is shown, done included. */
export function getAgentStatusKind(status: string): AgentStatusKind {
  const s = status.toLowerCase();
  if (s === "working" || s === "running" || s === "in_progress" || s === "queued") return "running";
  if (s === "passed" || s === "completed" || s === "done" || s === "merged") return "done";
  if (s === "failed" || s === "blocked" || s === "stalled") return "failed";
  if (s === "waiting_on_you" || s === "awaiting_input" || s === "needs_human") return "waiting";
  return "idle";
}

const AGENT_STATUS_LABEL: Record<AgentStatusKind, string> = {
  running: "Running",
  done: "Done",
  failed: "Failed",
  waiting: "Waiting on you",
  idle: "Idle",
};

/** Sidebar status of one subagent: spinner while running, check when done, red when failed. */
export function AgentStatusIndicator({ status, className }: { status: string; className?: string }) {
  const kind = getAgentStatusKind(status);
  const label = AGENT_STATUS_LABEL[kind];
  const box = cn("inline-flex size-4 shrink-0 items-center justify-center", className);
  if (kind === "running") {
    return (
      <span role="status" aria-label={label} title={label} className={box}>
        <FourDotLoader />
      </span>
    );
  }
  if (kind === "done") {
    return (
      <span aria-label={label} title={label} className={cn(box, "text-emerald-600 dark:text-emerald-400")}>
        <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <path d="M2.5 6.2l2.3 2.3 4.7-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  if (kind === "failed") {
    return (
      <span aria-label={label} title={label} className={cn(box, "rounded-full bg-red-500/20")}>
        <span className="size-[6.5px] rounded-full bg-red-500" />
      </span>
    );
  }
  if (kind === "waiting") {
    return (
      <span aria-label={label} title={label} className={cn(box, "rounded-full bg-[#3b82f6]/20")}>
        <span className="size-[6.5px] rounded-full bg-[#3b82f6]" />
      </span>
    );
  }
  return (
    <span aria-label={label} title={label} className={box}>
      <span className="size-[6px] rounded-full bg-muted-foreground/40" />
    </span>
  );
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 45) return "now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
  return `${Math.floor(diffSec / 86400)}d`;
}

export function formatClockDuration(ms: number | null | undefined): string {
  if (!ms || ms < 0) return "00:00:00";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

export function formatCompactTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

export function formatUsd(usd: number): string {
  if (usd <= 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}
