// 4a-4c for one ticket: its worktree, one implementer, the checks done by code,
// the reviewer its size calls for. 4d is fixloop.mjs, the merge is merge.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { Agents } from './agents.mjs';
import { implementerTask, reviewerTask, system } from './briefs.mjs';
import { checkFailures, runChecks } from './checks.mjs';
import { criteriaTests, isTestFile } from './criteria.mjs';
import { fix } from './fixloop.mjs';
import { addWorktree, changes, cloneModules, commitLeftovers, fileAt, head, ident, mergeBase, removedLines, removeWorktree, STAGING } from './git.mjs';
import { mergeTicket } from './merge.mjs';
import { implementerModel, REVIEWER } from './models.mjs';
import { effectiveOwns, matches, owned, ownsProblems } from './owns.mjs';
import { sharedFiles } from './plan.mjs';
import { detectProfile } from './profile.mjs';
import { alive, freePort, git, killTree, run, sleep } from './sh.mjs';
import { now } from './state.mjs';

export const profileOf = (ctx, dir) => detectProfile(dir, ctx.plan?.architecture?.checks);

export const ticketEnv = (t) => ({
  PORT: String(t.port),
  BASE_URL: `http://localhost:${t.port}`,
  CI: '1',
  XDG_CACHE_HOME: path.join(t.wt, '.nf-cache'),
  npm_config_cache: path.join(t.wt, '.nf-cache', 'npm'),
});

export const note = (ctx, t, what) => {
  t.history.push(`${now().slice(11, 19)} ${what}`);
  ctx.store.save();
};

// The worktree, made or reused. A reverted ticket coming back gets a new branch
// from staging with its revert commits reverted; it never merges staging into the
// old branch, which would apply the revert and drop its code.
export async function setupWorktree(ctx, t) {
  t.port = await freePort();
  t.wt ||= path.join(ctx.wtRoot, String(t.issue));
  if (t.restore === 'revert') {
    await removeWorktree(ctx.dir, t.wt);
    t.generation = (t.generation || 0) + 1;
    t.branch = `factory/${ctx.store.state.epic}/${t.issue}-r${t.generation}`;
    await addWorktree(ctx.dir, t.wt, t.branch, STAGING);
    for (const sha of [...t.reverts].reverse()) await git(t.wt, ...ident, 'revert', '--no-edit', sha);
    t.reverts = [];
    t.reverted = false;
    t.restore = null;
    t.syncStaging = false;
    note(ctx, t, `new branch ${t.branch} from staging; its revert reverted`);
  } else {
    t.branch ||= `factory/${ctx.store.state.epic}/${t.issue}`;
    await addWorktree(ctx.dir, t.wt, t.branch, STAGING);
  }
  await cloneModules(ctx.base, t.wt);
  if (t.syncStaging) {
    t.syncStaging = false;
    const files = await syncStaging(ctx, t);
    if (files.length) t.pending = [...(t.pending || []), { kind: 'conflict', files, message: `merging the newest staging into this branch conflicts in ${files.join(', ')}` }];
  }
  ctx.store.save();
}

// Merge the newest staging into the ticket's branch. Conflicts stay on disk, with
// their markers, for the implementer of the next round.
export async function syncStaging(ctx, t) {
  const r = await run('git', [...ident, 'merge', '--no-edit', STAGING], { cwd: t.wt, allowFail: true });
  if (r.code === 0) return [];
  const files = (await git(t.wt, 'diff', '--name-only', '--diff-filter=U')).split('\n').filter(Boolean);
  note(ctx, t, `staging merged into the branch with conflicts in ${files.join(', ')}`);
  return files;
}

// A process the implementer left listening on the ticket's PORT (a dev server started
// with \`( ... &)\` leaves the agent's tree) would fail the e2e that follows. Only a
// process whose working directory is this ticket's worktree is stopped, by its PID.
export async function freeTicketPort(ctx, t) {
  const r = await run('lsof', ['-nP', `-iTCP:${t.port}`, '-sTCP:LISTEN', '-t'], { allowFail: true });
  const pids = [...new Set(r.stdout.split('\n').map(Number).filter((p) => p && p !== process.pid))];
  for (const pid of pids) {
    const c = await run('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { allowFail: true });
    const cwd = /^n(.*)$/m.exec(c.stdout)?.[1] || '';
    if (!(cwd === t.wt || cwd.startsWith(`${t.wt}/`))) continue;
    killTree(pid);
    await sleep(1000);
    if (alive(pid)) killTree(pid, 'SIGKILL');
    note(ctx, t, `stopped PID ${pid}: the implementer left it listening on PORT ${t.port}`);
  }
}

// One implementer session. Returns { ok, blocked?, error? }.
export async function implement(ctx, t, { round = 0, failures = [], diagnosis = null, escalate = false, answer = null } = {}) {
  const m = implementerModel(t.size, escalate);
  const r = await ctx.agents.run({
    role: 'implementer',
    issue: t.issue,
    step: round ? `fix ${round}` : 'implement',
    ...m,
    cwd: t.wt,
    env: ticketEnv(t),
    system: system(ctx.skillDir, 'implementer'),
    prompt: implementerTask(ctx, t, { round, failures, diagnosis, answer, port: t.port, profile: profileOf(ctx, t.wt) }),
  });
  await commitLeftovers(t.wt, `#${t.issue}: work the implementer left uncommitted`);
  await freeTicketPort(ctx, t);
  note(ctx, t, `${round ? `fix round ${round}` : 'build'} by ${m.model}${m.effort ? ` (${m.effort})` : ''}: ${r.ok ? r.structured?.status || 'done' : 'agent error'}`);
  if (!r.ok) return { ok: false, error: r.error };
  if (r.structured?.status === 'blocked') return { ok: false, blocked: r.structured.blockedReason || r.structured.summary };
  return { ok: true };
}

async function testFiles(t) {
  const listed = (await git(t.wt, 'ls-files')).split('\n').filter(Boolean);
  const owns = effectiveOwns(t);
  return listed.filter((f) => isTestFile(f) && owned(f, owns)).map((f) => ({ path: f, text: fs.readFileSync(path.join(t.wt, f), 'utf8') }));
}

const parseJson = (s) => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};

// 4b and 4c. Returns the failures, [] when the ticket may merge.
export async function verify(ctx, t, { skipReview = false } = {}) {
  ctx.store.state.tickets[t.issue].phase = 'check';
  const base = await mergeBase(t.wt, 'HEAD', STAGING);
  const tag = `r${t.rounds}-${Date.now() % 100000}`;
  const [checks, diff] = await Promise.all([
    runChecks(t.wt, profileOf(ctx, t.wt), Object.keys(profileOf(ctx, t.wt).checks), { env: ticketEnv(t), logDir: path.join(ctx.runDir, 'logs', String(t.issue)), tag }),
    changes(t.wt, base),
  ]);
  const failures = checkFailures(checks);
  const declared = Object.values(ctx.store.state.tickets).flatMap((x) => x.newDependencies);
  const [before, after] = await Promise.all([fileAt(t.wt, base, 'package.json'), fileAt(t.wt, 'HEAD', 'package.json')]);
  for (const p of ownsProblems(diff, effectiveOwns(t), { pkgBefore: parseJson(before), pkgAfter: parseJson(after), declared })) failures.push({ kind: 'owns', ownsKind: p.kind, file: p.file, message: p.message });
  for (const f of t.extraOwns.filter((x) => (ctx.plan.architecture?.contracts || []).some((c) => c.file === x))) {
    const removed = await removedLines(t.wt, base, f);
    if (removed) failures.push({ kind: 'owns', ownsKind: 'contract', file: f, message: `${f} is a contract file: it may only be added to, but ${removed} line(s) of it were changed or removed` });
  }
  const ct = criteriaTests(await testFiles(t), t.criteria.map((c) => c.id));
  for (const p of ct.problems) failures.push({ kind: 'criteria', message: p });
  const s = { checks: checks.results.map((r) => ({ name: r.name, ok: r.ok, ms: r.ms })), failures: failures.length };
  (t.verifications ||= []).push({ at: now(), ...s });
  note(ctx, t, `checks: ${checks.results.map((r) => `${r.name} ${r.ok ? 'ok' : 'FAIL'}`).join(', ') || 'none'}; ${failures.length} failure(s)`);
  if (failures.length || skipReview) return failures;

  // S whose diff touches a shared file is reviewed as M.
  const files = diff.flatMap((c) => [c.path, c.from].filter(Boolean));
  if (t.size === 'S' && !t.reviewAs) {
    const shared = sharedFiles(ctx.plan, ctx.store.state.tickets, t);
    const hit = files.find((f) => shared.some((g) => matches(f, g)));
    if (hit) {
      t.reviewAs = 'M';
      note(ctx, t, `S touches the shared file ${hit}: reviewed as M`);
    }
  }
  const reviewSize = t.size === 'S' ? t.reviewAs : t.size;
  if (!reviewSize) return [];
  const tip = await head(t.wt);
  if (t.reviewedTip === tip) return [];
  const verdict = await review(ctx, t, { base, size: reviewSize });
  if (verdict.pass) t.reviewedTip = tip;
  ctx.store.save();
  return verdict.failures;
}

export async function review(ctx, t, { base, size = t.size, arbiter = null, model = null }) {
  ctx.store.state.tickets[t.issue].phase = arbiter ? 'arbiter' : 'review';
  const diffText = (await git(t.wt, 'diff', '--no-color', `${base}..HEAD`)).slice(0, 80000);
  const r = await ctx.agents.run({
    role: 'reviewer',
    issue: t.issue,
    step: arbiter ? 'second review' : 'review',
    ...(model || REVIEWER[size] || REVIEWER.M),
    cwd: t.wt,
    env: ticketEnv(t),
    system: system(ctx.skillDir, 'reviewer', { size }),
    prompt: reviewerTask(ctx, t, { base, diff: diffText, arbiter }),
  });
  const v = r.structured;
  if (!r.ok || !v) {
    note(ctx, t, `review: the reviewer stopped with an error`);
    return { pass: false, failures: [{ kind: 'review', message: `the reviewer could not finish: ${String(r.error).slice(0, 300)}` }] };
  }
  const failures = [
    ...(v.criteria || []).filter((c) => !c.met).map((c) => ({ kind: 'review', message: `${c.id} is not met: ${c.why || ''}` })),
    ...(v.findings || []).filter((f) => f.severity === 'blocking').map((f) => ({ kind: 'review', message: `${f.file ? `${f.file}: ` : ''}${f.problem}${f.fix ? ` Fix: ${f.fix}` : ''}` })),
  ];
  const pass = v.verdict === 'pass' && failures.length === 0;
  note(ctx, t, `${arbiter ? 'second review' : 'review'}: ${pass ? 'pass' : `fail (${failures.length})`}`);
  return { pass, failures: pass ? [] : failures.length ? failures : [{ kind: 'review', message: 'the reviewer failed the ticket without a reason' }], raw: v };
}

const depStopped = (ctx, t) => t.dependsOn.some((d) => ['needs-decision', 'blocked'].includes(ctx.store.state.tickets[d]?.status));

// Drive a ticket until it rests: merged, waiting, needs-decision or blocked.
// Its time in the report is the time spent here, summed over every drive.
export async function drive(ctx, t) {
  const t0 = Date.now();
  try {
    await driveOnce(ctx, t);
  } finally {
    t.activeMs = (t.activeMs || 0) + (Date.now() - t0);
    ctx.store.save();
  }
}

async function driveOnce(ctx, t) {
  t.status = 'running';
  t.startedAt ||= now();
  ctx.store.save();
  await setupWorktree(ctx, t);
  let failures = t.pending || [];
  t.pending = [];
  if (t.waitPlan) {
    const r = await fix(ctx, t, [], { resumeWait: true });
    if (r.stop) return;
    failures = r.failures || [];
  }
  if (!t.implemented) {
    t.phase = 'implement';
    const r = await implement(ctx, t);
    t.implemented = true;
    ctx.store.save();
    if (r.blocked) failures.push({ kind: 'blocked', message: `the implementer stopped: ${r.blocked}` });
    else if (r.error) failures.push({ kind: 'agent', message: `the implementer stopped with an error: ${r.error.slice(0, 500)}` });
  }
  for (;;) {
    if (depStopped(ctx, t)) {
      t.status = 'blocked';
      note(ctx, t, 'blocked: a ticket it depends on waits on a decision');
      return;
    }
    if (!failures.length) {
      failures = await verify(ctx, t);
      if (!failures.length) {
        if (depStopped(ctx, t)) continue;
        t.phase = 'merge';
        const m = await mergeTicket(ctx, t);
        if (m.ok) return;
        failures = m.failures;
      }
    }
    t.lastFailures = failures;
    const step = await fix(ctx, t, failures);
    if (step.stop) return;
    failures = step.failures || [];
  }
}

export { Agents };
