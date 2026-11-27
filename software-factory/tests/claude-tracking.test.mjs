import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  ClaudeStreamTracker,
  claudeUsageDelta,
  EpicTracker,
  findPublishCommand,
  findPublishedEpic,
  readPublishedEpic,
  mapV2TicketStatus,
  resolveResumeCwd,
} from "../cli/sf.ts";

/** Sums what the web app would store: tokens and cost are increments on steps, deduped by key. */
function fakeServer() {
  const posts = [];
  const steps = new Map();
  const post = (path, body) => {
    posts.push({ path, body });
    if (path === "/api/v1/runs/step" && !(body.idempotent && steps.has(body.step))) {
      steps.set(body.step, body);
    }
  };
  const totals = () => {
    const t = { input: 0, output: 0, cache: 0, cost: 0 };
    for (const s of steps.values()) {
      t.input += s.inputTokens || 0;
      t.output += s.outputTokens || 0;
      t.cache += s.cacheReadTokens || 0;
      t.cost += s.costUsd || 0;
    }
    return t;
  };
  return { post, posts, steps, totals };
}

const tracker = (server, extra = {}) =>
  new ClaudeStreamTracker({
    post: server.post,
    run: "r1",
    ctx: {},
    phase: "BA",
    agentKey: "orchestrator",
    agentName: "BA",
    role: "orchestrator",
    model: "opus",
    stepPrefix: "t1",
    ...extra,
  });

describe("Claude stream-json usage accounting", () => {
  it("counts a message split over several assistant events only once", () => {
    const seen = new Map();
    const usage = { input_tokens: 10, cache_creation_input_tokens: 90, output_tokens: 40, cache_read_input_tokens: 500 };
    const first = claudeUsageDelta(seen, { message: { id: "msg_1", usage } });
    const second = claudeUsageDelta(seen, { message: { id: "msg_1", usage } });
    assert.deepEqual(first, { inTok: 100, outTok: 40, cacheTok: 500 });
    assert.deepEqual(second, { inTok: 0, outTok: 0, cacheTok: 0 });
  });

  it("attributes only the growth when a later block of the same message reports more output", () => {
    const seen = new Map();
    claudeUsageDelta(seen, { message: { id: "msg_1", usage: { input_tokens: 5, output_tokens: 3 } } });
    const later = claudeUsageDelta(seen, { message: { id: "msg_1", usage: { input_tokens: 5, output_tokens: 30 } } });
    assert.deepEqual(later, { inTok: 0, outTok: 27, cacheTok: 0 });
  });

  it("matches the result's usage and cost exactly over a whole turn", () => {
    const s = fakeServer();
    const t = tracker(s);
    const u1 = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 1000 };
    t.handle({ type: "system", subtype: "init", session_id: "S", model: "claude-opus-5-5" });
    t.handle({ type: "assistant", message: { id: "m1", usage: u1, content: [{ type: "thinking", thinking: "…" }] } });
    t.handle({ type: "assistant", message: { id: "m1", usage: u1, content: [{ type: "text", text: "Let me look." }] } });
    t.handle({ type: "assistant", message: { id: "m1", usage: u1, content: [{ type: "tool_use", id: "tu_1", name: "Bash", input: { command: "ls" } }] } });
    assert.equal(t.busy, true);
    t.handle({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu_1", content: "a\nb" }] } });
    assert.equal(t.busy, false);
    const u2 = { input_tokens: 50, output_tokens: 10, cache_read_input_tokens: 1100 };
    t.handle({ type: "assistant", message: { id: "m2", usage: u2, content: [{ type: "text", text: "Done." }] } });
    t.handle({
      type: "result",
      subtype: "success",
      result: "Done.",
      total_cost_usd: 0.0425,
      duration_ms: 1200,
      usage: { input_tokens: 150, output_tokens: 31, cache_read_input_tokens: 2100 },
    });
    // 30 output tokens were only known at the end (the last block's usage was still growing): the result adds them.
    assert.deepEqual(s.totals(), { input: 150, output: 31, cache: 2100, cost: 0.0425 });
    assert.equal(t.finalText, "Done.");
    assert.equal(t.sessionId, "S");
    assert.equal(t.model, "claude-opus-5-5");
  });

  it("never posts the same tool step twice when a log is read again", () => {
    const s = fakeServer();
    const lines = [
      JSON.stringify({ type: "assistant", message: { id: "m1", usage: { input_tokens: 7, output_tokens: 3 }, content: [{ type: "tool_use", id: "tu_9", name: "Read", input: { file_path: "/a" } }] } }),
      JSON.stringify({ type: "result", total_cost_usd: 0.01, usage: { input_tokens: 7, output_tokens: 3 } }),
    ];
    for (let pass = 0; pass < 2; pass += 1) {
      const t = tracker(s); // a daemon restart reads the whole log again with a fresh tracker
      for (const l of lines) t.handleLine(l);
    }
    assert.deepEqual(s.totals(), { input: 7, output: 3, cache: 0, cost: 0.01 });
  });

  it("tracks Agent subagents as their own agents, tokens attributed to them", () => {
    const s = fakeServer();
    const t = tracker(s, { trackSubagents: true });
    t.handle({ type: "assistant", message: { id: "m1", usage: { input_tokens: 10 }, content: [{ type: "tool_use", id: "tu_A1", name: "Agent", input: { description: "Batch reader", subagent_type: "general-purpose" } }] } });
    t.handle({ type: "assistant", parent_tool_use_id: "tu_A1", message: { id: "s1", usage: { input_tokens: 40, output_tokens: 4 }, content: [{ type: "text", text: "Reading" }] } });
    const subStep = [...s.steps.values()].find((x) => x.label === "Batch reader: response");
    assert.ok(subStep.agent.startsWith("batch-reader-"));
    assert.equal(subStep.inputTokens, 40);
    t.handle({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu_A1", content: "ok" }] } });
    const done = s.posts.filter((p) => p.path === "/api/v1/runs/agent" && p.body.status === "passed");
    assert.equal(done.length, 1);
  });
});

describe("live chunks", () => {
  it("carry the key of the step they become, so the run page replaces them instead of duplicating", () => {
    const s = fakeServer();
    const live = [];
    const t = tracker(s, { onLive: (c) => live.push(c) });
    t.handle({ type: "assistant", message: { id: "m1", content: [{ type: "text", text: "Looking." }, { type: "tool_use", id: "tu_7", name: "Bash", input: { command: "ls" } }] } });
    t.handle({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu_7", content: "a" }] } });
    const keys = [...s.steps.keys()];
    const text = live.find((c) => c.kind === "text_delta");
    const active = live.find((c) => c.kind === "tool_active");
    const done = live.find((c) => c.kind === "tool_done");
    assert.ok(keys.includes(text.stepKey), `text_delta key ${text.stepKey} is a step`);
    assert.ok(keys.includes(active.stepKey), `tool_active key ${active.stepKey} is a step`);
    assert.equal(done.stepKey, active.stepKey);
  });
});

describe("subagents left open when a turn ends", () => {
  it("are closed as failed when the process stops before their result", () => {
    const s = fakeServer();
    const t = tracker(s, { trackSubagents: true });
    t.handle({ type: "assistant", message: { id: "m1", content: [{ type: "tool_use", id: "tu_B1", name: "Agent", input: { description: "Design reviewer" } }] } });
    t.closeOpenSubagents("Stopped before it reported");
    const last = s.posts.filter((p) => p.path === "/api/v1/runs/agent" && p.body.name === "Design reviewer").at(-1);
    assert.equal(last.body.status, "failed");
    assert.equal(last.body.activity, "Stopped before it reported");
    assert.equal(t.busy, false);
  });
});

describe("published epic detection", () => {
  it("reads the epic from publish-batch output and ignores a dry run", () => {
    const out = `publishing…\n${JSON.stringify({ repo: "o/r", visibility: "PRIVATE", epic: { number: 41, url: "https://github.com/o/r/issues/41" }, tickets: [{ issue: 42 }] }, null, 2)}`;
    assert.deepEqual(findPublishedEpic(out), { repo: "o/r", number: 41, url: "https://github.com/o/r/issues/41" });
    assert.equal(findPublishedEpic(JSON.stringify({ dryRun: true, repo: "o/r", epic: "create" })), null);
    assert.equal(findPublishedEpic("no json here"), null);
  });
});

describe("publish found from the command, not its output", () => {
  it("reads --dir and --repo from a publish-batch command, however its output is redirected", () => {
    assert.deepEqual(
      findPublishCommand("cd /w && node ~/.claude/skills/new-ba/scripts/publish-batch.mjs --dir ./batch --repo o/r --label ready > /tmp/pub.json 2>&1", "/w"),
      { dir: "/w/batch", repo: "o/r" },
    );
    assert.deepEqual(findPublishCommand('node scripts/publish-batch.mjs --repo "o/r" --dir "/s/b 1"', "/x"), { dir: "/s/b 1", repo: "o/r" });
    assert.equal(findPublishCommand("node publish-batch.mjs --dir b --repo o/r --dry-run", "/w"), null);
    assert.equal(findPublishCommand("node check-batch.mjs --dir b", "/w"), null);
  });

  it("reads the epic from published.json in the batch folder", () => {
    const dir = mkdtempSync(join(tmpdir(), "sf-batch-"));
    try {
      assert.equal(readPublishedEpic(dir), null);
      writeFileSync(join(dir, "published.json"), JSON.stringify({ repo: "o/r", epic: 41, epicUrl: "https://github.com/o/r/issues/41", issues: {} }));
      assert.deepEqual(readPublishedEpic(dir), { repo: "o/r", number: 41, url: "https://github.com/o/r/issues/41" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("factory v2 ticket status", () => {
  it("maps every new-factory status to a Kanban column", () => {
    assert.equal(mapV2TicketStatus("pending"), "ready");
    assert.equal(mapV2TicketStatus(undefined), "ready");
    assert.equal(mapV2TicketStatus("running"), "in_progress");
    assert.equal(mapV2TicketStatus("reopened"), "in_progress");
    assert.equal(mapV2TicketStatus("waiting"), "blocked");
    assert.equal(mapV2TicketStatus("blocked"), "blocked");
    assert.equal(mapV2TicketStatus("needs-decision"), "needs_human");
    assert.equal(mapV2TicketStatus("merged"), "passed");
  });
});

describe("EpicTracker", () => {
  it("reports tickets, agents, exact cost and decisions from state.json and agent logs", () => {
    const runDir = mkdtempSync(join(tmpdir(), "sf-epic-"));
    try {
      mkdirSync(join(runDir, "logs", "agents"), { recursive: true });
      const since = Date.now();
      const at = new Date(since + 10).toISOString();
      const old = new Date(since - 60_000).toISOString();
      const state = {
        status: "running",
        runs: 2,
        steps: { plan: { start: old, end: old }, tickets: { start: at, end: null } },
        tickets: {
          42: { issue: 42, title: "Add a task", size: "M", wave: 1, status: "running", rounds: 0, criteria: [{ id: "C1", text: "x" }], dependsOn: [] },
        },
        alarms: [{ at: old, reason: "from an earlier run" }],
        agents: [
          { id: "001-implementer-42", role: "implementer", issue: 42, step: "implement", model: "sonnet", start: old, end: old, cost: 1, ok: true, log: "logs/agents/001-implementer-42.jsonl" },
          { id: "002-implementer-42", role: "implementer", issue: 42, step: "fix 1", model: "sonnet", start: at, end: null, cost: 0, ok: null, log: "logs/agents/002-implementer-42.jsonl" },
        ],
      };
      const write = () => writeFileSync(join(runDir, "state.json"), JSON.stringify(state));
      const log = join(runDir, "logs", "agents", "002-implementer-42.jsonl");
      write();
      writeFileSync(log, `${JSON.stringify({ type: "system", subtype: "init", session_id: "x" })}\n${JSON.stringify({ type: "assistant", message: { id: "m1", usage: { input_tokens: 9, output_tokens: 2 }, content: [{ type: "tool_use", id: "tu1", name: "Edit", input: { file_path: "/w/a.ts" } }] } })}\n{"type":"res`);
      const s = fakeServer();
      const t = new EpicTracker({ runDir, sinceMs: since, post: s.post, run: "r1", ctx: {}, repo: "o/r", epic: 41 });
      t.poll();
      const firstSync = s.posts.find((p) => p.path === "/api/v1/epics/sync");
      assert.equal(firstSync.body.epic.number, 41);
      assert.equal(firstSync.body.tickets[0].title, "Add a task");
      assert.ok(!s.posts.some((p) => p.body.agentKey === "001-implementer-42"), "an agent of an earlier run is not this run's");
      assert.ok(!s.posts.some((p) => p.body.data?.kind === "alarm"), "an alarm of an earlier run is history");
      assert.equal(s.totals().input, 9);

      // The rest of the half-written line arrives, the agent ends, the ticket needs a decision.
      appendFileSync(log, `ult","total_cost_usd":0.3,"usage":{"input_tokens":9,"output_tokens":5}}\n`);
      state.agents[1].end = new Date(since + 20).toISOString();
      state.agents[1].ok = false;
      state.tickets[42].status = "needs-decision";
      state.tickets[42].rounds = 2;
      state.tickets[42].decisions = 1;
      state.tickets[42].decision = { question: "Keep the old API?", reason: "contradiction" };
      state.alarms.push({ at, issue: 42, step: "fix 1", reason: "stalled", handled: "killed" });
      write();
      t.poll();
      t.poll();
      assert.deepEqual(s.totals(), { input: 9, output: 5, cache: 0, cost: 0.3 });
      const status = s.posts.filter((p) => p.path === "/api/v1/epics/sync").at(-1).body.tickets[0];
      assert.equal(status.status, "needs-decision");
      assert.equal(status.decision.question, "Keep the old API?");
      const asks = s.posts.filter((p) => p.path === "/api/v1/runs/interaction");
      assert.equal(asks.length, 1);
      assert.equal(asks[0].body.type, "decision");
      assert.equal(asks[0].body.payload.issue, 42);
      assert.equal(s.posts.filter((p) => p.body.data?.kind === "alarm").length, 1);
      const failed = s.posts.filter((p) => p.body.agentKey === "002-implementer-42" && p.body.status === "failed");
      assert.equal(failed.length, 1);

      state.status = "done";
      write();
      writeFileSync(join(runDir, "report.md"), "# report");
      const end = t.finish(0);
      assert.equal(end.outcome, "blocked", "a batch with a ticket waiting on a decision is not passed");
      assert.match(end.summary, /# report/);
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });
});

describe("resume cwd", () => {
  it("resumes a Claude session in the directory it was started in (Claude keys sessions by cwd)", () => {
    const repo = mkdtempSync(join(tmpdir(), "sf-repo-"));
    const worktree = mkdtempSync(join(tmpdir(), "sf-wt-"));
    try {
      assert.equal(resolveResumeCwd({ localPath: repo, savedCwd: worktree }), worktree);
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  it("falls back to the project path when the saved cwd is gone", () => {
    const repo = mkdtempSync(join(tmpdir(), "sf-repo-"));
    try {
      assert.equal(resolveResumeCwd({ localPath: repo, savedCwd: join(repo, "missing") }), repo);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
