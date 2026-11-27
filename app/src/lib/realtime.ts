export type LiveChunkEvent =
  | {
      kind: "text_delta";
      stepKey: string;
      agentKey: string;
      agentName?: string;
      delta: string;
      model?: string;
      ts: number;
    }
  | {
      kind: "thinking";
      stepKey: string;
      agentKey: string;
      agentName?: string;
      text: string;
      model?: string;
      ts: number;
    }
  | {
      kind: "tool_active";
      stepKey: string;
      agentKey: string;
      agentName?: string;
      tool: string;
      label: string;
      ts: number;
    }
  | {
      kind: "tool_output";
      stepKey: string;
      agentKey: string;
      agentName?: string;
      tool: string;
      label: string;
      output: string;
      ts: number;
    }
  | {
      kind: "tool_done";
      stepKey: string;
      agentKey: string;
      status: "passed" | "failed";
      ts: number;
    }
  | {
      kind: "activity";
      agentKey: string;
      agentName?: string;
      role?: string;
      status: string;
      activity: string;
      model?: string;
      ts: number;
    }
  | {
      kind: "step_committed";
      stepKey?: string;
      ts: number;
    };

export type RealtimeTransportKind = "ably" | "supabase" | "sse";

export type RealtimeClientGrant =
  | {
      transport: "ably";
      channel: string;
      sseUrl: string;
      expiresAt: number;
    }
  | {
      transport: "supabase";
      channel: string;
      wsUrl: string;
      anonKey: string;
    }
  | {
      transport: "sse";
      channel: string;
    };

export type RealtimePublishGrant =
  | {
      transport: "ably";
      runId: string;
      channel: string;
      publishUrl: string;
      bearerToken: string;
      expiresAt: number;
    }
  | {
      transport: "supabase";
      runId: string;
      channel: string;
      publishUrl: string;
      apiKey: string;
    }
  | {
      transport: "sse";
      runId: string;
      channel: string;
    };

export function runLiveChannel(runId: string): string {
  return `sf:run:${runId}`;
}

export function detectRealtimeTransport(env: NodeJS.ProcessEnv = process.env): RealtimeTransportKind {
  const ablyKey = (env.ABLY_API_KEY || "").trim();
  if (ablyKey.includes(":") && ablyKey.includes(".")) {
    return "ably";
  }
  const supaUrl = (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const supaAnon = (env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  if (supaUrl && supaAnon) {
    return "supabase";
  }
  return "sse";
}

function parseAblyKey(raw: string): { keyName: string; apiKey: string } | null {
  const trimmed = raw.trim();
  const colonIdx = trimmed.indexOf(":");
  if (colonIdx <= 0) return null;
  const keyName = trimmed.slice(0, colonIdx);
  if (!keyName.includes(".")) return null;
  return { keyName, apiKey: trimmed };
}

async function requestAblyScopedToken(
  channel: string,
  permission: "subscribe" | "publish",
): Promise<{ token: string; expiresAt: number } | null> {
  const parsed = parseAblyKey(process.env.ABLY_API_KEY || "");
  if (!parsed) return null;

  const ttlMs = 3_600_000; // 1 hour
  const basicAuth = Buffer.from(parsed.apiKey).toString("base64");
  const capability = JSON.stringify({ [channel]: [permission] });

  const res = await fetch(
    `https://rest.ably.io/keys/${encodeURIComponent(parsed.keyName)}/requestToken`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        keyName: parsed.keyName,
        ttl: ttlMs,
        capability,
      }),
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!res.ok) return null;

  const data = (await res.json().catch(() => null)) as {
    token?: string;
    expires?: number;
  } | null;
  if (!data?.token) return null;
  return {
    token: data.token,
    expiresAt: typeof data.expires === "number" ? data.expires : Date.now() + ttlMs,
  };
}

function getSupabaseRealtimeConfig(): {
  httpUrl: string;
  wsUrl: string;
  anonKey: string;
  publishKey: string;
} | null {
  const rawUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "")
    .trim()
    .replace(/\/+$/, "");
  const anonKey = (process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  if (!rawUrl || !anonKey) return null;
  const publishKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim() || anonKey;
  const wsBase = rawUrl.replace(/^https:\/\//i, "wss://").replace(/^http:\/\//i, "ws://");
  return {
    httpUrl: `${rawUrl}/realtime/v1/api/broadcast`,
    wsUrl: `${wsBase}/realtime/v1/websocket?apikey=${encodeURIComponent(anonKey)}&vsn=1.0.0`,
    anonKey,
    publishKey,
  };
}

export async function issueRealtimeSubscribeGrant(runId: string): Promise<RealtimeClientGrant> {
  const channel = runLiveChannel(runId);
  const transport = detectRealtimeTransport();

  if (transport === "ably") {
    const issued = await requestAblyScopedToken(channel, "subscribe").catch(() => null);
    if (issued) {
      return {
        transport: "ably",
        channel,
        sseUrl: `https://realtime.ably.io/sse?v=1.2&channels=${encodeURIComponent(channel)}&accessToken=${encodeURIComponent(issued.token)}`,
        expiresAt: issued.expiresAt,
      };
    }
  }

  if (transport === "supabase") {
    const supa = getSupabaseRealtimeConfig();
    if (supa) {
      return {
        transport: "supabase",
        channel,
        wsUrl: supa.wsUrl,
        anonKey: supa.anonKey,
      };
    }
  }

  return { transport: "sse", channel };
}

export async function issueRealtimePublishGrant(runId: string): Promise<RealtimePublishGrant> {
  const channel = runLiveChannel(runId);
  const transport = detectRealtimeTransport();

  if (transport === "ably") {
    const issued = await requestAblyScopedToken(channel, "publish").catch(() => null);
    if (issued) {
      return {
        transport: "ably",
        runId,
        channel,
        publishUrl: `https://rest.ably.io/channels/${encodeURIComponent(channel)}/messages`,
        bearerToken: Buffer.from(issued.token).toString("base64"),
        expiresAt: issued.expiresAt,
      };
    }
  }

  if (transport === "supabase") {
    const supa = getSupabaseRealtimeConfig();
    if (supa) {
      return {
        transport: "supabase",
        runId,
        channel,
        publishUrl: supa.httpUrl,
        apiKey: supa.publishKey,
      };
    }
  }

  return { transport: "sse", runId, channel };
}

/**
 * Coalesces bursts of outgoing live chunks (e.g., rapid character-by-character `text_delta`
 * or repeated `tool_output` / `activity` snapshots) so network packets stay small and smooth.
 */
export function coalesceLiveChunks(chunks: LiveChunkEvent[]): LiveChunkEvent[] {
  const out: LiveChunkEvent[] = [];
  for (const chunk of chunks) {
    const prev = out[out.length - 1];
    if (
      chunk.kind === "text_delta" &&
      prev?.kind === "text_delta" &&
      prev.stepKey === chunk.stepKey &&
      prev.agentKey === chunk.agentKey
    ) {
      prev.delta += chunk.delta;
      prev.ts = chunk.ts;
      continue;
    }
    if (
      chunk.kind === "tool_output" &&
      prev?.kind === "tool_output" &&
      prev.stepKey === chunk.stepKey &&
      prev.agentKey === chunk.agentKey
    ) {
      out[out.length - 1] = chunk;
      continue;
    }
    if (
      chunk.kind === "activity" &&
      prev?.kind === "activity" &&
      prev.agentKey === chunk.agentKey
    ) {
      out[out.length - 1] = chunk;
      continue;
    }
    out.push(chunk.kind === "text_delta" ? { ...chunk } : chunk);
  }
  return out;
}
