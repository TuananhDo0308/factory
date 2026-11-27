import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { foundation, setup, why } from './harness.mjs';

const APP_E2E = `'e2e/app.spec.mjs': \`import test from 'node:test';
import assert from 'node:assert/strict';
test('C2 the app answers on PORT', async () => {
  const r = await (await fetch(process.env.BASE_URL)).json();
  assert.equal(r.ok, true);
});
\``;

test('one ticket end to end: worktree, implementer, checks by code, reviewer, merge --no-ff, final check, QC', async () => {
  const h = await setup('m2', {
    tickets: [foundation()],
    scenario: `export default (c) => {
  if (c.role === 'implementer') return { files: { ...foundationFiles, ${APP_E2E} } };
};`,
  });
  const r = await h.run();
  assert.equal(r.code, 0, why(r, h));
  const st = h.state();
  assert.equal(st.status, 'done');
  assert.equal(st.tickets[11].status, 'merged');
  const roles = h.calls().map((c) => `${c.role}:${c.model}`);
  assert.deepEqual(roles, ['implementer:sonnet', 'reviewer:sonnet', 'qc:sonnet'], 'M: one implementer (Sonnet), one reviewer, one QC');
  // The implementer ran in its own worktree, not in the clone.
  assert.notEqual(h.calls()[0].cwd, h.work);
  // staging on origin: the merge is a --no-ff merge commit; main untouched.
  assert.match(h.merges().at(-1), /^factory: merge #11 /);
  assert.equal(h.git('rev-parse', 'origin/main'), h.git('rev-parse', 'main'));
  const parents = h.git('log', '-1', '--format=%P', 'origin/staging').split(' ');
  assert.equal(parents.length, 2, 'a merge commit with two parents');
  // Final check reported e2e by criterion, QC checked the one without e2e.
  assert.equal(st.final.e2e.C2, 'pass');
  assert.deepEqual([...st.final.qcPassed].sort(), ['C1', 'C2']);
  const report = fs.readFileSync(path.join(h.runDir, 'report.md'), 'utf8');
  assert.match(report, /\| #11 Set up the registry \| M \| delivered \|/);
  assert.ok(fs.existsSync(path.join(h.runDir, 'dashboard.html')));
});

test('a criterion with no tagged test, or a test with no assertion, goes back to the implementer', async () => {
  const h = await setup('m2-criteria', {
    tickets: [foundation()],
    scenario: `export default (c) => {
  if (c.role !== 'implementer') return;
  const files = { ...foundationFiles, ${APP_E2E} };
  if (c.n === 1) files['src/registry.test.mjs'] = "import test from 'node:test';\\ntest('C1 throws', () => {});\\n";
  return { files };
};`,
  });
  const r = await h.run();
  assert.equal(r.code, 0, why(r, h));
  const st = h.state();
  assert.equal(st.tickets[11].status, 'merged');
  assert.equal(st.tickets[11].rounds, 1);
  const implementers = h.calls().filter((c) => c.role === 'implementer');
  assert.equal(implementers.length, 2);
  assert.match(st.tickets[11].history.join('\n'), /fix round 1/);
});

test('a real-like plan with contracts: the foundation gets the contracts it provides, a slice the ones it uses', async () => {
  const { feature } = await import('./harness.mjs');
  const architecture = {
    contracts: [
      { name: 'Registry', file: 'src/registry.mjs', summary: 'collect(features: Feature[]): Feature[] throws "route <r> declared by <a> and <b>"' },
      { name: 'App', file: 'src/app.mjs', summary: 'load(): Promise<Feature[]> loads every src/features/<name>/index.mjs' },
    ],
  };
  const h = await setup('m2-contracts', {
    architecture,
    tickets: [foundation(), feature(12, 'alpha', ['C3'], { uses: ['Registry'] })],
    // Like the real implementer: no exact contract in the brief, no guessing.
    scenario: `export default (c) => {
  if (c.role !== 'implementer') return;
  if (c.issue === 11) {
    if (!/Contracts you provide[^]*collect\\(features: Feature\\[\\]\\)[^]*load\\(\\): Promise/.test(c.prompt)) return { result: { status: 'blocked', summary: 'no contracts', blockedReason: 'the contracts are not in my brief' } };
    return { files: { ...foundationFiles, 'e2e/app.spec.mjs': "import test from 'node:test';\\nimport assert from 'node:assert/strict';\\ntest('C2 answers', async () => { assert.equal((await fetch(process.env.BASE_URL)).status, 200); });\\n" } };
  }
  if (!/Contracts you use[^]*Registry/.test(c.prompt)) return { result: { status: 'blocked', summary: 'no contracts', blockedReason: 'Registry is not in my brief' } };
  return { files: featureFiles('alpha', 'alpha', ['C3']) };
};`,
  });
  const r = await h.run();
  assert.equal(r.code, 0, why(r, h));
  const st = h.state();
  assert.equal(st.tickets[11].status, 'merged');
  assert.equal(st.tickets[12].status, 'merged');
  assert.equal(st.tickets[11].rounds + st.tickets[12].rounds, 0, 'nobody was blocked for want of a contract');
});

test('a server the implementer left on the ticket\'s PORT is stopped by PID before the checks', async () => {
  const h = await setup('m2-leftover', {
    tickets: [foundation()],
    scenario: `export default (c) => {
  if (c.role !== 'implementer') return;
  return { leaveServer: true, files: { ...foundationFiles, 'e2e/app.spec.mjs': "import test from 'node:test';\\nimport assert from 'node:assert/strict';\\ntest('C2 answers', async () => { const r = await (await fetch(process.env.BASE_URL)).json(); assert.equal(r.ok, true); });\\n" } };
};`,
  });
  const r = await h.run();
  assert.equal(r.code, 0, why(r, h));
  const st = h.state();
  assert.equal(st.tickets[11].status, 'merged');
  assert.equal(st.tickets[11].rounds, 0, 'the e2e did not fail on a port held by the leftover');
  assert.match(st.tickets[11].history.join('\n'), /stopped PID \d+: the implementer left it listening on PORT/);
  const { alive } = await import('../../orchestrator/lib/sh.mjs');
  const pid = Number(fs.readFileSync(path.join(h.stateDir, 'left-pid-11'), 'utf8'));
  assert.equal(alive(pid), false);
});
