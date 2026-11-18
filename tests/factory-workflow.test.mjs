// Runs factory/workflow/factory.js whole, with agent, parallel, phase and log
// stubbed, for the parts of the loop that no single helper decides: when QC
// runs, what it is shown, and how its result stops or sends work back.
// Run: node --test tests/
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const file = fileURLToPath(new URL('../factory/workflow/factory.js', import.meta.url))
const source = readFileSync(file, 'utf8').replace(/^export const meta/m, 'const meta')
const AsyncFunction = (async () => {}).constructor

const contract = {
  objective: 'Add a --json flag',
  criteria: [{ id: 'C1', text: 'prints JSON with --json' }, { id: 'C2', text: 'keeps the text output without it' }],
  outOfScope: [],
  checks: [{ name: 'test', command: 'run-tests' }],
  run: 'python3 wordstats.py FILE',
}
const spec = {
  id: 'S1', title: 't', goal: 'g', kind: 'feature', skills: [], criteria: ['C1', 'C2'], dependsOn: [],
  filesOwned: ['wordstats.py'], testFiles: ['tests/test_wordstats.py'],
  context: '', interfaces: 'main(argv)', changes: 'SECRET-PLAN', tests: 'tt', outOfScope: '', doneWhen: ['x'],
}
const roles = Object.fromEntries(['planner', 'implementer', 'qa', 'checker', 'reviewer', 'specReviewer', 'qc'].map(r => [r, `/roles/${r}.md`]))
const skills = Object.fromEntries(['tdd', 'codebase-design', 'diagnosing-bugs', 'verification-before-completion', 'mp-code-review', 'testing-strategy', 'pr-security-review'].map(n => [n, `/s/${n}`]))
const args = { repo: '/repo', base: 'BASE', contract, roles, skills, specs: [spec] }

const pass = { status: 'done', blockedReason: '', startedWith: 'python3 wordstats.py', filesChanged: [], commandsRun: [], openIssues: [], criteria: [
  { id: 'C1', status: 'pass', scenario: 'ran it with --json', expected: 'JSON', observed: '{"words": 3}' },
  { id: 'C2', status: 'pass', scenario: 'ran it without', expected: 'text', observed: 'words: 3' },
] }
const failC1 = { ...pass, criteria: [{ ...pass.criteria[0], status: 'fail', observed: 'error: unrecognized arguments: --json' }, pass.criteria[1]] }
const green = { results: [{ name: 'test', command: 'run-tests', exitCode: 0, outputTail: 'ok' }], changedFiles: ['wordstats.py'] }
const red = { results: [{ name: 'test', command: 'run-tests', exitCode: 1, outputTail: 'FAILED tests/test_wordstats.py' }], changedFiles: ['wordstats.py'] }
const met = { criteria: [{ id: 'C1', status: 'met', evidence: 'e' }, { id: 'C2', status: 'met', evidence: 'e' }], findings: [], notReviewed: [] }

// checks and qcs: one reply per round (the last repeats).
async function run(over = {}, { checks = [green], qcs = [pass] } = {}) {
  const calls = []
  const nth = (list, round) => list[Math.min(round, list.length - 1)]
  const roundOf = label => Number((label.match(/round (\d+)/) || [0, 0])[1])
  const agent = async (prompt, opts) => {
    calls.push({ label: opts.label, phase: opts.phase, prompt })
    const l = opts.label
    if (l.startsWith('build')) return { status: 'done', blockedReason: '', filesChanged: ['wordstats.py', 'tests/test_wordstats.py'], tdd: [], doneWhen: [], checksRun: [], openIssues: [] }
    if (l.startsWith('rebuild')) return { status: 'done', blockedReason: '', filesChanged: ['wordstats.py'], fixes: [], checksRun: [], openIssues: [] }
    if (l.startsWith('qa')) return { status: 'done', blockedReason: '', filesChanged: [], ledger: [], gaps: [], failures: [], checksRun: [], openIssues: [] }
    if (l.startsWith('checker')) return nth(checks, roundOf(l))
    if (l.startsWith('reviewer')) return met
    if (l.startsWith('qc')) return nth(qcs, roundOf(l))
    throw new Error(`unexpected agent ${l}`)
  }
  const parallel = thunks => Promise.all(thunks.map(t => t().catch(() => null)))
  const out = await new AsyncFunction('args', 'agent', 'parallel', 'phase', 'log', source)({ ...args, ...over }, agent, parallel, () => {}, () => {})
  const labels = calls.map(c => c.label)
  return { out, labels, prompt: label => calls.find(c => c.label === label).prompt, call: label => calls.find(c => c.label === label) }
}

test('QC runs beside the reviewer once the checks pass, and a clean QC lets the run pass', async () => {
  const r = await run()
  assert.equal(r.out.outcome, 'passed')
  assert.deepEqual(r.labels, ['build S1', 'qa S1', 'checker', 'reviewer', 'qc'])
  assert.equal(r.call('qc').phase, 'Review', 'QC is part of the Review step')
  assert.equal(r.out.qc.length, 1)
  assert.match(r.out.reason, /QC saw it work/)
})

test('QC is shown the contract and how to run the product, not the spec, its files or the checks', async () => {
  const r = await run()
  const p = r.prompt('qc')
  assert.match(p, /Read your role brief first: \/roles\/qc\.md/)
  assert.match(p, /- C1: prints JSON with --json/)
  assert.match(p, /python3 wordstats\.py FILE/)
  for (const hidden of ['SECRET-PLAN', 'main(argv)', 'tests/test_wordstats.py', 'run-tests']) assert.ok(!p.includes(hidden), `QC must not see ${hidden}`)
})

test('a criterion QC sees fail goes back to Build, and QC checks again next round', async () => {
  const r = await run({}, { qcs: [failC1, pass] })
  assert.equal(r.out.outcome, 'passed')
  assert.deepEqual(r.labels, ['build S1', 'qa S1', 'checker', 'reviewer', 'qc', 'rebuild 1 S1', 'qa 1 S1', 'checker (round 1)', 'reviewer (round 1)', 'qc (round 1)'])
  assert.match(r.prompt('rebuild 1 S1'), /unrecognized arguments: --json/)
  assert.deepEqual(r.out.failureLog.map(e => [e.kind, e.criterion, e.specs]), [['qc', 'C1', ['S1']]])
})

test('QC waits while a check fails, since the change goes back to Build anyway', async () => {
  const r = await run({}, { checks: [red, green] })
  assert.equal(r.out.outcome, 'passed')
  assert.ok(!r.labels.slice(0, 4).some(l => l.startsWith('qc')), 'no QC in the failing round')
  assert.deepEqual(r.labels.filter(l => l.startsWith('qc ')), ['qc (round 1)'])
})

test('QC that keeps failing fails the run at the rebuild cap', async () => {
  const r = await run({ maxRebuilds: 1 }, { qcs: [failC1] })
  assert.equal(r.out.outcome, 'failed')
  assert.equal(r.out.failures[0].kind, 'qc')
})

test('QC that cannot run the product, or leaves files behind, stops the run as blocked', async () => {
  const blocked = await run({}, { qcs: [{ ...pass, status: 'blocked', blockedReason: 'needs STRIPE_KEY' }] })
  assert.equal(blocked.out.outcome, 'blocked')
  assert.match(blocked.out.reason, /QC could not run the product: needs STRIPE_KEY/)
  const dirty = await run({}, { qcs: [{ ...pass, filesChanged: ['/repo/data.db'] }] })
  assert.equal(dirty.out.outcome, 'blocked')
  assert.match(dirty.out.reason, /QC changed files in the repository.*data\.db/)
  const silent = await run({}, { qcs: [null] })
  assert.match(silent.out.reason, /QC agent did not return a result/)
})

test('qc: false runs no QC and needs no QC brief', async () => {
  const r = await run({ qc: false, roles: { ...roles, qc: undefined } })
  assert.equal(r.out.outcome, 'passed')
  assert.ok(!r.labels.includes('qc'))
  assert.match(r.out.reason, /QC was turned off/)
  const missing = await run({ roles: { ...roles, qc: undefined } })
  assert.match(missing.out.reason, /Missing workflow args: roles\.qc/)
})
