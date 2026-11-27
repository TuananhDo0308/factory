// Git as the orchestrator uses it. Agents never call any of this.
import fs from 'node:fs';
import path from 'node:path';
import { git, gitOk, run } from './sh.mjs';

export const STAGING = 'staging';

export async function commonDir(dir) {
  return path.resolve(dir, await git(dir, 'rev-parse', '--git-common-dir'));
}

// Untracked files no ticket should commit by accident. Shared by every worktree.
export async function excludeGenerated(dir, extra = []) {
  const file = path.join(await commonDir(dir), 'info', 'exclude');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const have = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const want = ['node_modules/', '.nf-cache/', 'test-results/', 'playwright-report/', 'blob-report/', 'coverage/', '.playwright-mcp/', '__pycache__/', '*.tsbuildinfo', '.factory/runs/', ...extra];
  const missing = want.filter((w) => !have.split('\n').includes(w));
  if (missing.length) fs.writeFileSync(file, `${have.trimEnd()}\n# new-factory\n${missing.join('\n')}\n`);
}

export const branchExists = (dir, b) => gitOk(dir, 'show-ref', '--verify', '--quiet', `refs/heads/${b}`);
export const head = (dir, ref = 'HEAD') => git(dir, 'rev-parse', ref);

export async function addWorktree(dir, wt, branch, startPoint) {
  if (fs.existsSync(path.join(wt, '.git'))) return;
  await git(dir, 'worktree', 'prune');
  fs.mkdirSync(path.dirname(wt), { recursive: true });
  if (await branchExists(dir, branch)) await git(dir, 'worktree', 'add', wt, branch);
  else await git(dir, 'worktree', 'add', '-b', branch, wt, startPoint);
}

export async function removeWorktree(dir, wt) {
  if (!fs.existsSync(wt)) return;
  await run('git', ['worktree', 'remove', '--force', wt], { cwd: dir, allowFail: true });
  fs.rmSync(wt, { recursive: true, force: true });
}

export const mergeBase = (cwd, a, b) => git(cwd, 'merge-base', a, b);

// Committed changes between base and HEAD: [{ status: 'A'|'M'|'D'|'R'|..., path, from? }].
export async function changes(cwd, base, ref = 'HEAD') {
  const out = await git(cwd, 'diff', '--name-status', '-M', '--no-color', base, ref);
  return parseNameStatus(out);
}

export function parseNameStatus(out) {
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [st, a, b] = line.split('\t');
      const status = st[0];
      return status === 'R' || status === 'C' ? { status, from: a, path: b } : { status, path: a };
    });
}

export async function fileAt(cwd, ref, file) {
  const r = await run('git', ['show', `${ref}:${file}`], { cwd, allowFail: true });
  return r.code === 0 ? r.stdout : null;
}

// Commit whatever the agent left uncommitted, so the checks judge what is on disk.
export async function commitLeftovers(cwd, message) {
  const st = await git(cwd, 'status', '--porcelain');
  if (!st) return false;
  await git(cwd, 'add', '-A');
  await git(cwd, '-c', 'user.name=new-factory', '-c', 'user.email=new-factory@localhost', 'commit', '-q', '--no-verify', '-m', message);
  return true;
}

export const isAncestor = (cwd, a, b) => gitOk(cwd, 'merge-base', '--is-ancestor', a, b);

export const ident = ['-c', 'user.name=new-factory', '-c', 'user.email=new-factory@localhost'];

// The files with conflict markers left by a merge.
export async function conflicted(cwd) {
  const out = await git(cwd, 'diff', '--name-only', '--diff-filter=U');
  return out.split('\n').filter(Boolean);
}

// Lines removed from a file between base and HEAD (for append-only contract files).
export async function removedLines(cwd, base, file) {
  const out = await git(cwd, 'diff', '--numstat', base, 'HEAD', '--', file);
  const m = /^(\d+|-)\t(\d+|-)\t/.exec(out);
  return m && m[2] !== '-' ? Number(m[2]) : 0;
}

// Clone node_modules copy-on-write (APFS clonefile; reflink on Linux), plain copy otherwise.
export async function cloneModules(from, to) {
  const src = path.join(from, 'node_modules');
  const dst = path.join(to, 'node_modules');
  if (!fs.existsSync(src) || fs.existsSync(dst)) return false;
  const tries = process.platform === 'darwin' ? [['-c', '-R'], ['-R']] : [['-R', '--reflink=auto'], ['-R']];
  for (const flags of tries) {
    const r = await run('cp', [...flags, src, dst], { allowFail: true });
    if (r.code === 0) return true;
    fs.rmSync(dst, { recursive: true, force: true });
  }
  throw new Error(`could not copy node_modules into ${to}`);
}

// A detached worktree at ref, with node_modules cloned from `modulesFrom`; reused.
export async function detachedTree(dir, wt, ref, modulesFrom) {
  if (!fs.existsSync(path.join(wt, '.git'))) {
    await git(dir, 'worktree', 'prune');
    fs.mkdirSync(path.dirname(wt), { recursive: true });
    await git(dir, 'worktree', 'add', '--detach', wt, ref);
  } else await git(wt, 'checkout', '-q', '--detach', '--force', ref);
  await cloneModules(modulesFrom, wt);
  return wt;
}

// The two directories the server check runs its two dev servers in.
export const serverTrees = (ctx) => Promise.all([1, 2].map((i) => detachedTree(ctx.dir, path.join(ctx.wtRoot, `_server${i}`), STAGING, ctx.base)));
