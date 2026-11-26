import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  coalesceLiveChunks,
  detectRealtimeTransport,
  runLiveChannel,
} from "../src/lib/realtime.ts";

describe("Realtime Broadcast transport selection & chunk coalescing", () => {
  it("selects ably, supabase, or sse transport based on env configuration", () => {
    assert.equal(detectRealtimeTransport({}), "sse");
    assert.equal(
      detectRealtimeTransport({ ABLY_API_KEY: "app123.key456:secret789" }),
      "ably",
    );
    assert.equal(
      detectRealtimeTransport({
        SUPABASE_URL: "https://demo.supabase.co",
        SUPABASE_ANON_KEY: "anon-key",
      }),
      "supabase",
    );
    // Ably takes priority when both are configured
    assert.equal(
      detectRealtimeTransport({
        ABLY_API_KEY: "app123.key456:secret789",
        SUPABASE_URL: "https://demo.supabase.co",
        SUPABASE_ANON_KEY: "anon-key",
      }),
      "ably",
    );
    assert.equal(runLiveChannel("run_abc123"), "sf:run:run_abc123");
  });

  it("coalesces adjacent text deltas and deduplicates latest tool_output/activity frames", () => {
    const coalesced = coalesceLiveChunks([
      { kind: "text_delta", stepKey: "s1", agentKey: "orchestrator", delta: "Hel", ts: 1 },
      { kind: "text_delta", stepKey: "s1", agentKey: "orchestrator", delta: "lo ", ts: 2 },
      { kind: "text_delta", stepKey: "s1", agentKey: "orchestrator", delta: "world", ts: 3 },
      {
        kind: "tool_output",
        stepKey: "t1",
        agentKey: "S1-impl",
        tool: "run_command",
        label: "npm test",
        output: "line 1",
        ts: 4,
      },
      {
        kind: "tool_output",
        stepKey: "t1",
        agentKey: "S1-impl",
        tool: "run_command",
        label: "npm test",
        output: "line 1\nline 2",
        ts: 5,
      },
      {
        kind: "activity",
        agentKey: "S1-impl",
        status: "working",
        activity: "Step A",
        ts: 6,
      },
      {
        kind: "activity",
        agentKey: "S1-impl",
        status: "working",
        activity: "Step B",
        ts: 7,
      },
    ]);

    assert.equal(coalesced.length, 3);
    assert.equal(coalesced[0].kind, "text_delta");
    if (coalesced[0].kind === "text_delta") {
      assert.equal(coalesced[0].delta, "Hello world");
      assert.equal(coalesced[0].ts, 3);
    }
    assert.equal(coalesced[1].kind, "tool_output");
    if (coalesced[1].kind === "tool_output") {
      assert.equal(coalesced[1].output, "line 1\nline 2");
    }
    assert.equal(coalesced[2].kind, "activity");
    if (coalesced[2].kind === "activity") {
      assert.equal(coalesced[2].activity, "Step B");
    }
  });
});
