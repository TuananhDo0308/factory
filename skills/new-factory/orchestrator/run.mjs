#!/usr/bin/env node
// new-factory orchestrator: build one batch (an epic of new-ba tickets) into staging.
//
//   node run.mjs --repo <owner/name> --epic <n> [--dir <clone>] [--retry <issue>[,<issue>]] [--note <text>] [--create-staging]
//
// Run the same command again after a crash: it goes on from state.json.
// Exit: 0 done · 2 refused (labels, check-batch) · 3 needs the user (staging) · 64 usage · 70 error
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Agents } from './lib/agents.mjs';
import { loop } from './lib/engine.mjs';
import { addWorktree, commonDir, excludeGenerated, head, serverTrees, STAGING } from './lib/git.mjs';
import { pushStaging, Serial } from './lib/merge.mjs';
import { alarm, notifyMac } from './lib/notify.mjs';
import { readPlan } from './lib/plan.mjs';
import { installOnce, precheck, prepareCommit } from './lib/prepare.mjs';
import { detectProfile } from './lib/profile.mjs';
import { acquire, release } from './lib/queue.mjs';
import { writeReport } from './lib/report.mjs';
import { afterCrash, retry } from './lib/resume.mjs';
import { git, gitOk, run } from './lib/sh.mjs';
import { now, Store } from './lib/state.mjs';
import { startWatchdog } from './lib/watchdog.mjs';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parse(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '');
    if (k === 'create-staging') a[k] = true;
    else a[k] = argv[++i];
  }
  return a;
}

export function makeCtx({ store, runDir, dir, wtRoot }) {
  const logFile = path.join(runDir, 'run.log');
  const ctx = {
    store,
    runDir,
    dir,
    wtRoot,
    base: path.join(wtRoot, '_staging'),
    skillDir: SKILL,
    serial: new Serial(),
    get plan() {
      return store.state.plan;
    },
    get profile() {
      return detectProfile(ctx.base, store.state.plan?.architecture?.checks);
    },
    log(msg) {
      const line = `${now()} ${msg}`;
      fs.appendFileSync(logFile, `${line}\n`);
      if (process.env.NF_QUIET !== '1') console.log(line);
    },
    alarm: (a) => alarm(ctx, a),
    crashPoint(name) {
      const st = store.state;
      if (process.env.NF_CRASH_AT !== name || st.crashedAt?.includes(name)) return;
      st.crashedAt = [...(st.crashedAt || []), name];
      store.save();
      ctx.log(`crash point ${name}: exiting on purpose (NF_CRASH_AT)`);
      process.exit(99);
    },
  };
  ctx.agents = new Agents(ctx);
  return ctx;
}

// staging: local, from origin, or (with --create-staging) from main. Its worktree is ours.
async function ensureStaging(ctx, a) {
  const st = ctx.store.state;
  const { dir } = ctx;
  const hasOrigin = await gitOk(dir, 'remote', 'get-url', 'origin');
  if (hasOrigin) await run('git', ['fetch', '-q', 'origin'], { cwd: dir, allowFail: true });
  const local = await gitOk(dir, 'show-ref', '--verify', '--quiet', `refs/heads/${STAGING}`);
  const remote = hasOrigin && (await gitOk(dir, 'show-ref', '--verify', '--quiet', `refs/remotes/origin/${STAGING}`));
  if (!local && !remote) {
    if (!a['create-staging']) {
      st.status = 'needs-staging';
      st.refusal = `the repository has no \`${STAGING}\` branch. Ask the user; with their yes, rerun with --create-staging to make it from main.`;
      return false;
    }
    const from = hasOrigin && (await gitOk(dir, 'show-ref', '--verify', '--quiet', 'refs/remotes/origin/main')) ? 'origin/main' : 'main';
    await git(dir, 'branch', STAGING, from);
    if (hasOrigin) await git(dir, 'push', '-q', 'origin', STAGING);
    st.notes.push(`created ${STAGING} from ${from}`);
  } else if (!local) await git(dir, 'branch', STAGING, `origin/${STAGING}`);
  const list = await git(dir, 'worktree', 'list', '--porcelain');
  const holder = list.split('\n\n').find((b) => b.includes(`branch refs/heads/${STAGING}`));
  const at = holder && /^worktree (.*)$/m.exec(holder)?.[1];
  if (at && path.resolve(at) !== path.resolve(ctx.base)) {
    st.status = 'needs-staging';
    st.refusal = `\`${STAGING}\` is checked out at ${at}; the factory needs it in its own worktree. Switch that checkout to another branch and rerun.`;
    return false;
  }
  await addWorktree(dir, ctx.base, STAGING, STAGING);
  if (remote) {
    const ff = await run('git', ['merge', '-q', '--ff-only', `origin/${STAGING}`], { cwd: ctx.base, allowFail: true });
    if (ff.code !== 0 && !(await gitOk(ctx.base, 'merge-base', '--is-ancestor', `origin/${STAGING}`, 'HEAD'))) {
      st.status = 'needs-staging';
      st.refusal = `local ${STAGING} and origin/${STAGING} have diverged; the factory never force-pushes. Reconcile them and rerun.`;
      return false;
    }
  }
  return true;
}

async function stepPlan(ctx, retried) {
  const st = ctx.store.state;
  ctx.store.begin('plan');
  const r = await readPlan({ skillDir: SKILL, repo: st.repo, epic: st.epic, runDir: ctx.runDir });
  ctx.store.end('plan');
  if (!r.ok) {
    st.status = 'refused';
    st.refusal = r.refusal;
    return false;
  }
  const first = !st.plan;
  st.plan = r.plan;
  st.epicBody = r.epicBody;
  st.looks = r.looks;
  for (const c of r.changedAfterBA) if (!st.changedAfterBA.includes(c)) st.changedAfterBA.push(c);
  for (const [issue, t] of Object.entries(r.tickets)) {
    const have = st.tickets[issue];
    if (!have) st.tickets[issue] = t;
    else if (retried.includes(Number(issue)) || first) Object.assign(have, { title: t.title, body: t.body, criteria: t.criteria, owns: t.owns, uses: t.uses, dependsOn: t.dependsOn, newDependencies: t.newDependencies, size: t.size });
    if (st.snapshot[issue] && st.snapshot[issue].hash !== r.snapshot[issue].hash) st.notes.push(`#${issue} was edited on GitHub between runs`);
  }
  st.snapshot = { ...r.snapshot, ...Object.fromEntries(Object.entries(st.snapshot).filter(([k]) => !r.snapshot[k])) };
  ctx.store.save();
  return true;
}

async function stepPrepare(ctx) {
  const st = ctx.store.state;
  ctx.store.begin('prepare');
  const log = path.join(ctx.runDir, 'logs', 'prepare.log');
  fs.mkdirSync(path.dirname(log), { recursive: true });
  const pc = await prepareCommit({ base: ctx.base, plan: st.plan, tickets: st.tickets, log });
  await installOnce(ctx.base, log);
  const pre = await precheck(ctx.base, ctx.profile, { log, dirs: () => serverTrees(ctx) });
  st.prepared = { at: now(), commit: pc.commit, added: pc.added, precheck: pre };
  st.lastGreen = await head(ctx.base);
  ctx.store.end('prepare');
  if (pre.problems.length) await ctx.alarm({ step: 'prepare', reason: `QC precheck: ${pre.problems.join('; ')}`, handled: 'the tickets are built anyway; fix this before QC at the end of the batch' });
}

export async function main(argv) {
  const a = parse(argv);
  if (!a.repo || !a.epic || !/^\d+$/.test(a.epic)) {
    console.error('usage: run.mjs --repo <owner/name> --epic <n> [--dir <clone>] [--retry <issue>[,<issue>]] [--note <text>] [--create-staging]');
    return 64;
  }
  const dir = fs.realpathSync(a.dir || process.cwd());
  const epic = Number(a.epic);
  const runId = `epic-${epic}`;
  const runDir = path.join(dir, '.factory', 'runs', runId);
  const wtRoot = process.env.NF_WT_ROOT ? path.join(process.env.NF_WT_ROOT, runId) : path.join(os.homedir(), '.new-factory', 'worktrees', a.repo.replace('/', '__'), runId);
  const store = new Store(runDir);
  if (store.exists()) store.load();
  else store.init({ runId, repo: a.repo, epic, dir });
  const st = store.state;
  st.runs += 1;
  (st.runSpans ||= []).push({ start: now(), end: null });
  st.status = 'queued';
  st.finishedAt = null;
  st.refusal = null;
  store.save();
  const ctx = makeCtx({ store, runDir, dir, wtRoot });
  const retried = String(a.retry || '').split(',').filter(Boolean).map(Number);
  await excludeGenerated(dir);
  const qfile = path.join(await commonDir(dir), 'new-factory-queue.json');
  await acquire(qfile, runId, { onWait: (ahead) => ctx.log(`queued: ${ahead} is running on ${STAGING}; this batch starts from the newest ${STAGING} when it ends`) });
  let stopWatch = () => {};
  let code = 0;
  try {
    st.status = 'running';
    store.save();
    ctx.log(`run ${st.runs} of ${runId} on ${a.repo}`);
    if (!(await ensureStaging(ctx, a))) return (code = 3);
    if (!st.plan || retried.length) if (!(await stepPlan(ctx, retried))) return (code = 2);
    await afterCrash(ctx);
    if (retried.length) await retry(ctx, retried, a.note || '');
    if (!st.prepared) await stepPrepare(ctx);
    stopWatch = startWatchdog(ctx);
    await loop(ctx);
    st.status = 'done';
  } catch (e) {
    st.status = 'error';
    st.error = e.stack || String(e);
    ctx.log(`error: ${st.error}`);
    code = 70;
  } finally {
    stopWatch();
    if (st.status === 'done' || st.status === 'error') await pushStaging(ctx).catch(() => {});
    st.finishedAt = now();
    st.runSpans.at(-1).end = st.finishedAt;
    store.save();
    writeReport(runDir, st, SKILL);
    release(qfile, runId);
    const delivered = Object.values(st.tickets).filter((t) => t.status === 'merged').length;
    notifyMac('new-factory', `epic #${epic}: ${st.status}, ${delivered}/${Object.keys(st.tickets).length} delivered`);
    ctx.log(`${st.status}. Report: ${path.join(runDir, 'report.md')}`);
  }
  return code;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  main(process.argv.slice(2)).then((c) => process.exit(c));
}
