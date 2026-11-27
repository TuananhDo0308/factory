// Step 2: prepare the batch once. New dependencies and the prototype in one commit
// on staging, dependencies installed once in the staging worktree, and the checks
// QC will need (a browser, two dev servers on two ports) tried before any ticket runs.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LOCKFILES, packageManager } from './profile.mjs';
import { answers, freePort, git, gitOk, killTree, run, shell, sleep } from './sh.mjs';
import { ident } from './git.mjs';

const DEV_LIKE = /^(?:@types\/|typescript$|vite$|vitest$|@vitest\/|@vitejs\/|@playwright\/|playwright$|eslint|@eslint\/|prettier|jsdom$|happy-dom$|@testing-library\/|tsx$|ts-node$)/;
export const isDevDependency = (name) => DEV_LIKE.test(name);

export function splitDep(d) {
  const at = d.lastIndexOf('@');
  return { name: d.slice(0, at), version: d.slice(at + 1) };
}

// Pure: the union of every ticket's newDependencies, and what package.json lacks.
export function dependenciesToAdd(pkg, tickets) {
  const want = new Map();
  for (const t of tickets) for (const d of t.newDependencies || []) {
    const { name, version } = splitDep(d);
    want.set(name, version);
  }
  const have = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  return [...want].filter(([name, version]) => have[name] !== version).map(([name, version]) => ({ name, version, dev: isDevDependency(name) }));
}

export function addDependencies(pkg, adds) {
  const out = { ...(pkg || { name: 'app', private: true }) };
  for (const a of adds) {
    const field = a.dev ? 'devDependencies' : 'dependencies';
    const other = a.dev ? 'dependencies' : 'devDependencies';
    if (out[other]?.[a.name]) out[other] = { ...out[other], [a.name]: a.version };
    else out[field] = Object.fromEntries(Object.entries({ ...(out[field] || {}), [a.name]: a.version }).sort(([x], [y]) => x.localeCompare(y)));
  }
  return out;
}

const installCmd = (pm) => process.env.NF_INSTALL_CMD || (pm === 'pnpm' ? 'pnpm install' : pm === 'yarn' ? 'yarn install' : 'npm install --no-audit --no-fund');

function depsHash(dir) {
  const h = crypto.createHash('sha256');
  for (const f of ['package.json', ...LOCKFILES]) if (fs.existsSync(path.join(dir, f))) h.update(fs.readFileSync(path.join(dir, f)));
  return h.digest('hex');
}

// Install dependencies in dir when package.json or the lockfile changed since the last install.
export async function installOnce(dir, log) {
  if (!fs.existsSync(path.join(dir, 'package.json'))) return false;
  const marker = path.join(dir, 'node_modules', '.nf-installed');
  const hash = depsHash(dir);
  if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === hash) return false;
  await shell(installCmd(packageManager(dir)), { cwd: dir, log, env: { CI: '1' } });
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, depsHash(dir));
  return true;
}

// The prototype's files at plan.prototype.path, from git archive of its commit.
async function copyPrototype(base, proto) {
  if (!(await gitOk(base, 'cat-file', '-e', `${proto.commit}^{commit}`))) await git(base, 'fetch', '-q', 'origin', `refs/heads/${proto.branch}`);
  const dest = path.join(base, proto.path);
  fs.mkdirSync(dest, { recursive: true });
  await shell(`git archive --format=tar ${proto.commit} | tar -x -C '${dest}'`, { cwd: base });
}

export const PREPARE_SUBJECT = (id) => `factory: prepare ${id} (new dependencies, prototype)`;

// Make the one prepare commit on staging, in the staging worktree. Idempotent.
export async function prepareCommit({ base, plan, tickets, log }) {
  const subject = PREPARE_SUBJECT(plan.id);
  const found = await git(base, 'log', '--format=%H', '--fixed-strings', `--grep=${subject}`, '-n', '1', 'HEAD');
  if (found) return { commit: found, added: [], again: true };
  const pkgFile = path.join(base, 'package.json');
  const pkg = fs.existsSync(pkgFile) ? JSON.parse(fs.readFileSync(pkgFile, 'utf8')) : null;
  const adds = dependenciesToAdd(pkg, Object.values(tickets));
  if (adds.length) fs.writeFileSync(pkgFile, `${JSON.stringify(addDependencies(pkg, adds), null, 2)}\n`);
  if (plan.prototype) await copyPrototype(base, plan.prototype);
  if (adds.length) await installOnce(base, log);
  const paths = ['package.json', ...LOCKFILES, ...(plan.prototype ? [plan.prototype.path] : [])].filter((f) => fs.existsSync(path.join(base, f)));
  if (paths.length) await git(base, 'add', '-A', '--', ...paths);
  const staged = await git(base, 'diff', '--cached', '--name-only');
  if (!staged) return { commit: null, added: [] };
  await git(base, ...ident, 'commit', '-q', '--no-verify', '-m', subject);
  return { commit: await git(base, 'rev-parse', 'HEAD'), added: adds.map((a) => `${a.name}@${a.version}`) };
}

// --- checks before QC is needed ---------------------------------------------------

async function browserProblem(base) {
  if (process.env.NF_BROWSER_CHECK === 'skip') return null;
  if (fs.existsSync(path.join(base, 'node_modules', 'playwright-core'))) {
    const r = await run('node', ['-e', "require('playwright-core').chromium.launch().then(b=>b.close()).then(()=>process.exit(0),e=>{console.error(e.message);process.exit(1)})"], { cwd: base, allowFail: true });
    return r.code === 0 ? null : `Chromium does not start from the project's Playwright: ${r.stderr.trim().split('\n')[0]}. Run \`npx playwright install chromium\``;
  }
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), process.platform === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright');
  const has = fs.existsSync(cache) && fs.readdirSync(cache).some((d) => d.startsWith('chromium'));
  return has ? null : `no Playwright browser in ${cache}. Run \`npx playwright install chromium\``;
}

export const MCP_PACKAGE = '@playwright/mcp@0.0.86';

async function mcpProblem() {
  if (process.env.NF_MCP_CHECK === 'skip') return null;
  const r = await run('npx', ['-y', MCP_PACKAGE, '--help'], { allowFail: true });
  return r.code === 0 ? null : `the Playwright MCP server (${MCP_PACKAGE}) does not start: ${(r.stderr || r.stdout).trim().split('\n')[0]}`;
}

function configProblem(base) {
  const f = ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs'].map((x) => path.join(base, x)).find((x) => fs.existsSync(x));
  if (!f) return null;
  const text = fs.readFileSync(f, 'utf8');
  const out = [];
  if (!/process\.env\.(?:PORT|BASE_URL)/.test(text)) out.push(`${path.basename(f)} does not read PORT or BASE_URL from the environment`);
  if (/reuseExistingServer\s*:\s*true/.test(text)) out.push(`${path.basename(f)} reuses a running server (reuseExistingServer: true)`);
  return out.length ? out.join('; ') : null;
}

// Start the dev server twice, on two ports, each in its own directory as two
// tickets' worktrees are, and see both answer on their own port. A server that
// does not answer is reported with the last lines it printed.
export async function twoServers(base, devCmd, { waitMs = Number(process.env.NF_SERVER_WAIT_MS || 60000), log, dirs = [base, base] } = {}) {
  const ports = [await freePort(), await freePort()];
  const logs = ports.map((_, i) => `${log || path.join(os.tmpdir(), `nf-server-${process.pid}`)}.server${i + 1}.log`);
  logs.forEach((f) => fs.writeFileSync(f, ''));
  const kids = [];
  const exited = [false, false];
  const started = ports.map((port, i) =>
    shell(devCmd, { cwd: dirs[i], allowFail: true, log: logs[i], env: { CI: '1', PORT: String(port), BASE_URL: `http://localhost:${port}` }, onSpawn: (c) => kids.push(c.pid) }).then((r) => {
      exited[i] = true;
      return r;
    }),
  );
  try {
    const deadline = Date.now() + waitMs;
    const up = [false, false];
    while (Date.now() < deadline && !up.every(Boolean) && !exited.some((x, i) => x && !up[i])) {
      for (const i of [0, 1]) if (!up[i]) up[i] = await answers(ports[i]);
      if (!up.every(Boolean)) await sleep(300);
    }
    for (const i of [0, 1]) if (!up[i]) up[i] = await answers(ports[i]);
    if (up.every(Boolean)) return null;
    const i = up.indexOf(false);
    const tail = fs.readFileSync(logs[i], 'utf8').split('\n').map((l) => l.trim()).filter(Boolean).slice(-6).join(' | ');
    const why = exited[i] ? 'exited' : `did not answer within ${Math.round(waitMs / 1000)}s`;
    return `the dev server (\`${devCmd}\`) on PORT=${ports[i]} ${why} while a second one ran on PORT=${ports[1 - i]} in another directory${tail ? `; its log ends: ${tail.slice(-600)}` : ''}`;
  } finally {
    for (const pid of kids) killTree(pid);
    await Promise.race([Promise.all(started), sleep(5000)]);
    for (const pid of kids) killTree(pid, 'SIGKILL');
  }
}

// Returns { problems: [...], servers: 'ok' | 'deferred' }.
export async function precheck(base, profile, { log, servers = true, dirs } = {}) {
  const tasks = [browserProblem(base), mcpProblem(), Promise.resolve(configProblem(base))];
  const canServe = servers && profile.dev && fs.existsSync(path.join(base, 'package.json'));
  if (canServe) tasks.push(twoServers(base, profile.dev, { log, dirs: dirs && (await dirs()) }));
  const problems = (await Promise.all(tasks)).filter(Boolean);
  return { problems, servers: canServe ? 'ok' : 'deferred' };
}
