// The pure parts of the pr-judge skill: reading a diff, the issue's acceptance criteria and the
// manifests, and the verdict rule. No files, network, processes or clock, so each rule is tested on
// its own (tests/pr-judge.test.ts at the repository root, not shipped with the skill). Self-contained (no package imports): the skill runs from any repository.

export const RUBRIC_VERSION = 'pr-judge/1';

export type CheckStatus = 'pass' | 'fail' | 'pre_existing_fail' | 'skipped' | 'error';
export type Check = {
  id: string;
  name: string;
  status: CheckStatus;
  count?: number;
  command?: string;
  detail?: string;
};
export type CriterionStatus = 'met' | 'not_met' | 'unknown';
export type Criterion = {
  id: string;
  text: string;
  status: CriterionStatus;
  evidence?: string;
  derived?: boolean;
};
export type Severity = 'blocker' | 'major' | 'minor';
export type Finding = {
  severity: Severity;
  criterion?: string;
  file?: string;
  line?: number;
  problem?: string;
};
export type Score = { id: string; name: string; score: number | null; reasons: string };
export type Merge = 'merge' | 'merge_after_changes' | 'do_not_merge' | 'unknown';
export type Verdict = 'pass' | 'fail' | 'unknown';

// ---- diffs -------------------------------------------------------------------------------------

export type DiffLine = { file: string; line?: number; text: string; kind: 'added' | 'removed' };

// Added lines with their line number in the new file, and removed lines, from a unified diff
// (`git diff`). Binary files and renames without changes give no lines.
export function diffLines(diff: string): DiffLine[] {
  const out: DiffLine[] = [];
  let file = '';
  let newLine = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      file = '';
      continue;
    }
    if (raw.startsWith('+++ ')) {
      const name = raw.slice(4).trim();
      file = name === '/dev/null' ? '' : name.replace(/^b\//, '');
      continue;
    }
    if (raw.startsWith('--- ')) {
      const name = raw.slice(4).trim();
      if (name !== '/dev/null') file = name.replace(/^a\//, '');
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (raw.startsWith('+')) {
      out.push({ file, line: newLine, text: raw.slice(1), kind: 'added' });
      newLine += 1;
    } else if (raw.startsWith('-')) {
      out.push({ file, text: raw.slice(1), kind: 'removed' });
    } else if (raw.startsWith(' ')) {
      newLine += 1;
    }
  }
  return out;
}

// The files a diff touches, from its `diff --git a/x b/y` headers (the new name).
export function diffFiles(diff: string): string[] {
  const files: string[] = [];
  for (const raw of diff.split('\n')) {
    const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(raw);
    if (m?.[2] !== undefined && !files.includes(m[2])) files.push(m[2]);
  }
  return files;
}

const TEST_FILE = [
  /(^|\/)(__tests__|tests?|spec|e2e)\//,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /(^|\/)test_[^/]+\.py$/,
  /_test\.(py|go)$/,
];

export function isTestFile(path: string): boolean {
  return TEST_FILE.some((re) => re.test(path));
}

const NOT_CODE = [/\.(md|txt|json|ya?ml|toml|lock|svg|png|jpe?g|gif|ico|css)$/, /(^|\/)\.[^/]+$/];

export function isCodeFile(path: string): boolean {
  return !NOT_CODE.some((re) => re.test(path)) && !isTestFile(path);
}

// B5: ways around the checks in added lines. Each hit is flagged for a person to read; a hit is not
// by itself a fault (a reasoned eslint-disable can be right).
export const SHORTCUTS: readonly { name: string; re: RegExp; tests?: boolean }[] = [
  { name: '@ts-ignore', re: /@ts-ignore|@ts-nocheck/ },
  { name: '@ts-expect-error', re: /@ts-expect-error/ },
  {
    name: 'lint disabled',
    re: /eslint-disable|biome-ignore|#\s*noqa|\/\/\s*nolint|pylint:\s*disable/,
  },
  { name: 'type: ignore', re: /#\s*type:\s*ignore/ },
  { name: 'any cast', re: /\bas any\b|:\s*any\b/ },
  {
    name: 'skipped test',
    re: /\b(it|test|describe)\.(skip|todo)\(|\bx(it|describe|test)\(|@pytest\.mark\.skip|\bt\.Skip\(/,
  },
  { name: 'focused test', re: /\b(it|test|describe)\.only\(|\bf(it|describe)\(/ },
  { name: 'empty catch', re: /catch\s*(\([^)]*\))?\s*\{\s*\}|except[^:]*:\s*pass\b/ },
  { name: 'debug output', re: /\bconsole\.(log|debug)\(|\bdebugger;|\bprint\(\s*['"]debug/i },
];

export type Hit = { name: string; file: string; line?: number };

export function shortcutHits(lines: readonly DiffLine[]): Hit[] {
  const hits: Hit[] = [];
  for (const l of lines) {
    if (l.kind !== 'added') continue;
    for (const s of SHORTCUTS) {
      if (s.name === 'debug output' && isTestFile(l.file)) continue;
      if (s.re.test(l.text)) hits.push({ name: s.name, file: l.file, line: l.line });
    }
  }
  return hits;
}

const ASSERTION = /\b(assert\w*|expect)\s*[.(]|\bt\.(Error|Fatal)f?\(|\bshould\./;

// Assertions removed from test files (a weakened test), net of assertions added in the same file.
export function removedAssertions(lines: readonly DiffLine[]): Hit[] {
  const net = new Map<string, number>();
  for (const l of lines) {
    if (!isTestFile(l.file) || !ASSERTION.test(l.text)) continue;
    net.set(l.file, (net.get(l.file) ?? 0) + (l.kind === 'removed' ? 1 : -1));
  }
  const hits: Hit[] = [];
  for (const [file, n] of net) {
    for (let i = 0; i < n; i++) hits.push({ name: 'removed assertion', file });
  }
  return hits;
}

// ---- manifests ---------------------------------------------------------------------------------

const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
const GUARDED_SCRIPTS = ['test', 'lint', 'build', 'typecheck', 'type-check', 'check'];

function jsonObject(text: string | undefined): Record<string, unknown> | undefined {
  if (text === undefined) return undefined;
  try {
    const v = JSON.parse(text);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

function keysOf(value: unknown): string[] {
  return typeof value === 'object' && value !== null ? Object.keys(value) : [];
}

// B3: packages a package.json names on the head that it did not name on the base.
export function addedPackageDeps(base: string | undefined, head: string | undefined): string[] {
  const b = jsonObject(base) ?? {};
  const h = jsonObject(head);
  if (h === undefined) return [];
  const had = new Set(DEP_FIELDS.flatMap((f) => keysOf(b[f])));
  const added = DEP_FIELDS.flatMap((f) => keysOf(h[f])).filter((name) => !had.has(name));
  return [...new Set(added)].sort();
}

// The package.json scripts that decide a check (test, lint, build, ...) and that the head changed:
// a check is run with the base's command, so this is flagged rather than trusted.
export function changedGuardedScripts(
  base: string | undefined,
  head: string | undefined,
): string[] {
  const b = (jsonObject(base)?.scripts ?? {}) as Record<string, unknown>;
  const h = (jsonObject(head)?.scripts ?? {}) as Record<string, unknown>;
  return GUARDED_SCRIPTS.filter((name) => b[name] !== h[name] && (name in b || name in h));
}

// B3 for go.mod and requirements files: module or package lines added.
export function addedLineDeps(lines: readonly DiffLine[]): string[] {
  const out: string[] = [];
  for (const l of lines) {
    if (l.kind !== 'added') continue;
    const text = l.text.trim();
    if (/(^|\/)go\.mod$/.test(l.file)) {
      const m = /^(?:require\s+)?([\w./-]+\.[\w./-]+)\s+v\d/.exec(text);
      if (m?.[1]) out.push(m[1]);
    } else if (/(^|\/)requirements[^/]*\.txt$/.test(l.file)) {
      const m = /^([A-Za-z0-9_.-]+)/.exec(text);
      if (m?.[1] && !text.startsWith('#')) out.push(m[1]);
    }
  }
  return [...new Set(out)].sort();
}

// ---- the issue ---------------------------------------------------------------------------------

// The issue's numbered acceptance criteria, `C1`..`Cn` as ba-ticket writes them, or split as `C2.1`: a line that starts
// (after a list marker, bold or a checkbox) with the id. The first line of each id wins.
export function parseCriteria(body: string): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  const seen = new Set<string>();
  const re =
    /^\s*(?:[-*+]\s+)?(?:\[[ xX]\]\s+)?(?:\*\*|__)?(C\d+(?:\.\d+)*)(?:\*\*|__)?\s*[.:)\]–-]?\s*(?:\*\*|__)?\s*(.+)$/;
  for (const line of body.split('\n')) {
    const m = re.exec(line);
    if (!m?.[1] || !m[2] || seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ id: m[1], text: m[2].replace(/\*\*|__/g, '').trim() });
  }
  return out;
}

// ---- the verdict -------------------------------------------------------------------------------

// The verdict rule of pr-judge/1 (a draft for the owner to review; see rubric.md):
// fail    when an acceptance criterion is not met, a build, type, lint, format or test check fails
//         where it passed on the base, or any finding is a blocker;
// unknown otherwise, when there are no acceptance criteria, any is unknown, or the tests could not
//         be run (error);
// pass    otherwise. Flags (B3, B4, B5) and scores never decide it: they are read beside it.
export function verdictOf(
  criteria: readonly Criterion[],
  checks: readonly Check[],
  findings: readonly Finding[],
): { verdict: Verdict; reasons: string[] } {
  const fails: string[] = [];
  for (const c of criteria) if (c.status === 'not_met') fails.push(`${c.id} is not met`);
  for (const c of checks) {
    if (c.id.startsWith('B1.') && c.status === 'fail')
      fails.push(`${c.name} fails (passed on base)`);
  }
  const blockers = findings.filter((f) => f.severity === 'blocker');
  if (blockers.length > 0) fails.push(`${blockers.length} blocker finding(s)`);
  if (fails.length > 0) return { verdict: 'fail', reasons: fails };

  const unknowns: string[] = [];
  if (criteria.length === 0) unknowns.push('the issue has no acceptance criteria');
  for (const c of criteria) if (c.status === 'unknown') unknowns.push(`${c.id} is unknown`);
  for (const c of checks) {
    if (c.id === 'B1.test' && c.status === 'error') unknowns.push('the tests could not be run');
  }
  if (unknowns.length > 0) return { verdict: 'unknown', reasons: unknowns };
  return { verdict: 'pass', reasons: ['every acceptance criterion met, no check newly failing'] };
}

// ---- the report --------------------------------------------------------------------------------

export type Report = {
  rubric_version: string;
  judge_model?: string;
  calibrated: boolean;
  judged_at: string;
  repo: string;
  // number and url are absent for a branch judged without a pull request.
  pr: {
    number?: number;
    url?: string;
    title: string;
    head_ref: string;
    head_sha: string;
    base_sha: string;
  };
  issues: { number: number; title: string }[];
  run_id?: string;
  verdict: Verdict;
  verdict_reasons: string[];
  merge: Merge;
  merge_reasons?: string;
  criteria: Criterion[];
  checks: Check[];
  scores: Score[];
  findings: Finding[];
};

const SEVERITY_ORDER: Record<Severity, number> = { blocker: 0, major: 1, minor: 2 };

export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      (a.file ?? '').localeCompare(b.file ?? '') ||
      (a.line ?? 0) - (b.line ?? 0),
  );
}

function cell(text: string | undefined): string {
  return (text ?? '').replace(/\|/g, '\\|').replace(/\n+/g, ' ');
}

export function reportMarkdown(r: Report): string {
  const lines: string[] = [];
  lines.push(
    `# ${r.pr.number !== undefined ? `PR #${r.pr.number}` : r.pr.head_ref}: ${r.pr.title}`,
    '',
  );
  lines.push(
    `**Verdict: ${r.verdict.toUpperCase()}** · merge: ${r.merge} · rubric ${r.rubric_version}` +
      `${r.calibrated ? '' : ' (uncalibrated)'} · judged ${r.judged_at}`,
    '',
  );
  for (const reason of r.verdict_reasons) lines.push(`- ${reason}`);
  lines.push(
    '',
    `${r.pr.url ?? 'no pull request'} · issues ${r.issues.map((i) => `#${i.number}`).join(', ') || 'none'}`,
  );
  lines.push(
    `head ${r.pr.head_ref} @ ${r.pr.head_sha.slice(0, 12)}, base ${r.pr.base_sha.slice(0, 12)}`,
  );
  if (r.run_id) lines.push(`Factory run ${r.run_id}`);
  lines.push(
    '',
    'This is a judgement (tier 3 of docs/quality-criteria.md), not a graded outcome.',
    '',
  );

  lines.push(
    '## Acceptance criteria',
    '',
    '| Id | Criterion | Status | Evidence |',
    '|---|---|---|---|',
  );
  for (const c of r.criteria) {
    lines.push(
      `| ${c.id}${c.derived ? '*' : ''} | ${cell(c.text)} | ${c.status} | ${cell(c.evidence)} |`,
    );
  }
  if (r.criteria.length === 0) lines.push('| – | none found | – | – |');
  if (r.criteria.some((c) => c.derived))
    lines.push('', '\\* not numbered in the issue; derived by the judge.');

  lines.push(
    '',
    '## Checks',
    '',
    '| Id | Check | Status | Count | Detail |',
    '|---|---|---|---|---|',
  );
  for (const c of r.checks) {
    lines.push(
      `| ${c.id} | ${cell(c.name)} | ${c.status} | ${c.count ?? ''} | ${cell(c.detail ?? c.command)} |`,
    );
  }

  lines.push('', '## Scores', '', '| Id | Criterion | Score | Reasons |', '|---|---|---|---|');
  for (const s of r.scores)
    lines.push(`| ${s.id} | ${s.name} | ${s.score ?? '?'} | ${cell(s.reasons)} |`);
  if (r.merge_reasons) lines.push('', `**Merge readiness (H1):** ${r.merge} — ${r.merge_reasons}`);

  lines.push('', '## Findings', '');
  const findings = sortFindings(r.findings);
  if (findings.length === 0) lines.push('None.');
  for (const f of findings) {
    const where = f.file ? ` \`${f.file}${f.line ? `:${f.line}` : ''}\`` : '';
    lines.push(
      `- **${f.severity}**${f.criterion ? ` [${f.criterion}]` : ''}${where} ${f.problem ?? ''}`.trimEnd(),
    );
  }
  return `${lines.join('\n')}\n`;
}

// ---- the judges' answers -----------------------------------------------------------------------

// The judged criteria of docs/quality-criteria.md that pr-judge/1 asks, one isolated judge each.
export const SCORED_JUDGES: readonly { id: string; name: string }[] = [
  { id: 'C1', name: 'Readable' },
  { id: 'C2', name: 'Fits the repository' },
  { id: 'C3', name: 'As simple as the task allows' },
  { id: 'C4', name: 'Handles failure' },
  { id: 'C5', name: 'Tests check behaviour' },
  { id: 'C7', name: 'No security flaw' },
];
export const JUDGE_IDS = ['C6', ...SCORED_JUDGES.map((j) => j.id), 'H1'] as const;

const SEVERITIES: readonly Severity[] = ['blocker', 'major', 'minor'];
const MERGES: readonly Merge[] = ['merge', 'merge_after_changes', 'do_not_merge', 'unknown'];
const STATUSES: readonly CriterionStatus[] = ['met', 'not_met', 'unknown'];

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function findingsOf(value: unknown, criterion: string): Finding[] {
  if (!Array.isArray(value)) return [];
  const out: Finding[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue;
    const f = raw as Record<string, unknown>;
    const severity = SEVERITIES.includes(f.severity as Severity)
      ? (f.severity as Severity)
      : 'minor';
    const line =
      typeof f.line === 'number' && Number.isInteger(f.line) && f.line > 0 ? f.line : undefined;
    const file = text(f.file);
    // Judges whose example shows no finding often name the field `text`; both mean the problem.
    const problem = text(f.problem) ?? text(f.text);
    out.push({
      severity,
      criterion,
      ...(file !== undefined ? { file } : {}),
      ...(line !== undefined ? { line } : {}),
      ...(problem !== undefined ? { problem } : {}),
    });
  }
  return out;
}

// What the judges answered (judges/<id>.json, already parsed; a missing or unreadable answer is
// undefined), combined with the issue's parsed criteria. A judge that did not answer leaves its
// score Unknown (null) and its criteria unknown: missing is never zero.
export function fromJudges(
  parsed: readonly { id: string; text: string }[],
  answers: Readonly<Record<string, unknown>>,
): {
  criteria: Criterion[];
  scores: Score[];
  findings: Finding[];
  merge: Merge;
  merge_reasons?: string;
  missing: string[];
} {
  const missing = JUDGE_IDS.filter((id) => typeof answers[id] !== 'object' || answers[id] === null);
  const get = (id: string) => (answers[id] ?? {}) as Record<string, unknown>;

  const c6 = get('C6');
  const judged = new Map<string, { status: CriterionStatus; evidence?: string; text?: string }>();
  if (Array.isArray(c6.criteria)) {
    for (const raw of c6.criteria) {
      if (typeof raw !== 'object' || raw === null) continue;
      const c = raw as Record<string, unknown>;
      const id = text(c.id);
      if (id === undefined || judged.has(id)) continue;
      const status = STATUSES.includes(c.status as CriterionStatus)
        ? (c.status as CriterionStatus)
        : 'unknown';
      judged.set(id, { status, evidence: text(c.evidence), text: text(c.text) });
    }
  }
  const criteria: Criterion[] = parsed.map(({ id, text: t }) => {
    const j = judged.get(id);
    return {
      id,
      text: t,
      status: j?.status ?? 'unknown',
      ...(j?.evidence ? { evidence: j.evidence } : {}),
    };
  });
  // Criteria the issue did not number: the C6 judge derived them from its text.
  if (parsed.length === 0) {
    for (const [id, j] of judged) {
      criteria.push({
        id,
        text: j.text ?? '',
        status: j.status,
        derived: true,
        ...(j.evidence ? { evidence: j.evidence } : {}),
      });
    }
  }

  const scores: Score[] = SCORED_JUDGES.map(({ id, name }) => {
    const a = get(id);
    const s = a.score;
    const score = typeof s === 'number' && Number.isInteger(s) && s >= 1 && s <= 5 ? s : null;
    return {
      id,
      name,
      score,
      reasons: text(a.reasons) ?? (missing.includes(id) ? 'no answer' : ''),
    };
  });

  const findings = JUDGE_IDS.flatMap((id) => findingsOf(get(id).findings, id));
  const h1 = get('H1');
  const merge = MERGES.includes(h1.merge as Merge) ? (h1.merge as Merge) : 'unknown';
  const mergeReasons = text(h1.reasons);
  return {
    criteria,
    scores,
    findings: sortFindings(findings),
    merge,
    ...(mergeReasons !== undefined ? { merge_reasons: mergeReasons } : {}),
    missing,
  };
}

// The Factory run a pull request came from, by its head branch `factory/<run id>`.
export function runIdOfBranch(headRef: string): string | undefined {
  const m = /^factory\/(.+)$/.exec(headRef);
  return m?.[1];
}
