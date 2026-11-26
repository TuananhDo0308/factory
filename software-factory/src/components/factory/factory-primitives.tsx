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
