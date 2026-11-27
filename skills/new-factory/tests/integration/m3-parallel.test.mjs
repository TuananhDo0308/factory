import test from 'node:test';
import assert from 'node:assert/strict';
import { feature, foundation, setup, why } from './harness.mjs';

const FOUNDATION = `const APP_E2E = { 'e2e/app.spec.mjs': "import test from 'node:test';\\nimport assert from 'node:assert/strict';\\ntest('C2 the app answers', async () => { const r = await fetch(process.env.BASE_URL); assert.equal(r.status, 200); });\\n" };`;

test('normal path: 3 tickets, the two of wave 1 in parallel; check after merging only while a ticket waits; lockfile made again', async () => {
  const h = await setup('m3-happy', {
    tickets: [foundation(), feature(12, 'alpha', ['C3'], { size: 'S' }), feature(13, 'beta', ['C4', 'C5', 'C6', 'C7'])],
    scenario: `${FOUNDATION}
export default (c) => {
  if (c.role !== 'implementer') return;
  if (c.issue === 11) return { files: { ...foundationFiles, ...APP_E2E } };
  if (c.issue === 12) return { sleepMs: 4000, files: { ...featureFiles('alpha', 'alpha', ['C3']), 'package-lock.json': 'junk from a ticket' } };
  const pkg = JSON.parse(projectFiles['package.json']);
  pkg.scripts['beta:extra'] = 'node -e 1';
  return { sleepMs: 2500, files: { ...featureFiles('beta', 'beta', ['C4', 'C5', 'C6', 'C7']), 'package.json': JSON.stringify(pkg, null, 2) } };
};`,
  });
  const r = await h.run([], { NF_LOCK_CMD: 'echo regenerated > package-lock.json' });
  assert.equal(r.code, 0, why(r, h));
  const st = h.state();
  for (const i of [11, 12, 13]) assert.equal(st.tickets[i].status, 'merged', `#${i}`);
  const calls = h.calls();
  const impl = (i) => calls.find((c) => c.role === 'implementer' && c.issue === i);
  assert.ok(impl(12).start < impl(13).end && impl(13).start < impl(12).end, 'wave 1 implementers overlapped');
  assert.ok(impl(12).start >= impl(11).end, 'wave 1 started after the foundation');
  assert.equal(impl(12).model, 'haiku', 'S: the light model');
  assert.deepEqual(calls.filter((c) => c.role === 'reviewer').map((c) => c.issue).sort(), [11, 13], 'S has no reviewer');
  assert.deepEqual(st.stagingChecks.map((c) => c.label), ['after merging #11', 'final'], 'no check after #12 or #13: nothing waited on them');
  assert.equal(h.merges().filter((m) => m.startsWith('factory: merge')).length, 3);
  assert.equal(h.git('show', 'origin/staging:package-lock.json'), 'regenerated', 'lockfile is never merged, it is made again');
  assert.notEqual(st.tickets[12].port, st.tickets[13].port);
  // #13 changed package.json and merged first: the install after it must not leave
  // staging's worktree dirty, or #12's merge is refused and blamed on #12.
  assert.ok(st.mergeLog.findIndex((m) => m.issue === 13) < st.mergeLog.findIndex((m) => m.issue === 12));
  assert.equal(st.tickets[12].rounds, 0);
});

test('semantic conflict after merging: bisect finds the merge, the culprit fixes it, the waiting ticket starts after', async () => {
  const h = await setup('m3-conflict', {
    tickets: [foundation(), feature(12, 'alpha', ['C3']), feature(13, 'beta', ['C4']), { ...feature(14, 'gamma', ['C5']), wave: 2, dependsOn: [12, 13] }],
    scenario: `${FOUNDATION}
export default (c) => {
  if (c.role !== 'implementer') return;
  if (c.issue === 11) return { files: { ...foundationFiles, ...APP_E2E } };
  const name = { 12: 'alpha', 13: 'beta', 14: 'gamma' }[c.issue];
  const id = { 12: 'C3', 13: 'C4', 14: 'C5' }[c.issue];
  // Both wave-1 features first claim the route "list": each passes alone, not together.
  const route = c.n === 1 && c.issue !== 14 ? 'list' : name;
  return { sleepMs: c.issue === 13 && c.n === 1 ? 900 : 0, files: featureFiles(name, route, [id]) };
};`,
  });
  const r = await h.run();
  assert.equal(r.code, 0, why(r, h));
  const st = h.state();
  for (const i of [11, 12, 13, 14]) assert.equal(st.tickets[i].status, 'merged', `#${i}`);
  const firstMerged = st.mergeLog.find((m) => m.issue === 12 || m.issue === 13).issue;
  const second = firstMerged === 12 ? 13 : 12;
  assert.equal(st.blames.length, 1);
  assert.equal(st.blames[0].culprit, second, 'the second merge broke it');
  assert.equal(st.blames[0].bisected, true);
  assert.ok(st.blames[0].affected.includes(11), 'the failing test belongs to the foundation (registry)');
  assert.equal(st.tickets[second].rounds, 1);
  assert.equal(st.tickets[firstMerged].rounds, 0);
  const g = h.calls().find((c) => c.role === 'implementer' && c.issue === 14);
  const fixed = h.calls().filter((c) => c.role === 'implementer' && c.issue === second).at(-1);
  assert.ok(g.start >= fixed.end, '#14 started only once staging was green again');
  assert.match(st.tickets[second].history.join('\n'), /fix round 1/);
  const msg = JSON.stringify(st.tickets[second]);
  assert.ok(!msg.includes('"pending":[{'), 'its failures were consumed');
});
