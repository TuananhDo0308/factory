import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  addedLineDeps,
  addedPackageDeps,
  type Check,
  type Criterion,
  changedGuardedScripts,
  diffFiles,
  diffLines,
  fromJudges,
  isCodeFile,
  isTestFile,
  parseCriteria,
  type Report,
  RUBRIC_VERSION,
  removedAssertions,
  reportMarkdown,
  runIdOfBranch,
  shortcutHits,
  verdictOf,
} from '../pr-judge/scripts/lib.ts';

const DIFF = `diff --git a/src/cart.ts b/src/cart.ts
index 1..2 100644
--- a/src/cart.ts
+++ b/src/cart.ts
@@ -10,3 +10,5 @@ export function add() {
   const a = 1;
-  return a;
+  // @ts-ignore
+  console.log(a);
+  return a as any;
 }
diff --git a/src/cart.test.ts b/src/cart.test.ts
--- a/src/cart.test.ts
+++ b/src/cart.test.ts
@@ -1,4 +1,4 @@
-  assert.equal(add(), 1);
-  expect(total()).toBe(2);
+  it.skip('adds', () => {});
+  console.log('fine in tests');
diff --git a/README.md b/README.md
new file mode 100644
--- /dev/null
+++ b/README.md
@@ -0,0 +1 @@
+# Shop
`;

describe('diffs', () => {
  test('diffLines numbers added lines in the new file and keeps removed ones', () => {
    const lines = diffLines(DIFF);
    assert.deepEqual(
      lines.filter((l) => l.file === 'src/cart.ts'),
      [
        { file: 'src/cart.ts', text: '  return a;', kind: 'removed' },
        { file: 'src/cart.ts', line: 11, text: '  // @ts-ignore', kind: 'added' },
        { file: 'src/cart.ts', line: 12, text: '  console.log(a);', kind: 'added' },
        { file: 'src/cart.ts', line: 13, text: '  return a as any;', kind: 'added' },
      ],
    );
    assert.deepEqual(lines.at(-1), { file: 'README.md', line: 1, text: '# Shop', kind: 'added' });
  });

  test('diffFiles lists each file once', () => {
    assert.deepEqual(diffFiles(DIFF), ['src/cart.ts', 'src/cart.test.ts', 'README.md']);
  });

  test('test and code files', () => {
    for (const p of [
      'src/a.test.ts',
      'tests/x.py',
      'pkg/a_test.go',
      'test_api.py',
      'a/__tests__/b.js',
    ]) {
      assert.ok(isTestFile(p), p);
    }
    assert.ok(!isTestFile('src/testing.ts'));
    assert.ok(isCodeFile('src/a.ts'));
    assert.ok(!isCodeFile('README.md'));
    assert.ok(!isCodeFile('src/a.test.ts'));
  });

  test('shortcutHits finds shortcuts in added lines, debug output only outside tests', () => {
    const hits = shortcutHits(diffLines(DIFF));
    assert.deepEqual(hits, [
      { name: '@ts-ignore', file: 'src/cart.ts', line: 11 },
      { name: 'debug output', file: 'src/cart.ts', line: 12 },
      { name: 'any cast', file: 'src/cart.ts', line: 13 },
      { name: 'skipped test', file: 'src/cart.test.ts', line: 1 },
    ]);
  });

  test('removedAssertions counts assertions removed from tests, net of added ones', () => {
    assert.deepEqual(removedAssertions(diffLines(DIFF)), [
      { name: 'removed assertion', file: 'src/cart.test.ts' },
      { name: 'removed assertion', file: 'src/cart.test.ts' },
    ]);
    const moved = diffLines(`--- a/a.test.ts
+++ b/a.test.ts
@@ -1,1 +1,1 @@
-  assert.equal(x, 1);
+  assert.equal(x, 2);
`);
    assert.deepEqual(removedAssertions(moved), []);
  });
});

describe('manifests', () => {
  test('addedPackageDeps names packages new on the head, in any dependency field', () => {
    const base = JSON.stringify({ dependencies: { a: '1' }, devDependencies: { b: '1' } });
    const head = JSON.stringify({
      dependencies: { a: '2', c: '1' },
      devDependencies: { b: '1', d: '1' },
    });
    assert.deepEqual(addedPackageDeps(base, head), ['c', 'd']);
    assert.deepEqual(addedPackageDeps(undefined, head), ['a', 'b', 'c', 'd']);
    assert.deepEqual(addedPackageDeps(base, 'not json'), []);
  });

  test('changedGuardedScripts flags a changed test or lint script only', () => {
    const base = JSON.stringify({ scripts: { test: 'vitest run', lint: 'eslint .', dev: 'vite' } });
    const head = JSON.stringify({
      scripts: { test: 'echo ok', lint: 'eslint .', dev: 'vite --open' },
    });
    assert.deepEqual(changedGuardedScripts(base, head), ['test']);
  });

  test('addedLineDeps reads go.mod and requirements files', () => {
    const lines = diffLines(`--- a/go.mod
+++ b/go.mod
@@ -1,1 +1,3 @@
+require github.com/x/y v1.2.0
+	golang.org/x/text v0.3.0
--- a/requirements.txt
+++ b/requirements.txt
@@ -1,1 +1,3 @@
+requests==2.0
+# a comment
`);
    assert.deepEqual(addedLineDeps(lines), ['github.com/x/y', 'golang.org/x/text', 'requests']);
  });
});

describe('parseCriteria', () => {
  test('reads C1..Cn in the forms ba-ticket and people write', () => {
    const body = [
      '## Acceptance criteria',
      '- **C1** A user can add a product',
      '- [ ] C2: The list survives a reload',
      'C3. Empty list shows a message',
      '* **C4.** Errors are shown',
      '- C2 duplicate is ignored',
      'Some text mentioning C5 in the middle',
    ].join('\n');
    assert.deepEqual(parseCriteria(body), [
      { id: 'C1', text: 'A user can add a product' },
      { id: 'C2', text: 'The list survives a reload' },
      { id: 'C3', text: 'Empty list shows a message' },
      { id: 'C4', text: 'Errors are shown' },
    ]);
    assert.deepEqual(parseCriteria('no criteria here'), []);
    assert.deepEqual(parseCriteria('- C2.1. Section one\n- C2.2: Section two\n- C3. Checks'), [
      { id: 'C2.1', text: 'Section one' },
      { id: 'C2.2', text: 'Section two' },
      { id: 'C3', text: 'Checks' },
    ]);
  });
});

describe('verdictOf', () => {
  const met = (id: string): Criterion => ({ id, text: id, status: 'met' });
  const check = (id: string, status: Check['status']): Check => ({ id, name: id, status });

  test('pass when every criterion is met and no B1 check newly fails', () => {
    const v = verdictOf(
      [met('C1'), met('C2')],
      [check('B1.test', 'pass'), check('B1.lint', 'pre_existing_fail'), check('B5', 'fail')],
      [{ severity: 'major' }],
    );
    assert.equal(v.verdict, 'pass');
  });

  test('fail on a criterion not met, a new B1 failure or a blocker, with every reason', () => {
    const v = verdictOf(
      [met('C1'), { id: 'C2', text: '', status: 'not_met' }],
      [check('B1.build', 'fail')],
      [{ severity: 'blocker' }],
    );
    assert.equal(v.verdict, 'fail');
    assert.deepEqual(v.reasons, [
      'C2 is not met',
      'B1.build fails (passed on base)',
      '1 blocker finding(s)',
    ]);
  });

  test('fail wins over unknown', () => {
    const v = verdictOf(
      [
        { id: 'C1', text: '', status: 'unknown' },
        { id: 'C2', text: '', status: 'not_met' },
      ],
      [],
      [],
    );
    assert.equal(v.verdict, 'fail');
  });

  test('unknown with no criteria, an unknown criterion or tests that could not run', () => {
    assert.equal(verdictOf([], [], []).verdict, 'unknown');
    assert.equal(verdictOf([{ id: 'C1', text: '', status: 'unknown' }], [], []).verdict, 'unknown');
    assert.equal(verdictOf([met('C1')], [check('B1.test', 'error')], []).verdict, 'unknown');
    assert.equal(verdictOf([met('C1')], [check('B1.test', 'skipped')], []).verdict, 'pass');
  });
});

test('reportMarkdown shows the verdict, unknown scores as ? and findings most severe first', () => {
  const report: Report = {
    rubric_version: RUBRIC_VERSION,
    calibrated: false,
    judged_at: '2026-11-16T10:00:00.000Z',
    repo: 'acme/shop',
    pr: {
      number: 12,
      url: 'https://github.com/acme/shop/pull/12',
      title: 'Add the wishlist',
      head_ref: 'factory/run-7',
      head_sha: 'c'.repeat(40),
      base_sha: 'b'.repeat(40),
    },
    issues: [{ number: 7, title: 'Wishlist' }],
    run_id: 'run-7',
    verdict: 'fail',
    verdict_reasons: ['C2 is not met'],
    merge: 'do_not_merge',
    criteria: [{ id: 'C1', text: 'a | b', status: 'met', derived: true }],
    checks: [{ id: 'B5', name: 'shortcuts', status: 'fail', count: 1 }],
    scores: [{ id: 'C4', name: 'Handles failure', score: null, reasons: 'no error path' }],
    findings: [
      { severity: 'minor', file: 'a.ts', line: 2, problem: 'small' },
      { severity: 'blocker', criterion: 'C7', file: 'b.ts', line: 9, problem: 'SQL injection' },
    ],
  };
  const md = reportMarkdown(report);
  assert.match(
    md,
    /\*\*Verdict: FAIL\*\* · merge: do_not_merge · rubric pr-judge\/1 \(uncalibrated\)/,
  );
  assert.match(md, /\| C1\* \| a \\\| b \| met \|/);
  assert.match(md, /\| C4 \| Handles failure \| \? \|/);
  assert.ok(md.indexOf('SQL injection') < md.indexOf('small'));
  assert.match(md, /Factory run run-7/);
});

describe('fromJudges', () => {
  const parsed = [
    { id: 'C1', text: 'add' },
    { id: 'C2', text: 'reload' },
  ];

  test('takes each criterion status from C6, scores and findings per judge, merge from H1', () => {
    const r = fromJudges(parsed, {
      C6: {
        criteria: [
          { id: 'C1', status: 'met', evidence: 'src/a.ts:3' },
          { id: 'C9', status: 'met' },
        ],
        findings: [{ severity: 'major', file: 'src/a.ts', line: 3, problem: 'C2 missing' }],
      },
      C1: { reasons: 'clear', score: 4, findings: [{ severity: 'minor', file: 'b.ts', text: 'long' }] },
      C7: { reasons: 'none found', score: 5, findings: [{ severity: 'bogus', problem: 'x' }] },
      H1: { reasons: 'small fixes', merge: 'merge_after_changes' },
    });
    assert.deepEqual(r.criteria, [
      { id: 'C1', text: 'add', status: 'met', evidence: 'src/a.ts:3' },
      { id: 'C2', text: 'reload', status: 'unknown' },
    ]);
    assert.deepEqual(
      r.scores.find((s) => s.id === 'C1'),
      { id: 'C1', name: 'Readable', score: 4, reasons: 'clear' },
    );
    assert.deepEqual(
      r.scores.find((s) => s.id === 'C4'),
      {
        id: 'C4',
        name: 'Handles failure',
        score: null,
        reasons: 'no answer',
      },
    );
    assert.deepEqual(r.findings, [
      { severity: 'major', criterion: 'C6', file: 'src/a.ts', line: 3, problem: 'C2 missing' },
      { severity: 'minor', criterion: 'C7', problem: 'x' },
      { severity: 'minor', criterion: 'C1', file: 'b.ts', problem: 'long' },
    ]);
    assert.equal(r.merge, 'merge_after_changes');
    assert.deepEqual(r.missing, ['C2', 'C3', 'C4', 'C5']);
  });

  test('an out-of-range score is Unknown, and unnumbered criteria come from C6 as derived', () => {
    const r = fromJudges([], {
      C6: { criteria: [{ id: 'C1', text: 'add', status: 'not_met' }] },
      C3: { score: 9 },
    });
    assert.deepEqual(r.criteria, [{ id: 'C1', text: 'add', status: 'not_met', derived: true }]);
    assert.equal(r.scores.find((s) => s.id === 'C3')?.score, null);
    assert.equal(r.merge, 'unknown');
  });

  test('runIdOfBranch reads factory/<run id>', () => {
    assert.equal(runIdOfBranch('factory/run-7'), 'run-7');
    assert.equal(runIdOfBranch('feature/x'), undefined);
  });
});

test('reportMarkdown names a branch judged without a pull request by its label', () => {
  const md = reportMarkdown({
    rubric_version: RUBRIC_VERSION,
    calibrated: false,
    judged_at: '2026-11-17T10:00:00.000Z',
    repo: 'acme/shop',
    pr: { title: 'Compare page', head_ref: 'branch-a', head_sha: 'c'.repeat(40), base_sha: 'b'.repeat(40) },
    issues: [],
    verdict: 'pass',
    verdict_reasons: [],
    merge: 'merge',
    criteria: [],
    checks: [],
    scores: [],
    findings: [],
  });
  assert.match(md, /^# branch-a: Compare page/);
  assert.match(md, /no pull request · issues none/);
});
