// The project's checks. In order: .factory/project.json "checks" (the project's own
// override), the plan's architecture.checks (new-ba writes them, and in a new
// repository they are the only source: there is no package.json yet), and only when
// the plan has none, package.json scripts by their usual names.
import fs from 'node:fs';
import path from 'node:path';

const readJson = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);

export function packageManager(dir) {
  if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(dir, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

export const LOCKFILES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'npm-shrinkwrap.json'];

// "npm run test -- a b", "pnpm run test a b".
export function scriptCmd(pm, script, extra = []) {
  const args = extra.map((a) => `'${String(a).replace(/'/g, `'\\''`)}'`).join(' ');
  if (!args) return `${pm} run ${script}`;
  return pm === 'npm' ? `npm run ${script} -- ${args}` : `${pm} run ${script} ${args}`;
}

const reportOf = (text = '') => (/\bplaywright\b/.test(text) ? 'playwright' : /\bvitest\b/.test(text) ? 'vitest' : /\bjest\b/.test(text) ? 'jest' : null);

// The plan's check names, as the factory's steps know them.
const NAME = { test: 'unit', unit: 'unit', 'unit-test': 'unit', 'test-unit': 'unit', e2e: 'e2e', 'test-e2e': 'e2e', typecheck: 'typecheck', types: 'typecheck', tsc: 'typecheck', lint: 'lint', format: 'format', 'format-check': 'format', build: 'build' };
export const checkName = (n) => NAME[n] || n;

// "npm test", "npm run e2e", "pnpm test", "yarn lint": the script, so extra args get
// the right "--". Anything else is a plain command.
export function scriptOf(command) {
  const m = /^(npm|pnpm|yarn)\s+(?:run\s+)?([\w:.-]+)$/.exec(command.trim());
  if (!m || (m[1] === 'npm' && !/\srun\s/.test(command) && m[2] !== 'test')) return null;
  return { pm: m[1], script: m[2] };
}

// plan: [{ name, command }] from architecture.checks.
export function planChecks(plan, scripts = {}) {
  const out = {};
  for (const c of plan || []) {
    const name = checkName(c.name);
    const s = scriptOf(c.command);
    const text = `${c.command} ${s ? scripts[s.script] || '' : ''}`;
    out[name] = { ...(s ? { script: s.script } : {}), cmd: c.command, report: name === 'e2e' ? 'playwright' : reportOf(text) };
  }
  return out;
}

// { pm, checks: { name: { script?, cmd, report } }, dev }. Names: typecheck, lint, format, build, unit, e2e, and any other the plan names.
export function detectProfile(dir, fromPlan = null) {
  const pkg = readJson(path.join(dir, 'package.json'));
  const own = readJson(path.join(dir, '.factory', 'project.json'));
  const pm = own?.packageManager || packageManager(dir);
  const scripts = pkg?.scripts || {};
  const pick = (...names) => names.find((n) => scripts[n]);
  const checks = {};
  const add = (name, script) => {
    if (script) checks[name] = { script, cmd: scriptCmd(pm, script), report: reportOf(scripts[script]) };
  };
  add('typecheck', pick('typecheck', 'type-check', 'check:types', 'tsc'));
  if (!checks.typecheck && fs.existsSync(path.join(dir, 'tsconfig.json')) && (pkg?.devDependencies?.typescript || pkg?.dependencies?.typescript)) checks.typecheck = { cmd: 'npx tsc --noEmit', report: null };
  add('lint', pick('lint'));
  add('format', pick('format:check', 'check:format', 'prettier:check'));
  add('build', pick('build'));
  const e2e = pick('e2e', 'test:e2e');
  const unit = pick('test:unit', 'unit', 'test');
  add('e2e', e2e);
  if (unit && !(unit === 'test' && reportOf(scripts.test) === 'playwright')) add('unit', unit);
  if (checks.e2e) checks.e2e.report = 'playwright';
  if (fromPlan?.length) {
    for (const k of Object.keys(checks)) delete checks[k];
    Object.assign(checks, planChecks(fromPlan, scripts));
  }
  const devScript = pick('dev', 'start');
  let dev = devScript ? scriptCmd(pm, devScript) : null;
  if (own?.checks) {
    for (const [name, v] of Object.entries(own.checks)) {
      if (v === null) delete checks[name];
      else checks[name] = typeof v === 'string' ? { ...(scriptOf(v) ? { script: scriptOf(v).script } : {}), cmd: v, report: name === 'e2e' ? 'playwright' : reportOf(v) } : v;
    }
  }
  if (own?.dev !== undefined) dev = own.dev;
  return { pm, checks, dev };
}

// Which checks each step runs.
export const TICKET_CHECKS = ['typecheck', 'lint', 'format', 'build', 'unit', 'e2e'];
export const MERGE_CHECKS = ['typecheck', 'build', 'unit', 'e2e'];
