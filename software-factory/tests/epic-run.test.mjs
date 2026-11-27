// A real new-factory run (fake `claude` and `gh` from factory_v2's own fixtures, no tokens)
// watched by the daemon's EpicTracker: what reaches the web app must match state.json exactly.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { EpicTracker } from "../cli/sf.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
/** The nearest `factory_v2/skills` above this checkout (it sits beside or above software-factory). */
function findV2Skills(from) {
  for (let dir = from; ; dir = dirname(dir)) {
    const skills = join(dir, "factory_v2", "skills");
    if (existsSync(join(skills, "new-factory", "SKILL.md"))) return skills;
    if (dirname(dir) === dir) return join(from, "factory_v2", "skills");
  }
}
const HARNESS = join(findV2Skills(HERE), "new-factory", "tests", "integration", "harness.mjs");

test("an epic run reports its tickets, agents and exact cost", { skip: !existsSync(HARNESS) && "factory_v2 not in this checkout", timeout: 180_000 }, async () => {
  const { foundation, setup, why } = await import(HARNESS);
  const h = await setup("sf-epic", {
    tickets: [foundation()],
    scenario: `export default (c) => {
  if (c.role === 'implementer') return { files: { ...foundationFiles, 'e2e/app.spec.mjs': \`import test from 'node:test';
import assert from 'node:assert/strict';
test('C2 the app answers on PORT', async () => {
  const r = await (await fetch(process.env.BASE_URL)).json();
  assert.equal(r.ok, true);
});
\` } };
};`,
  });

  const posts = [];
  const steps = new Map();
  const post = (path, body) => {
    posts.push({ path, body });
    if (path === "/api/v1/runs/step" && !(body.idempotent && steps.has(body.step))) steps.set(body.step, body);
  };
  const tracker = new EpicTracker({ runDir: h.runDir, sinceMs: Date.now(), post, run: "r1", ctx: {}, repo: "o/r", epic: 10 });
  const timer = setInterval(() => tracker.poll(), 50);
  const r = await h.run();
  clearInterval(timer);
  assert.equal(r.code, 0, why(r, h));
  const end = tracker.finish(r.code);

  const st = h.state();
  assert.equal(end.outcome, "passed");
  assert.match(end.summary, /new-factory report: epic #10/);

  // Every agent of the run is an agent on the web, ending as it ended.
  for (const a of st.agents) {
    const last = posts.filter((p) => p.path === "/api/v1/runs/agent" && p.body.agentKey === a.id).at(-1);
    assert.ok(last, `agent ${a.id} reported`);
    assert.equal(last.body.status, a.ok ? "passed" : "failed");
  }
  // Cost on the web is exactly the orchestrator's own sum, counted once.
  const webCost = [...steps.values()].reduce((n, s) => n + (s.costUsd || 0), 0);
  const nfCost = st.agents.reduce((n, a) => n + (a.cost || 0), 0);
  assert.ok(nfCost > 0);
  assert.equal(webCost.toFixed(6), nfCost.toFixed(6));
  // The ticket went through the board to passed.
  const statuses = posts
    .filter((p) => p.path === "/api/v1/epics/sync")
    .flatMap((p) => p.body.tickets.filter((t) => t.number === 11).map((t) => t.status));
  assert.equal(statuses.at(-1), "merged");
  const phases = [...steps.values()].filter((s) => s.data?.kind === "lifecycle").map((s) => s.phase);
  for (const p of ["Plan", "Prepare", "Build", "Report"]) assert.ok(phases.includes(p), `phase ${p} reported (${phases})`);
});
