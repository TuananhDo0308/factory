import test from 'node:test';
import assert from 'node:assert/strict';
import { feature, foundation, setup, why } from './harness.mjs';

const BASE = `const APP_E2E = { 'e2e/app.spec.mjs': "import test from 'node:test';\\nimport assert from 'node:assert/strict';\\ntest('C2 the app answers', async () => { const r = await fetch(process.env.BASE_URL); assert.equal(r.status, 200); });\\n" };
const NAMES = { 12: ['alpha', 'C3'], 13: ['beta', 'C4'], 14: ['gamma', 'C5'] };
const normal = (c, extra = {}) => c.issue === 11 ? { files: { ...foundationFiles, ...APP_E2E } } : { files: { ...featureFiles(NAMES[c.issue][0], NAMES[c.issue][0], [NAMES[c.issue][1]]), ...extra } };`;
const three = () => [foundation(), feature(12, 'alpha', ['C3']), feature(13, 'beta', ['C4'], { owns: ['src/features/beta/**', 'e2e/beta.spec.mjs', 'lib/beta/**'] }), { ...feature(14, 'gamma', ['C5'], { owns: ['src/features/gamma/**', 'e2e/gamma.spec.mjs', 'lib/gamma/**'] }), wave: 2, dependsOn: [13] }];

test('outside Owns: a free file is locked and granted with no extra agent; a file of a dependent is handed over', async () => {
  const h = await setup('m4-owns', {
    tickets: three(),
    scenario: `${BASE}
export default (c) => {
  if (c.role !== 'implementer') return;
  if (c.issue === 12) return normal(c, { 'src/shared/util.mjs': 'export const x = 1;\\n' });
  if (c.issue === 13) return normal(c, { 'lib/gamma/helper.mjs': 'export const h = 2;\\n' });
  return normal(c);
};`,
  });
  const r = await h.run();
  assert.equal(r.code, 0, why(r, h));
  const st = h.state();
  for (const i of [11, 12, 13, 14]) assert.equal(st.tickets[i].status, 'merged', `#${i}`);
  assert.deepEqual(st.tickets[12].extraOwns, ['src/shared/util.mjs']);
  assert.equal(st.tickets[12].rounds, 0, 'no fix round was spent');
  assert.equal(h.calls().filter((c) => c.role === 'implementer' && c.issue === 12).length, 1);
  assert.match(st.tickets[13].history.join('\n'), /lock on lib\/gamma\/helper\.mjs handed over from #14/);
  assert.deepEqual(st.locks, {}, 'locks are released at merge');
});

test('outside Owns: a file held by a ticket running at the same time waits for its merge, then goes on from the new staging', async () => {
  const h = await setup('m4-wait', {
    tickets: three().slice(0, 3),
    scenario: `${BASE}
export default (c) => {
  if (c.role !== 'implementer') return;
  if (c.issue === 12) return normal(c, { 'lib/beta/note.mjs': 'export const n = 1;\\n' });
  if (c.issue === 13) return { sleepMs: 800, ...normal(c) };
  return normal(c);
};`,
  });
  const r = await h.run();
  assert.equal(r.code, 0, why(r, h));
  const st = h.state();
  for (const i of [11, 12, 13]) assert.equal(st.tickets[i].status, 'merged', `#${i}`);
  const hist = st.tickets[12].history.join('\n');
  assert.match(hist, /waits for #13 to merge/);
  assert.ok(st.mergeLog.findIndex((m) => m.issue === 13) < st.mergeLog.findIndex((m) => m.issue === 12), '#12 merged after #13');
  assert.deepEqual(st.tickets[12].extraOwns, ['lib/beta/note.mjs']);
});

test('needs-decision: comment and label, dependents not delivered, the rest of the batch goes on; --retry with the answer finishes it', async () => {
  const h = await setup('m4-decision', {
    tickets: three(),
    scenario: `${BASE}
export default (c) => {
  if (c.role === 'implementer' && c.issue === 13 && c.n === 1) return { result: { status: 'blocked', summary: 'C4 says both "list" and "grid"', blockedReason: 'C4 is ambiguous' } };
  if (c.role === 'diagnoser') return { result: { class: 'contradiction', diagnosis: 'C4 can be read two ways', files: [], question: 'Should beta show a list or a grid?' } };
  if (c.role === 'implementer') return normal(c);
};`,
  });
  const r1 = await h.run();
  assert.equal(r1.code, 0, why(r1, h));
  let st = h.state();
  assert.equal(st.tickets[13].status, 'needs-decision');
  assert.equal(st.tickets[14].status, 'blocked', 'its dependent waits, not delivered');
  assert.equal(st.tickets[12].status, 'merged', 'the rest of the batch went on');
  const ev = h.gh();
  assert.ok(ev.some((e) => e.type === 'comment' && e.issue === 13 && /Should beta show a list or a grid\?/.test(e.body) && /needs-decision:13:1/.test(e.body)));
  assert.ok(ev.some((e) => e.type === 'add-label' && e.issue === 13 && e.label === 'needs-decision'));
  assert.ok(!st.final.qcPassed.includes('C4') && !st.final.qcPassed.includes('C5'), 'QC covered only merged tickets');
  assert.equal(h.calls().filter((c) => c.role === 'diagnoser').length, 1, 'a blocked implementer goes straight to the diagnoser');

  h.answer(13, 'A list, like alpha.');
  const r2 = await h.run(['--retry', '13']);
  assert.equal(r2.code, 0, why(r2, h));
  st = h.state();
  for (const i of [11, 12, 13, 14]) assert.equal(st.tickets[i].status, 'merged', `#${i}`);
  const second = h.calls().filter((c) => c.role === 'implementer' && c.issue === 13).at(-1);
  assert.match(second.prompt, /A list, like alpha\./, 'the implementer got the user\'s answer');
  assert.ok(h.gh().some((e) => e.type === 'remove-label' && e.issue === 13));
  const qcs = h.calls().filter((c) => c.role === 'qc');
  assert.doesNotMatch(qcs.at(-1).prompt, /\*\*C3\*\*/, 'the second QC does not check again what passed');
  assert.equal(st.runs, 2);
});

test('needs-decision after QC: the merged ticket and its merged dependent are reverted; --retry reverts the revert on a new branch', async () => {
  const h = await setup('m4-revert', {
    tickets: three(),
    scenario: `${BASE}
export default (c) => {
  if (c.role === 'qc') return { result: (d) => ({ ...d, criteria: d.criteria.map((x) => x.id === 'C4' && c.n <= 3 ? { ...x, met: false, evidence: 'beta shows nothing' } : x) }) };
  if (c.role === 'diagnoser') return { result: { class: 'contradiction', diagnosis: 'C4 cannot be met as written', files: [], question: 'What should beta show when empty?' } };
  if (c.role !== 'implementer') return;
  // C4 has no e2e test: QC checks it by hand.
  if (c.issue === 13) return normal(c, { 'e2e/beta.spec.mjs': null, ...(c.n > 1 ? { 'lib/beta/fix.mjs': 'export const round = ' + c.n + ';\\n' } : {}) });
  return normal(c);
};`,
  });
  const r1 = await h.run();
  assert.equal(r1.code, 0, why(r1, h));
  let st = h.state();
  assert.equal(st.tickets[13].status, 'needs-decision');
  assert.equal(st.tickets[13].reverted, true);
  assert.equal(st.tickets[14].reverted, true, 'its merged dependent is reverted too');
  assert.equal(st.tickets[14].status, 'blocked');
  assert.equal(st.tickets[13].rounds, 2, 'two QC fix rounds, then the diagnoser said contradiction');
  const subjects = h.merges();
  const reverts = subjects.filter((s) => s.startsWith('factory: revert'));
  const expected = st.mergeLog.filter((m) => m.kind === 'merge' && [13, 14].includes(m.issue)).reverse().map((m) => `factory: revert #${m.issue} (needs a decision on #13)`);
  assert.deepEqual(reverts, expected, 'every merge of #13 and #14 is reverted, newest merge first');
  assert.equal(st.tickets[13].merges.length, 3, 'first build and two QC fixes');
  assert.equal(h.git('ls-tree', '--name-only', 'origin/staging', 'src/features/').split('\n').map((p) => p.split('/').pop()).sort().join(','), 'alpha', 'staging keeps only code that passed QC');
  assert.ok(st.tickets[13].reverts.length >= 1);
  assert.equal(st.final.lastCheck.ok, true, 'checks ran again after the revert');

  h.answer(13, 'Show "No beta yet".');
  const r2 = await h.run(['--retry', '13']);
  assert.equal(r2.code, 0, why(r2, h));
  st = h.state();
  for (const i of [11, 12, 13, 14]) assert.equal(st.tickets[i].status, 'merged', `#${i}`);
  assert.match(st.tickets[13].branch, /-r1$/, 'a new branch from staging');
  assert.match(st.tickets[13].history.join('\n'), /its revert reverted/);
  assert.equal(h.calls().filter((c) => c.role === 'implementer' && c.issue === 14).length, 1, 'the dependent got its code back by reverting its revert, no new build');
  assert.deepEqual(h.git('ls-tree', '--name-only', 'origin/staging', 'src/features/').split('\n').map((p) => p.split('/').pop()).sort(), ['alpha', 'beta', 'gamma']);
});

test('crash in the middle, then the same command again: goes on, merges nothing twice', async () => {
  const h = await setup('m4-crash', {
    tickets: three().slice(0, 3),
    scenario: `${BASE}
export default (c) => (c.role === 'implementer' ? { sleepMs: c.issue === 13 ? 600 : 0, ...normal(c) } : undefined);`,
  });
  const r1 = await h.run([], { NF_CRASH_AT: 'after-merge:12' });
  assert.equal(r1.code, 99, why(r1, h));
  assert.equal(h.state().tickets[12].status, 'merged');
  assert.ok(h.merges().some((s) => s.startsWith('factory: merge #12')), 'staging on origin was pushed right after the merge');
  const r2 = await h.run();
  assert.equal(r2.code, 0, why(r2, h));
  const st = h.state();
  for (const i of [11, 12, 13]) assert.equal(st.tickets[i].status, 'merged', `#${i}`);
  const merges = h.merges().filter((s) => s.startsWith('factory: merge'));
  assert.deepEqual(merges.map((s) => s.split(' ')[2]).sort(), ['#11', '#12', '#13'], 'each ticket merged once');
  assert.equal(st.runs, 2);
});

test('crash while an agent runs: the rerun waits for it, then the ticket goes on', async () => {
  const h = await setup('m4-crash-agent', {
    tickets: three().slice(0, 2),
    scenario: `${BASE}
export default (c) => (c.role === 'implementer' ? { sleepMs: c.issue === 12 && c.n === 1 ? 1500 : 0, ...normal(c) } : undefined);`,
  });
  const r1 = await h.run([], { NF_CRASH_AT: 'agent:implementer:12' });
  assert.equal(r1.code, 99, why(r1, h));
  const r2 = await h.run();
  assert.equal(r2.code, 0, why(r2, h));
  const st = h.state();
  assert.equal(st.tickets[12].status, 'merged');
  assert.equal(h.merges().filter((s) => s.startsWith('factory: merge #12')).length, 1);
});
