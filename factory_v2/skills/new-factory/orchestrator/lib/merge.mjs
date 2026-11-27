// Step 5: merge into staging by code, one at a time, --no-ff. Lockfiles are not
// merged but made again. A check after merging runs only when a ticket waits on
// the code just merged; a failure there is traced to a merge by bisecting.
import fs from 'node:fs';
import path from 'node:path';
import { findCulprit, rerunPlan } from './bisect.mjs';
import { runChecks } from './checks.mjs';
import { addWorktree, cloneModules, conflicted, head, ident, serverTrees, STAGING } from './git.mjs';
import { release } from './locks.mjs';
import { effectiveOwns, LOCKFILES, owned } from './owns.mjs';
import { installOnce, twoServers } from './prepare.mjs';
import { detectProfile, MERGE_CHECKS, packageManager } from './profile.mjs';
import { freePort, git, gitOk, run, shell } from './sh.mjs';
import { now } from './state.mjs';
import { waitingOn } from './scheduler.mjs';

// staging on GitHub follows every merge and revert. Never forced; a refusal is noted.
export async function pushStaging(ctx) {
  const st = ctx.store.state;
  if (!(await gitOk(ctx.dir, 'remote', 'get-url', 'origin'))) return;
  const r = await run('git', ['push', '-q', 'origin', `${STAGING}:${STAGING}`], { cwd: ctx.base, allowFail: true });
  if (r.code !== 0) {
    const n = `push of ${STAGING} failed (never forced): ${r.stderr.trim().split('\n').pop()}`;
    if (!st.notes.includes(n)) st.notes.push(n);
    ctx.store.save();
  }
}

// One thing at a time on the staging worktree.
export class Serial {
  constructor() {
    this.tail = Promise.resolve();
  }
  run(fn) {
    const p = this.tail.then(fn, fn);
    this.tail = p.catch(() => {});
    return p;
  }
}

const lockCmd = (pm) => (pm === 'pnpm' ? 'pnpm install --lockfile-only --ignore-scripts' : pm === 'yarn' ? 'yarn install --mode update-lockfile' : 'npm install --package-lock-only --ignore-scripts --no-audit --no-fund');

// The merge commit of a branch tip, when it is on staging already (after a crash).
async function mergedAs(base, tip) {
  const out = await git(base, 'log', '--format=%H', '--fixed-strings', `--grep=nf-tip: ${tip}`, '-n', '1', STAGING);
  return out || null;
}

async function doMerge(ctx, t) {
  const base = ctx.base;
  const st = ctx.store.state;
  const tip = await head(t.wt);
  const already = await mergedAs(base, tip);
  if (already) return { ok: true, sha: already };
  if (await gitOk(base, 'merge-base', '--is-ancestor', tip, 'HEAD')) return { ok: true, sha: null, nothing: true };
  // Only the orchestrator works in the staging worktree. Anything left changed there
  // (an install that rewrote the lockfile, a merge a crash left open) is put back to HEAD.
  const dirty = await git(base, 'status', '--porcelain', '--untracked-files=no');
  if (dirty) {
    await run('git', ['merge', '--abort'], { cwd: base, allowFail: true });
    await git(base, 'reset', '-q', '--hard', 'HEAD');
    ctx.log(`staging worktree had changes nobody committed (${dirty.split('\n').map((l) => l.slice(3)).join(', ')}); put back to HEAD before merging #${t.issue}`);
  }
  const before = await head(base);
  const r = await run('git', [...ident, 'merge', '--no-ff', '--no-commit', t.branch], { cwd: base, allowFail: true });
  if (r.code !== 0) {
    const files = await conflicted(base);
    const real = files.filter((f) => !LOCKFILES.has(f));
    if (!files.length) {
      // Not a conflict the ticket can fix: the orchestrator's own problem, said at once.
      await run('git', ['merge', '--abort'], { cwd: base, allowFail: true });
      throw new Error(`git merge of ${t.branch} into staging failed with no conflict: ${(r.stderr || r.stdout).trim().split('\n').slice(-3).join(' ')}`);
    }
    if (real.length) {
      await run('git', ['merge', '--abort'], { cwd: base, allowFail: true });
      return { ok: false, failures: [{ kind: 'conflict', files: real, message: `merging into staging conflicts in ${real.join(', ') || '(unknown files)'}: ${(r.stderr || r.stdout).trim().split('\n').slice(-3).join(' ')}` }] };
    }
  }
  // Lockfiles are never merged: staging's, made again when package.json changed.
  for (const lf of LOCKFILES) {
    if (await gitOk(base, 'cat-file', '-e', `HEAD:${lf}`)) await git(base, 'checkout', 'HEAD', '--', lf);
    else if (fs.existsSync(path.join(base, lf))) {
      await run('git', ['rm', '-q', '--force', '--', lf], { cwd: base, allowFail: true });
      fs.rmSync(path.join(base, lf), { force: true });
    }
  }
  const pkgChanged = (await git(base, 'diff', '--cached', '--name-only', 'HEAD')).split('\n').includes('package.json');
  if (pkgChanged && fs.existsSync(path.join(base, 'package.json'))) {
    await shell(process.env.NF_LOCK_CMD || lockCmd(packageManager(base)), { cwd: base, log: path.join(ctx.runDir, 'logs', 'lockfile.log') });
    for (const lf of LOCKFILES) if (fs.existsSync(path.join(base, lf))) await git(base, 'add', '--', lf);
  }
  await git(base, ...ident, 'commit', '-q', '--no-verify', '-m', `factory: merge #${t.issue} ${t.title}\n\nnf-run: ${st.runId}\nnf-tip: ${tip}`);
  const sha = await head(base);
  if (pkgChanged) {
    await installOnce(base, path.join(ctx.runDir, 'logs', 'install.log'));
    // The install may rewrite the lockfile just committed; staging keeps the committed one.
    for (const lf of LOCKFILES) if (await gitOk(base, 'cat-file', '-e', `HEAD:${lf}`)) await git(base, 'checkout', 'HEAD', '--', lf);
  }
  ctx.log(`merged #${t.issue} into staging as ${sha.slice(0, 10)} (was ${before.slice(0, 10)})`);
  return { ok: true, sha };
}

// Queue the merge, then the check after merging when a ticket waits on this code.
export function mergeTicket(ctx, t) {
  return ctx.serial.run(async () => {
    const st = ctx.store.state;
    const r = await doMerge(ctx, t);
    if (!r.ok) return r;
    if (r.sha && !t.merges.includes(r.sha)) {
      t.merges.push(r.sha);
      st.mergeLog.push({ kind: 'merge', issue: t.issue, sha: r.sha, at: now() });
    }
    t.status = 'merged';
    t.mergedAt = now();
    t.phase = null;
    release(st.locks, t.issue);
    const { note } = await import('./ticket.mjs');
    note(ctx, t, r.sha ? `merged into staging as ${r.sha.slice(0, 10)}` : 'nothing new to merge: staging has it all');
    await pushStaging(ctx);
    ctx.crashPoint(`after-merge:${t.issue}`);
    deferredServerCheck(ctx);
    if (waitingOn(st.tickets, t.issue).length) await checkStaging(ctx, `after merging #${t.issue}`);
    return { ok: true };
  });
}

// A new repository had no dev server when the batch was prepared: try the two
// servers once staging has one, without holding anything up.
function deferredServerCheck(ctx) {
  const pre = ctx.store.state.prepared?.precheck;
  const profile = ctx.profile;
  if (pre?.servers !== 'deferred' || !profile.dev) return;
  pre.servers = 'checking';
  ctx.store.save();
  serverTrees(ctx)
    .then((dirs) => twoServers(ctx.base, profile.dev, { log: path.join(ctx.runDir, 'logs', 'prepare.log'), dirs }))
    .then(async (problem) => {
      pre.servers = problem ? 'failed' : 'ok';
      if (problem) {
        pre.problems.push(problem);
        await ctx.alarm({ step: 'prepare', reason: `QC precheck: ${problem}`, handled: 'the tickets are built anyway; fix this before QC at the end of the batch' });
      }
      ctx.store.save();
    })
    .catch((e) => ctx.log(`server check: ${e.message}`));
}

// typecheck, build, unit, e2e on staging. On failure, find the merge to blame
// and send it the failure. Returns true when green.
export async function checkStaging(ctx, label, { names = MERGE_CHECKS, step = 'post-merge check' } = {}) {
  const st = ctx.store.state;
  ctx.store.begin(step);
  const port = await freePort();
  const env = { PORT: String(port), BASE_URL: `http://localhost:${port}`, CI: '1' };
  const res = await runChecks(ctx.base, ctx.profile, names, { env, logDir: path.join(ctx.runDir, 'logs', 'staging'), tag: `${step.replace(/\W+/g, '-')}-${Date.now() % 100000}` });
  (st.stagingChecks ||= []).push({ at: now(), label, ok: res.ok, checks: res.results.map((r) => ({ name: r.name, ok: r.ok, ms: r.ms, failedFiles: r.failedFiles })) });
  ctx.store.end(step);
  if (res.ok) {
    st.lastGreen = await head(ctx.base);
    st.stagingRed = false;
    ctx.store.save();
    return { ok: true, res };
  }
  st.stagingRed = true;
  ctx.store.save();
  ctx.log(`${step} ${label}: ${res.results.filter((r) => !r.ok).map((r) => r.name).join(', ')} failed`);
  const routed = await blame(ctx, res.results);
  return { ok: false, res, routed };
}

async function bisectTree(ctx) {
  const wt = path.join(ctx.wtRoot, '_bisect');
  if (!fs.existsSync(path.join(wt, '.git'))) {
    await git(ctx.dir, 'worktree', 'prune');
    await git(ctx.dir, 'worktree', 'add', '--detach', wt, STAGING);
  }
  await cloneModules(ctx.base, wt);
  return wt;
}

// Bisect the merges since the last green point, running only what failed.
// Sends the failure to the ticket whose merge caused it. Returns the issue, or null.
export async function blame(ctx, results) {
  const st = ctx.store.state;
  ctx.store.begin('bisect');
  const plan = rerunPlan(results);
  const from = st.mergeLog.findIndex((m) => m.sha === st.lastGreen);
  const points = st.mergeLog.slice(from + 1).filter((m) => m.kind === 'merge' || m.kind === 'revert');
  const wt = points.length ? await bisectTree(ctx) : null;
  const port = await freePort();
  const fails = async (i) => {
    const sha = i < 0 ? st.lastGreen : points[i].sha;
    if (!sha) return false;
    await git(wt, 'checkout', '-q', '--detach', '--force', sha);
    // A failing test file that does not exist yet at this point cannot fail here.
    const files = {};
    const names = [];
    for (const n of plan.names) {
      if (!plan.files[n]) names.push(n);
      else {
        const here = plan.files[n].filter((f) => fs.existsSync(path.join(wt, f)));
        if (here.length) (files[n] = here), names.push(n);
      }
    }
    if (!names.length) return false;
    const r = await runChecks(wt, detectProfile(wt, ctx.plan?.architecture?.checks), names, { env: { PORT: String(port), BASE_URL: `http://localhost:${port}`, CI: '1' }, files, logDir: path.join(ctx.runDir, 'logs', 'bisect'), tag: sha.slice(0, 10) });
    return !r.ok;
  };
  const idx = points.length ? await findCulprit(points, fails) : null;
  const failedFiles = [...new Set(results.flatMap((r) => r.failedFiles || []))];
  const owners = [...new Set(failedFiles.map((f) => Object.values(st.tickets).find((t) => owned(f, effectiveOwns(t)))?.issue).filter(Boolean))];
  const lastMerged = [...st.mergeLog].reverse().find((m) => m.kind === 'merge')?.issue;
  const culprit = idx !== null ? points[idx].issue : owners[0] ?? lastMerged ?? null;
  ctx.store.end('bisect');
  const what = results.filter((r) => !r.ok).map((r) => `\`${r.cmd}\``).join(', ');
  const message = `${what} fail(s) on staging after merging${failedFiles.length ? `, in ${failedFiles.join(', ')}` : ''}${owners.length ? ` (owned by ${owners.map((o) => `#${o}`).join(', ')})` : ''}. ${idx !== null ? `Bisecting the merges points to the merge of #${culprit} (${points[idx].sha.slice(0, 10)}): the tests passed before it.` : 'Bisecting found no single merge; sent to the owner of the failing tests.'} Fix it in your files so both your ticket and ${owners.filter((o) => o !== culprit).map((o) => `#${o}`).join(', ') || 'the others'} keep working.`;
  (st.blames ||= []).push({ at: now(), culprit, affected: owners, bisected: idx !== null, failedFiles });
  if (culprit === null) return null;
  reopen(ctx, culprit, [{ kind: 'merged-check', message, detail: results.filter((r) => !r.ok).map((r) => r.tail).join('\n---\n'), files: failedFiles }]);
  return culprit;
}

// A merged ticket goes back to work with these failures.
export function reopen(ctx, issue, failures) {
  const t = ctx.store.state.tickets[issue];
  if (!t || ['needs-decision', 'blocked'].includes(t.status)) return false;
  t.status = 'reopened';
  t.pending = [...(t.pending || []), ...failures];
  t.syncStaging = true;
  t.reviewedTip = null;
  ctx.store.save();
  return true;
}

// A merged ticket became needs-decision: revert it, and every merged ticket that
// depends on it, newest first. Each revert sha is kept, to undo the revert later.
export function revert(ctx, t) {
  return ctx.serial.run(async () => {
    const st = ctx.store.state;
    const { dependents } = await import('./scheduler.mjs');
    const group = new Set([t.issue, ...dependents(st.tickets, t.issue)]);
    const undone = new Set(st.mergeLog.filter((m) => m.kind === 'revert').map((m) => m.of));
    const merges = st.mergeLog.filter((m) => m.kind === 'merge' && group.has(m.issue) && !undone.has(m.sha)).reverse();
    for (const m of merges) {
      const x = st.tickets[m.issue];
      const found = await git(ctx.base, 'log', '--format=%H', '--fixed-strings', `--grep=nf-revert: ${m.sha}`, '-n', '1', STAGING);
      let sha = found;
      if (!sha) {
        await git(ctx.base, ...ident, 'revert', '--no-edit', '-m', '1', m.sha);
        await git(ctx.base, ...ident, 'commit', '--amend', '-q', '--no-verify', '-m', `factory: revert #${m.issue} (needs a decision on #${t.issue})\n\nnf-run: ${st.runId}\nnf-revert: ${m.sha}`);
        sha = await head(ctx.base);
      }
      if (!x.reverts.includes(sha)) x.reverts.push(sha);
      if (!st.mergeLog.some((e) => e.sha === sha)) st.mergeLog.push({ kind: 'revert', issue: m.issue, sha, of: m.sha, at: now() });
      ctx.store.save();
    }
    for (const issue of group) {
      const x = st.tickets[issue];
      if (!x.merges.length || x.reverted) continue;
      x.reverted = true;
      if (x.issue !== t.issue) {
        x.status = 'blocked';
        x.blockedBy = t.issue;
      }
    }
    st.stagingDirty = true;
    ctx.store.save();
    await pushStaging(ctx);
    ctx.log(`reverted ${[...group].filter((i) => st.tickets[i].reverted).map((i) => `#${i}`).join(', ')} from staging`);
  });
}
