// Builders for the tests: a git repository with main and staging behind a bare
// origin, a batch of tickets served by the fake gh, and fake claude/gh on PATH.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { projectFiles } from './project.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SKILL = path.resolve(HERE, '..', '..');
export const BA = path.resolve(SKILL, '..', 'new-ba');

export const tmpDir = (name) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `nf-${name}-`)));
const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

export function writeFiles(dir, files) {
  for (const [f, content] of Object.entries(files)) {
    const p = path.join(dir, f);
    if (content === null) fs.rmSync(p, { force: true });
    else {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content);
    }
  }
}

// { origin, work }: work is a clone with main checked out and staging pushed.
export function makeRepo(root, files = projectFiles, { staging = true } = {}) {
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  g(root, 'init', '-q', '--bare', '-b', 'main', origin);
  g(root, 'clone', '-q', origin, work);
  g(work, 'config', 'user.name', 'test');
  g(work, 'config', 'user.email', 'test@example.com');
  g(work, 'checkout', '-q', '-b', 'main');
  writeFiles(work, files);
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'init');
  g(work, 'push', '-q', 'origin', 'main');
  if (staging) {
    g(work, 'branch', 'staging');
    g(work, 'push', '-q', 'origin', 'staging');
  }
  return { origin, work };
}

export function ticketBody({ title, wave, size = 'M', owns, uses = [], dependsOn = [], criteria, newDependencies = [] }) {
  const list = (xs, f) => (xs.length ? xs.map(f).join('\n') : 'none');
  return `## Objective

${title}.

## Acceptance criteria

${criteria.map(([id, text]) => `- **${id}** ${text}`).join('\n')}

## Out of scope

- Nothing else.

## Wave

${wave}

## Size

${size}: fixture

## Owns

${owns.map((o) => `- \`${o}\``).join('\n')}

## Uses

${list(uses, (u) => `- \`${u}\``)}

## Depends on

${list(dependsOn, (d) => `- #${d}: needed`)}

## New dependencies

${list(newDependencies, (d) => `- \`${d}\``)}
`;
}

// Writes the fake gh data for an epic and its tickets. Returns { dataFile, plan }.
export async function makeBatch(dataFile, { epic = 10, id = 'demo', architecture = null, tickets, labels = ['ready'], prototype }) {
  const lib = await import(pathToFileURL(path.join(BA, 'scripts', 'lib.mjs')).href);
  const arch = { layout: 'existing', checks: [{ name: 'typecheck', command: 'npm run typecheck' }, { name: 'lint', command: 'npm run lint' }, { name: 'build', command: 'npm run build' }, { name: 'test', command: 'npm test' }, { name: 'e2e', command: 'npm run e2e' }], stack: 'node', shared: [], extensionPoint: 'src/features/*/index.mjs', contracts: [], ...(architecture || {}) };
  const issues = {};
  const built = tickets.map((t) => ({ issue: t.issue, key: t.key, title: t.title, body: ticketBody(t), size: t.size || 'M', sizeReason: 'fixture' }));
  const { plan } = lib.buildPlan({ id, title: 'Demo batch', epic, architecture: arch, ...(prototype ? { prototype } : {}) }, built);
  for (const t of tickets) {
    const ticketLabels = t.labels || labels;
    issues[t.issue] = { number: t.issue, title: t.title, body: ticketBody(t), labels: ticketLabels.map((name) => ({ name })), state: 'OPEN', updatedAt: '2026-11-26T00:00:00Z', comments: [] };
  }
  issues[epic] = { number: epic, title: 'Demo batch', body: `## Objective\n\nDemo.\n\n${lib.renderPlanBlock(plan)}`, labels: labels.map((name) => ({ name })), state: 'OPEN', updatedAt: '2026-11-26T00:00:00Z', comments: [] };
  fs.writeFileSync(dataFile, JSON.stringify({ issues }, null, 2));
  fs.rmSync(`${dataFile}.events.jsonl`, { force: true });
  return { dataFile, plan };
}

export function ghEvents(dataFile) {
  const f = `${dataFile}.events.jsonl`;
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : [];
}

// A bin dir with gh and claude wrappers around the fakes.
export function fakeBin(root) {
  const dir = path.join(root, 'bin');
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, script] of [['gh', 'fake-gh.mjs'], ['claude', 'fake-claude.mjs']]) {
    const p = path.join(dir, name);
    fs.writeFileSync(p, `#!/bin/sh\nexec "${process.execPath}" "${path.join(HERE, script)}" "$@"\n`);
    fs.chmodSync(p, 0o755);
  }
  return { dir, gh: path.join(dir, 'gh'), claude: path.join(dir, 'claude') };
}
