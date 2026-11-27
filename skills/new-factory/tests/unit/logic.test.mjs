import test from 'node:test';
import assert from 'node:assert/strict';
import { criteriaTests, testsIn } from '../../orchestrator/lib/criteria.mjs';
import { findCulprit, rerunPlan } from '../../orchestrator/lib/bisect.mjs';
import { dependsOn, grant, holderOf, release, request, waitsFor } from '../../orchestrator/lib/locks.mjs';
import { effectiveOwns, matches, ownsProblems, testOwns, undeclaredDependencies } from '../../orchestrator/lib/owns.mjs';
import { parseNameStatus } from '../../orchestrator/lib/git.mjs';
import { dependents, next, waitingOn } from '../../orchestrator/lib/scheduler.mjs';
import { classifyStall, commandWords, descendants } from '../../orchestrator/lib/watchdog.mjs';
import { criteriaResults, readReport } from '../../orchestrator/lib/checks.mjs';

const T = (issue, deps = [], status = 'pending', owns = [`src/f${issue}/**`]) => ({ issue, wave: deps.length ? 1 : 0, dependsOn: deps, status, owns, extraOwns: [], criteria: [] });
const map = (...ts) => Object.fromEntries(ts.map((t) => [t.issue, t]));

// ---------------------------------------------------------------- owns

test('owns: globs read as check-batch reads them', () => {
  assert.ok(matches('src/a/b/c.ts', 'src/a/**'));
  assert.ok(matches('src/a/x.ts', 'src/a/'));
  assert.ok(matches('src/a.ts', './src/a.ts'));
  assert.ok(!matches('src/ab/x.ts', 'src/a/**'));
  assert.ok(matches('e2e/add.spec.ts', 'e2e/*.spec.ts'));
  assert.ok(!matches('e2e/x/add.spec.ts', 'e2e/*.spec.ts'));
  assert.ok(matches('src/a/x.ts', 'src/**/x.ts'));
});

test('owns: a ticket owns its test places without listing them', () => {
  const t = { issue: 12, key: 'T2', owns: ['src/repo.ts', 'src/features/add/**'], extraOwns: ['src/shared.ts'] };
  const o = effectiveOwns(t);
  assert.ok(o.includes('e2e/12/**'));
  assert.ok(testOwns(t).includes('src/repo.test.*'));
  for (const f of ['e2e/12/add.spec.ts', 'e2e/t2/x.spec.ts', 'src/repo.test.ts', 'src/repo.spec.tsx', 'src/__tests__/repo.ts', 'src/shared.ts']) assert.ok(o.some((g) => matches(f, g)), f);
  assert.ok(!o.some((g) => matches('src/other.test.ts', g)));
});

test('owns: additions, edits, deletions and both sides of a rename are judged', () => {
  const changes = parseNameStatus(['A\tsrc/f/new.ts', 'M\tsrc/f/old.ts', 'D\tsrc/gone.ts', 'R087\tsrc/shared/a.ts\tsrc/f/a.ts', 'R100\tsrc/f/b.ts\tlib/b.ts'].join('\n'));
  const p = ownsProblems(changes, ['src/f/**']);
  assert.deepEqual(p.map((x) => x.file).sort(), ['lib/b.ts', 'src/gone.ts', 'src/shared/a.ts']);
  assert.match(p.find((x) => x.file === 'src/gone.ts').message, /^deletes/);
  assert.match(p.find((x) => x.file === 'src/shared/a.ts').message, /renames away/);
  assert.match(p.find((x) => x.file === 'lib/b.ts').message, /renames into/);
});

test('owns: caches, placeholders and check output are ignored; the lockfile too', () => {
  const changes = parseNameStatus(['A\tsrc/__pycache__/x.pyc', 'A\tdata/.gitkeep', 'A\ttest-results/r.json', 'A\tplaywright-report/index.html', 'A\tcoverage/lcov.info', 'M\tpackage-lock.json', 'A\ttsconfig.tsbuildinfo'].join('\n'));
  assert.deepEqual(ownsProblems(changes, ['src/f/**']), []);
});

test('owns: package.json may change, but only declared dependencies', () => {
  const before = { scripts: {}, dependencies: { react: '18.3.1' } };
  const after = { scripts: { e2e: 'playwright test' }, dependencies: { react: '18.3.1', zod: '3.23.8', lodash: '4.17.21' } };
  const changes = parseNameStatus('M\tpackage.json');
  const p = ownsProblems(changes, ['src/**'], { pkgBefore: before, pkgAfter: after, declared: ['zod@3.23.8'] });
  assert.equal(p.length, 1);
  assert.equal(p[0].kind, 'dependency');
  assert.match(p[0].message, /lodash/);
  assert.deepEqual(undeclaredDependencies(before, { ...before, scripts: { x: 'y' } }, []), []);
  assert.equal(undeclaredDependencies(before, { dependencies: {} }, []).length, 1, 'a removed dependency is a change too');
});

// ---------------------------------------------------------------- criteria tests

test('criteria: each criterion needs a test named with its id that asserts', () => {
  const files = [
    { path: 'src/add.test.ts', text: `import { expect, test } from 'vitest';\ntest('C5 adds a task', () => {\n  const f = () => (1);\n  expect(add('x')).toEqual({ title: 'x' });\n});\ntest('C6 empty title', () => {\n  render(<Add />);\n});\ntest.skip('C8 skipped one', () => { expect(1).toBe(1); });\n` },
    { path: 'e2e/add.spec.ts', text: `test.describe('C7 errors', () => {\n  test('shows "Title is required" (x)', async ({ page }) => {\n    await expect(page.getByText('Title is required')).toBeVisible();\n  });\n});\n` },
  ];
  const r = criteriaTests(files, ['C5', 'C6', 'C7', 'C8', 'C9', 'C50']);
  assert.deepEqual(r.problems.map((p) => p.split(':')[0]), ['C6', 'C8', 'C9', 'C50']);
  assert.match(r.problems[0], /has no assertion/);
  assert.match(r.problems[1], /no test has C8/);
  assert.equal(r.found.C7[0].file, 'e2e/add.spec.ts');
});

test('criteria: ids are whole tokens (C5 is not C50 or C5.1), tags count, python works', () => {
  const js = [{ path: 'a.test.js', text: `it('C50 x', () => assert.ok(1));\nit('does C5.1', () => assert.ok(1));\ntest('works @C3', () => { expect(x).toBe(1) });` }];
  assert.deepEqual(criteriaTests(js, ['C5', 'C3']).problems.map((p) => p.split(':')[0]), ['C5']);
  const py = [{ path: 'tests/test_add.py', text: `def test_c4_adds():\n    r = add('x')\n    assert r.title == 'x'\n\ndef test_c9_nothing():\n    add('x')\n` }];
  assert.deepEqual(criteriaTests(py, ['C4', 'C9']).problems.map((p) => p.split(':')[0]), ['C9']);
});

test('criteria: a parenthesis inside a string does not end the test early', () => {
  const t = testsIn('x.test.ts', `test('C1 a', () => { const s = "(("; expect(s).toBe('((') });`);
  assert.match(t[0].body, /expect/);
});

// ---------------------------------------------------------------- reports

test('reports: Playwright JSON gives per-criterion results from tags and titles', () => {
  const results = [{ name: 'e2e', tests: [
    { file: 'e2e/a.spec.ts', title: 'add C5 adds', ok: true },
    { file: 'e2e/a.spec.ts', title: 'C6 errors @C7', ok: false },
    { file: 'e2e/b.spec.ts', title: 'C5 again', ok: true },
  ] }];
  assert.deepEqual(criteriaResults(results), { C5: 'pass', C6: 'fail', C7: 'fail' });
});

// ---------------------------------------------------------------- scheduler

test('scheduler: by the dependency graph, not by wave, at most four at once', () => {
  const ts = map(T(1, [], 'merged'), T(2, [1]), T(3, [1]), T(4, [1]), T(5, [1]), T(6, [1]), T(7, [2]));
  const r = next(ts, new Set());
  assert.deepEqual(r.start, [2, 3, 4, 5]);
  assert.deepEqual(next(ts, new Set([2, 3, 4])).start, [5]);
  ts[2].status = 'merged';
  assert.ok(next(ts, new Set([3, 4, 5, 6])).start.length === 0, 'full');
  assert.deepEqual(next(ts, new Set([3, 4, 5])).start, [6], 'lowest wave first');
  assert.deepEqual(next(ts, new Set([3, 4, 5, 6]), { max: 5 }).start, [7], 'a wave-2 ticket starts as soon as its own dependency merged, before wave 1 is done');
});

test('scheduler: tickets behind a needs-decision, directly or not, are blocked', () => {
  const ts = map(T(1, [], 'merged'), T(2, [1], 'needs-decision'), T(3, [2]), T(4, [3]), T(5, [1]));
  const r = next(ts, new Set());
  assert.deepEqual(r.block.sort(), [3, 4]);
  assert.deepEqual(r.start, [5]);
  assert.deepEqual(dependents(ts, 2).sort(), [3, 4]);
});

test('scheduler: a red staging holds dependent tickets; a reopened ticket goes first', () => {
  const ts = map(T(1, [], 'merged'), T(2, [1]), T(3, [1], 'reopened'));
  assert.deepEqual(next(ts, new Set(), { hold: true }).start, [3]);
  assert.deepEqual(next(ts, new Set()).start, [3, 2]);
  assert.deepEqual(waitingOn(map(T(1, [], 'merged'), T(2, [1]), T(4, [1, 9]), T(9, [])), 1).map((t) => t.issue), [2]);
});

// ---------------------------------------------------------------- lock table

test('locks: a free file is granted and locked', () => {
  const ts = map(T(1, [], 'merged', ['src/core/**']), T(2, [1], 'running'));
  const locks = {};
  assert.equal(holderOf('src/core/a.ts', ts, locks, 2), null, 'a merged ticket holds nothing');
  const r = request(ts, locks, 2, ['src/core/a.ts']);
  assert.equal(r.result, 'granted');
  grant(locks, 2, ['src/core/a.ts']);
  assert.equal(holderOf('src/core/a.ts', ts, locks, 3), 2);
  release(locks, 2);
  assert.deepEqual(locks, {});
});

test('locks: held by a ticket that depends on us, directly or not: handed over', () => {
  const ts = map(T(1, [], 'merged'), T(2, [1], 'running'), T(3, [2]), T(4, [3], 'pending', ['src/x/**']));
  assert.ok(dependsOn(ts, 4, 2));
  const r = request(ts, {}, 2, ['src/x/a.ts']);
  assert.equal(r.result, 'granted');
  assert.deepEqual(r.transfers, [{ file: 'src/x/a.ts', from: 4 }]);
});

test('locks: held by a needs-decision ticket: needs-decision too', () => {
  const ts = map(T(1, [], 'merged'), T(2, [1], 'running'), T(3, [1], 'needs-decision', ['src/y/**']));
  assert.deepEqual(request(ts, {}, 2, ['src/y/a.ts']), { result: 'needs-decision', holder: 3, file: 'src/y/a.ts' });
});

test('locks: held by an unrelated running ticket: wait, unless waiting closes a cycle', () => {
  const ts = map(T(1, [], 'merged'), T(2, [1], 'running', ['src/a/**']), T(3, [1], 'running', ['src/b/**']));
  assert.equal(request(ts, {}, 2, ['src/b/x.ts']).result, 'wait');
  ts[2].status = 'waiting';
  ts[2].waitingFor = 3;
  assert.ok(waitsFor(ts, 2, 3));
  assert.equal(request(ts, {}, 3, ['src/a/x.ts']).result, 'cycle', '3 waiting on 2, which waits on 3');
});

test('locks: a cycle through a dependency is found too', () => {
  // 4 depends on 3 (not merged). 3 needs a file of 4's? 4 depends on 3: handed over, no cycle.
  // 3 needs a file held by 5; 5 waits for 3 through a lock: cycle.
  const ts = map(T(1, [], 'merged'), T(3, [1], 'running', ['src/c/**']), T(5, [1], 'waiting', ['src/e/**']), T(6, [5], 'pending', ['src/f/**']));
  ts[5].waitingFor = 3;
  assert.equal(request(ts, {}, 3, ['src/e/x.ts']).result, 'cycle');
  assert.equal(request(ts, {}, 3, ['src/f/x.ts']).result, 'cycle', '3 would wait for 6, which depends on 5, which waits for 3');
  ts[5].status = 'running';
  assert.equal(request(ts, {}, 3, ['src/f/x.ts']).result, 'wait', 'with 5 not waiting on 3, 3 can wait for 6');
});

// ---------------------------------------------------------------- bisect

test('bisect: finds the first failing merge with few runs', async () => {
  const runs = [];
  const at = (bad) => async (i) => (runs.push(i), i >= bad);
  assert.equal(await findCulprit(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], at(5)), 5);
  assert.ok(runs.length <= 5, `ran ${runs.length} times`);
  assert.equal(await findCulprit(['a', 'b', 'c'], at(0)), 0, 'the first merge, with the green point passing');
});

test('bisect: no culprit when it failed before the range, or HEAD passes now (flaky)', async () => {
  assert.equal(await findCulprit(['a', 'b'], async () => true), null);
  assert.equal(await findCulprit(['a', 'b'], async () => false), null);
  assert.equal(await findCulprit([], async () => true), null);
});

test('bisect: reruns only the failing files; whole check when no file is known', () => {
  const plan = rerunPlan([{ name: 'unit', ok: false, failedFiles: ['src/a.test.ts'] }, { name: 'typecheck', ok: false, failedFiles: [] }, { name: 'e2e', ok: true, failedFiles: [] }]);
  assert.deepEqual(plan, { names: ['unit', 'typecheck'], files: { unit: ['src/a.test.ts'] } });
});

// ---------------------------------------------------------------- watchdog

const live = (over = {}) => ({ pid: 100, pending: new Map(), sigs: [], tail: [], rateLimited: null, apiError: null, ...over });
const table = [
  { pid: 100, ppid: 1, command: 'claude -p --model sonnet' },
  { pid: 101, ppid: 100, command: '/bin/zsh -c eval npx vitest' },
  { pid: 102, ppid: 101, command: 'node /x/node_modules/.bin/vitest' },
  { pid: 103, ppid: 100, command: 'npx @playwright/mcp' },
  { pid: 200, ppid: 1, command: 'node vitest --watch (someone else)' },
];

test('watchdog: a watch-mode command is found in the agent\'s own tree only', () => {
  const c = classifyStall(live({ pending: new Map([['t1', { name: 'Bash', command: 'npx vitest', at: 1 }]]) }), table);
  assert.equal(c.reason, 'command-not-exiting');
  assert.equal(c.kind, 'watch or server');
  assert.deepEqual(c.targets, [101], 'the shell running it; never pid 200 outside the tree, never the agent');
  assert.deepEqual(descendants(table, 100).map((p) => p.pid).sort(), [101, 102, 103]);
  assert.deepEqual(commandWords('cd web && npm run dev -- --port 3000'), ['web', 'dev', '3000']);
});

test('watchdog: rate limit, loops, locked ports, unknown', () => {
  assert.equal(classifyStall(live({ rateLimited: { resetsAt: 1 } }), table).reason, 'api-error');
  assert.equal(classifyStall(live({ sigs: ['a', 'b', 'a', 'b', 'a', 'b'] }), table).reason, 'loop');
  assert.equal(classifyStall(live({ tail: ['result (error): Error: listen EADDRINUSE: address already in use :::3000'] }), table).reason, 'resource-locked');
  assert.equal(classifyStall(live(), table).reason, 'unknown');
  const none = classifyStall(live({ pending: new Map([['t1', { name: 'Bash', command: 'sleep-forever-thing', at: 1 }]]) }), table);
  assert.equal(none.reason, 'unknown', 'no matching process: nothing is killed');
  assert.deepEqual(none.targets, []);
});

test('reports: readReport reads jest/vitest and playwright formats', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rep-'));
  fs.writeFileSync(path.join(dir, 'u.json'), JSON.stringify({ testResults: [{ name: path.join(dir, 'src/a.test.ts'), status: 'failed', assertionResults: [{ fullName: 'C5 adds', status: 'failed' }, { fullName: 'C6 ok', status: 'passed' }] }] }));
  assert.deepEqual(readReport('vitest', path.join(dir, 'u.json'), dir), [{ file: 'src/a.test.ts', title: 'C5 adds', ok: false }, { file: 'src/a.test.ts', title: 'C6 ok', ok: true }]);
  fs.writeFileSync(path.join(dir, 'p.json'), JSON.stringify({ config: { rootDir: path.join(dir, 'e2e') }, suites: [{ title: 'add.spec.ts', file: 'add.spec.ts', specs: [], suites: [{ title: 'Add', specs: [{ title: 'adds', tags: ['@C7'], file: 'add.spec.ts', ok: false, tests: [{ results: [{ status: 'failed' }] }] }] }] }] }));
  assert.deepEqual(readReport('playwright', path.join(dir, 'p.json'), dir), [{ file: 'e2e/add.spec.ts', title: 'Add adds @C7', ok: false }]);
});

// ---------------------------------------------------------------- briefs

test('briefs: a ticket gets the contracts it provides (file in its Owns) and the ones it uses', async () => {
  const { contractsText, implementerTask } = await import('../../orchestrator/lib/briefs.mjs');
  const plan = { architecture: { contracts: [
    { name: 'TaskStore', file: 'server/tasks/store.ts', summary: 'list(userId): Task[]' },
    { name: 'slot:input', file: 'web/slots.ts', summary: 'input slot' },
    { name: 'Other', file: 'lib/other.ts', summary: 'not ours' },
  ] } };
  const foundation = { issue: 2, owns: ['server/**', 'web/**', 'package.json'], uses: [], extraOwns: [], title: 'x', body: 'b', size: 'L', branch: 'b' };
  const text = contractsText(plan, foundation);
  assert.match(text, /Contracts you provide[^]*TaskStore[^]*list\(userId\)[^]*slot:input/);
  assert.doesNotMatch(text, /Other/);
  const slice = { issue: 4, owns: ['src/features/add/**'], uses: ['TaskStore'], extraOwns: [] };
  assert.match(contractsText(plan, slice), /Contracts you provide[^]*none[^]*Contracts you use[^]*TaskStore/);
  const ctx = { plan, profile: { checks: {} } };
  assert.match(implementerTask(ctx, foundation, { port: 1 }), /`package\.json` is yours for scripts/);
  assert.match(implementerTask(ctx, { ...slice, title: 'y', body: 'b', size: 'M', branch: 'b' }, { port: 1 }), /`package\.json` and the lockfile are not yours/);
});
