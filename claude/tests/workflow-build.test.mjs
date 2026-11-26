// Verifies that `factory/workflow/factory.js` stays strictly in sync with its
// modular source blocks under `factory/workflow/src/`, and that named model
// profiles match `factory/catalog/model-profiles.json`.
// Run: node --test tests/workflow-build.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { assembleWorkflow } from '../factory/scripts/build-workflow.mjs'
import { helpers as h } from './load.mjs'

const builtFile = fileURLToPath(new URL('../factory/workflow/factory.js', import.meta.url))
const profilesFile = fileURLToPath(new URL('../factory/catalog/model-profiles.json', import.meta.url))

test('factory/workflow/factory.js is in sync with factory/workflow/src/ blocks', () => {
  const onDisk = readFileSync(builtFile, 'utf8')
  const assembled = assembleWorkflow()
  assert.equal(onDisk, assembled, 'factory.js is out of sync — run: node factory/scripts/build-workflow.mjs')
  assert.ok(onDisk.startsWith('export const meta = {'), 'factory.js must start with `export const meta = {`')
})

test('catalog/model-profiles.json matches MODEL_PROFILES in config/02-models.js', () => {
  const catalog = JSON.parse(readFileSync(profilesFile, 'utf8'))
  assert.deepEqual(Object.keys(catalog.profiles).sort(), Object.keys(h.MODEL_PROFILES).sort())
  for (const [name, def] of Object.entries(catalog.profiles)) {
    assert.deepEqual(def.models, h.MODEL_PROFILES[name], `Profile "${name}" drifted between catalog and 02-models.js`)
  }
})

test('modelProfileProblems and resolveModelsForProfile support fast, flagship, inherit and overrides', () => {
  assert.deepEqual(h.modelProfileProblems(undefined), [])
  assert.deepEqual(h.modelProfileProblems('balanced'), [])
  assert.deepEqual(h.modelProfileProblems('fast'), [])
  assert.deepEqual(h.modelProfileProblems('flagship'), [])
  assert.deepEqual(h.modelProfileProblems('inherit'), [])
  assert.equal(h.modelProfileProblems('unknown').length, 1)

  // Fast profile uses haiku for QA & checker, while explicit overrides still win.
  const fastWithOverride = h.resolveModelsForProfile('fast', { qa: { model: 'sonnet' } })
  assert.deepEqual(h.modelFor('checker', fastWithOverride), { model: 'haiku', effort: 'low' })
  assert.deepEqual(h.modelFor('qa', fastWithOverride), { model: 'sonnet', effort: 'medium' })

  // Inherit profile omits `model` so every agent uses the session's model.
  const inherited = h.resolveModelsForProfile('inherit')
  assert.equal(h.modelFor('planner', inherited).model, undefined)
  assert.equal(h.modelFor('reviewer', inherited).model, undefined)
})

test('factory.js respects args.modelProfile end-to-end and rejects invalid profiles', async () => {
  const source = readFileSync(builtFile, 'utf8').replace(/^export const meta/m, 'const meta')
  const AsyncFunction = (async () => {}).constructor
  const runWorkflow = new AsyncFunction('args', 'agent', 'parallel', 'phase', 'log', source)

  const roles = Object.fromEntries(
    ['planner', 'implementer', 'qa', 'checker', 'reviewer', 'specReviewer', 'qc'].map(r => [r, `/roles/${r}.md`]),
  )
  const skills = Object.fromEntries(
    ['tdd', 'codebase-design', 'diagnosing-bugs', 'verification-before-completion', 'mp-code-review', 'testing-strategy', 'pr-security-review'].map(n => [n, `/s/${n}`]),
  )
  const contract = {
    objective: 'Test profile routing',
    criteria: [{ id: 'C1', text: 'works' }],
    outOfScope: [],
    checks: [{ name: 'test', command: 'npm test' }],
  }

  // 1. Invalid profile stops immediately before starting any agent.
  const badCalls = []
  const badRes = await runWorkflow(
    { repo: '/repo', base: 'BASE', roles, skills, contract, qc: false, modelProfile: 'invalid-tier' },
    async (p, opts) => { badCalls.push(opts); return null },
    async fns => Promise.all(fns.map(f => f())),
    () => {},
    () => {},
  )
  assert.equal(badRes.outcome, 'blocked')
  assert.match(badRes.reason, /modelProfile/)
  assert.equal(badCalls.length, 0)

  // 2. Fast profile applies to planner even during questionsOnly mode.
  const fastCalls = []
  const fastRes = await runWorkflow(
    { repo: '/repo', base: 'BASE', roles, skills, contract, questionsOnly: true, modelProfile: 'fast' },
    async (p, opts) => {
      fastCalls.push(opts)
      return { overview: 'ok', specs: [], risks: [], questions: [] }
    },
    async fns => Promise.all(fns.map(f => f())),
    () => {},
    () => {},
  )
  assert.equal(fastRes.outcome, 'ready')
  assert.equal(fastCalls[0].model, 'sonnet')
  assert.equal(fastCalls[0].effort, 'high')
})
