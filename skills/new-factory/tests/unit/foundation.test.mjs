import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Store } from '../../orchestrator/lib/state.mjs';
import { decide } from '../../orchestrator/lib/queue.mjs';
import { addDependencies, dependenciesToAdd, isDevDependency } from '../../orchestrator/lib/prepare.mjs';
import { detectProfile, scriptCmd } from '../../orchestrator/lib/profile.mjs';
import { changedTickets } from '../../orchestrator/lib/plan.mjs';
import { tmpDir, writeFiles } from '../fixtures/make.mjs';

test('state: saved atomically, reloads the same, state.js mirrors it', () => {
  const dir = tmpDir('state');
  const s = new Store(path.join(dir, 'run'));
  s.init({ runId: 'epic-1', repo: 'o/r', epic: 1, dir });
  s.state.tickets[5] = { status: 'merged' };
  s.save();
  const again = new Store(path.join(dir, 'run'));
  assert.equal(again.load().tickets[5].status, 'merged');
  assert.match(fs.readFileSync(path.join(dir, 'run', 'state.js'), 'utf8'), /^window\.STATE = \{/);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'run')).filter((f) => f.endsWith('.tmp')), []);
});

test('state: once() does a side effect a single time, even after a reload', async () => {
  const dir = tmpDir('once');
  const s = new Store(path.join(dir, 'run'));
  s.init({ runId: 'r', repo: 'o/r', epic: 1, dir });
  let n = 0;
  assert.equal(await s.once('merge:12', async () => (n++, 'sha1')), 'sha1');
  const again = new Store(path.join(dir, 'run'));
  again.load();
  assert.equal(await again.once('merge:12', async () => (n++, 'sha2')), 'sha1');
  assert.equal(n, 1);
});

test('state: step timings add up across a restart', () => {
  const dir = tmpDir('steps');
  const s = new Store(path.join(dir, 'run'));
  s.init({ runId: 'r', repo: 'o/r', epic: 1, dir });
  s.begin('prepare');
  s.end('prepare');
  const first = s.state.steps.prepare.ms;
  s.begin('prepare');
  s.end('prepare');
  assert.ok(s.state.steps.prepare.ms >= first);
  assert.ok(s.state.steps.prepare.end);
});

test('queue: the first run starts, a second waits, and starts once the first is gone', () => {
  const alive = new Set([1, 2]);
  const isAlive = (pid) => alive.has(pid);
  const a = decide({}, { runId: 'A', pid: 1 }, isAlive);
  assert.equal(a.start, true);
  const b = decide(a.queue, { runId: 'B', pid: 2 }, isAlive);
  assert.equal(b.start, false);
  assert.equal(b.ahead, 'A');
  const b2 = decide(b.queue, { runId: 'B', pid: 2 }, isAlive);
  assert.equal(b2.queue.waiting.length, 1, 'waiting twice keeps one place');
  alive.delete(1);
  assert.equal(decide(b2.queue, { runId: 'B', pid: 2 }, isAlive).start, true);
});

test('queue: a rerun of the same batch after a crash takes its place back', () => {
  const q = { active: { runId: 'A', pid: 999999 }, waiting: [] };
  assert.equal(decide(q, { runId: 'A', pid: 3 }, () => true).start, true);
});

test('queue: order is kept between two waiting runs', () => {
  const isAlive = () => true;
  let q = { active: { runId: 'A', pid: 1 }, waiting: [] };
  q = decide(q, { runId: 'B', pid: 2 }, isAlive).queue;
  q = decide(q, { runId: 'C', pid: 3 }, isAlive).queue;
  q.active = null;
  assert.equal(decide(q, { runId: 'C', pid: 3 }, isAlive).start, false);
  assert.equal(decide(q, { runId: 'B', pid: 2 }, isAlive).start, true);
});

test('prepare: the union of new dependencies, minus what package.json has', () => {
  const pkg = { dependencies: { react: '18.3.1' }, devDependencies: { vitest: '2.0.0' } };
  const adds = dependenciesToAdd(pkg, [{ newDependencies: ['react@18.3.1', 'zod@3.23.8'] }, { newDependencies: ['vitest@2.1.0', '@types/node@22.0.0', 'zod@3.23.8'] }]);
  assert.deepEqual(adds, [
    { name: 'zod', version: '3.23.8', dev: false },
    { name: 'vitest', version: '2.1.0', dev: true },
    { name: '@types/node', version: '22.0.0', dev: true },
  ]);
  const out = addDependencies(pkg, adds);
  assert.equal(out.dependencies.zod, '3.23.8');
  assert.equal(out.devDependencies.vitest, '2.1.0');
  assert.equal(out.devDependencies['@types/node'], '22.0.0');
  assert.equal(isDevDependency('@playwright/test'), true);
  assert.equal(isDevDependency('react'), false);
});

test('prepare: no package.json yet gets a minimal one', () => {
  const out = addDependencies(null, [{ name: 'vite', version: '5.4.0', dev: true }]);
  assert.equal(out.private, true);
  assert.equal(out.devDependencies.vite, '5.4.0');
});

test('profile: checks from package.json scripts, project.json overrides', () => {
  const dir = tmpDir('profile');
  writeFiles(dir, {
    'package.json': JSON.stringify({ scripts: { typecheck: 'tsc --noEmit', lint: 'eslint .', build: 'vite build', test: 'vitest run', e2e: 'playwright test', dev: 'vite' } }),
  });
  const p = detectProfile(dir);
  assert.equal(p.pm, 'npm');
  assert.deepEqual(Object.keys(p.checks).sort(), ['build', 'e2e', 'lint', 'typecheck', 'unit']);
  assert.equal(p.checks.unit.report, 'vitest');
  assert.equal(p.checks.e2e.report, 'playwright');
  assert.equal(p.dev, 'npm run dev');
  writeFiles(dir, { '.factory/project.json': JSON.stringify({ checks: { lint: null, unit: 'node --test' } }) });
  const q = detectProfile(dir);
  assert.equal(q.checks.lint, undefined);
  assert.equal(q.checks.unit.cmd, 'node --test');
  assert.equal(scriptCmd('npm', 'test', ['a b.ts']), "npm run test -- 'a b.ts'");
  assert.equal(scriptCmd('pnpm', 'test', ['x']), "pnpm run test 'x'");
});

test('plan: tickets whose plan entry changed after BA are named', () => {
  const t = (issue, criteria) => ({ issue, owns: ['a/**'], uses: [], dependsOn: [], newDependencies: [], criteria });
  const stored = { waves: [{ wave: 0, tickets: [t(11, ['C1']), t(12, ['C2'])] }] };
  const built = { waves: [{ wave: 0, tickets: [t(11, ['C1']), t(12, ['C2', 'C3'])] }] };
  assert.deepEqual(changedTickets(stored, built), [12]);
  assert.deepEqual(changedTickets(stored, stored), []);
});

test('profile: the plan\'s architecture.checks are the checks, even with no package.json yet', async () => {
  const { planChecks, scriptOf } = await import('../../orchestrator/lib/profile.mjs');
  const dir = tmpDir('profile-plan');
  const plan = [{ name: 'test', command: 'npm test' }, { name: 'e2e', command: 'npm run e2e' }, { name: 'typecheck', command: 'npx tsc --noEmit' }, { name: 'lint-css', command: 'npx stylelint "src/**/*.css"' }];
  const p = detectProfile(dir, plan);
  assert.deepEqual(Object.keys(p.checks).sort(), ['e2e', 'lint-css', 'typecheck', 'unit']);
  assert.equal(p.checks.unit.script, 'test', 'npm test is a script, so extra args get "--"');
  assert.equal(p.checks.e2e.report, 'playwright');
  assert.equal(p.checks.typecheck.script, undefined);
  writeFiles(dir, { 'package.json': JSON.stringify({ scripts: { test: 'vitest run', e2e: 'playwright test', lint: 'eslint .', dev: 'vite' } }) });
  const q = detectProfile(dir, plan);
  assert.equal(q.checks.unit.report, 'vitest', 'the runner is read from the script the command runs');
  assert.equal(q.checks.lint, undefined, 'the plan decides the list, not package.json');
  assert.equal(q.dev, 'npm run dev');
  writeFiles(dir, { '.factory/project.json': JSON.stringify({ checks: { 'lint-css': null } }) });
  assert.equal(detectProfile(dir, plan).checks['lint-css'], undefined, 'the project\'s own file still overrides');
  assert.deepEqual(scriptOf('pnpm lint'), { pm: 'pnpm', script: 'lint' });
  assert.equal(scriptOf('npm lint'), null);
  assert.deepEqual(Object.keys(planChecks([{ name: 'unit', command: 'yarn test' }])), ['unit']);
});
