import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ClaudeStreamTracker, turnCostDelta } from "../cli/sf.ts";

function costOf(server) {
  const steps = new Map();
  for (const { path, body } of server) if (path === "/api/v1/runs/step") steps.set(body.step, body);
  return [...steps.values()].reduce((sum, s) => sum + (s.costUsd || 0), 0);
}

const tracker = (posts, extra = {}) =>
  new ClaudeStreamTracker({
    post: (path, body) => posts.push({ path, body }),
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

const result = (total) => JSON.stringify({ type: "result", subtype: "success", total_cost_usd: total, usage: {} });

describe("turn cost from Claude Code's running total_cost_usd", () => {
  it("counts only the growth since the last total", () => {
    assert.equal(turnCostDelta(0.96, 0.31), 0.96 - 0.31);
    assert.equal(turnCostDelta(0.31, 0), 0.31);
    assert.equal(turnCostDelta(0, 5), 0);
  });

  it("treats a total below the baseline as a process that counted from zero", () => {
    assert.equal(turnCostDelta(0.2, 5), 0.2);
  });

  it("does not sum running totals across results of one process", () => {
    const posts = [];
    const t = tracker(posts);
    for (const total of [0.31, 0.96, 11.15]) t.handleLine(result(total));
    assert.ok(Math.abs(costOf(posts) - 11.15) < 1e-9);
    assert.ok(Math.abs(t.costUsd - 11.15) < 1e-9);
  });

  it("starts a resumed turn from the session's last total", () => {
    const posts = [];
    const totals = [];
    const t = tracker(posts, { costBaseline: 14.26, onCostTotal: (x) => totals.push(x) });
    t.handleLine(result(17.49));
    assert.ok(Math.abs(costOf(posts) - (17.49 - 14.26)) < 1e-9);
    assert.deepEqual(totals, [17.49]);
  });
});
