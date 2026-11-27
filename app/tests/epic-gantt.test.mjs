import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildEpicGantt } from "../src/lib/epic-gantt.ts";

const T0 = Date.parse("2026-11-27T00:00:00Z");
const at = (min) => new Date(T0 + min * 60_000).toISOString();
const agent = (id, name, role, start, end, status = "passed") => ({
  id,
  agentKey: id,
  name,
  role,
  status,
  startedAt: at(start),
  finishedAt: end === null ? null : at(end),
});

describe("epic Gantt layout", () => {
  const agents = [
    agent("orchestrator", "new-factory orchestrator", "orchestrator", 0, 50),
    agent("001-implementer-2", "#2 implementer · implement", "implementer", 1, 20),
    agent("002-reviewer-2", "#2 reviewer · review", "reviewer", 20, 22),
    agent("003-implementer-3", "#3 implementer · implement", "implementer", 22, 30),
    agent("004-implementer-4", "#4 implementer · implement", "implementer", 22, 26),
    agent("005-diagnoser-4", "#4 diagnoser · diagnose", "diagnoser", 25, 27),
    agent("006-qc-batch", "batch qc · qc", "qc", 40, 50),
  ];
  const g = buildEpicGantt({
    runStartedAt: at(0),
    runFinishedAt: at(50),
    nowMs: T0 + 60 * 60_000,
    agents,
    mergedAt: new Map([[2, at(22.5)]]),
  });

  it("puts each ticket on its own row, the epic's own agents last, and leaves out the orchestrator", () => {
    assert.deepEqual(g.rows.map((r) => r.ticket), [2, 3, 4, null]);
    assert.ok(!g.rows.flatMap((r) => r.bars).some((b) => b.role === "orchestrator"));
  });

  it("places bars on the run's time axis", () => {
    const impl = g.rows[0].bars[0];
    assert.equal(impl.left, 2);
    assert.equal(impl.width, 38);
    assert.equal(impl.task, "implement");
    assert.equal(g.rows[0].mergedAt, 45);
  });

  it("stacks overlapping agents of one ticket in separate lanes", () => {
    const row4 = g.rows[2];
    assert.equal(row4.lanes, 2);
    assert.deepEqual(row4.bars.map((b) => b.lane), [0, 1]);
    assert.equal(g.rows[0].lanes, 1);
  });

  it("counts the most agents working at once", () => {
    assert.equal(g.peak, 3);
  });

  it("runs a bar still working up to now", () => {
    const live = buildEpicGantt({
      runStartedAt: at(0),
      runFinishedAt: null,
      nowMs: T0 + 10 * 60_000,
      agents: [agent("001-implementer-5", "#5 implementer · implement", "implementer", 5, null, "working")],
      tickets: [5, 6],
    });
    const bar = live.rows[0].bars[0];
    assert.equal(bar.running, true);
    assert.equal(bar.left + bar.width, 100);
    assert.deepEqual(live.rows.map((r) => r.ticket), [5, 6]);
  });
});
