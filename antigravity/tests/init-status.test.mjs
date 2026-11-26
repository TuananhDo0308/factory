// Tests for factory/scripts/init-status.mjs. Run: node --test tests/
import test from 'node:test'
import assert from 'node:assert/strict'
import { fingerprint, initStatus, summary, STEPS } from '../factory/scripts/init-status.mjs'

const index = [
  '100644 aaa 0\tpackage.json',
  '100644 bbb 0\tpnpm-lock.yaml',
  '100644 ccc 0\tsrc/components/Button.tsx',
  '100644 ddd 0\tsrc/components/Button.test.tsx',
  '100644 eee 0\tREADME.md',
  '100644 fff 0\tsrc/app.css',
]

test('a fingerprint changes only when the files of its step change', () => {
  const before = fingerprint(index, 'catalog')
  assert.equal(fingerprint([...index.slice(0, 3), '100644 zzz 0\tsrc/components/Button.test.tsx', ...index.slice(4)], 'catalog'), before, 'a test file is not part of the catalogue')
  assert.notEqual(fingerprint(index.map(l => l.replace('ccc', 'ccd')), 'catalog'), before)
  assert.equal(fingerprint(index.map(l => l.replace('ccc', 'ccd')), 'stack'), fingerprint(index, 'stack'), 'a component change does not touch the stack')
  assert.equal(fingerprint(index, 'check'), null, 'the check has no inputs: it is run again')
})

const profile = { ui: true, stack: { languages: ['typescript'] } }
const done = fp => Object.fromEntries(STEPS.map(s => [s, { done: true, fingerprint: fp[s] ?? null }]))
const current = { stack: 's1', product: 'p1', design: 'd1', catalog: 'c1', skills: 'k1', defaults: 'm1', check: null }

test('nothing there is none; a fresh setup that matches is complete', () => {
  assert.equal(initStatus({ profile: null, problems: [], record: null, current }).state, 'none')
  const s = initStatus({ profile, problems: [], record: { steps: done(current) }, current })
  assert.deepEqual(s, { state: 'complete', todo: [], stale: [], problems: [] })
  assert.equal(summary(s), 'Already set up and current. Nothing to do.')
})

test('an init stopped half way resumes at the steps left', () => {
  const steps = done(current)
  delete steps.skills
  delete steps.check
  const s = initStatus({ profile, problems: [], record: { steps }, current })
  assert.equal(s.state, 'partial')
  assert.deepEqual(s.todo, ['skills', 'check'])
  assert.match(summary(s), /left to do: skills, check/)
})

test('changed files make only their steps stale', () => {
  const s = initStatus({ profile, problems: [], record: { steps: done(current) }, current: { ...current, catalog: 'c2', stack: 's2' } })
  assert.equal(s.state, 'stale')
  assert.deepEqual(s.stale, ['stack', 'catalog'])
  assert.match(summary(s), /redo: stack, catalog/)
})

test('a project without screens needs no design or catalogue step', () => {
  const steps = done(current)
  delete steps.design
  delete steps.catalog
  assert.equal(initStatus({ profile: { stack: {} }, problems: [], record: { steps }, current }).state, 'complete')
})

test('a profile with problems is not complete, even with every step marked', () => {
  const s = initStatus({ profile, problems: ['commands.test is missing'], record: { steps: done(current) }, current })
  assert.equal(s.state, 'partial')
  assert.deepEqual(s.todo, ['check'])
})

test('a profile written by hand, with no record, is partial and lists every step', () => {
  const s = initStatus({ profile, problems: [], record: null, current })
  assert.equal(s.state, 'partial')
  assert.deepEqual(s.todo, STEPS)
})
