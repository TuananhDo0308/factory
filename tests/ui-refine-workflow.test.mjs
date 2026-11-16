// Runs ui-refine-loop/workflow/ui-refine-loop.js whole, with agent, phase and
// log stubbed: its stop rules, the routing of problem types to commands, what
// each agent is shown, the score and the finish review. The script is a
// workflow body (top-level await and return), so this is also its syntax check.
// Run: node --test
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const file = fileURLToPath(new URL('../ui-refine-loop/workflow/ui-refine-loop.js', import.meta.url))
const source = readFileSync(file, 'utf8').replace(/^export const meta/m, 'const meta')
const AsyncFunction = (async () => {}).constructor

// checks: the checker's reply per check (index 0 is check 1; the last repeats).
// fixer, design, detect: (n) => reply.
async function run(args, checks, fixer, { design, detect, finish } = {}) {
  const calls = []
  const agent = async (prompt, opts) => {
    calls.push({ label: opts.label, prompt })
    if (opts.label === 'finish') return finish ?? { grades: [{ id: 'x', grade: 'fixed', evidence: 'e' }], regressions: [], disposition: 'ready for review' }
    const n = Number(opts.label.match(/r(\d+)$/)[1])
    if (opts.label.startsWith('design')) return design ? design(n) : { dims: {}, designTotal: 10 + n, problems: [] }
    if (opts.label.startsWith('detector')) return detect ? detect(n) : { dims: {}, auditTotal: 10, detectorCount: 3, detectorRan: true, problems: [] }
    if (opts.label.startsWith('check')) return checks[n - 1] === undefined ? checks[checks.length - 1] : checks[n - 1]
    return fixer(n)
  }
  const out = await new AsyncFunction('args', 'agent', 'phase', 'log', source)(args, agent, () => {}, () => {})
  const labels = calls.map(c => c.label)
  const prompt = label => calls.find(c => c.label === label).prompt
  return { out, calls, labels, prompt, starting: s => labels.filter(l => l.startsWith(s)) }
}

const IMP = { layout: 'node', skillDir: '/imp', reference: '/imp/reference', detect: 'node /imp/scripts/detect.mjs --json', context: 'node /imp/scripts/context.mjs', version: '4.0.4' }
const base = {
  slug: 'reports', target: '/reports', scope: ['src/reports/'], prompt: 'calmer', worktree: '/wt', runDir: '/wt.run',
  skillDir: '/skill', checks: ['npm run typecheck'], shootCmd: 'node shoot.mjs --base http://localhost:1 --route /reports',
  baseUrl: 'http://localhost:1', route: '/reports',
  beforeShots: ['/wt.run/shots/round-0-main-desktop-light.png', '/wt.run/shots/round-0-main-desktop-dark.png', '/wt.run/shots/round-0-main-desktop-light-s1.png'],
  impeccable: IMP,
}
const p = (severity, type = 'polish', id = `${type}-${severity}`) => ({ id, severity, type, title: id, location: 'a.tsx:1', evidence: 'e', fix: 'f' })
const check = (problems = [], extra = {}) => ({ problems, vsBefore: 'better', summary: 's', ...extra })
const committed = (fixed = []) => n => ({
  status: 'committed', commit: `c${n}`, commands: ['layout', 'polish'], fixed, skipped: [], outOfScope: [], checks: 'green',
  afterShots: [`/wt.run/shots/round-${n}-main-desktop-light.png`, `/wt.run/shots/round-${n}-main-desktop-light-s1.png`, `/wt.run/shots/cmp-round-${n}-main-desktop-light.png`],
})
const reverted = () => ({ status: 'reverted', commit: '', commands: [], fixed: [], skipped: [], outOfScope: [], checks: 'tsc red', afterShots: [] })
// The JSON array that follows `marker` in a prompt.
const listAfter = (text, marker) => JSON.parse(text.slice(text.indexOf('[', text.indexOf(marker))))

test('five fix rounds by default, then a closing check scores the final state', async () => {
  const r = await run(base, [check([p('P1', 'cluttered')])], committed())
  assert.equal(r.out.stopReason, 'ran all 5 rounds')
  assert.equal(r.starting('fixer').length, 5)
  assert.equal(r.starting('check ').length, 6)
  assert.deepEqual(r.labels.slice(0, 4), ['design r1', 'detector r1', 'check r1', 'fixer r1'])
  assert.equal(r.out.finalLabel, 'round-5')
})

test('two consecutive checks without a P0 or P1 stop the loop', async () => {
  const r = await run(base, [check([p('P1', 'too-loud')]), check([p('P2', 'typography')]), check([p('P3')])], committed())
  assert.equal(r.out.stopReason, 'two consecutive checks found no P0/P1')
  assert.deepEqual(r.starting('fixer'), ['fixer r1', 'fixer r2'])
  assert.equal(r.starting('check ').length, 3)
})

test('a P1 resets the clean streak', async () => {
  const r = await run({ ...base, rounds: 3 }, [check([p('P2')]), check([p('P1')]), check([p('P2')]), check([p('P1')])], committed())
  assert.equal(r.out.stopReason, 'ran all 3 rounds')
})

test('a check with no problems starts no fixer, and no fixes means no finish review', async () => {
  const r = await run(base, [check([])], committed())
  assert.equal(r.starting('fixer').length, 0)
  assert.equal(r.out.stopReason, 'two consecutive checks found no P0/P1')
  assert.equal(r.out.disposition, 'no fixes landed')
  assert.equal(r.labels.includes('finish'), false)
})

test('two reverted rounds in a row stop the loop; a commit in between resets the count', async () => {
  const r = await run(base, [check([p('P0', 'responsive')])], n => (n === 2 ? committed()(n) : reverted()))
  assert.equal(r.out.stopReason, 'two fix rounds in a row went red and were reverted')
  assert.equal(r.labels.at(-1), 'fixer r4')
})

test('an agent that died stops the loop and is named', async () => {
  const one = [check([p('P1')])]
  assert.equal((await run(base, one, committed(), { design: () => null })).out.stopReason, 'design reviewer r1 died')
  assert.equal((await run(base, one, committed(), { detect: () => null })).out.stopReason, 'detector r1 died')
  assert.equal((await run(base, [null], committed())).out.stopReason, 'checker r1 died')
  assert.equal((await run(base, one, () => null)).out.stopReason, 'fixer r1 died')
})

test('every problem type is routed to its command, as references/routing.md lists them', async () => {
  const table = readFileSync(fileURLToPath(new URL('../ui-refine-loop/references/routing.md', import.meta.url)), 'utf8')
  const routes = Object.fromEntries([...table.matchAll(/^\| `([a-z-]+)` \|.*\| `([a-z]+)` \|$/gm)].map(m => [m[1], m[2]]))
  assert.equal(Object.keys(routes).length, 16)
  const r = await run({ ...base, rounds: 1 }, [check(Object.keys(routes).map(t => p('P2', t))), check([])], committed())
  const routed = listAfter(r.prompt('fixer r1'), 'Problems from check')
  assert.equal(routed.length, 8, 'a check hands the fixer at most 8 problems')
  const all = []
  for (const types of [Object.keys(routes).slice(0, 8), Object.keys(routes).slice(8)]) {
    const run2 = await run({ ...base, rounds: 1 }, [check(types.map(t => p('P2', t))), check([])], committed())
    all.push(...listAfter(run2.prompt('fixer r1'), 'Problems from check'))
  }
  assert.deepEqual(Object.fromEntries(all.map(q => [q.type, q.route])), routes)
})

test('the suggested chain is ordered by severity, without repeats, polish last', async () => {
  const problems = [p('P3', 'polish'), p('P2', 'typography'), p('P0', 'cluttered'), p('P1', 'spacing-hierarchy'), p('P2', 'cluttered', 'dup')]
  const r = await run({ ...base, rounds: 1 }, [check(problems), check([])], committed())
  assert.match(r.prompt('fixer r1'), /polish always last\): distill → layout → typeset → polish\n/)
  assert.ok(r.prompt('fixer r1').includes('/skill/references/routing.md'))
})

test('the detector is shown no screenshots and the design reviewer no detector output', async () => {
  const r = await run({ ...base, rounds: 1 }, [check([p('P1')]), check([])], committed())
  assert.doesNotMatch(r.prompt('detector r1'), /\.png/)
  assert.doesNotMatch(r.prompt('design r1'), /auditTotal|detectorCount/)
  assert.ok(r.prompt('detector r1').includes('node /imp/scripts/detect.mjs --json'))
  assert.ok(r.prompt('check r1').includes('"auditTotal": 10'))
  assert.ok(r.prompt('check r1').includes('"designTotal": 11'))
})

test('check 1 sees round-0 only; later checks see round-0, the current shots, crops and sheets', async () => {
  const r = await run({ ...base, rounds: 1 }, [check([p('P1')]), check([])], committed())
  const first = r.prompt('design r1')
  assert.ok(first.includes('current = round-0'))
  assert.ok(first.includes('round-0-main-desktop-dark.png'))
  assert.ok(first.includes('Round-0 section crops: /wt.run/shots/round-0-main-desktop-light-s1.png'))
  const second = r.prompt('design r2')
  assert.ok(second.includes('Round-0 (before) shots: /wt.run/shots/round-0-main-desktop-light.png'))
  assert.ok(second.includes('Current shots (light and dark, desktop 1440 and mobile 390): /wt.run/shots/round-1-main-desktop-light.png'))
  assert.ok(second.includes('Current section crops: /wt.run/shots/round-1-main-desktop-light-s1.png'))
  assert.ok(second.includes('Before | after sheets (read these first): /wt.run/shots/cmp-round-1-main-desktop-light.png'))
  assert.ok(r.prompt('fixer r1').includes('--label round-1 --compare round-0'))
})

test('the score is design /20 plus audit /20, and the first check is the baseline', async () => {
  const r = await run({ ...base, rounds: 2 }, [check([p('P1')]), check([p('P1')], { vsBefore: 'worse' }), check([p('P1')])], committed())
  assert.equal(r.out.scoreLine, 'C1 21/40 → C2 22/40 (worse) → C3 23/40 (better)')
  assert.deepEqual([r.out.before, r.out.after], [21, 23])
  assert.equal(r.out.rounds[0].vsBefore, 'baseline')
  assert.match(r.out.ledger[0], /^C1 · visual 21\/40 \(design 11\/20 · audit 10\/20 · detector 3\) · baseline · P0×0 P1×1 P2×0 P3×0 · committed c1 \[layout → polish\]/)
})

test('the finish reviewer grades every claimed fix once, the latest round winning', async () => {
  const finish = { grades: [{ id: 'a', grade: 'partial', evidence: 'e' }, { id: 'b', grade: 'fixed', evidence: 'e' }], regressions: ['dark footer'], disposition: 'a stays open' }
  const r = await run({ ...base, rounds: 2 }, [check([p('P1', 'cluttered', 'a'), p('P2', 'typography', 'b')]), check([p('P1', 'cluttered', 'a')]), check([])], committed(['a', 'b']), { finish })
  assert.equal(r.labels.at(-1), 'finish')
  assert.deepEqual(listAfter(r.prompt('finish'), 'Claimed fixes').map(c => [c.id, c.round]), [['b', 1], ['a', 2]])
  assert.ok(r.prompt('finish').includes('/skill/references/finish-reviewer-brief.md'))
  assert.deepEqual(r.out.grades.map(g => g.grade), ['partial', 'fixed'])
  assert.deepEqual(r.out.regressions, ['dark footer'])
})

test('a reverted round claims nothing and keeps the earlier shots', async () => {
  const r = await run({ ...base, rounds: 2 }, [check([p('P1', 'cluttered', 'a')])], n => (n === 1 ? committed(['a'])(n) : reverted()))
  assert.equal(r.out.finalLabel, 'round-1')
  assert.deepEqual(listAfter(r.prompt('finish'), 'Claimed fixes').map(c => c.id), ['a'])
})

test('the fixer is given the commit subject with the slug and the checks to keep green', async () => {
  const r = await run({ ...base, rounds: 1 }, [check([p('P1')]), check([])], committed())
  assert.ok(r.prompt('fixer r1').includes('Commit message: "[ui] reports: round 1'))
  assert.ok(r.prompt('fixer r1').includes('Checks that must stay green: npm run typecheck.'))
})

test('without Impeccable the loop uses the rubric and says the result is degraded', async () => {
  const { impeccable, ...noImp } = base
  let r = await run({ ...noImp, rounds: 1, warnings: ['Impeccable NOT FOUND'] }, [check([p('P1')]), check([])], committed())
  assert.ok(r.calls[0].prompt.includes('/skill/references/rubric.md'))
  assert.ok(r.calls[0].prompt.includes('/skill/references/taste.md'))
  assert.equal(r.out.method, 'rubric')
  assert.ok(r.out.degraded)
  assert.deepEqual(r.out.warnings, ['Impeccable NOT FOUND'])
  r = await run({ ...base, rounds: 1 }, [check([])], committed())
  assert.equal(r.out.degraded, null)
  assert.ok(r.calls[0].prompt.includes('impeccable v4.0.4 (node layout)'))
  await assert.rejects(run({ ...base, critic: 'impeccable', impeccable: '/imp/scripts/impeccable' }, [], committed()), /needs args.impeccable/)
})

test('a missing arg is refused by name, and args given as a JSON string are accepted', async () => {
  await assert.rejects(run({ ...base, shootCmd: undefined }, [], committed()), /args\.shootCmd/)
  const r = await run(JSON.stringify({ ...base, rounds: 1 }), [check([])], committed())
  assert.equal(r.out.stopReason, 'two consecutive checks found no P0/P1')
})

test('every brief the script points an agent at exists in the skill', () => {
  for (const name of ['checker-brief.md', 'fixer-brief.md', 'routing.md', 'finish-reviewer-brief.md', 'rubric.md', 'taste.md']) {
    assert.ok(source.includes(name), `${name} is named in the script`)
    assert.ok(readFileSync(fileURLToPath(new URL(`../ui-refine-loop/references/${name}`, import.meta.url)), 'utf8').length > 0)
  }
})
