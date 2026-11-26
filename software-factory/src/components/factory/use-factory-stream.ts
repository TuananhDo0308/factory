"use client";

import * as React from "react";

/**
 * Subscribes to real-time SSE (`/api/stream`) on persistent servers (localhost / Docker)
 * AND automatically enables lightweight smart polling (3.5s while tab is visible)
 * when SSE fails/disconnects — making live updates work seamlessly on Vercel Serverless too.
 */
export function useFactoryStream(
  onEvent: (eventType: string, data: unknown) => void,
  options?: { runId?: string; enabled?: boolean; pollIntervalMs?: number },
) {
  const cbRef = React.useRef(onEvent);
  React.useEffect(() => {
    cbRef.current = onEvent;
  }, [onEvent]);

  const enabled = options?.enabled !== false;
  const runId = options?.runId;
  const pollIntervalMs = options?.pollIntervalMs ?? 3500;

  React.useEffect(() => {
    if (!enabled) return;
    const qs = runId ? `?runId=${encodeURIComponent(runId)}` : "";
    const es = new EventSource(`/api/stream${qs}`);
    let fallbackTimer: ReturnType<typeof setInterval> | null = null;

    const startFallbackPolling = () => {
      if (fallbackTimer) return;
      fallbackTimer = setInterval(() => {
        if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
        cbRef.current("poll:tick", { runId: runId ?? null });
      }, pollIntervalMs);
    };

    const stopFallbackPolling = () => {
      if (!fallbackTimer) return;
      clearInterval(fallbackTimer);
      fallbackTimer = null;
    };

    es.onopen = () => {
      stopFallbackPolling();
    };
    es.onerror = () => {
      startFallbackPolling();
    };

    const eventNames = [
      "run:updated",
      "agent:updated",
      "step:created",
      "interaction:updated",
      "artifact:created",
      "issue:updated",
      "project:updated",
      "pr:updated",
      "runner:updated",
      "lesson:updated",
      "command:created",
    ];

    const handlers = eventNames.map((name) => {
      const handler = (ev: MessageEvent) => {
        try {
          cbRef.current(name, JSON.parse(ev.data));
        } catch {
          cbRef.current(name, ev.data);
        }
      };
      es.addEventListener(name, handler);
      return [name, handler] as const;
    });

    return () => {
      stopFallbackPolling();
      for (const [name, handler] of handlers) {
        es.removeEventListener(name, handler);
      }
      es.close();
    };
  }, [enabled, runId, pollIntervalMs]);
}
