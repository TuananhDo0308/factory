// Runs scripts/skills-ready.sh with bash against scratch skill directories, and
// checks that its list of required skills matches the registry in factory.js.
// Run: node --test
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { helpers as h } from './load.mjs'

const script = fileURLToPath(new URL('../factory/scripts/skills-ready.sh', import.meta.url))

function scratch(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'factory-skills-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const home = join(root, 'home')
  const repo = join(root, 're po')
  mkdirSync(repo, { recursive: true })
  const add = (dir, name, body = 'x') => {
    mkdirSync(join(dir, name), { recursive: true })
    writeFileSync(join(dir, name, 'SKILL.md'), body)
  }
  return { root, home, repo, add }
}

const ready = (repo, home) => spawnSync('bash', [script, repo], { encoding: 'utf8', env: { ...process.env, FACTORY_SKILLS_HOME: home } })

test('skills-ready.sh lists the same required and optional skills as the registry', () => {
  const text = readFileSync(script, 'utf8')
  const list = name => text.match(new RegExp(`^${name}="([^"]*)"`, 'm'))[1].split(/\s+/).sort()
  assert.deepEqual(list('REQUIRED'), h.requiredSkills())
  assert.deepEqual(list('OPTIONAL'), h.optionalSkills())
})

test('skills-ready.sh adds the optional skills that are installed and ignores the rest', t => {
  const { home, repo, add } = scratch(t)
  for (const n of h.requiredSkills()) add(join(home, '.claude/skills'), n)
  add(join(home, '.claude/skills'), 'vitest')
  const r = ready(repo, home)
  assert.equal(r.status, 0, r.stderr)
  const map = JSON.parse(r.stdout)
  assert.equal(map.vitest, join(home, '.claude/skills/vitest/SKILL.md'))
  assert.equal(map['playwright-best-practices'], undefined)
})

test('skills-ready.sh resolves every skill, the repository first, plus the repository\'s own', t => {
  const { home, repo, add, root } = scratch(t)
  for (const n of h.requiredSkills()) add(join(home, '.claude/skills'), n)
  add(join(repo, '.claude/skills'), 'tdd')
  add(join(repo, '.claude/skills'), 'impeccable')
  add(join(root, 'elsewhere'), 'linked')
  symlinkSync(join(root, 'elsewhere/linked'), join(repo, '.claude/skills/linked'))
  add(join(repo, '.claude/skills'), 'empty', '')
  const r = ready(repo, home)
  assert.equal(r.status, 0, r.stderr)
  const map = JSON.parse(r.stdout)
  assert.equal(map.tdd, join(repo, '.claude/skills/tdd/SKILL.md'))
  assert.equal(map['mp-code-review'], join(home, '.claude/skills/mp-code-review/SKILL.md'))
  assert.equal(map.impeccable, join(repo, '.claude/skills/impeccable/SKILL.md'))
  assert.ok(map.linked, 'a symlinked skill counts')
  assert.equal(map.empty, undefined, 'an empty SKILL.md does not count')
  assert.deepEqual(h.missingSkills(map), [])
})

test('skills-ready.sh exits 10 and names what is missing', t => {
  const { home, repo, add } = scratch(t)
  for (const n of h.requiredSkills().filter(n => n !== 'tdd')) add(join(home, '.agents/skills'), n)
  const r = ready(repo, home)
  assert.equal(r.status, 10)
  assert.equal(r.stdout, '')
  assert.deepEqual(r.stderr.trim().split('\n'), ['tdd'])
})
