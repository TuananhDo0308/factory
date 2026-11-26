"use client";

import * as React from "react";
import type { LiveChunkEvent, RealtimeClientGrant } from "@/lib/realtime";

export type LiveStreamTransport = "ably" | "supabase" | "sse" | "polling";

/**
 * Subscribes to real-time SSE (`/api/stream`) on persistent servers (localhost / Docker)
 * AND automatically enables lightweight smart polling while tab is visible
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
      "live:chunk",
      "interaction:updated",
      "artifact:created",
      "prototype:updated",
      "context:updated",
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

function extractChunksFromPayload(raw: unknown): LiveChunkEvent[] {
  if (!raw) return [];
  let obj: unknown = raw;
  if (typeof obj === "string") {
    try {
      obj = JSON.parse(obj);
    } catch {
      return [];
    }
  }
  if (Array.isArray(obj)) return obj as LiveChunkEvent[];
  if (typeof obj === "object" && obj !== null) {
    const rec = obj as Record<string, unknown>;
    if (Array.isArray(rec.chunks)) return rec.chunks as LiveChunkEvent[];
    if (typeof rec.kind === "string") return [rec as unknown as LiveChunkEvent];
  }
  return [];
}

/**
 * Connects directly to Ably Realtime SSE or Supabase Realtime Broadcast WebSocket
 * (bypassing Vercel Serverless Functions entirely) for ~50–100ms token-by-token streaming.
 * Falls back cleanly to local zero-DB SSE (`useFactoryStream`) when no external broker is configured.
 */
export function useLiveRunStream(opts: {
  runId: string;
  active: boolean;
  onChunks: (chunks: LiveChunkEvent[]) => void;
  onCommit: () => void;
}): LiveStreamTransport {
  const { runId, active, onChunks, onCommit } = opts;
  const [transport, setTransport] = React.useState<LiveStreamTransport>("sse");
  const onChunksRef = React.useRef(onChunks);
  const onCommitRef = React.useRef(onCommit);
  React.useEffect(() => {
    onChunksRef.current = onChunks;
    onCommitRef.current = onCommit;
  }, [onChunks, onCommit]);

  React.useEffect(() => {
    if (!active || !runId) return;

    let cancelled = false;
    let es: EventSource | null = null;
    let ws: WebSocket | null = null;
    let hbTimer: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let refreshTokenTimer: ReturnType<typeof setTimeout> | null = null;
    let commitDebounce: ReturnType<typeof setTimeout> | null = null;

    const cleanupConnection = () => {
      if (hbTimer) {
        clearInterval(hbTimer);
        hbTimer = null;
      }
      if (refreshTokenTimer) {
        clearTimeout(refreshTokenTimer);
        refreshTokenTimer = null;
      }
      if (es) {
        es.close();
        es = null;
      }
      if (ws) {
        try {
          ws.close();
        } catch {
          // Ignore close errors.
        }
        ws = null;
      }
    };

    const dispatchChunks = (chunks: LiveChunkEvent[]) => {
      if (chunks.length === 0) return;
      const hasCommit = chunks.some((c) => c.kind === "step_committed");
      const nonCommit = chunks.filter((c) => c.kind !== "step_committed");
      if (nonCommit.length > 0) {
        onChunksRef.current(nonCommit);
      }
      if (hasCommit && !commitDebounce) {
        commitDebounce = setTimeout(() => {
          commitDebounce = null;
          onCommitRef.current();
        }, 120);
      }
    };

    const connect = async () => {
      if (cancelled) return;
      cleanupConnection();

      let grant: (RealtimeClientGrant & { ok?: boolean }) | null = null;
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(runId)}/live-token`, {
          cache: "no-store",
        });
        if (res.ok) {
          grant = (await res.json()) as RealtimeClientGrant & { ok?: boolean };
        }
      } catch {
        grant = null;
      }
      if (cancelled || !grant) return;

      if (grant.transport === "ably") {
        es = new EventSource(grant.sseUrl);
        es.onopen = () => {
          if (!cancelled) setTransport("ably");
        };
        es.addEventListener("message", (ev) => {
          try {
            const envelope = JSON.parse((ev as MessageEvent).data) as { data?: unknown };
            dispatchChunks(extractChunksFromPayload(envelope.data));
          } catch {
            // Ignore malformed frame.
          }
        });
        es.onerror = () => {
          if (!cancelled) setTransport("polling");
        };
        const refreshInMs = Math.max(60_000, grant.expiresAt - Date.now() - 120_000);
        refreshTokenTimer = setTimeout(() => {
          void connect();
        }, refreshInMs);
        return;
      }

      if (grant.transport === "supabase") {
        let refCounter = 1;
        const topic = `realtime:${grant.channel}`;
        ws = new WebSocket(grant.wsUrl);
        ws.onopen = () => {
          if (cancelled || !ws) return;
          setTransport("supabase");
          ws.send(
            JSON.stringify({
              topic,
              event: "phx_join",
              payload: { config: { broadcast: { self: false, ack: false } } },
              ref: String(refCounter++),
            }),
          );
          hbTimer = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  topic: "phoenix",
                  event: "heartbeat",
                  payload: {},
                  ref: String(refCounter++),
                }),
              );
            }
          }, 25_000);
        };
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(String(ev.data)) as {
              event?: string;
              payload?: { event?: string; payload?: unknown };
            };
            if (msg.event === "broadcast" && msg.payload?.event === "chunk") {
              dispatchChunks(extractChunksFromPayload(msg.payload.payload));
            }
          } catch {
            // Ignore malformed frame.
          }
        };
        ws.onclose = () => {
          if (hbTimer) {
            clearInterval(hbTimer);
            hbTimer = null;
          }
          if (!cancelled) {
            setTransport("polling");
            reconnectTimer = setTimeout(() => {
              void connect();
            }, 2500);
          }
        };
        return;
      }

      setTransport("sse");
    };

    void connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (commitDebounce) clearTimeout(commitDebounce);
      cleanupConnection();
    };
  }, [runId, active]);

  return active ? transport : "sse";
}
