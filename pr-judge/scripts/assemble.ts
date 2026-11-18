// pr-judge step 3: combine context.json, checks.json and the judges' answers (judges/<id>.json)
// into report.json and report.md, apply the verdict rule, and remove the worktrees.
//
//   node assemble.ts --out <dir> [--judge-model <model id>] [--run <run id>] [--keep-worktrees]
//
// Prints the verdict, the report paths and the Factory run id (from --run or the head branch
// factory/<run id>), or "run: ?" when it is unknown.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  type Check,
  fromJudges,
  JUDGE_IDS,
  type Report,
  RUBRIC_VERSION,
  reportMarkdown,
  runIdOfBranch,
  verdictOf,
} from './lib.ts';

type Context = {
  repo: string;
  repo_dir: string;
  pr: {
    number?: number;
    title: string;
    url?: string;
    head_ref: string;
    head_sha: string;
    base_sha: string;
  };
  issues: { number: number; title: string; criteria: { id: string; text: string }[] }[];
  contract?: { criteria: { id: string; text: string }[] };
  head_dir: string;
  base_dir: string;
};

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

function main(): number {
  const { values } = parseArgs({
    strict: true,
    options: {
      out: { type: 'string' },
      'judge-model': { type: 'string' },
      run: { type: 'string' },
      'keep-worktrees': { type: 'boolean' },
    },
  });
  if (!values.out) {
    console.error(
      'usage: node assemble.ts --out <dir> [--judge-model <id>] [--run <run id>] [--keep-worktrees]',
    );
    return 2;
  }
  const out = resolve(values.out);
  const context = readJson(join(out, 'context.json')) as Context | undefined;
  if (context === undefined) {
    console.error(`assemble: cannot read ${join(out, 'context.json')}; run prepare.ts first`);
    return 1;
  }
  const checks = (readJson(join(out, 'checks.json')) as Check[] | undefined) ?? [];

  const answers: Record<string, unknown> = {};
  for (const id of JUDGE_IDS) {
    const path = join(out, 'judges', `${id}.json`);
    if (!existsSync(path)) continue;
    const value = readJson(path);
    if (typeof value === 'object' && value !== null) answers[id] = value;
    else
      console.error(`assemble: ${path} is not a JSON object; judge ${id} counts as not answered`);
  }

  // Criteria of every linked issue; ids are prefixed with the issue when there are several.
  // Criteria of every linked issue (ids prefixed with the issue when there are several), else of
  // the contract file a branch was judged against.
  const several = context.issues.length > 1;
  const fromIssues = context.issues.flatMap((i) =>
    i.criteria.map((c) => ({ id: several ? `#${i.number}.${c.id}` : c.id, text: c.text })),
  );
  const parsed = fromIssues.length > 0 ? fromIssues : (context.contract?.criteria ?? []);
  const judged = fromJudges(parsed, answers);
  const { verdict, reasons } = verdictOf(judged.criteria, checks, judged.findings);
  const runId = values.run ?? runIdOfBranch(context.pr.head_ref);

  const report: Report = {
    rubric_version: RUBRIC_VERSION,
    ...(values['judge-model'] ? { judge_model: values['judge-model'] } : {}),
    calibrated: false,
    judged_at: new Date().toISOString(),
    repo: context.repo,
    pr: {
      ...(context.pr.number !== undefined ? { number: context.pr.number } : {}),
      ...(context.pr.url !== undefined ? { url: context.pr.url } : {}),
      title: context.pr.title,
      head_ref: context.pr.head_ref,
      head_sha: context.pr.head_sha,
      base_sha: context.pr.base_sha,
    },
    issues: context.issues.map((i) => ({ number: i.number, title: i.title })),
    ...(runId ? { run_id: runId } : {}),
    verdict,
    verdict_reasons: [
      ...reasons,
      ...(judged.missing.length > 0
        ? [`no answer from judge(s) ${judged.missing.join(', ')}`]
        : []),
      ...(checks.length === 0 ? ['checks were not run'] : []),
    ],
    merge: judged.merge,
    ...(judged.merge_reasons ? { merge_reasons: judged.merge_reasons } : {}),
    criteria: judged.criteria,
    checks,
    scores: judged.scores,
    findings: judged.findings,
  };
  writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(out, 'report.md'), reportMarkdown(report));

  if (!values['keep-worktrees']) {
    for (const dir of [context.head_dir, context.base_dir]) {
      if (!existsSync(dir)) continue;
      const r = spawnSync('git', ['worktree', 'remove', '--force', dir], {
        cwd: context.repo_dir,
        encoding: 'utf8',
      });
      if (r.status !== 0)
        console.error(`assemble: could not remove worktree ${dir}: ${r.stderr.trim()}`);
    }
  }

  console.log(`verdict: ${verdict} (${report.verdict_reasons.join('; ')})`);
  console.log(`merge: ${report.merge}`);
  console.log(`report: ${join(out, 'report.md')}`);
  console.log(`json: ${join(out, 'report.json')}`);
  console.log(`run: ${runId ?? '?'}`);
  return 0;
}

process.exit(main());
