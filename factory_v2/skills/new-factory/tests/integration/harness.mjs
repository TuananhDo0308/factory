// A whole orchestrator run against a fixture repository, with fake claude and gh.
// No tokens: every agent is tests/fixtures/fake-claude.mjs playing a scenario.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fakeBin, ghEvents, HERE, makeBatch, makeRepo, SKILL, tmpDir } from '../fixtures/make.mjs';

export const FOUNDATION_C = [
  ['C1', 'the registry throws an error naming both features when two declare the same route'],
  ['C2', '`npm run dev` starts the app on the port in `PORT`; every feature folder loads with no clash'],
];

export const foundation = (extra = {}) => ({ issue: 11, key: 'T1', title: 'Set up the registry', wave: 0, size: 'M', owns: ['src/registry.mjs', 'src/app.mjs', 'src/registry.test.mjs', 'e2e/app.spec.mjs'], criteria: FOUNDATION_C, ...extra });
export const feature = (issue, name, ids, extra = {}) => ({
  issue,
  key: `T${issue - 10}`,
  title: `Add ${name}`,
  wave: 1,
  size: 'M',
  owns: [`src/features/${name}/**`, `e2e/${name}.spec.mjs`],
  criteria: ids.map((id) => [id, `${name} answers with its name on the page`]),
  dependsOn: [11],
  ...extra,
});

// The outer node --test must not leak into the fixture's own node --test runs.
const clean = (e) => {
  delete e.NODE_TEST_CONTEXT;
  return e;
};

export async function setup(name, { tickets, scenario, architecture = null }) {
  const root = tmpDir(name);
  const { work, origin } = makeRepo(root);
  const bin = fakeBin(root);
  const data = path.join(root, 'gh.json');
  await makeBatch(data, { tickets, architecture });
  const scenarioFile = path.join(root, 'scenario.mjs');
  fs.writeFileSync(scenarioFile, `import { projectFiles, foundationFiles, featureFiles } from ${JSON.stringify(path.join(HERE, 'project.mjs'))};\n${scenario}\n`);
  const stateDir = path.join(root, 'fake');
  const env = {
    NF_CLAUDE_BIN: bin.claude,
    NF_GH_BIN: bin.gh,
    NF_FAKE_GH_DATA: data,
    NF_FAKE_SCENARIO: scenarioFile,
    NF_FAKE_STATE: stateDir,
    NF_WT_ROOT: path.join(root, 'wt'),
    NF_NO_NOTIFY: '1',
    NF_MCP_CHECK: 'skip',
    NF_BROWSER_CHECK: 'skip',
    NF_QUIET: '1',
    NF_QUEUE_POLL_MS: '200',
    NF_API_RETRY_MS: '100',
    NF_SERVER_WAIT_MS: '15000',
  };
  const runDir = path.join(work, '.factory', 'runs', 'epic-10');
  const h = {
    root,
    work,
    origin,
    data,
    stateDir,
    runDir,
    run(args = [], extra = {}) {
      return new Promise((resolve) => {
        const child = spawn(process.execPath, [path.join(SKILL, 'orchestrator', 'run.mjs'), '--repo', 'o/r', '--epic', '10', '--dir', work, ...args], { env: clean({ ...process.env, ...env, ...extra }), stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        child.stdout.on('data', (d) => (out += d));
        child.stderr.on('data', (d) => (out += d));
        child.on('close', (code) => resolve({ code, out, log: fs.existsSync(path.join(runDir, 'run.log')) ? fs.readFileSync(path.join(runDir, 'run.log'), 'utf8') : '' }));
      });
    },
    state: () => JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8')),
    calls: () => (fs.existsSync(path.join(stateDir, 'calls.jsonl')) ? fs.readFileSync(path.join(stateDir, 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse) : []),
    git: (...args) => execFileSync('git', args, { cwd: work, encoding: 'utf8' }).trim(),
    gh: () => ghEvents(data),
    // The user answers on the issue, as they would on GitHub.
    answer: (issue, text) => execFileSync(bin.gh, ['issue', 'comment', String(issue), '-R', 'o/r', '--body', text], { env: { ...process.env, NF_FAKE_GH_DATA: data } }),
    // Merge commits on origin's staging, first parent only, oldest first.
    merges: () =>
      execFileSync('git', ['log', '--first-parent', '--format=%s', 'staging'], { cwd: origin, encoding: 'utf8' })
        .trim()
        .split('\n')
        .reverse(),
  };
  return h;
}

// Explain a failed run in the assertion message.
export const why = (r, h) => `exit ${r.code}\n${r.out.slice(-3000)}\n${r.log.slice(-3000)}\n${fs.existsSync(path.join(h.runDir, 'report.md')) ? fs.readFileSync(path.join(h.runDir, 'report.md'), 'utf8') : ''}`;
