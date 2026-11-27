import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { alive } from '../../orchestrator/lib/sh.mjs';
import { feature, foundation, setup, why } from './harness.mjs';

const BASE = `const APP_E2E = { 'e2e/app.spec.mjs': "import test from 'node:test';\\nimport assert from 'node:assert/strict';\\ntest('C2 the app answers', async () => { const r = await fetch(process.env.BASE_URL); assert.equal(r.status, 200); });\\n" };
const normal = (c) => c.issue === 11 ? { files: { ...foundationFiles, ...APP_E2E } } : { files: featureFiles(c.issue === 12 ? 'alpha' : 'beta', c.issue === 12 ? 'alpha' : 'beta', [c.issue === 12 ? 'C3' : 'C4']) };`;

test('watch mode stuck: the child process is killed by PID inside the agent\'s tree, the agent goes on, an alarm goes out', async () => {
  const h = await setup('m5-watch', {
    tickets: [foundation(), feature(12, 'alpha', ['C3']), feature(13, 'beta', ['C4'])],
    scenario: `${BASE}
export default (c) => {
  if (c.role !== 'implementer') return;
  if (c.issue === 12 && c.n === 1) return { hang: 'vitest --watch', ...normal(c) };
  if (c.issue === 13 && c.n === 1) return { api: true };
  return normal(c);
};`,
  });
  const r = await h.run([], { NF_STALL_MS: '1500', NF_WATCH_INTERVAL_MS: '300' });
  assert.equal(r.code, 0, why(r, h));
  const st = h.state();
  for (const i of [11, 12, 13]) assert.equal(st.tickets[i].status, 'merged', `#${i}`);
  const stuck = st.alarms.find((a) => a.issue === 12 && a.cause === 'command-not-exiting');
  assert.ok(stuck, JSON.stringify(st.alarms));
  assert.match(stuck.handled, /killed the stuck process \(PID \d+: `vitest --watch`, watch or server\)/);
  assert.ok(stuck.tail.some((l) => /tool Bash: vitest --watch/.test(l)), 'the alarm carries the log tail');
  const pid = Number(fs.readFileSync(path.join(h.stateDir, 'hang-pid-12'), 'utf8'));
  assert.equal(alive(pid), false);
  assert.equal(h.calls().filter((c) => c.role === 'implementer' && c.issue === 12).length, 1, 'the same agent finished: it was never killed');
  assert.ok(h.gh().some((e) => e.type === 'comment' && e.issue === 12 && /new-factory alarm/.test(e.body) && /running for/.test(e.body)), 'alarm comment on the ticket');
  // API error: waited, retried, alarmed.
  const api = st.alarms.find((a) => a.issue === 13 && a.reason === 'api-error');
  assert.ok(api, JSON.stringify(st.alarms));
  const a13 = st.agents.find((a) => a.role === 'implementer' && a.issue === 13);
  assert.equal(a13.attempts, 2);
  assert.equal(a13.ok, true);
});

test('report and dashboard: times per step, agents, cost, ticket states', async () => {
  const h = await setup('m5-report', {
    tickets: [foundation(), feature(12, 'alpha', ['C3'])],
    scenario: `${BASE}\nexport default (c) => (c.role === 'implementer' ? normal(c) : undefined);`,
  });
  const r = await h.run();
  assert.equal(r.code, 0, why(r, h));
  const report = fs.readFileSync(path.join(h.runDir, 'report.md'), 'utf8');
  for (const s of ['| plan |', '| prepare |', '| tickets |', '| final check |', '| qc |', '| implementer | 2 |', '| reviewer | 2 |', '| qc | 1 |', 'delivered']) assert.ok(report.includes(s), `report has ${s}\n${report}`);
  assert.match(report, /5 agent call\(s\), \$0\.05/);
  const dash = fs.readFileSync(path.join(h.runDir, 'dashboard.html'), 'utf8');
  assert.match(dash, /state\.js/);
  assert.match(fs.readFileSync(path.join(h.runDir, 'state.js'), 'utf8'), /^window\.STATE = /);
});
