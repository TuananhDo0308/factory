// Running the project's checks in a worktree, in parallel, each on the ticket's
// own PORT, and reading which test files failed from their JSON reports.
import fs from 'node:fs';
import path from 'node:path';
import { scriptCmd } from './profile.mjs';
import { shell } from './sh.mjs';

export const CRITERION_TAG = /\bC\d+(?:\.\d+)*\b/g;
const quote = (a) => `'${String(a).replace(/'/g, `'\\''`)}'`;

function commandFor(check, pm, { files = [], reportFile }) {
  const extra = [...files];
  if (reportFile) {
    if (check.report === 'vitest') extra.push('--reporter=default', '--reporter=json', `--outputFile.json=${reportFile}`);
    else if (check.report === 'jest') extra.push('--json', `--outputFile=${reportFile}`);
    else if (check.report === 'playwright') extra.push('--reporter=line,json');
  }
  if (check.script) return scriptCmd(pm, check.script, extra);
  return extra.length ? `${check.cmd} ${extra.map(quote).join(' ')}` : check.cmd;
}

// Tests in a report: [{ file, title, ok }], file relative to cwd.
export function readReport(kind, file, cwd) {
  if (!file || !fs.existsSync(file)) return null;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  const rel = (f) => (f ? path.relative(cwd, path.resolve(cwd, f)) : '');
  const out = [];
  if (kind === 'playwright') {
    const root = data.config?.rootDir || cwd;
    const walk = (suite, titles) => {
      const t = suite.title && !suite.title.endsWith('.ts') && !suite.title.endsWith('.js') ? [...titles, suite.title] : titles;
      for (const s of suite.specs || []) {
        const full = [...t, s.title, ...(s.tags || []).map((x) => (x.startsWith('@') ? x : `@${x}`))].join(' ');
        const ok = s.ok !== false && (s.tests || []).every((x) => !x.results?.some((r) => r.status === 'failed' || r.status === 'timedOut' || r.status === 'interrupted'));
        out.push({ file: rel(path.resolve(root, s.file || suite.file || '')), title: full, ok });
      }
      for (const c of suite.suites || []) walk(c, t);
    };
    for (const s of data.suites || []) walk(s, []);
  } else {
    for (const r of data.testResults || []) {
      const asserts = r.assertionResults || [];
      if (!asserts.length) out.push({ file: rel(r.name || r.testFilePath), title: '', ok: r.status !== 'failed' });
      for (const a of asserts) out.push({ file: rel(r.name || r.testFilePath), title: a.fullName || [...(a.ancestorTitles || []), a.title].join(' '), ok: a.status !== 'failed' });
    }
  }
  return out;
}

const tail = (text, n = 40) => text.trim().split('\n').slice(-n).join('\n');

// Run the named checks that the profile has. Returns { ok, results: [...] }.
// opts: { env, logDir, tag, files: { unit: [...], e2e: [...] }, onPid(name, pid), only }
export async function runChecks(cwd, profile, names, opts = {}) {
  const { env = {}, logDir, tag = 'check', files = {}, onPid } = opts;
  fs.mkdirSync(logDir, { recursive: true });
  const todo = names.filter((n) => profile.checks[n]);
  const results = await Promise.all(
    todo.map(async (name) => {
      const check = profile.checks[name];
      const reportFile = check.report ? path.join(logDir, `${tag}-${name}.report.json`) : null;
      if (reportFile) fs.rmSync(reportFile, { force: true });
      const cmd = commandFor(check, profile.pm, { files: files[name] || [], reportFile });
      const log = path.join(logDir, `${tag}-${name}.log`);
      fs.writeFileSync(log, `$ ${cmd}\n`);
      const t0 = Date.now();
      const r = await shell(cmd, {
        cwd,
        allowFail: true,
        log,
        env: { CI: '1', FORCE_COLOR: '0', ...env, ...(check.report === 'playwright' ? { PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile } : {}) },
        onSpawn: (c) => onPid?.(name, c.pid),
      });
      const tests = readReport(check.report, reportFile, cwd);
      const failedFiles = [...new Set((tests || []).filter((t) => !t.ok && t.file).map((t) => t.file))];
      return { name, ok: r.code === 0, code: r.code, ms: Date.now() - t0, cmd, log, tail: r.code === 0 ? '' : tail(`${r.stdout}\n${r.stderr}`), tests, failedFiles };
    }),
  );
  return { ok: results.every((r) => r.ok), results };
}

// Per-criterion results from the test titles of the reports: { C5: 'pass' | 'fail' }.
export function criteriaResults(results, kinds = ['e2e']) {
  const out = {};
  for (const r of results.filter((x) => kinds.includes(x.name))) {
    for (const t of r.tests || []) {
      for (const id of new Set(t.title.match(CRITERION_TAG) || [])) {
        if (!t.ok) out[id] = 'fail';
        else if (!out[id]) out[id] = 'pass';
      }
    }
  }
  return out;
}

// Failures as the implementer reads them.
export function checkFailures(res) {
  return res.results.filter((r) => !r.ok).map((r) => ({ kind: 'check', check: r.name, message: `\`${r.cmd}\` failed (exit ${r.code})${r.failedFiles.length ? `; failing files: ${r.failedFiles.join(', ')}` : ''}`, detail: r.tail, files: r.failedFiles }));
}
