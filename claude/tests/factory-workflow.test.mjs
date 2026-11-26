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
  { id: 'C1', status: 'pass', scenario: 'ran it with --json', expected: 'JSON', observed: '{"words": 3}', steps: ['python3 wordstats.py --json file.txt'] },
  { id: 'C2', status: 'pass', scenario: 'ran it without', expected: 'text', observed: 'words: 3', steps: ['python3 wordstats.py file.txt'] },
] }
const failC1 = { ...pass, criteria: [{ ...pass.criteria[0], status: 'fail', observed: 'error: unrecognized arguments: --json' }, pass.criteria[1]] }
const green = { results: [{ name: 'test', command: 'run-tests', exitCode: 0, outputTail: 'ok' }], changedFiles: ['wordstats.py'] }
const red = { results: [{ name: 'test', command: 'run-tests', exitCode: 1, outputTail: 'FAILED tests/test_wordstats.py' }], changedFiles: ['wordstats.py'] }
const met = { criteria: [{ id: 'C1', status: 'met', evidence: 'e' }, { id: 'C2', status: 'met', evidence: 'e' }], findings: [], standards: [], notReviewed: [] }

// checks and qcs: one reply per round (the last repeats).
async function run(over = {}, { checks = [green], verifyChecks = null, qcs = [pass], plans = [{ overview: 'o', specs: [spec], risks: [], questions: [] }], reviews = [met], ba = null } = {}) {
  const calls = []
  const nth = (list, round) => list[Math.min(round, list.length - 1)]
  const roundOf = label => Number((label.match(/round (\d+)/) || [0, 0])[1])
  const agent = async (prompt, opts) => {
    calls.push({ label: opts.label, phase: opts.phase, prompt, opts })
    const l = opts.label
    if (l === 'ba') return ba
    if (l.startsWith('planner')) return nth(plans, l.includes('revision') ? 1 : 0)
    if (l.startsWith('build')) return { status: 'done', blockedReason: '', filesChanged: l === 'build S2' ? ['report.py', 'tests/test_report.py'] : l === 'build S1' && /src\/auth/.test(prompt) ? ['src/auth/login.py'] : ['wordstats.py', 'tests/test_wordstats.py'], tdd: [], doneWhen: [], checksRun: [], openIssues: [] }
    if (l.startsWith('rebuild')) return { status: 'done', blockedReason: '', filesChanged: ['wordstats.py'], fixes: [], checksRun: [], openIssues: [] }
    if (l.startsWith('qa')) return { status: 'done', blockedReason: '', filesChanged: [], ledger: [], gaps: [], failures: [], checksRun: [], openIssues: [] }
    if (l.startsWith('checker (verify files')) return verifyChecks ? nth(verifyChecks, roundOf(l)) : nth(checks, roundOf(l))
    if (l.startsWith('checker')) return nth(checks, roundOf(l))
    if (l.startsWith('reviewer') || l.startsWith('review ')) return nth(reviews, roundOf(l))
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

test('the gate: a failing check goes back to Build with no reviewer or QC on it', async () => {
  const r = await run({}, { checks: [red, green] })
  assert.equal(r.out.outcome, 'passed')
  assert.deepEqual(r.labels, ['build S1', 'qa S1', 'checker', 'rebuild 1 S1', 'qa 1 S1', 'checker (round 1)', 'reviewer (round 1)', 'qc (round 1)'])
  assert.match(r.prompt('rebuild 1 S1'), /exited with 1/)
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

const asking = { overview: 'o', specs: [spec], risks: [], questions: [{ question: 'Should --json also cover errors?', why: 'changes the error output', criteria: ['C1'] }] }

test('a planner with open questions stops the run before anything is built', async () => {
  const r = await run({ specs: undefined }, { plans: [asking] })
  assert.equal(r.out.outcome, 'blocked')
  assert.deepEqual(r.labels, ['planner'])
  assert.equal(r.out.questions.length, 1)
  assert.match(r.out.reason, /1 open question/)
  assert.match(r.out.reason, /Q1: Should --json also cover errors\? \(C1\)/)
})

test('a planner without questions goes on to build as before', async () => {
  const r = await run({ specs: undefined })
  assert.equal(r.out.outcome, 'passed')
  assert.deepEqual(r.labels, ['planner', 'build S1', 'qa S1', 'checker', 'reviewer', 'qc'])
  assert.deepEqual(r.out.questions, [])
})

test('questionsOnly runs the planner alone and returns ready when it has no questions', async () => {
  const roles = { planner: '/roles/planner.md' }
  const r = await run({ specs: undefined, questionsOnly: true, roles, skills: undefined })
  assert.equal(r.out.outcome, 'ready')
  assert.deepEqual(r.labels, ['planner'])
  assert.match(r.prompt('planner'), /readiness check, not a build/)
})

test('questionsOnly returns the questions as blocked', async () => {
  const r = await run({ specs: undefined, questionsOnly: true, roles: { planner: '/roles/planner.md' } }, { plans: [asking] })
  assert.equal(r.out.outcome, 'blocked')
  assert.equal(r.out.questions[0].question, 'Should --json also cover errors?')
})

test('questionsOnly refuses supplied specs, which would skip the planner it exists to run', async () => {
  const r = await run({ questionsOnly: true })
  assert.equal(r.out.outcome, 'blocked')
  assert.deepEqual(r.labels, [])
  assert.match(r.out.reason, /cannot be given "specs"/)
})

const spec2 = { ...spec, id: 'S2', criteria: ['C2'], filesOwned: ['report.py'], testFiles: ['tests/test_report.py'] }
const s1only = { ...spec, criteria: ['C1'] }
const greenTwo = { ...green, changedFiles: ['wordstats.py', 'report.py'] }

test('a low-risk change gets one reviewer on Sonnet, even when split', async () => {
  const r = await run({ specs: undefined }, { plans: [{ overview: 'o', specs: [s1only, spec2], risks: [], risk: 'low', surfaces: [], questions: [] }], checks: [greenTwo] })
  assert.equal(r.out.outcome, 'passed', r.out.reason)
  assert.ok(!r.labels.some(l => l.startsWith('review ')), 'no spec reviewers at low risk')
  assert.equal(r.call('reviewer').opts.model, 'sonnet')
  assert.equal(r.out.risk.risk, 'low')
})

test('a medium-risk split change keeps the spec reviewers and the Opus reviewer', async () => {
  const r = await run({ specs: undefined }, { plans: [{ overview: 'o', specs: [s1only, spec2], risks: [], risk: 'medium', surfaces: [], questions: [] }], checks: [greenTwo] })
  assert.deepEqual(r.labels.filter(l => l.startsWith('review ')), ['review S1', 'review S2'])
  assert.equal(r.call('reviewer').opts.model, 'opus')
})

test('owning auth files raises a low rating to high: stronger reviewers, a security review, and a person before merge', async () => {
  const auth = { ...spec, filesOwned: ['src/auth/login.py'] }
  const r = await run({ specs: [auth], risk: 'low' }, { checks: [{ ...green, changedFiles: ['src/auth/login.py'] }] })
  assert.equal(r.out.risk && r.out.risk.risk, 'high', r.out.reason)
  assert.deepEqual(r.out.risk.surfaces, ['security'])
  assert.deepEqual([r.call('reviewer').opts.model, r.call('reviewer').opts.effort], ['opus', 'xhigh'])
  assert.match(r.prompt('reviewer'), /pr-security-review/)
  assert.equal(r.out.merge.decision, 'person')
  assert.match(r.out.reason, /A person must accept it/)
})

test('the models the caller passes still override the routing', async () => {
  const r = await run({ risk: 'low', models: { reviewer: { model: 'haiku' } } })
  assert.equal(r.call('reviewer').opts.model, 'haiku')
})

test('a plain passing change may be merged without a person', async () => {
  const r = await run()
  assert.equal(r.out.merge.decision, 'auto')
  assert.match(r.out.reason, /may be merged without a person/)
})

test('a dependency change passes but waits for a person', async () => {
  const deps = { ...spec, filesOwned: ['wordstats.py', 'package.json'] }
  const r = await run({ specs: [deps] }, { checks: [{ ...green, changedFiles: ['wordstats.py', 'package.json'] }] })
  assert.equal(r.out.outcome, 'passed')
  assert.deepEqual(r.out.merge.reasons, ['dependency: package.json'])
})

test('a spec may not own a protected file unless the caller allows it', async () => {
  const ci = { ...spec, filesOwned: ['wordstats.py', '.github/workflows/ci.yml'] }
  const r = await run({ specs: [ci] })
  assert.equal(r.out.outcome, 'blocked')
  assert.deepEqual(r.labels, [])
  assert.match(r.out.reason, /owns \.github\/workflows\/ci\.yml, which is protected/)
  const allowed = await run({ specs: [ci], allowProtected: ['.github/workflows/ci.yml'] })
  assert.equal(allowed.out.outcome, 'passed', allowed.out.reason)
})

test('a protected file changed outside every spec stops the run, even when ignored as output', async () => {
  const r = await run({ ignoreFiles: ['tsconfig.json'] }, { checks: [{ ...green, changedFiles: ['wordstats.py', 'tsconfig.json'] }] })
  assert.equal(r.out.outcome, 'blocked')
  assert.match(r.out.reason, /Protected files were changed: tsconfig\.json/)
})

test('.factory workspace artifacts never block, explicit allowProtected allows protected files, and FACTORY_ALLOW_PROTECTED env does not bypass', async () => {
  const artifacts = await run({}, {
    checks: [{
      ...green,
      changedFiles: [
        'wordstats.py',
        'tests/test_wordstats.py',
        '.factory/decisions.md',
        '.factory/plans/2026-11-25-landing-demo-ba.json',
        '.factory/product.md',
      ],
    }],
  })
  assert.equal(artifacts.out.outcome, 'passed', artifacts.out.reason)

  const ci = { ...spec, filesOwned: ['wordstats.py', '.github/workflows/ci.yml'] }
  const allowedTrue = await run(
    { specs: [ci], allowProtected: true },
    { checks: [{ ...green, changedFiles: ['wordstats.py', '.github/workflows/ci.yml'] }] },
  )
  assert.equal(allowedTrue.out.outcome, 'passed', allowedTrue.out.reason)

  const prevEnv = process.env.FACTORY_ALLOW_PROTECTED
  process.env.FACTORY_ALLOW_PROTECTED = '1'
  try {
    const blockedEnv = await run(
      { specs: [ci] },
      { checks: [{ ...green, changedFiles: ['wordstats.py', '.github/workflows/ci.yml'] }] },
    )
    assert.equal(blockedEnv.out.outcome, 'blocked')
    assert.match(blockedEnv.out.reason, /\.github\/workflows\/ci\.yml/)
  } finally {
    if (prevEnv === undefined) delete process.env.FACTORY_ALLOW_PROTECTED
    else process.env.FACTORY_ALLOW_PROTECTED = prevEnv
  }
})

test('the project profile reaches the agents: stack skills, its instructions, and not QC', async () => {
  const skillsMore = { ...skills, vitest: '/s/vitest', 'playwright-best-practices': '/s/pw' }
  const r = await run({ skills: skillsMore, projectSkills: { implementer: ['vitest'], qc: ['playwright-best-practices'] }, projectDocs: { agents: 'CLAUDE.md', decisions: 'DECISIONS.md' } })
  assert.equal(r.out.outcome, 'passed')
  assert.match(r.prompt('build S1'), /vitest: \/s\/vitest/)
  assert.match(r.prompt('build S1'), /read CLAUDE\.md before anything else/)
  assert.match(r.prompt('qc'), /playwright-best-practices: \/s\/pw/)
  assert.ok(!r.prompt('qc').includes('CLAUDE.md'))
})

test('a stack skill the run was not given stops it before any agent', async () => {
  const r = await run({ projectSkills: { implementer: ['nextjs-conventions'] } })
  assert.equal(r.out.outcome, 'blocked')
  assert.deepEqual(r.labels, [])
  assert.match(r.out.reason, /stack skills are not installed[^.]*nextjs-conventions/)
})

test('the design reaches the implementer and QC, and a screen unlike its mockup goes back to Build', async () => {
  const design = { doc: 'DESIGN.md', tokens: 't.css', screens: [{ screen: 'Stats', criteria: ['C1'], mockup: 'docs/mockups/stats.png', states: ['empty'] }] }
  const differs = { ...pass, screens: [{ screen: 'Stats', screenshot: '/tmp/s.png', status: 'differs', differences: ['totals are above the list, mockup has them below'] }] }
  const match = { ...pass, screens: [{ screen: 'Stats', screenshot: '/tmp/s.png', status: 'match', differences: [] }] }
  const r = await run({ contract: { ...contract, design }, browser: 'playwright' }, { qcs: [differs, match] })
  assert.match(r.prompt('build S1'), /Screen "Stats" for C1: mockup docs\/mockups\/stats\.png/)
  assert.match(r.prompt('qc'), /Screens to compare/)
  assert.equal(r.out.outcome, 'passed')
  assert.ok(r.labels.includes('rebuild 1 S1'))
  assert.match(r.prompt('rebuild 1 S1'), /totals are above the list/)
})

test('a mockup given as a link stops the run: agents cannot open it', async () => {
  const design = { doc: 'DESIGN.md', screens: [{ screen: 'Stats', criteria: ['C1'], mockup: 'https://claude.ai/design/abc' }] }
  const r = await run({ contract: { ...contract, design }, browser: 'playwright' })
  assert.equal(r.out.outcome, 'blocked')
  assert.match(r.out.reason, /mockup is a link/)
})

test('QC uses browser MCP tools and writes no script; screens or UI surface without browser block', async () => {
  const design = { doc: 'DESIGN.md', screens: [{ screen: 'Orders', criteria: ['C1'], mockup: 'docs/mockups/orders.png', states: [] }] }
  const match = { ...pass, screens: [{ screen: 'Orders', screenshot: '/tmp/o.png', status: 'match', differences: [] }] }
  const ok = await run({ contract: { ...contract, design }, browser: 'playwright' }, { qcs: [match] })
  assert.equal(ok.out.outcome, 'passed')
  assert.match(ok.prompt('qc'), /mcp__playwright__browser_navigate/)
  assert.match(ok.prompt('qc'), /Write no browser script/)

  const noBrowser = await run({ contract: { ...contract, design } })
  assert.equal(noBrowser.out.outcome, 'blocked')
  assert.deepEqual(noBrowser.labels, [])
  assert.match(noBrowser.out.reason, /browser MCP server/)

  const uiPlan = await run({ specs: undefined }, { plans: [{ overview: 'o', specs: [spec], risks: [], risk: 'low', surfaces: ['ui'], questions: [] }] })
  assert.equal(uiPlan.out.outcome, 'blocked')
  assert.deepEqual(uiPlan.labels, ['planner'])
  assert.match(uiPlan.out.reason, /browser MCP server/)
})

test('coding standards reach agents and a broken blocking rule sends the spec back', async () => {
  const stdContract = {
    ...contract,
    checks: [...contract.checks, { name: 'lint', command: 'npm run lint' }],
    standards: {
      file: 'CODING_STANDARDS.md',
      rules: [
        { id: 'S1', text: 'Lint passes cleanly.', severity: 'blocking', enforced: 'tool', check: 'lint' },
        { id: 'S2', text: 'Errors are never swallowed.', severity: 'blocking', enforced: 'review' },
        { id: 'S3', text: 'Names stay clear.', severity: 'minor', enforced: 'review' },
      ],
    },
  }
  const greenWithLint = { results: [{ name: 'test', command: 'run-tests', exitCode: 0, outputTail: 'ok' }, { name: 'lint', command: 'npm run lint', exitCode: 0, outputTail: 'ok' }], changedFiles: ['wordstats.py'] }
  const failStd = { ...met, standards: [{ id: 'S2', status: 'fail', file: 'wordstats.py', line: 12, evidence: 'empty catch' }, { id: 'S3', status: 'pass', file: '', line: 0, evidence: 'ok' }] }
  const passStd = { ...met, standards: [{ id: 'S2', status: 'pass', file: '', line: 0, evidence: 'ok' }, { id: 'S3', status: 'pass', file: '', line: 0, evidence: 'ok' }] }
  const r = await run({ contract: stdContract }, { checks: [greenWithLint], reviews: [failStd, passStd] })
  assert.equal(r.out.outcome, 'passed')
  assert.match(r.prompt('build S1'), /Errors are never swallowed/)
  assert.match(r.prompt('reviewer'), /Errors are never swallowed/)
  assert.ok(r.labels.includes('rebuild 1 S1'))
  assert.deepEqual(r.out.standards.map(x => [x.id, x.status]), [['S1', 'pass'], ['S2', 'pass'], ['S3', 'pass']])

  const missingCheck = await run({ contract: { ...contract, standards: { file: 'CODING_STANDARDS.md', rules: [{ id: 'S1', text: 'Lint clean', severity: 'blocking', enforced: 'tool', check: 'lint' }] } } })
  assert.equal(missingCheck.out.outcome, 'blocked')
  assert.deepEqual(missingCheck.labels, [])
  assert.match(missingCheck.out.reason, /check "lint" is not one of the contract's checks/)
})

test('workflow never runs BA inside the build loop and blocks without a contract objective', async () => {
  const r = await run({ idea: 'Add JSON output to wordstats', autoBa: true, contract: { criteria: [{ id: 'C1', text: 'prints JSON' }], checks: [{ name: 'test', command: 'run-tests' }] } })
  assert.equal(r.out.outcome, 'blocked')
  assert.deepEqual(r.labels, [])
  assert.match(r.out.reason, /contract\.objective/)
})

test('a flaky check does not send the change back, and is reported', async () => {
  const flaky = { results: [{ name: 'test', command: 'run-tests', exitCode: 1, rerunExitCode: 0, outputTail: 'timeout' }], changedFiles: ['wordstats.py'] }
  const r = await run({}, { checks: [flaky] })
  assert.equal(r.out.outcome, 'passed')
  assert.ok(!r.labels.some(l => l.startsWith('rebuild')))
  assert.match(r.out.reason, /Flaky, fix the test: test/)
  assert.match(r.prompt('checker'), /run it once more exactly as written/)
})

test('tests that pass on the base code send the spec back before any review', async () => {
  const passOnBase = { ...green, baseRuns: [{ spec: 'S1', files: ['tests/test_wordstats.py'], command: 'pytest tests/test_wordstats.py', exitCode: 0, outputTail: '2 passed' }] }
  const failOnBase = { ...green, baseRuns: [{ spec: 'S1', files: ['tests/test_wordstats.py'], command: 'pytest tests/test_wordstats.py', exitCode: 1, outputTail: 'AttributeError' }] }
  const r = await run({ contract: { ...contract, testFileCommand: 'pytest {files}' } }, { checks: [passOnBase, failOnBase] })
  assert.equal(r.out.outcome, 'passed')
  assert.deepEqual(r.labels.slice(0, 6), ['build S1', 'qa S1', 'checker', 'rebuild 1 S1', 'qa 1 S1', 'checker (round 1)'])
  assert.match(r.prompt('checker'), /git worktree add --detach <dir> BASE[\s\S]*Command: pytest \{files\}[\s\S]*- S1: tests\/test_wordstats\.py/)
  assert.match(r.prompt('rebuild 1 S1'), /pass on the base code/)
})

test('without a test-file command there is no base run, and nothing is held against the spec', async () => {
  const r = await run()
  assert.ok(!r.prompt('checker').includes('git worktree add'))
  assert.equal(r.out.outcome, 'passed')
})

test('a hallucinated unowned filename from checker is re-verified against git before blocking', async () => {
  const hallucinated = {
    ...green,
    changedFiles: ['wordstats.py', 'tests/test_wordstats.py', 'test/account-customer-store.test.js'],
  }
  const verifiedClean = { changedFiles: ['wordstats.py', 'tests/test_wordstats.py'] }
  const recovered = await run({}, { checks: [hallucinated], verifyChecks: [verifiedClean] })
  assert.equal(recovered.out.outcome, 'passed', recovered.out.reason)
  assert.ok(recovered.labels.includes('checker (verify files)'))
  assert.match(recovered.prompt('checker (verify files)'), /test\/account-customer-store\.test\.js/)
  assert.deepEqual(recovered.out.check.changedFiles, ['wordstats.py', 'tests/test_wordstats.py'])

  const verifiedReal = { changedFiles: ['wordstats.py', 'extra.py'] }
  const blocked = await run({}, { checks: [{ ...green, changedFiles: ['wordstats.py', 'extra.py'] }], verifyChecks: [verifiedReal] })
  assert.equal(blocked.out.outcome, 'blocked')
  assert.match(blocked.out.reason, /Files were changed that no spec owns: extra\.py/)

  const clean = await run()
  assert.ok(!clean.labels.includes('checker (verify files)'), 'happy path runs no verification call')
})
