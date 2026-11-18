// pr-judge step 1: gather a pull request and its issues, check both commits out in worktrees, and
// run the measured checks (B1-B6 of docs/quality-criteria.md). Run from inside a clone of the
// pull request's repository:
//
//   node prepare.ts --pr <number|url> [--issue <n>...] [--out <dir>] [--allow-fork] [--skip-checks]
//   node prepare.ts --branch <ref> --base <commit> (--criteria <file> | --issue <n>...)
//                   [--label <name>] [--title <text>] [--out <dir>] [--skip-checks]
//
// The branch form judges a local branch with no pull request (a Factory run that was not merged)
// against a criteria file (lines starting C1..Cn) or issues; --label replaces the branch name in
// everything the judges read, so several branches can be judged blind.
//
// Writes <out>/context.json, diff.patch, issue-<n>.md, checks.json, logs/ and commands.jsonl, and
// prints the out dir on its last line. Every external command is logged in commands.jsonl.
// Exit: 0 done, 2 usage, 3 a fork's pull request without --allow-fork, 4 no linked issue, 1 error.

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  addedLineDeps,
  addedPackageDeps,
  type Check,
  changedGuardedScripts,
  diffFiles,
  diffLines,
  isCodeFile,
  isTestFile,
  parseCriteria,
  removedAssertions,
  shortcutHits,
} from './lib.ts';

const TIMEOUT_SEC = Number(process.env.PR_JUDGE_TIMEOUT_SEC ?? 1200);
let commandsLog = '';

type Run = { code: number | null; out: string; err: string; error?: string; timedOut: boolean };

function run(
  cmd: string,
  args: string[],
  cwd: string,
  opts: { shell?: boolean; env?: NodeJS.ProcessEnv; log?: string } = {},
): Run {
  const started = Date.now();
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    shell: opts.shell ?? false,
    env: opts.env ?? process.env,
    timeout: TIMEOUT_SEC * 1000,
    maxBuffer: 256 * 1024 * 1024,
  });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  const result: Run = {
    code: r.status,
    out: r.stdout ?? '',
    err: r.stderr ?? '',
    timedOut,
    ...(r.error !== undefined ? { error: r.error.message } : {}),
  };
  if (commandsLog !== '') {
    appendFileSync(
      commandsLog,
      `${JSON.stringify({ cmd: [cmd, ...args].join(' '), cwd, code: r.status, ms: Date.now() - started, timedOut, error: result.error })}\n`,
    );
  }
  if (opts.log)
    writeFileSync(opts.log, `$ ${[cmd, ...args].join(' ')}\n\n${result.out}\n${result.err}`);
  return result;
}

function must(cmd: string, args: string[], cwd: string): string {
  const r = run(cmd, args, cwd);
  if (r.code !== 0) {
    throw new Error(
      `${cmd} ${args.join(' ')} failed (${r.code ?? r.error}): ${r.err.trim() || r.out.trim()}`,
    );
  }
  return r.out;
}

function readText(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
}

function onPath(name: string): boolean {
  return run('sh', ['-c', `command -v ${name}`], process.cwd()).code === 0;
}

// ---- commands ----------------------------------------------------------------------------------

const CHECK_NAMES = ['build', 'typecheck', 'lint', 'format', 'test'] as const;
type Commands = { install?: string } & Partial<Record<(typeof CHECK_NAMES)[number], string>>;

const NODE_SCRIPTS: Record<(typeof CHECK_NAMES)[number], string[]> = {
  build: ['build'],
  typecheck: ['typecheck', 'type-check', 'tsc', 'check-types'],
  lint: ['lint'],
  format: ['format:check', 'fmt:check', 'prettier:check', 'format-check'],
  test: ['test'],
};

// The commands come from the base commit, never the head: a pull request cannot change how it is
// checked. A `.pr-judge.json` at the base's root ({"install": "...", "test": "...", ...}, null to
// skip) overrides what is detected.
function commandsOf(baseDir: string): Commands {
  const override = readText(join(baseDir, '.pr-judge.json'));
  if (override !== undefined) {
    const v = JSON.parse(override) as Record<string, unknown>;
    const out: Commands = {};
    for (const key of ['install', ...CHECK_NAMES] as const) {
      if (typeof v[key] === 'string' && v[key] !== '') out[key] = v[key] as string;
    }
    return out;
  }
  const pkg = readText(join(baseDir, 'package.json'));
  if (pkg !== undefined) {
    const scripts = ((JSON.parse(pkg) as { scripts?: Record<string, string> }).scripts ??
      {}) as Record<string, string>;
    const pm = existsSync(join(baseDir, 'pnpm-lock.yaml'))
      ? 'pnpm'
      : existsSync(join(baseDir, 'yarn.lock'))
        ? 'yarn'
        : existsSync(join(baseDir, 'bun.lockb')) || existsSync(join(baseDir, 'bun.lock'))
          ? 'bun'
          : 'npm';
    const out: Commands = {
      install: {
        pnpm: 'pnpm install --frozen-lockfile',
        yarn: 'yarn install --frozen-lockfile',
        bun: 'bun install --frozen-lockfile',
        npm: existsSync(join(baseDir, 'package-lock.json')) ? 'npm ci' : 'npm install',
      }[pm],
    };
    for (const name of CHECK_NAMES) {
      const script = NODE_SCRIPTS[name].find((s) => typeof scripts[s] === 'string');
      if (script === undefined) continue;
      const body = scripts[script] as string;
      if (name === 'test' && /no test specified/.test(body)) continue;
      out[name] = body;
    }
    return out;
  }
  if (existsSync(join(baseDir, 'go.mod'))) {
    return {
      install: 'go mod download',
      build: 'go build ./...',
      typecheck: 'go vet ./...',
      test: 'go test ./...',
    };
  }
  const pyproject = readText(join(baseDir, 'pyproject.toml'));
  if (pyproject !== undefined || existsSync(join(baseDir, 'requirements.txt'))) {
    const out: Commands = {};
    if (existsSync(join(baseDir, 'uv.lock'))) out.install = 'uv sync';
    else if (existsSync(join(baseDir, 'requirements.txt')))
      out.install = 'python -m pip install -q -r requirements.txt';
    const runner = existsSync(join(baseDir, 'uv.lock')) ? 'uv run ' : '';
    if (/\[tool\.ruff/.test(pyproject ?? '') || existsSync(join(baseDir, 'ruff.toml')))
      out.lint = `${runner}ruff check .`;
    if (/\[tool\.mypy/.test(pyproject ?? '')) out.typecheck = `${runner}mypy .`;
    if (/pytest/.test(pyproject ?? '') || existsSync(join(baseDir, 'tests')))
      out.test = `${runner}python -m pytest -q`;
    return out;
  }
  return {};
}

function envFor(dir: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CI: 'true',
    PATH: `${join(dir, 'node_modules', '.bin')}:${process.env.PATH ?? ''}`,
  };
}

function b1Checks(out: string, headDir: string, baseDir: string): Check[] {
  const cmds = commandsOf(baseDir);
  const logs = join(out, 'logs');
  mkdirSync(logs, { recursive: true });
  const installed: Record<string, Run | undefined> = {};
  const install = (side: 'head' | 'base', dir: string): Run | undefined => {
    if (cmds.install === undefined) return undefined;
    if (!(side in installed)) {
      installed[side] = run(cmds.install, [], dir, {
        shell: true,
        env: envFor(dir),
        log: join(logs, `${side}-install.log`),
      });
    }
    return installed[side];
  };
  const checks: Check[] = [];

  const headInstall = install('head', headDir);
  if (cmds.install === undefined) {
    checks.push({
      id: 'B1.install',
      name: 'install',
      status: 'skipped',
      detail: 'no install command',
    });
  } else if (headInstall?.code === 0) {
    checks.push({ id: 'B1.install', name: 'install', status: 'pass', command: cmds.install });
  } else {
    const baseInstall = install('base', baseDir);
    checks.push({
      id: 'B1.install',
      name: 'install',
      status: baseInstall?.code === 0 ? 'fail' : 'pre_existing_fail',
      command: cmds.install,
      detail: 'logs/head-install.log',
    });
  }
  const headInstalled = cmds.install === undefined || headInstall?.code === 0;

  for (const name of CHECK_NAMES) {
    const id = `B1.${name}`;
    const command = cmds[name];
    if (command === undefined) {
      checks.push({ id, name, status: 'skipped', detail: 'no command in the base commit' });
      continue;
    }
    if (!headInstalled) {
      checks.push({ id, name, status: 'error', command, detail: 'not run: install failed' });
      continue;
    }
    const head = run(command, [], headDir, {
      shell: true,
      env: envFor(headDir),
      log: join(logs, `head-${name}.log`),
    });
    if (head.code === 0) {
      checks.push({ id, name, status: 'pass', command });
      continue;
    }
    if (head.timedOut || head.code === null) {
      checks.push({
        id,
        name,
        status: 'error',
        command,
        detail: `timed out or did not start; logs/head-${name}.log`,
      });
      continue;
    }
    const baseInstall = install('base', baseDir);
    if (cmds.install !== undefined && baseInstall?.code !== 0) {
      checks.push({
        id,
        name,
        status: 'error',
        command,
        detail: `fails on head; base could not be installed to compare. logs/head-${name}.log`,
      });
      continue;
    }
    const base = run(command, [], baseDir, {
      shell: true,
      env: envFor(baseDir),
      log: join(logs, `base-${name}.log`),
    });
    checks.push({
      id,
      name,
      status: base.code === 0 ? 'fail' : 'pre_existing_fail',
      command,
      detail: `logs/head-${name}.log`,
    });
  }
  return checks;
}

function diffChecks(diff: string, headDir: string, baseDir: string): Check[] {
  const lines = diffLines(diff);
  const files = diffFiles(diff);
  const added = lines.filter((l) => l.kind === 'added').length;
  const removed = lines.length - added;
  const checks: Check[] = [
    { id: 'B2.files', name: 'files changed', status: 'pass', count: files.length },
    {
      id: 'B2.lines',
      name: 'lines changed',
      status: 'pass',
      count: added + removed,
      detail: `+${added} -${removed}`,
    },
  ];

  const deps = [
    ...addedPackageDeps(
      readText(join(baseDir, 'package.json')),
      readText(join(headDir, 'package.json')),
    ),
    ...addedLineDeps(lines),
  ];
  checks.push({
    id: 'B3',
    name: 'dependencies added',
    status: deps.length > 0 ? 'fail' : 'pass',
    count: deps.length,
    ...(deps.length > 0 ? { detail: deps.join(', ') } : {}),
  });

  const tests = files.filter(isTestFile);
  const code = files.filter(isCodeFile);
  checks.push({
    id: 'B4',
    name: 'test files changed',
    status: code.length > 0 && tests.length === 0 ? 'fail' : 'pass',
    count: tests.length,
    ...(code.length > 0 && tests.length === 0
      ? { detail: 'code changed with no test file changed' }
      : {}),
  });

  const hits = [
    ...shortcutHits(lines),
    ...removedAssertions(lines),
    ...changedGuardedScripts(
      readText(join(baseDir, 'package.json')),
      readText(join(headDir, 'package.json')),
    ).map((s) => ({
      name: `package.json script "${s}" changed`,
      file: 'package.json',
      line: undefined,
    })),
  ];
  checks.push({
    id: 'B5',
    name: 'shortcuts around the checks',
    status: hits.length > 0 ? 'fail' : 'pass',
    count: hits.length,
    ...(hits.length > 0
      ? {
          detail: hits
            .slice(0, 12)
            .map((h) => `${h.name} ${h.file}${h.line ? `:${h.line}` : ''}`)
            .join('; '),
        }
      : {}),
  });
  return checks;
}

async function sonarCheck(
  headDir: string,
  baseDir: string,
  pr: { number: number; headRefName: string; baseRefName: string },
): Promise<Check> {
  const host = process.env.SONAR_HOST_URL;
  const token = process.env.SONAR_TOKEN;
  const props = readText(join(baseDir, 'sonar-project.properties'));
  const key = props ? /^sonar\.projectKey\s*=\s*(.+)$/m.exec(props)?.[1]?.trim() : undefined;
  if (!host || !token || !key || !onPath('sonar-scanner')) {
    return {
      id: 'B6.sonar',
      name: 'SonarQube',
      status: 'skipped',
      detail: 'needs sonar-scanner, SONAR_HOST_URL, SONAR_TOKEN and sonar.projectKey in the base',
    };
  }
  const scan = run(
    'sonar-scanner',
    [
      `-Dsonar.pullrequest.key=${pr.number}`,
      `-Dsonar.pullrequest.branch=${pr.headRefName}`,
      `-Dsonar.pullrequest.base=${pr.baseRefName}`,
      '-Dsonar.qualitygate.wait=true',
    ],
    headDir,
    { log: join(headDir, '..', 'logs', 'sonar.log') },
  );
  const api = async (path: string): Promise<Record<string, unknown> | undefined> => {
    try {
      const res = await fetch(`${host.replace(/\/$/, '')}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.ok ? ((await res.json()) as Record<string, unknown>) : undefined;
    } catch {
      return undefined;
    }
  };
  const q = `projectKey=${encodeURIComponent(key)}&pullRequest=${pr.number}`;
  const gate = await api(`/api/qualitygates/project_status?${q}`);
  const issues = await api(
    `/api/issues/search?componentKeys=${encodeURIComponent(key)}&pullRequest=${pr.number}&resolved=false&ps=1`,
  );
  const status = (gate?.projectStatus as { status?: string } | undefined)?.status;
  const total = typeof issues?.total === 'number' ? issues.total : undefined;
  if (status === undefined) {
    return {
      id: 'B6.sonar',
      name: 'SonarQube',
      status: 'error',
      detail: `no quality gate (scan exit ${scan.code}); logs/sonar.log. PR analysis needs Developer Edition or above`,
    };
  }
  return {
    id: 'B6.sonar',
    name: 'SonarQube',
    status: status === 'OK' ? 'pass' : 'fail',
    ...(total !== undefined ? { count: total } : {}),
    detail: `quality gate ${status}`,
  };
}

// ---- main --------------------------------------------------------------------------------------

type PrView = {
  number: number;
  title: string;
  url: string;
  body: string;
  headRefName: string;
  headRefOid: string;
  baseRefName: string;
  baseRefOid: string;
  isCrossRepository: boolean;
  closingIssuesReferences: { number: number }[];
};

type Source = {
  number?: number;
  title: string;
  url?: string;
  body: string;
  headRef: string;
  headSha: string;
  baseRef?: string;
  baseSha: string;
};

const USAGE =
  'usage: node prepare.ts --pr <number|url> [--issue <n>...] [--out <dir>] [--allow-fork] [--skip-checks]\n' +
  '       node prepare.ts --branch <ref> --base <commit> (--criteria <file> | --issue <n>...) [--label <name>] [--title <text>] [--out <dir>] [--skip-checks]';

async function main(): Promise<number> {
  let values: {
    pr?: string;
    branch?: string;
    base?: string;
    criteria?: string;
    label?: string;
    title?: string;
    issue?: string[];
    out?: string;
    'allow-fork'?: boolean;
    'skip-checks'?: boolean;
  };
  try {
    values = parseArgs({
      strict: true,
      options: {
        pr: { type: 'string' },
        branch: { type: 'string' },
        base: { type: 'string' },
        criteria: { type: 'string' },
        label: { type: 'string' },
        title: { type: 'string' },
        issue: { type: 'string', multiple: true },
        out: { type: 'string' },
        'allow-fork': { type: 'boolean' },
        'skip-checks': { type: 'boolean' },
      },
    }).values;
  } catch (error) {
    console.error(`prepare: ${(error as Error).message}\n${USAGE}`);
    return 2;
  }
  const branchMode = values.branch !== undefined;
  if (
    (values.pr === undefined) === !branchMode ||
    (branchMode && (!values.base || (!values.criteria && !values.issue?.length)))
  ) {
    console.error(USAGE);
    return 2;
  }

  const repoDir = must('git', ['rev-parse', '--show-toplevel'], process.cwd()).trim();
  const view = run('gh', ['repo', 'view', '--json', 'nameWithOwner'], repoDir);
  const repo =
    view.code === 0
      ? (JSON.parse(view.out) as { nameWithOwner: string }).nameWithOwner
      : basename(repoDir);

  let source: Source;
  let issueNumbers: number[];
  if (branchMode) {
    // A local branch with no pull request, such as a Factory run that was not merged. The label
    // stands in for the branch name everywhere the judges look, so they can be kept blind to it.
    const headSha = must('git', ['rev-parse', '--verify', `${values.branch}^{commit}`], repoDir).trim();
    const baseSha = must('git', ['merge-base', values.base as string, headSha], repoDir).trim();
    source = {
      title: values.title ?? 'A change on a branch',
      body: 'A branch with no pull request.',
      headRef: values.label ?? 'branch',
      headSha,
      baseSha,
    };
    issueNumbers = (values.issue ?? []).map(Number);
  } else {
    const pr = JSON.parse(
      must(
        'gh',
        [
          'pr',
          'view',
          values.pr as string,
          '--json',
          'number,title,url,body,headRefName,headRefOid,baseRefName,baseRefOid,isCrossRepository,closingIssuesReferences',
        ],
        repoDir,
      ),
    ) as PrView;
    if (pr.isCrossRepository && !values['allow-fork']) {
      console.error(
        `prepare: PR #${pr.number} comes from a fork; its code would run on this machine (install, build, test). Rerun with --allow-fork once you trust it.`,
      );
      return 3;
    }
    issueNumbers = values.issue?.length
      ? values.issue.map(Number)
      : pr.closingIssuesReferences.map((i) => i.number);
    if (issueNumbers.length === 0) {
      console.error(
        `prepare: PR #${pr.number} is linked to no issue (no "Closes #n"). Pass --issue <n>.`,
      );
      return 4;
    }
    must('git', ['fetch', '--no-tags', 'origin', `pull/${pr.number}/head`, pr.baseRefName], repoDir);
    source = {
      number: pr.number,
      title: pr.title,
      url: pr.url,
      body: pr.body,
      headRef: pr.headRefName,
      headSha: pr.headRefOid,
      baseRef: pr.baseRefName,
      baseSha: must('git', ['merge-base', pr.baseRefOid, pr.headRefOid], repoDir).trim(),
    };
  }
  if (issueNumbers.some((n) => !Number.isInteger(n) || n <= 0)) {
    console.error(`prepare: --issue takes issue numbers\n${USAGE}`);
    return 2;
  }

  const out = resolve(
    values.out ??
      join(
        homedir(),
        '.xfb',
        'judge',
        repo.replace('/', '__'),
        source.number !== undefined
          ? `pr-${source.number}`
          : `branch-${source.headRef.replace(/^branch-/, '')}`,
        source.headSha.slice(0, 12),
      ),
  );
  mkdirSync(join(out, 'judges'), { recursive: true });
  commandsLog = join(out, 'commands.jsonl');

  const issues = issueNumbers.map((n) => {
    const issue = JSON.parse(
      must('gh', ['issue', 'view', String(n), '--json', 'number,title,body,url'], repoDir),
    ) as {
      number: number;
      title: string;
      body: string;
      url: string;
    };
    const file = join(out, `issue-${n}.md`);
    writeFileSync(file, `# #${issue.number} ${issue.title}\n\n${issue.url}\n\n${issue.body}\n`);
    return {
      number: issue.number,
      title: issue.title,
      url: issue.url,
      file,
      criteria: parseCriteria(issue.body),
    };
  });
  let contract: { file: string; criteria: { id: string; text: string }[] } | undefined;
  if (values.criteria !== undefined) {
    const text = readFileSync(resolve(values.criteria), 'utf8');
    const file = join(out, 'contract.md');
    writeFileSync(file, text);
    contract = { file, criteria: parseCriteria(text) };
  }
  const heading = source.number !== undefined ? `PR #${source.number}` : source.headRef;
  writeFileSync(
    join(out, 'pr.md'),
    `# ${heading} ${source.title}\n\n${source.url ?? ''}\n\n${source.body}\n`,
  );

  const headDir = join(out, 'head');
  const baseDir = join(out, 'base');
  for (const [dir, sha] of [
    [headDir, source.headSha],
    [baseDir, source.baseSha],
  ] as const) {
    if (existsSync(dir)) run('git', ['worktree', 'remove', '--force', dir], repoDir);
    must('git', ['worktree', 'add', '--detach', dir, sha], repoDir);
  }
  const diff = must(
    'git',
    ['diff', '--no-color', '--no-ext-diff', source.baseSha, source.headSha],
    repoDir,
  );
  writeFileSync(join(out, 'diff.patch'), diff);

  const conventions = ['CLAUDE.md', 'AGENTS.md', 'CONTRIBUTING.md', 'DESIGN.md', '.cursorrules']
    .filter((f) => existsSync(join(baseDir, f)))
    .map((f) => join(baseDir, f));
  for (const f of diffFiles(diff)) {
    const parts = f.split('/').slice(0, -1);
    for (let i = parts.length; i > 0; i--) {
      const p = join(baseDir, ...parts.slice(0, i), 'CLAUDE.md');
      if (existsSync(p) && !conventions.includes(p)) conventions.push(p);
    }
  }

  const context = {
    repo,
    repo_dir: repoDir,
    out,
    pr: {
      ...(source.number !== undefined ? { number: source.number } : {}),
      title: source.title,
      ...(source.url !== undefined ? { url: source.url } : {}),
      file: join(out, 'pr.md'),
      head_ref: source.headRef,
      head_sha: source.headSha,
      ...(source.baseRef !== undefined ? { base_ref: source.baseRef } : {}),
      base_sha: source.baseSha,
    },
    issues,
    ...(contract !== undefined ? { contract } : {}),
    head_dir: headDir,
    base_dir: baseDir,
    diff_file: join(out, 'diff.patch'),
    files: diffFiles(diff),
    conventions,
  };
  writeFileSync(join(out, 'context.json'), `${JSON.stringify(context, null, 2)}\n`);

  if (!values['skip-checks']) {
    const checks = [
      ...b1Checks(out, headDir, baseDir),
      ...diffChecks(diff, headDir, baseDir),
      source.number !== undefined && source.baseRef !== undefined
        ? await sonarCheck(headDir, baseDir, {
            number: source.number,
            headRefName: source.headRef,
            baseRefName: source.baseRef,
          })
        : {
            id: 'B6.sonar',
            name: 'SonarQube',
            status: 'skipped' as const,
            detail: 'a branch without a pull request has no PR analysis',
          },
    ];
    writeFileSync(join(out, 'checks.json'), `${JSON.stringify(checks, null, 2)}\n`);
    for (const c of checks)
      console.log(`${c.id.padEnd(12)} ${c.status}${c.count !== undefined ? ` (${c.count})` : ''}`);
  }
  console.log(
    `criteria: ${[
      ...issues.map((i) => `#${i.number} (${i.criteria.length})`),
      ...(contract ? [`contract (${contract.criteria.length})`] : []),
    ].join(', ')}`,
  );
  console.log(out);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`prepare: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
