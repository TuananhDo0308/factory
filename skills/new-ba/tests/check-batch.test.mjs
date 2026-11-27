// node --test tests/   (from the skill's folder)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { batchProblems } from '../scripts/check-batch.mjs';
import { ticketProblems } from '../scripts/check-ticket.mjs';
import { buildPlan, globsOverlap, planFromEpicBody, readBatchDir, replacePlanBlock } from '../scripts/lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VALID = path.join(HERE, 'fixtures', 'valid');
const VALID_DEPS = path.join(HERE, 'fixtures', 'valid-deps');
const CLI = path.join(HERE, '..', 'scripts', 'check-batch.mjs');

// A copy of the valid batch with some files changed: { 'T3.md': (text) => text }.
function variant(changes = {}, batchChange = (b) => b, base = VALID) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'new-ba-'));
  for (const f of fs.readdirSync(base)) fs.copyFileSync(path.join(base, f), path.join(dir, f));
  for (const [file, change] of Object.entries(changes)) {
    const p = path.join(dir, file);
    fs.writeFileSync(p, change(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''));
  }
  const b = JSON.parse(fs.readFileSync(path.join(dir, 'batch.json'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'batch.json'), JSON.stringify(batchChange(b), null, 2));
  return dir;
}

function check(dir) {
  const { batch, tickets, published } = readBatchDir(dir);
  const { plan, parsed } = buildPlan({ id: batch.id, title: batch.title, architecture: batch.architecture, waveLimitReason: batch.waveLimitReason }, tickets);
  return { plan, ...batchProblems(plan, parsed, { previous: published }) };
}

const run = (dir) => {
  try {
    return { code: 0, out: execFileSync('node', [CLI, '--dir', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { code: e.status, out: e.stdout, err: e.stderr };
  }
};

const has = (list, re) => assert.ok(list.some((p) => re.test(p)), `expected a line matching ${re}, got:\n${list.join('\n')}`);

test('a valid batch passes, from the command line too', () => {
  const r = check(VALID);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.plan.waves.map((w) => w.tickets.map((t) => t.key)), [['T1'], ['T2', 'T3']]);
  assert.match(r.plan.hash, /^sha256:[0-9a-f]{64}$/);
  const cli = run(VALID);
  assert.equal(cli.code, 0);
  assert.match(cli.out, /check-batch: pass/);
});

test('two tickets of one wave owning the same file fail', () => {
  const dir = variant({ 'T3.md': (t) => t.replace('- `src/pages/list/features/toggle-done/**`', '- `src/pages/list/features/toggle-done/**`\n- `src/pages/list/features/add-task/Form.tsx`') });
  const r = check(dir);
  has(r.problems, /T2 and T3 are both in wave 1 and both own `src\/pages\/list\/features\/add-task\/\*\*` \/ `src\/pages\/list\/features\/add-task\/Form\.tsx`/);
  assert.equal(run(dir).code, 1);
});

test('a dependency on a later wave fails', () => {
  const dir = variant({ 'T1.md': (t) => t.replace(/## Depends on\n\nnone/, '## Depends on\n\n- #T2: the form') });
  has(check(dir).problems, /T1 \(wave 0\) depends on T2 \(wave 1\)/);
});

test('a dependency inside the same wave fails', () => {
  const dir = variant({ 'T3.md': (t) => t.replace('- #T1: the store and the row slot', '- #T1: the store and the row slot\n- #T2: a task to tick') });
  has(check(dir).problems, /T3 \(wave 1\) depends on T2 \(wave 1\)/);
});

test('a criterion in two tickets fails, by id and by text', () => {
  const byId = variant({ 'T3.md': (t) => t.replace('- **C10**', '- **C7**') });
  has(check(byId).problems, /C7 is in T2 and in T3/);
  const byText = variant({ 'T3.md': (t) => t.replace(/- \*\*C10\*\* .*/, '- **C10** A title longer than 200 characters is refused with "Tối đa 200 ký tự".') });
  has(check(byText).problems, /T3 C10 says the same as a criterion of T2/);
});

test('four waves fail, unless the plan says why', () => {
  const four = {
    'T3.md': (t) => t.replace(/## Wave\n\n1/, '## Wave\n\n2').replace('- #T1: the store and the row slot', '- #T1: the store and the row slot\n- #T2: a task to tick'),
    'T4.md': () => fs.readFileSync(path.join(VALID, 'T3.md'), 'utf8').replace(/C8\b/, 'C11').replace(/C9\b/, 'C12').replace(/C10\b/, 'C13').replace(/## Wave\n\n1/, '## Wave\n\n3').replace(/toggle-done/g, 'delete-task').replace('- #T1: the store and the row slot', '- #T1: the store\n- #T3: done tasks').replace(/ticks its checkbox/, 'presses Delete').replace(/unticks it/, 'undoes').replace(/done state is kept/, 'deletion is kept'),
  };
  const addT4 = (b) => ({ ...b, tickets: [...b.tickets, { key: 'T4', title: 'Delete a task', size: 'S', sizeReason: 'one button' }] });
  const r = check(variant(four, addT4));
  has(r.problems, /4 waves; at most 3/);
  const excused = check(variant(four, (b) => ({ ...addT4(b), waveLimitReason: 'each step reads what the last one wrote' })));
  assert.deepEqual(excused.problems, []);
  has(excused.looks, /4 waves .*each step reads/);
});

test('a gap in the wave numbers fails', () => {
  has(check(variant({ 'T2.md': (t) => t.replace(/## Wave\n\n1/, '## Wave\n\n2'), 'T3.md': (t) => t.replace(/## Wave\n\n1/, '## Wave\n\n2') })).problems, /no gap; found 0, 2/);
});

test('a contract that is not defined, or not from an earlier wave, fails', () => {
  has(check(variant({ 'T2.md': (t) => t.replace('- `slot:input` from #T1', '- `slot:footer` from #T1') })).problems, /T2 uses `slot:footer`, which is not in architecture.contracts/);
  const sameWave = variant({}, (b) => ({ ...b, architecture: { ...b.architecture, contracts: [...b.architecture.contracts, { name: 'AddForm', file: 'src/pages/list/features/add-task/Form.tsx', summary: 'the form' }] } }));
  fs.appendFileSync(path.join(sameWave, 'T3.md'), '');
  fs.writeFileSync(path.join(sameWave, 'T3.md'), fs.readFileSync(path.join(sameWave, 'T3.md'), 'utf8').replace('- `slot:item-action` from #T1', '- `slot:item-action` from #T1\n- `AddForm` from #T2'));
  has(check(sameWave).problems, /T3 \(wave 1\) uses `AddForm`, provided by T2 in wave 1/);
  has(check(variant({ 'T2.md': (t) => t.replace('- #T1: the store and the input slot', 'none') })).problems, /T2 uses `TaskRepo` from T1 but does not list T1/);
});

test('a size below what the factory will accept fails', () => {
  has(check(variant({ 'T1.md': (t) => t.replace('M: foundation', 'S: foundation') })).problems, /T1 is size S but is at least M: 4 criteria/);
  const risky = variant({ 'T3.md': (t) => t.replace('ticks its checkbox', 'signs in and ticks its checkbox') });
  has(check(risky).problems, /T3 is size S but is at least L: touches auth/);
});

test('the plan must fit the schema', () => {
  has(check(variant({ 'T3.md': (t) => t.replace('S: a checkbox', 'XL: a checkbox') })).problems, /plan: .*size (is required|must be one of S, M, L)/);
  has(check(variant({}, (b) => ({ ...b, id: 'Todo V1' }))).problems, /plan: \$\.id/);
});

test('a revision keeps published criterion numbers', () => {
  const published = { repo: 'o/r', epic: 10, issues: {}, criteria: { C1: 'T1', C2: 'T1', C3: 'T1', C4: 'T1', C5: 'T2', C6: 'T2', C7: 'T2', C8: 'T3', C9: 'T3', C10: 'T3', C11: 'T3' } };
  const dir = variant({ 'published.json': () => JSON.stringify(published), 'T2.md': (t) => t.replace(/(- \*\*C7\*\* .*)/, '$1\n- **C9** The field keeps focus after a task is added.') });
  const r = check(dir);
  has(r.problems, /C9 is in T2 and in T3|C9 was in T3 and is now in T2/);
  has(r.looks, /C11 \(T3\) was dropped/);
  const reused = variant({ 'published.json': () => JSON.stringify(published), 'T2.md': (t) => t.replace(/(- \*\*C7\*\* .*)/, '$1\n- **C12** The field keeps focus after a task is added.').replace('S: one field', 'M: one field') });
  assert.deepEqual(check(reused).problems, []);
});

test('the hash follows the contract fields and nothing else', () => {
  const base = check(VALID).plan.hash;
  assert.equal(check(variant({ 'T2.md': (t) => t.replace('People add a task by typing it.', 'People add tasks.') })).plan.hash, base);
  assert.notEqual(check(variant({ 'T2.md': (t) => t.replace('`e2e/list/add-task/**`', '`e2e/list/add/**`') })).plan.hash, base);
  assert.notEqual(check(variant({ 'T2.md': (t) => t.replace('"Mua sữa" appears', '"Mua sữa" shows') })).plan.hash, base);
});

test('globs overlap when one file can match both', () => {
  assert.ok(globsOverlap('src/a/**', 'src/a/b.ts'));
  assert.ok(globsOverlap('src/**/index.ts', 'src/features/x/index.ts'));
  assert.ok(globsOverlap('src/*.ts', 'src/App.ts'));
  assert.ok(globsOverlap('src/a/', 'src/a/b/c.ts'));
  assert.ok(!globsOverlap('src/features/a/**', 'src/features/b/**'));
  assert.ok(!globsOverlap('src/*.ts', 'src/a/b.ts'));
  assert.ok(!globsOverlap('e2e/a.spec.ts', 'e2e/b.spec.ts'));
});

test('the plan block round-trips through an epic body', () => {
  const { plan } = check(VALID);
  const body = replacePlanBlock('## Objective\n\nx\n', { ...plan, epic: 10 });
  assert.deepEqual(planFromEpicBody(body), { ...plan, epic: 10 });
  const again = replacePlanBlock(`${body}\n## After\n\ny\n`, { ...plan, epic: 11 });
  assert.equal(planFromEpicBody(again).epic, 11);
  assert.match(again, /## After/);
  assert.equal(again.match(/## Plan/g).length, 1);
});

test('two waves owning one file must be ordered by Depends on, since the factory schedules by dependency', () => {
  const t4 = () =>
    fs.readFileSync(path.join(VALID, 'T3.md'), 'utf8')
      .replace(/C8\b/, 'C11').replace(/C9\b/, 'C12').replace(/C10\b/, 'C13')
      .replace(/## Wave\n\n1/, '## Wave\n\n2')
      .replace('- `src/pages/list/features/toggle-done/**`', '- `src/pages/list/features/add-task/Form.tsx`')
      .replace('- `e2e/list/toggle-done/**`', '- `e2e/list/edit-task/**`')
      .replace(/ticks its checkbox/, 'double-clicks it').replace(/unticks it/, 'presses Escape').replace(/done state is kept/, 'new title is kept');
  const addT4 = (b) => ({ ...b, tickets: [...b.tickets, { key: 'T4', title: 'Edit a task' }] });
  has(check(variant({ 'T4.md': t4 }, addT4)).problems, /T2 \(wave 1\) and T4 \(wave 2\) both own .*T4 does not depend on T2/);
  const ordered = variant({ 'T4.md': () => t4().replace('- #T1: the store and the row slot', '- #T1: the store and the row slot\n- #T2: the form it extends') }, addT4);
  assert.deepEqual(check(ordered).problems, []);
});

test('a valid batch with new dependencies passes, and they are in the plan and the hash', () => {
  const r = check(VALID_DEPS);
  assert.deepEqual(r.problems, []);
  const t3 = r.plan.waves[1].tickets.find((t) => t.key === 'T3');
  assert.deepEqual(t3.newDependencies, ['zod@3.23.8', 'date-fns@4.1.0']);
  assert.deepEqual(r.plan.waves[0].tickets[0].newDependencies, ['@fontsource/be-vietnam-pro@5.1.0']);
  assert.deepEqual(check(VALID).plan.waves[1].tickets[0].newDependencies, []);
  const bumped = check(variant({ 'T3.md': (t) => t.replace('date-fns@4.1.0', 'date-fns@4.1.1') }, undefined, VALID_DEPS));
  assert.notEqual(bumped.plan.hash, r.plan.hash);
  for (const k of ['T1', 'T2', 'T3']) assert.deepEqual(ticketProblems({ title: 'x', body: fs.readFileSync(path.join(VALID_DEPS, `${k}.md`), 'utf8') }), []);
});

test('two tickets declaring one package at different versions fail', () => {
  const dir = variant({ 'T3.md': (t) => t.replace('`zod@3.23.8`: validates the patch', '`zod@3.22.0`: validates the patch') }, undefined, VALID_DEPS);
  has(check(dir).problems, /T3 declares zod@3\.22\.0 and T2 declares zod@3\.23\.8/);
  assert.equal(run(dir).code, 1);
});

test('a dependency not written name@version fails, in the ticket and in the plan', () => {
  const dir = variant({ 'T2.md': (t) => t.replace('`zod@3.23.8`', '`zod`') }, undefined, VALID_DEPS);
  has(check(dir).problems, /plan: .*newDependencies\[0\] "zod" does not match/);
  has(ticketProblems({ title: 'x', body: fs.readFileSync(path.join(dir, 'T2.md'), 'utf8') }), /New dependencies: "zod" is not name@version/);
});

test('a batch with e2e whose foundation names no PORT fails', () => {
  const dir = variant({ 'T1.md': (t) => t.replace(' on the port in `PORT`', '').replace(' on the port in `PORT` (never reusing a running one)', '') });
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'T1.md'), 'utf8'), /PORT/);
  has(check(dir).problems, /the batch has e2e tests but no foundation criterion names `PORT`/);
});

test('a ticket whose Owns has no place for its tests fails', () => {
  const dir = variant({ 'T3.md': (t) => t.replace('- `src/pages/list/features/toggle-done/**`\n- `e2e/list/toggle-done/**`', '- `src/pages/list/features/toggle-done/index.ts`\n- `src/pages/list/features/toggle-done/Toggle.tsx`') });
  has(check(dir).problems, /T3 owns no place for its tests/);
  const withTest = variant({ 'T3.md': (t) => t.replace('- `src/pages/list/features/toggle-done/**`\n- `e2e/list/toggle-done/**`', '- `src/pages/list/features/toggle-done/Toggle.tsx`\n- `src/pages/list/features/toggle-done/Toggle.test.tsx`') });
  assert.deepEqual(check(withTest).problems, []);
});

test('architecture.checks is required and not empty', () => {
  has(check(variant({}, (b) => { const { checks, ...architecture } = b.architecture; return { ...b, architecture }; })).problems, /architecture\.checks is missing or empty/);
  has(check(variant({}, (b) => ({ ...b, architecture: { ...b.architecture, checks: [] } }))).problems, /architecture\.checks is missing or empty/);
});

test('an existing repository is not held to the pages-features rules', () => {
  const oldStyle = {
    'T1.md': (t) => t.replace('- `CLAUDE.md`\n- `src/app/**`\n- `src/shared/**`\n- `src/pages/list/page.tsx`', '- `src/App.tsx`\n- `src/tasks/**`'),
    'T2.md': (t) => t.replace('- `src/pages/list/features/add-task/**`\n- `e2e/list/add-task/**`', '- `src/components/AddTask.tsx`\n- `src/components/AddTask.test.tsx`\n- `src/App.css`'),
  };
  const existing = (b) => ({ ...b, architecture: { ...b.architecture, layout: 'existing', contracts: b.architecture.contracts.map((c) => ({ ...c, file: c.name === 'TaskRepo' ? 'src/tasks/repo.ts' : 'src/App.tsx' })) } });
  assert.deepEqual(check(variant(oldStyle, existing)).problems, []);
  const asNew = check(variant(oldStyle, (b) => ({ ...existing(b), architecture: { ...existing(b).architecture, layout: 'pages-features' } })));
  has(asNew.problems, /T2 owns `src\/components\/AddTask\.tsx`, outside its feature folder/);
  has(asNew.problems, /the foundation does not own CLAUDE\.md/);
});

test('a pages-features slice owning outside its feature folder fails', () => {
  const dir = variant({ 'T2.md': (t) => t.replace('- `e2e/list/add-task/**`', '- `e2e/list/add-task/**`\n- `src/lib/format.ts`') });
  has(check(dir).problems, /T2 owns `src\/lib\/format\.ts`, outside its feature folder/);
  has(check(variant({ 'T2.md': (t) => t.replace('- `e2e/list/add-task/**`', '- `e2e/list/add-task/**`\n- `src/shared/tasks/extra.ts`') })).problems, /T2 owns `src\/shared\/tasks\/extra\.ts`, inside src\/shared/);
  has(check(variant({ 'T2.md': (t) => t.replace('- `e2e/list/add-task/**`', '- `e2e/list/add-task/**`\n- `src/app/router.tsx`') })).problems, /T2 owns `src\/app\/router\.tsx`, inside src\/app/);
  has(check(variant({ 'T2.md': (t) => t.replace('- `e2e/list/add-task/**`', '- `e2e/list/other/**`') })).looks, /T2 owns `e2e\/list\/other\/\*\*`; its e2e tests belong under e2e\/list\/add-task\//);
});

test('a pages-features slice owning a page.tsx fails', () => {
  const dir = variant({
    'T2.md': (t) => t.replace('- `src/pages/list/features/add-task/**`', '- `src/pages/list/features/add-task/**`\n- `src/pages/list/page.tsx`'),
    'T1.md': (t) => t.replace('- `src/pages/list/page.tsx`\n', ''),
  });
  has(check(dir).problems, /T2 owns `src\/pages\/list\/page\.tsx`, which includes a page\.tsx/);
  has(check(dir).problems, /the foundation does not own src\/pages\/list\/page\.tsx/);
});

test('a pages-features foundation that does not own CLAUDE.md fails, and its checks are named in its criteria', () => {
  has(check(variant({ 'T1.md': (t) => t.replace('- `CLAUDE.md`\n', '') })).problems, /the foundation does not own CLAUDE\.md/);
  has(check(variant({}, (b) => ({ ...b, architecture: { ...b.architecture, checks: [...b.architecture.checks, { name: 'typecheck', command: 'npm run typecheck' }] } }))).looks, /no foundation criterion names the check `npm run typecheck`/);
});

test('detect-layout tells an empty repository from one with code', async () => {
  const { layoutOf } = await import('../scripts/detect-layout.mjs');
  assert.equal(layoutOf([]).layout, 'pages-features');
  assert.equal(layoutOf(['README.md', 'LICENSE', '.gitignore', '.github/workflows/ci.yml', 'docs/idea.md', '']).layout, 'pages-features');
  const r = layoutOf(['README.md', 'package.json', 'src/main.ts']);
  assert.equal(r.layout, 'existing');
  assert.equal(r.codeFiles, 2);
});
