// Tests for the rules that factory.js enforces in code. Run: node --test tests/
import test from 'node:test'
import assert from 'node:assert/strict'
import { helpers as h } from './load.mjs'

const contract = {
  objective: 'o',
  criteria: [{ id: 'C1', text: 'one' }, { id: 'C2', text: 'two' }],
  outOfScope: [],
  checks: [{ name: 'test', command: 'run-tests' }],
}

function spec(over) {
  return {
    id: 'S1', title: 't', goal: 'g', kind: 'feature', skills: [], criteria: ['C1', 'C2'], dependsOn: [],
    filesOwned: ['a.py'], testFiles: ['tests/test_a.py'],
    context: '', interfaces: 'f(x)', changes: 'c', tests: 'tt', outOfScope: '', doneWhen: ['x'],
    ...over,
  }
}

const two = [
  spec({ id: 'S1', criteria: ['C1'] }),
  spec({ id: 'S2', criteria: ['C2'], dependsOn: ['S1'], filesOwned: ['b.py'], testFiles: ['tests/test_b.py'] }),
]

const goodReview = { criteria: [{ id: 'C1', status: 'met', evidence: 'e' }, { id: 'C2', status: 'met', evidence: 'e' }], findings: [], notReviewed: [] }
const goodCheck = { results: [{ name: 'test', command: 'run-tests', exitCode: 0, outputTail: '' }], changedFiles: [] }

test('validateSpecs accepts a usable set', () => {
  assert.deepEqual(h.validateSpecs([spec()], contract), [])
  assert.deepEqual(h.validateSpecs(two, contract), [])
})

test('validateSpecs rejects what the planner brief says it rejects', () => {
  const has = (specs, re) => assert.ok(h.validateSpecs(specs, contract).some(p => re.test(p)), `expected ${re}`)
  has([], /No specs/)
  has([spec({ criteria: ['C1'] })], /C2 is not covered/)
  has([spec({ criteria: ['C1', 'C2', 'C9'] })], /C9, which is not in the contract/)
  has([spec({ filesOwned: [], testFiles: [] })], /owns no files/)
  has([spec({ testFiles: ['./a.py'] })], /both filesOwned and testFiles/)
  has([two[0], { ...two[1], filesOwned: ['a.py'] }], /owned by both S1 and S2/)
  has([two[0], { ...two[1], testFiles: ['tests/test_a.py'] }], /owned by both S1 and S2/)
  has([spec({ dependsOn: ['S7'] })], /S7, which does not exist/)
  has([spec({ dependsOn: ['S1'] })], /depends on itself/)
  has([{ ...two[0], dependsOn: ['S2'] }, two[1]], /cycle/)
  has([spec(), spec()], /used more than once/)
  has([spec({ changes: '' })], /"changes" is empty/)
})

test('a spec with only tests needs no changes or doneWhen; one without tests is allowed', () => {
  assert.deepEqual(h.validateSpecs([spec({ filesOwned: [], changes: '', doneWhen: [] })], contract), [])
  assert.deepEqual(h.validateSpecs([spec({ testFiles: [] })], contract), [])
})

test('buildLevels orders by dependency and returns null on a cycle', () => {
  assert.deepEqual(h.buildLevels(two).map(l => l.map(s => s.id)), [['S1'], ['S2']])
  assert.equal(h.buildLevels([{ id: 'A', dependsOn: ['B'] }, { id: 'B', dependsOn: ['A'] }]), null)
  assert.equal(h.buildLevels([{ id: 'A' }, { id: 'B' }]).length, 1)
})

test('matchesIgnore: exact path, directory, *.ext and **/name', () => {
  assert.ok(h.matchesIgnore('build/out.js', 'build'))
  assert.ok(h.matchesIgnore('build/out.js', 'build/'))
  assert.ok(!h.matchesIgnore('builder/out.js', 'build'))
  assert.ok(h.matchesIgnore('a/b/x.pyc', '*.pyc'))
  assert.ok(h.matchesIgnore('a/__pycache__/x', '**/__pycache__'))
  assert.ok(!h.matchesIgnore('a/b', ''))
})

test('ownership: stray files stop the run, caches and ignored files do not', () => {
  const changed = ['a.py', 'tests/test_a.py', 'other.py', 'tests/__pycache__/x.pyc', 'wip.txt']
  assert.deepEqual(h.filesOutsideOwnership(changed, [spec()], ['wip.txt']), ['other.py'])
  assert.deepEqual(h.filesOutsideAssignment(['./a.py', 'b.py'], ['a.py']), ['b.py'])
  assert.deepEqual(h.filesOutsideAssignment(['/repo/a.py', '/elsewhere/a.py'], ['a.py']), ['/elsewhere/a.py'])
})

test('the implementer may change both the source and the test files of its spec', () => {
  assert.deepEqual(h.specFiles(spec()), ['a.py', 'tests/test_a.py'])
  assert.deepEqual(h.filesOutsideAssignment(['a.py', 'tests/test_a.py'], h.specFiles(spec())), [])
  assert.deepEqual(h.filesOutsideAssignment(['a.py'], spec().testFiles), ['a.py'], 'QA may change test files only')
})

test('testsChanged picks the test files out of what an agent changed', () => {
  assert.deepEqual(h.testsChanged(['a.py', '/repo/tests/test_a.py', './tests/test_a.py'], spec()), ['tests/test_a.py'])
  assert.deepEqual(h.testsChanged(['a.py'], spec()), [])
  assert.deepEqual(h.testsChanged(undefined, spec()), [])
})

test('evaluate passes only when checks, criteria and findings are all clean', () => {
  assert.deepEqual(h.evaluate(contract, goodCheck, goodReview, []), [])
  const kinds = (c, r, sr) => h.evaluate(contract, c, r, sr || []).map(f => f.kind)
  assert.deepEqual(kinds({ results: [] }, goodReview), ['check'])
  assert.deepEqual(kinds({ results: [{ name: 'test', exitCode: 1, outputTail: 'x' }] }, goodReview), ['check'])
  assert.deepEqual(kinds(goodCheck, { criteria: [goodReview.criteria[0]], findings: [] }), ['criterion'])
  assert.deepEqual(kinds(goodCheck, { ...goodReview, criteria: [goodReview.criteria[0], { id: 'C2', status: 'unknown', evidence: '' }] }), ['criterion'])
  assert.deepEqual(kinds(goodCheck, { ...goodReview, findings: [{ severity: 'minor', file: 'a.py', line: 1, problem: 'p' }] }), [])
  assert.deepEqual(kinds(goodCheck, { ...goodReview, findings: [{ severity: 'blocking', file: 'a.py', line: 1, problem: 'p' }] }), ['finding'])
})

test('evaluate: a spec reviewer can fail a criterion the whole-change reviewer passed', () => {
  const specReviews = [{ spec: two[0], review: { criteria: [{ id: 'C1', status: 'not_met', evidence: 'e' }], findings: [] } }]
  const failures = h.evaluate(contract, goodCheck, goodReview, specReviews)
  assert.equal(failures.length, 1)
  assert.equal(failures[0].spec, 'S1')
})


const goodQc = { status: 'done', criteria: [{ id: 'C1', status: 'pass', scenario: 's', expected: 'e', observed: 'o' }, { id: 'C2', status: 'not_observable', scenario: 'about the code', expected: '', observed: '' }], filesChanged: [] }

test('evaluate: QC fails a criterion it saw fail or did not judge; not_observable passes', () => {
  assert.deepEqual(h.evaluate(contract, goodCheck, goodReview, [], goodQc), [])
  assert.deepEqual(h.evaluate(contract, goodCheck, goodReview, [], null), [], 'QC that did not run adds nothing')
  const failing = { ...goodQc, criteria: [{ id: 'C1', status: 'fail', scenario: 'ran wc --json a.txt', expected: 'JSON', observed: 'usage error' }] }
  const failures = h.evaluate(contract, goodCheck, goodReview, [], failing)
  assert.deepEqual(failures.map(f => [f.kind, f.id]), [['qc', 'C1'], ['qc', 'C2']])
  assert.match(failures[0].problem, /Scenario: ran wc --json a\.txt Expected: JSON Observed: usage error/)
  assert.match(failures[1].problem, /C2 was not judged by QC/)
})

test('checkFailures is the check part of evaluate', () => {
  assert.deepEqual(h.checkFailures(contract, goodCheck), [])
  assert.deepEqual(h.checkFailures(contract, { results: [{ name: 'test', exitCode: 2 }] }).map(f => f.kind), ['check'])
})

test('routeFailures and failureEntries: a QC failure goes to the specs of its criterion and logs it', () => {
  const f = { kind: 'qc', id: 'C2', problem: 'p' }
  const groups = h.routeFailures([f], two)
  assert.deepEqual(groups.map(g => g.spec.id), ['S2'])
  const [e] = h.failureEntries(groups, { stage: 'review', round: 1, sentBack: true })
  assert.deepEqual(e, { stage: 'review', round: 1, kind: 'qc', specs: ['S2'], criterion: 'C2', problem: 'p', sentBack: true })
})

test('qcText shows the contract and how to run the product, and nothing of the checks', () => {
  const text = h.qcText({ ...contract, run: 'python3 wordstats.py FILE' })
  assert.match(text, /- C1: one/)
  assert.match(text, /How to run the product:\npython3 wordstats\.py FILE/)
  assert.ok(!text.includes('run-tests'), 'the check commands are not shown')
  assert.match(h.qcText(contract), /Not given\. Find out from the repository's README/)
})

test('qcLine counts what QC saw', () => {
  assert.deepEqual(h.qcLine(goodQc), { text: '1/2 criteria pass when used, 1 not observable', state: 'ok' })
  assert.equal(h.qcLine({ criteria: [{ id: 'C1', status: 'fail' }] }).state, 'fail')
  assert.equal(h.qcLine({ criteria: [] }).state, 'fail')
})


test('routeFailures: a failure naming a file goes to the spec that owns it', () => {
  const groups = h.routeFailures([
    { kind: 'finding', file: 'b.py', line: 1, problem: 'p' },
    { kind: 'finding', file: 'tests/test_b.py', line: 1, problem: 'p' },
    { kind: 'finding', file: 'tests/test_a.py', line: 1, spec: 'S2', problem: 'p' },
  ], two)
  assert.deepEqual(groups.map(g => [g.spec.id, g.failures.length]), [['S1', 1], ['S2', 2]])
})

test('routeFailures: criteria go to the specs responsible for them', () => {
  const whole = h.routeFailures([{ kind: 'criterion', id: 'C2', problem: 'p' }], two)
  assert.deepEqual(whole.map(g => g.spec.id), ['S2'])
  const judged = h.routeFailures([{ kind: 'criterion', id: 'C1', spec: 'S2', problem: 'p' }], two)
  assert.deepEqual(judged.map(g => g.spec.id), ['S2'])
})

test('routeFailures: a failing check goes to the specs named in its output, else to all', () => {
  const named = h.routeFailures([{ kind: 'check', name: 'test', problem: 'p', outputTail: 'FAILED tests/test_b.py::test_x' }], two)
  assert.deepEqual(named.map(g => g.spec.id), ['S2'])
  const unnamed = h.routeFailures([{ kind: 'check', name: 'test', problem: 'p', outputTail: 'segfault' }], two)
  assert.deepEqual(unnamed.map(g => g.spec.id), ['S1', 'S2'])
  const stray = h.routeFailures([{ kind: 'finding', file: 'nobody.py', line: 1, problem: 'p' }], two)
  assert.deepEqual(stray.map(g => g.spec.id), ['S1', 'S2'])
})

// An isolation failure: one spec's test file leaks a mock, and the output names
// the victims, here files of both specs and of none.
const leak = 'FAIL tests/test_a.py::t1\nFAIL tests/test_b.py::t2\nFAIL tests/old_test.py::t3'

test('routeFailures: a check with a culprit owned by a spec goes to that spec only', () => {
  const groups = h.routeFailures([{ kind: 'check', name: 'test', problem: 'p', outputTail: leak, culprits: ['tests/test_b.py'] }], two)
  assert.deepEqual(groups.map(g => g.spec.id), ['S2'])
  const absolute = h.routeFailures([{ kind: 'check', name: 'test', problem: 'p', outputTail: 'segfault', culprits: ['/repo/tests/test_a.py'] }], two)
  assert.deepEqual(absolute.map(g => g.spec.id), ['S1'], 'an absolute culprit path is read relative to the repository')
})

test('routeFailures: a culprit no spec owns falls back to the output, then to every spec', () => {
  const named = h.routeFailures([{ kind: 'check', name: 'test', problem: 'p', outputTail: 'FAILED tests/test_b.py::test_x', culprits: ['tests/old_test.py'] }], two)
  assert.deepEqual(named.map(g => g.spec.id), ['S2'])
  const unnamed = h.routeFailures([{ kind: 'check', name: 'test', problem: 'p', outputTail: 'segfault', culprits: ['tests/old_test.py'] }], two)
  assert.deepEqual(unnamed.map(g => g.spec.id), ['S1', 'S2'])
})

test('routeFailures: without culprits a check is routed as before', () => {
  for (const culprits of [undefined, []]) {
    const groups = h.routeFailures([{ kind: 'check', name: 'test', problem: 'p', outputTail: leak, culprits }], two)
    assert.deepEqual(groups.map(g => g.spec.id), ['S1', 'S2'])
  }
})

test('resultFor matches a check by name, then by command, so a shortened name is not "not run"', () => {
  const check = { name: 'ci-tests: Run unit tests', command: 'python3 -m unittest discover -s tests -v' }
  const exact = { name: 'ci-tests: Run unit tests', command: 'other', exitCode: 0 }
  const shortened = { name: 'ci-tests', command: 'python3  -m unittest discover -s tests -v ', exitCode: 0 }
  assert.equal(h.resultFor([shortened, exact], check), exact, 'the exact name wins')
  assert.equal(h.resultFor([shortened], check), shortened, 'the same command, spacing aside, matches')
  assert.equal(h.resultFor([{ name: 'lint', command: 'ruff check .', exitCode: 0 }], check), undefined)
  assert.equal(h.resultFor(undefined, check), undefined)
  const contractWithColon = { ...contract, checks: [check] }
  assert.deepEqual(h.evaluate(contractWithColon, { results: [shortened], changedFiles: [] }, goodReview, []), [])
  assert.deepEqual(h.evaluate(contractWithColon, { results: [], changedFiles: [] }, goodReview, []).map(f => f.problem),
    ['Check "ci-tests: Run unit tests" (python3 -m unittest discover -s tests -v) was not run.'])
})

test('evaluate carries the checker\'s culprits into the check failure', () => {
  const check = { results: [{ name: 'test', command: 'run-tests', exitCode: 1, outputTail: leak, culprits: ['./tests/test_b.py'], culpritEvidence: 'tests/test_a.py alone: pass' }], changedFiles: [] }
  const [f] = h.evaluate(contract, check, goodReview, [])
  assert.deepEqual(f.culprits, ['tests/test_b.py'])
  assert.equal(f.culpritEvidence, 'tests/test_a.py alone: pass')
  assert.ok(f.problem.includes('tests/test_b.py'))
  assert.deepEqual(h.routeFailures([f], two).map(g => g.spec.id), ['S2'])
  const plain = h.evaluate(contract, { ...check, results: [{ ...check.results[0], culprits: [], culpritEvidence: 'nothing found' }] }, goodReview, [])
  assert.equal(plain[0].culprits, undefined)
  assert.equal(plain[0].problem, 'Check "test" (run-tests) exited with 1.')
})

test('isolationText lists each spec\'s test files as suspects, with the run cap', () => {
  const text = h.isolationText(two)
  assert.ok(text.includes('- S1: tests/test_a.py') && text.includes('- S2: tests/test_b.py'))
  assert.ok(text.includes(`at most ${h.MAX_ISOLATION_RUNS} extra runs`))
  assert.equal(h.isolationText([spec({ testFiles: [] })]), '')
})

test('failureEntries logs each routed failure once, with the specs that had to answer for it', () => {
  const failures = [
    { kind: 'check', name: 'test', problem: 'Check "test" (run-tests) exited with 1.', outputTail: 'segfault' },
    { kind: 'criterion', id: 'C2', problem: 'Criterion C2 is not_met: e' },
    { kind: 'finding', file: './b.py', line: 3, spec: 'S2', problem: 'p' },
  ]
  const log = h.failureEntries(h.routeFailures(failures, two), { stage: 'review', round: 1, sentBack: true })
  assert.equal(log.length, 3)
  assert.deepEqual(log.map(e => e.kind), ['check', 'criterion', 'finding'])
  const check = log.find(e => e.kind === 'check')
  assert.deepEqual(check.specs, ['S1', 'S2'])
  assert.equal(check.check, 'test')
  assert.equal(check.outputTail, undefined, 'the check output stays out of the log')
  assert.equal(log.find(e => e.kind === 'criterion').criterion, 'C2')
  assert.deepEqual(log.find(e => e.kind === 'finding'), { stage: 'review', round: 1, kind: 'finding', specs: ['S2'], file: 'b.py', line: 3, problem: 'p', sentBack: true })
})

test('failureEntries marks a failure that ended the run, logs QA rounds and cuts long problems', () => {
  const s = spec()
  const long = 'x'.repeat(1000)
  const [e] = h.failureEntries([{ spec: s, failures: [{ kind: 'qa', file: 'tests/test_a.py', line: 1, spec: 'S1', problem: long }] }], { stage: 'qa', round: 2, sentBack: false })
  assert.equal(e.stage, 'qa')
  assert.equal(e.round, 2)
  assert.equal(e.sentBack, false)
  assert.equal(e.problem.length, 300)
  assert.ok(e.problem.endsWith('…'))
  assert.deepEqual(h.failureEntries([], { stage: 'qa', round: 0, sentBack: true }), [])
})

test('specText shows the implementer everything and hides the plan from QA', () => {
  const s = spec({ changes: 'CHANGES-TEXT', tests: 'TESTS-TEXT', doneWhen: ['DONE-TEXT'] })
  const impl = h.specText(s, contract, 'implementer')
  const qa = h.specText(s, contract, 'qa')
  assert.ok(impl.includes('CHANGES-TEXT') && impl.includes('TESTS-TEXT') && impl.includes('DONE-TEXT'))
  assert.ok(impl.includes('tests/test_a.py') && impl.includes('a.py'))
  assert.ok(qa.includes('TESTS-TEXT') && !qa.includes('CHANGES-TEXT') && !qa.includes('DONE-TEXT'))
})

test('runRecord shows the run from raw state', () => {
  const run = { id: 'r', title: 't', agents: 6, maxRepairRounds: 2 }
  const state = {
    specs: [spec(), spec({ id: 'S2', testFiles: [], filesOwned: ['b.py'] })],
    builds: [{ spec: 'S1', tdd: [{ criterion: 'C1', tests: ['t1'], red: 'r' }, { criterion: 'C2', tests: [], red: 'none' }] }],
    qa: [{ spec: 'S1', gaps: [{ severity: 'high', problem: 'g', written: true }, { severity: 'low', problem: 'g', written: false }], failures: [] }],
    check: goodCheck, review: goodReview, specReviews: [], failures: [{ kind: 'criterion', id: 'C2' }], repairRounds: 0, reason: '',
  }
  const rec = h.runRecord(run, contract, state, { phase: 'Review', outcome: 'running', levels: 1, build: { S1: { impl: 'ok', test: 'ok' }, S2: { impl: 'ok', test: 'none' } }, repairs: [] })
  assert.equal(rec.specs[0].implNote, 'Test-first: 1/2 criteria')
  assert.equal(rec.specs[0].testNote, 'QA: 2 gap(s), 1 test(s) added')
  assert.equal(rec.specs[1].test, 'none')
  assert.equal(rec.check.state, 'ok')
  assert.deepEqual(rec.criteria.map(c => c.status), ['met', 'not_met'])
  assert.deepEqual(rec.review.map(r => r.tag), ['whole change'])
  const withQc = h.runRecord(run, contract, { ...state, failures: [{ kind: 'qc', id: 'C1' }], qc: [{ round: 0, ...goodQc }] }, { phase: 'Review', outcome: 'running', levels: 1, build: {}, repairs: [] })
  assert.deepEqual(withQc.review.at(-1), { tag: 'qc', text: '1/2 criteria pass when used, 1 not observable', state: 'ok' })
  assert.deepEqual(withQc.criteria.map(c => c.status), ['not_met', 'met'], 'a criterion QC failed is not met')
  const early = h.runRecord(run, contract, { specs: [] }, { phase: 'Spec', outcome: 'running', levels: 0, build: {}, repairs: [] })
  assert.deepEqual(early.criteria.map(c => c.status), ['', ''])
  assert.equal(rec.workflowOutcome, 'running')
  const done = h.runRecord(run, contract, state, { phase: 'Review', outcome: 'passed', levels: 1, build: {}, repairs: [] })
  assert.equal(done.outcome, 'passed')
  assert.equal(done.workflowOutcome, 'passed')
  assert.deepEqual(rec.failureLog, [], 'a run with no failure log files an empty one')
  const entry = { stage: 'qa', round: 0, kind: 'qa', specs: ['S1'], file: 'tests/test_a.py', line: 1, problem: 'p', sentBack: true }
  assert.deepEqual(h.runRecord(run, contract, { ...state, failureLog: [entry] }, { phase: 'Build', outcome: 'running', levels: 1, build: {}, repairs: [] }).failureLog, [entry])
})

test('scratchDir gives every agent label its own directory under the scratch root', () => {
  const labels = ['planner', 'build S1', 'qa S1', 'review S1', 'review S1 (round 1)', 'rebuild 1 S1', 'rebuild 2 S1', 'checker', 'checker (round 1)']
  const dirs = labels.map(l => h.scratchDir('/w', l))
  assert.equal(new Set(dirs).size, labels.length)
  for (const d of dirs) assert.match(d, /^\/w\/[a-z0-9]+(-[a-z0-9]+)*$/)
  assert.equal(h.scratchDir('/w', 'review S1 (round 1)'), '/w/review-s1-round-1')
})

test('scratchDir never leaves the scratch root, whatever the label', () => {
  assert.equal(h.scratchDir('/w', '../../etc'), '/w/etc')
  assert.equal(h.scratchDir('/w', ''), '/w/agent')
  assert.equal(h.scratchDir('/w', '///'), '/w/agent')
  assert.equal(h.scratchDir('/w', undefined), '/w/agent')
})

test('scratchNote names the directory and forbids links into the repository', () => {
  const note = h.scratchNote('/w/qa-s1')
  assert.match(note, /^Scratch directory: \/w\/qa-s1\n/)
  assert.match(note, /Never create a link/)
})

test('validateSpecs: every spec has a known kind, and its own skills are installed and unattended', () => {
  const has = (specs, available, re) => assert.ok(h.validateSpecs(specs, contract, available).some(p => re.test(p)), `expected ${re}`)
  has([spec({ kind: undefined })], undefined, /"kind" must be one of/)
  has([spec({ kind: 'chore' })], undefined, /"kind" must be one of/)
  has([spec({ skills: ['grill-me'] })], ['grill-me'], /waits on a person/)
  has([spec({ skills: ['impeccable'] })], ['tdd'], /impeccable is not installed/)
  assert.deepEqual(h.validateSpecs([spec({ skills: ['impeccable'] })], contract, ['impeccable']), [])
})

test('skillsFor: the kind picks the implementer\'s skills, a spec\'s own skills replace them, roles add theirs', () => {
  assert.deepEqual(h.skillsFor('implementer', spec({ kind: 'bug' })), ['diagnosing-bugs', 'tdd', 'verification-before-completion', 'mp-code-review'])
  assert.deepEqual(h.skillsFor('implementer', spec({ kind: 'feature' })), ['tdd', 'codebase-design', 'verification-before-completion', 'mp-code-review'])
  assert.deepEqual(h.skillsFor('implementer', spec({ kind: 'ux' })), ['tdd', 'verification-before-completion', 'mp-code-review'])
  assert.deepEqual(h.skillsFor('implementer', spec({ kind: 'tech-debt' })), ['codebase-design', 'tdd', 'verification-before-completion', 'mp-code-review'])
  assert.deepEqual(h.skillsFor('implementer', spec({ kind: 'docs' })), ['verification-before-completion', 'mp-code-review'])
  assert.deepEqual(h.skillsFor('implementer', spec({ kind: 'bug', skills: ['impeccable'] })), ['impeccable', 'verification-before-completion', 'mp-code-review'])
  assert.deepEqual(h.skillsFor('qa', spec({ kind: 'bug', skills: ['impeccable'] })), ['tdd', 'diagnosing-bugs', 'verification-before-completion', 'testing-strategy', 'mp-code-review', 'pr-security-review'])
  assert.deepEqual(h.skillsFor('reviewer'), ['mp-code-review', 'codebase-design'])
  assert.deepEqual(h.skillsFor('specReviewer', spec()), ['mp-code-review', 'codebase-design'])
  assert.deepEqual(h.skillsFor('planner'), [])
})

test('missingSkills: a run needs every skill the registry can hand out', () => {
  const all = Object.fromEntries(h.requiredSkills().map(n => [n, `/s/${n}/SKILL.md`]))
  assert.deepEqual(h.missingSkills(all), [])
  assert.deepEqual(h.missingSkills({ ...all, tdd: '' }), ['tdd'])
  assert.deepEqual(h.missingSkills(undefined), h.requiredSkills())
  for (const kind of h.SKILLS.kinds) assert.ok(Array.isArray(h.SKILLS.implementer[kind]), `kind ${kind} has a row`)
})

test('skillsNote names each skill with its path and the unattended rules', () => {
  assert.equal(h.skillsNote([], {}), '')
  const note = h.skillsNote(['tdd'], { tdd: '/s/tdd/SKILL.md' }, 'FIXED')
  assert.match(note, /Skill tool, in this order: tdd/)
  assert.match(note, /- tdd: \/s\/tdd\/SKILL\.md/)
  assert.match(note, /the brief wins/)
  assert.match(note, /FIXED$/)
})

test('conditionalFor offers the installed conditional skills of a role, with their rule', () => {
  const paths = { vitest: '/s/vitest/SKILL.md', 'testing-strategy': '/s/ts/SKILL.md', 'playwright-best-practices': '/s/p/SKILL.md' }
  assert.deepEqual(h.conditionalFor('implementer', paths).map(c => c.name), ['vitest', 'playwright-best-practices', 'testing-strategy'])
  assert.deepEqual(h.conditionalFor('qa', paths).map(c => c.name), ['vitest', 'playwright-best-practices'], 'as super-board: QA always loads testing-strategy, browsers by condition')
  assert.match(h.conditionalFor('qa', paths)[0].when, /Vitest/)
  assert.deepEqual(h.conditionalFor('implementer', paths, ['vitest']).map(c => c.name), ['playwright-best-practices', 'testing-strategy'], 'not offered again when loaded anyway')
  assert.deepEqual(h.conditionalFor('implementer', { ...paths, 'domain-modeling': '/d' }).map(c => c.name).includes('domain-modeling'), true)
  assert.deepEqual(h.conditionalFor('reviewer', paths), [])
  assert.deepEqual(h.conditionalFor('qc', paths).map(c => c.name), ['playwright-best-practices'])
  assert.deepEqual(h.skillsFor('qc'), [], 'QC loads no review skill')
  assert.deepEqual(h.conditionalFor('implementer', undefined), [])
  assert.deepEqual(h.optionalSkills(), ['domain-modeling', 'playwright-best-practices', 'vitest'])
  for (const n of h.optionalSkills()) assert.ok(!h.requiredSkills().includes(n), `${n} is never required`)
})

test('skillsNote lists conditional skills apart, each with its rule', () => {
  const note = h.skillsNote(['tdd'], { tdd: '/t', vitest: '/v' }, '', [{ name: 'vitest', when: 'when Vitest' }])
  assert.match(note, /each only when its rule applies/)
  assert.match(note, /- vitest, when Vitest: \/v/)
  assert.match(h.skillsNote([], { vitest: '/v' }, '', [{ name: 'vitest', when: 'w' }]), /^Load these too/)
})

test('modelFor: the planner and the whole-change reviewer get the strongest models, the rest Sonnet', () => {
  assert.deepEqual(h.modelFor('planner'), { model: 'fable', effort: 'high' })
  assert.deepEqual(h.modelFor('reviewer'), { model: 'opus', effort: 'high' })
  for (const role of ['implementer', 'qa', 'specReviewer', 'qc']) assert.deepEqual(h.modelFor(role), { model: 'sonnet', effort: 'medium' })
  assert.deepEqual(h.modelFor('checker'), { model: 'sonnet', effort: 'low' })
  assert.deepEqual(h.modelFor('rebuild'), { model: 'opus', effort: 'medium' }, 'a spec sent back is rebuilt on a stronger model')
})

test('modelFor: "models" replaces entries, and "inherit" runs on the session model', () => {
  assert.deepEqual(h.modelFor('implementer', { implementer: { model: 'opus' } }), { model: 'opus', effort: 'medium' })
  assert.deepEqual(h.modelFor('reviewer', { reviewer: { model: 'inherit', effort: 'max' } }), { effort: 'max' })
  assert.deepEqual(h.modelFor('qa', { implementer: { model: 'opus' } }), { model: 'sonnet', effort: 'medium' })
})

test('modelProblems rejects unknown roles, models and efforts', () => {
  assert.deepEqual(h.modelProblems(undefined), [])
  assert.deepEqual(h.modelProblems({ planner: { model: 'opus', effort: 'max' } }), [])
  const has = (o, re) => assert.ok(h.modelProblems(o).some(p => re.test(p)), `expected ${re}`)
  has([], /must be an object/)
  has({ tester: { model: 'opus' } }, /tester, which is not a role/)
  has({ planner: { model: 'gpt' } }, /model" must be one of/)
  has({ planner: { effort: 'huge' } }, /effort" must be one of/)
  has({ planner: 'opus' }, /must be an object with/)
})

test('issueText shows the planner the issue and its sub-issues as background, not as criteria', () => {
  assert.equal(h.issueText(undefined), '')
  assert.equal(h.issueText({ number: 7, title: '', body: '' }), '')
  const text = h.issueText({
    number: 7, title: 'Send messages', body: 'Users send text.\n',
    subIssues: [{ number: 8, title: 'Message store', body: 'Lives in src/store.ts' }, { number: 9, title: 'Chat UI', body: '' }],
  })
  assert.match(text, /issue #7/)
  assert.match(text, /Issue #7: Send messages\nUsers send text\./)
  assert.match(text, /Sub-issue #8: Message store\nLives in src\/store\.ts/)
  assert.match(text, /Sub-issue #9: Chat UI\n\(no description\)/)
  assert.match(text, /not as specs or criteria/)
  assert.match(text, /Only the contract's criteria are judged/)
  assert.match(h.issueText({ number: 3, title: 'Fix', body: 'b' }), /It has no sub-issues\./)
})

test('openQuestions keeps the planner questions that say something, in one shape', () => {
  const { openQuestions } = h
  assert.deepEqual(openQuestions(null), [])
  assert.deepEqual(openQuestions({ questions: [] }), [])
  assert.deepEqual(openQuestions({}), [], 'an older plan without the field has none')
  assert.deepEqual(
    openQuestions({ questions: [{ question: '  Is a deleted order recoverable? ', why: 'changes the delete path', criteria: ['C2'] }, { question: ' ', why: 'x', criteria: [] }, 'Who may export?'] }),
    [
      { question: 'Is a deleted order recoverable?', why: 'changes the delete path', criteria: ['C2'] },
      { question: 'Who may export?', why: '', criteria: [] },
    ],
  )
})

test('questionsText numbers the questions with their criteria and reasons', () => {
  const { questionsText } = h
  assert.equal(
    questionsText([{ question: 'A?', why: 'w', criteria: ['C1', 'C3'] }, { question: 'B?', why: '', criteria: [] }]),
    'Q1: A? (C1, C3) - w Q2: B?',
  )
})

test('matchesGlob: ** across directories, * within a name, a bare name at any depth', () => {
  const { matchesGlob } = h
  assert.ok(matchesGlob('.github/workflows/ci.yml', '.github/**'))
  assert.ok(matchesGlob('web/vitest.config.ts', 'vitest.config.*'))
  assert.ok(matchesGlob('tsconfig.build.json', 'tsconfig*.json'))
  assert.ok(matchesGlob('src/auth/login.ts', '**/auth/**'))
  assert.ok(matchesGlob('src/userAuthGuard.ts', '**/*auth*'), 'case does not matter')
  assert.ok(!matchesGlob('src/vitest.config/x.ts', 'vitest.config.*'), '* stays within one name')
  assert.ok(!matchesGlob('docs/github/x.md', '.github/**'))
})

test('protectedFiles finds the checks a run is judged by, minus what the caller allows', () => {
  const { protectedFiles } = h
  const files = ['src/a.ts', '.github/workflows/ci.yml', 'jest.config.js', 'eslint.config.mjs', 'factory/checks.sh']
  assert.deepEqual(protectedFiles(files), ['.github/workflows/ci.yml', 'jest.config.js', 'eslint.config.mjs', 'factory/checks.sh'])
  assert.deepEqual(protectedFiles(files, ['src/**'], ['.github/**', 'jest.config.js']), ['src/a.ts', 'eslint.config.mjs', 'factory/checks.sh'])
})

test('sensitiveKinds names auth, money, migrations, dependencies and CI by path', () => {
  const { sensitiveKinds } = h
  assert.deepEqual(sensitiveKinds(['src/auth/session.ts', 'api/payments.py', 'db/migrations/001.sql', 'package.json', 'Dockerfile']), ['auth', 'money', 'migration', 'dependency', 'ci'])
  assert.deepEqual(sensitiveKinds(['src/list.ts']), [])
})

test('assessRisk keeps the rating unless the files show more, and adds surfaces', () => {
  const { assessRisk } = h
  assert.deepEqual(assessRisk('low', [], [{ filesOwned: ['src/list.py'] }]), { risk: 'low', surfaces: [], raisedBy: [] })
  assert.deepEqual(assessRisk(undefined, ['bogus'], []), { risk: 'medium', surfaces: [], raisedBy: [] }, 'an unrated run is medium')
  const a = assessRisk('low', [], [{ filesOwned: ['src/billing.ts', 'src/Plan.tsx'] }])
  assert.equal(a.risk, 'high')
  assert.deepEqual(a.surfaces, ['ui', 'security'])
  assert.equal(assessRisk('low', [], [{ filesOwned: ['package.json'] }]).risk, 'medium')
  assert.equal(assessRisk('high', [], [{ filesOwned: ['package.json'] }]).risk, 'high', 'never lowered')
})

test('routedModels puts the caller over the routing, role by role', () => {
  const { routedModels } = h
  assert.deepEqual(routedModels('low', {}), { reviewer: { model: 'sonnet', effort: 'medium' } })
  assert.deepEqual(routedModels('high', { reviewer: { effort: 'high' } }).reviewer, { model: 'opus', effort: 'high' })
  assert.deepEqual(routedModels('medium', undefined), {})
})

test('escalation says what a person must look at, or lets the run merge', () => {
  const { escalation } = h
  const medium = { risk: 'medium', surfaces: [], raisedBy: [] }
  assert.deepEqual(escalation(['src/list.py'], medium, []), { decision: 'auto', reasons: [] })
  const e = escalation(['src/list.py', 'db/migrations/002.sql', 'yarn.lock'], { risk: 'high', surfaces: ['ui'], raisedBy: ['the specs own a migration'] }, [{ rebuild: 1, spec: 'S1', files: ['t.py'] }])
  assert.equal(e.decision, 'person')
  assert.deepEqual(e.reasons.map(r => r.split(':')[0]), ['migration', 'dependency', 'high-risk', 'ui', 'tests-rewritten'])
  assert.match(e.reasons[4], /t\.py/)
  assert.deepEqual(escalation(['yarn.lock'], medium, [], ['auth']).decision, 'auto', 'the caller chooses what needs a person')
})
