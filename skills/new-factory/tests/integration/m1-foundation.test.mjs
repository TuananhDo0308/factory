import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { readPlan } from '../../orchestrator/lib/plan.mjs';
import { precheck, prepareCommit, twoServers } from '../../orchestrator/lib/prepare.mjs';
import { addWorktree, cloneModules } from '../../orchestrator/lib/git.mjs';
import { detectProfile } from '../../orchestrator/lib/profile.mjs';
import { fakeBin, makeBatch, makeRepo, SKILL, tmpDir } from '../fixtures/make.mjs';

const T = (issue, wave, extra = {}) => ({
  issue,
  key: `T${issue - 10}`,
  title: `Ticket ${issue}`,
  wave,
  owns: [`src/features/f${issue}/**`, `e2e/f${issue}.spec.mjs`],
  criteria: wave ? [[`C${issue}`, `Feature ${issue} answers on the page`]] : [[`C${issue}`, '`npm run dev` starts the app on the port in `PORT`']],
  dependsOn: wave ? [11] : [],
  ...extra,
});

function env(root) {
  const bin = fakeBin(root);
  process.env.NF_GH_BIN = bin.gh;
  process.env.NF_FAKE_GH_DATA = path.join(root, 'gh.json');
  return bin;
}

test('plan: refuses when an issue lacks the ready label, and names it', async () => {
  const root = tmpDir('plan-label');
  env(root);
  await makeBatch(path.join(root, 'gh.json'), { tickets: [T(11, 0, { owns: ['src/**'] }), T(12, 1, { labels: ['review'] })] });
  const r = await readPlan({ skillDir: SKILL, repo: 'o/r', epic: 10, runDir: root });
  assert.equal(r.ok, false);
  assert.match(r.refusal, /label "ready": #12/);
});

test('plan: refuses with check-batch\'s own problem when the batch is wrong', async () => {
  const root = tmpDir('plan-bad');
  env(root);
  // Two tickets of one wave owning one file: check-batch refuses.
  await makeBatch(path.join(root, 'gh.json'), { tickets: [T(11, 0, { owns: ['src/a.mjs', 'src/a.test.mjs'] }), T(12, 0, { owns: ['src/a.mjs', 'src/b.test.mjs'] })] });
  const r = await readPlan({ skillDir: SKILL, repo: 'o/r', epic: 10, runDir: root });
  assert.equal(r.ok, false);
  assert.match(r.refusal, /check-batch: .*both own `src\/a\.mjs`/);
});

test('plan: builds tickets, raises size by the floor, notes tickets changed after BA', async () => {
  const root = tmpDir('plan-ok');
  env(root);
  const data = path.join(root, 'gh.json');
  const four = [1, 2, 3, 4].map((i) => [`C${20 + i}`, `Fact ${i} is shown`]);
  await makeBatch(data, { tickets: [T(11, 0, { owns: ['src/registry.mjs', 'src/app.mjs', 'src/registry.test.mjs'] }), T(12, 1, { size: 'M', criteria: four }), T(13, 1)] });
  // Someone edits #13's criteria on GitHub after BA.
  const j = JSON.parse(fs.readFileSync(data, 'utf8'));
  j.issues[13].body = j.issues[13].body.replace('- **C13** Feature 13 answers on the page', '- **C13** Feature 13 answers on the page\n- **C14** And one more');
  fs.writeFileSync(data, JSON.stringify(j));
  const r = await readPlan({ skillDir: SKILL, repo: 'o/r', epic: 10, runDir: root });
  assert.equal(r.ok, true, r.refusal);
  assert.deepEqual(Object.keys(r.tickets).sort(), ['11', '12', '13']);
  assert.deepEqual(r.tickets[13].criteria.map((c) => c.id), ['C13', 'C14']);
  assert.deepEqual(r.tickets[12].dependsOn, [11]);
  assert.deepEqual(r.changedAfterBA, ['ticket #13 changed after BA']);
  assert.ok(r.snapshot[13].hash.startsWith('sha256:'));
});

test('prepare: new dependencies and the prototype land in one commit on staging; a second run makes none', async () => {
  const root = tmpDir('prepare');
  const { work } = makeRepo(root);
  // A prototype branch with no shared history, as new-ba pushes it.
  execFileSync('sh', ['-c', 'git checkout -q --orphan prototype/demo && git rm -rfq . && echo "<html>proto</html>" > index.html && git add index.html && git commit -qm proto && git push -q origin prototype/demo && git checkout -q main'], { cwd: work });
  const protoCommit = execFileSync('git', ['rev-parse', 'prototype/demo'], { cwd: work, encoding: 'utf8' }).trim();
  execFileSync('git', ['branch', '-D', 'prototype/demo'], { cwd: work });
  const base = path.join(root, 'staging');
  await addWorktree(work, base, 'staging', 'staging');
  process.env.NF_INSTALL_CMD = 'mkdir -p node_modules/zod && echo "{}" > package-lock.json';
  const plan = { id: 'demo', prototype: { branch: 'prototype/demo', commit: protoCommit, path: 'docs/prototypes/demo/' } };
  const tickets = { 11: { newDependencies: ['zod@3.23.8'] }, 12: { newDependencies: ['zod@3.23.8', 'vitest@2.1.0'] } };
  const r = await prepareCommit({ base, plan, tickets, log: path.join(root, 'install.log') });
  assert.deepEqual(r.added.sort(), ['vitest@2.1.0', 'zod@3.23.8']);
  const files = execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: base, encoding: 'utf8' }).trim().split('\n').sort();
  assert.deepEqual(files, ['docs/prototypes/demo/index.html', 'package-lock.json', 'package.json']);
  const pkg = JSON.parse(fs.readFileSync(path.join(base, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies.zod, '3.23.8');
  assert.equal(pkg.devDependencies.vitest, '2.1.0');
  const again = await prepareCommit({ base, plan, tickets, log: path.join(root, 'install.log') });
  assert.equal(again.again, true);
  assert.equal(again.commit, r.commit);
  delete process.env.NF_INSTALL_CMD;

  // node_modules reaches a ticket worktree as a copy-on-write clone.
  const wt = path.join(root, 'wt12');
  await addWorktree(work, wt, 'factory/12', 'staging');
  assert.equal(await cloneModules(base, wt), true);
  assert.ok(fs.existsSync(path.join(wt, 'node_modules', 'zod')));
  fs.writeFileSync(path.join(wt, 'node_modules', 'zod', 'x'), '1');
  assert.equal(fs.existsSync(path.join(base, 'node_modules', 'zod', 'x')), false, 'a worktree never writes into another one\'s node_modules');
});

test('prepare: two dev servers on two ports; a server that ignores PORT is reported', async () => {
  const root = tmpDir('servers');
  const { work } = makeRepo(root);
  assert.equal(await twoServers(work, 'node server.mjs', { waitMs: 10000 }), null);
  fs.writeFileSync(path.join(work, 'fixed.mjs'), "import http from 'node:http'; http.createServer((q,s)=>s.end('x')).listen(0);\n");
  const problem = await twoServers(work, 'node fixed.mjs', { waitMs: 1500 });
  assert.match(problem, /on PORT=\d+ did not answer within 2s while a second one ran/);
  fs.writeFileSync(path.join(work, 'locked.mjs'), "console.error('SqliteError: database is locked'); process.exit(1);\n");
  const locked = await twoServers(work, 'node locked.mjs', { waitMs: 5000 });
  assert.match(locked, /exited .*its log ends: .*SqliteError: database is locked/, 'the real cause, not a guess about PORT');
  process.env.NF_MCP_CHECK = 'skip';
  const p = await precheck(work, detectProfile(work), {});
  assert.deepEqual(p.problems, []);
  assert.equal(p.servers, 'ok');
});
