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
    id: 'S1', title: 't', goal: 'g', criteria: ['C1', 'C2'], dependsOn: [],
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
  has([spec({ testFiles: ['./a.py'] })], /owned by both/)
  has([two[0], { ...two[1], filesOwned: ['a.py'] }], /owned by both/)
  has([spec({ dependsOn: ['S7'] })], /S7, which does not exist/)
  has([spec({ dependsOn: ['S1'] })], /depends on itself/)
  has([{ ...two[0], dependsOn: ['S2'] }, two[1]], /cycle/)
  has([spec(), spec()], /used more than once/)
  has([spec({ changes: '' })], /"changes" is empty/)
})

test('a spec with only tests needs no changes or doneWhen', () => {
  assert.deepEqual(h.validateSpecs([spec({ filesOwned: [], changes: '', doneWhen: [] })], contract), [])
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

test('splitFailures: only a finding against a test file goes to a tester', () => {
  const failures = [
    { kind: 'check', name: 'test', problem: 'p' },
    { kind: 'criterion', id: 'C1', problem: 'p' },
    { kind: 'finding', file: 'b.py', line: 1, problem: 'p' },
    { kind: 'finding', file: 'tests/test_b.py', line: 1, problem: 'p' },
  ]
  const split = h.splitFailures(failures, two)
  assert.equal(split.code.length, 3)
  assert.deepEqual(split.tests.map(g => g.spec.id), ['S2'])
  assert.equal(split.tests[0].failures[0].file, 'tests/test_b.py')
})

test('splitFailures: a spec with no source files sends its failures to its tester', () => {
  const only = [spec({ filesOwned: [], changes: '', doneWhen: [] })]
  const split = h.splitFailures([{ kind: 'check', name: 'test', problem: 'p' }], only)
  assert.equal(split.code.length, 0)
  assert.equal(split.tests.length, 1)
})

test('specText hides the tests from the implementer and the changes from the tester', () => {
  const s = spec({ changes: 'CHANGES-TEXT', tests: 'TESTS-TEXT', doneWhen: ['DONE-TEXT'] })
  const impl = h.specText(s, contract, 'implementer')
  const tester = h.specText(s, contract, 'tester')
  assert.ok(impl.includes('CHANGES-TEXT') && !impl.includes('TESTS-TEXT'))
  assert.ok(tester.includes('TESTS-TEXT') && !tester.includes('CHANGES-TEXT') && !tester.includes('DONE-TEXT'))
})

test('runRecord shows the run from raw state', () => {
  const run = { id: 'r', title: 't', agents: 6, maxRepairRounds: 2 }
  const state = { specs: [spec()], tests: [{ spec: 'S1', selfCheck: 1, filesChanged: [] }], check: goodCheck, review: goodReview, specReviews: [], failures: [{ kind: 'criterion', id: 'C2' }], repairRounds: 0, reason: '' }
  const rec = h.runRecord(run, contract, state, { phase: 'Review', outcome: 'running', levels: 1, build: { S1: { impl: 'ok', test: 'ok' } }, repairs: [] })
  assert.equal(rec.specs[0].testNote, 'Self-check 1: nothing changed')
  assert.equal(rec.check.state, 'ok')
  assert.deepEqual(rec.criteria.map(c => c.status), ['met', 'not_met'])
  const early = h.runRecord(run, contract, { specs: [] }, { phase: 'Spec', outcome: 'running', levels: 0, build: {}, repairs: [] })
  assert.deepEqual(early.criteria.map(c => c.status), ['', ''])
})
