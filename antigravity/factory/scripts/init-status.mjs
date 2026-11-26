#!/usr/bin/env node
// Has this repository been set up for the factory, and is that setup still
// true? Run before anything else in factory-init, so a project that is
// already set up costs one command, not a scan, a read of the code and a
// round of questions.
//
//   node init-status.mjs <repo> [--json]      the state and what is left to do
//   node init-status.mjs <repo> --mark <step> record a step as done, now
//
// Steps: stack, product, design, catalog, skills, defaults, standards, check. Each done
// step is recorded in .factory/init.json with a fingerprint of the files it
// was based on (git's blob ids of the working tree, one git call). When
// those files change, the step is stale and only it is redone. States:
//   none      nothing set up
//   partial   started, some steps left (an init that was stopped resumes here)
//   stale     done, but the files some steps were based on have changed
//   complete  done and current: nothing to do
// The pure function `initStatus` is tested in tests/init-status.test.mjs.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { checkProfile, isSkillInstalled, PROFILE, readMcpServers } from './project-check.mjs'

export const RECORD = '.factory/init.json'

// The files each step is based on. A change to any of them makes it stale.
export const INPUTS = {
  stack: /(^|\/)(package\.json|pnpm-lock\.yaml|yarn\.lock|package-lock\.json|bun\.lockb?|pyproject\.toml|requirements[^/]*\.txt|poetry\.lock|uv\.lock|go\.mod|Cargo\.toml|Gemfile|composer\.json)$|^\.github\/workflows\//,
  product: /^(README\.md|PRODUCT\.md|\.factory\/product\.md)$/i,
  design: /(^|\/)(tailwind\.config\.[a-z]+|DESIGN\.md|tokens?\.json|theme\.(ts|js|tsx))$|\.(css|scss)$/,
  catalog: /\.(tsx|jsx|vue|svelte)$/,
  skills: /^\.(agents|gemini)\/skills\//,
  defaults: /^(GEMINI\.md|AGENTS\.md)$/,
  standards: /^CODING_STANDARDS\.md$|(^|\/)(\.eslintrc[^/]*|eslint\.config\.[a-z]+|\.prettierrc[^/]*|prettier\.config\.[a-z]+|biome\.jsonc?|ruff\.toml|\.ruff\.toml|tsconfig[^/]*\.json)$/,
}
const NOT_SOURCE = /(^|\/)(node_modules|dist|build|\.next|coverage)\/|\.(test|spec|stories)\.[a-z]+$/
export const STEPS = ['stack', 'product', 'design', 'catalog', 'skills', 'defaults', 'standards', 'check']

// index: lines "<blob id>\t<path>" (any prefix before the tab works).
export function fingerprint(index, step) {
  const re = INPUTS[step]
  if (!re) return null
  const lines = index.filter(l => { const p = l.split('\t')[1] || ''; return re.test(p) && !NOT_SOURCE.test(p) }).sort()
  return createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16)
}

// profile: .factory/project.json or null; problems: checkProfile's output;
// record: .factory/init.json or null; current: { step: fingerprint } now.
export function initStatus({ profile, problems, record, current }) {
  const steps = (record && record.steps) || {}
  const ui = !!(profile && (profile.ui || profile.design))
  const required = STEPS.filter(s => (s === 'design' || s === 'catalog' ? ui || !profile : true))
  const todo = []
  const stale = []
  for (const s of required) {
    const r = steps[s]
    if (!r || !r.done) { todo.push(s); continue }
    if (r.fingerprint && current[s] && r.fingerprint !== current[s]) stale.push(s)
  }
  if (profile && problems.length > 0 && !todo.includes('check')) todo.push('check')
  let state
  if (!profile && !record) state = 'none'
  else if (todo.length > 0 || !profile) state = 'partial'
  else if (stale.length > 0) state = 'stale'
  else state = 'complete'
  return { state, todo, stale, problems }
}

export function summary(s) {
  if (s.state === 'none') return 'Not set up for the factory yet: run the whole init.'
  if (s.state === 'complete') return 'Already set up and current. Nothing to do.'
  const parts = []
  if (s.todo.length) parts.push(`left to do: ${s.todo.join(', ')}`)
  if (s.stale.length) parts.push(`changed since init, redo: ${s.stale.join(', ')}`)
  if (s.problems.length) parts.push(`profile problems: ${s.problems.length}`)
  return `${s.state === 'partial' ? 'Set up in part' : 'Set up, but out of date'}; ${parts.join('; ')}.`
}

// "<blob id>\t<path>" for every file a step is based on, as it is in the
// working tree now (committed or not), so a step marked before a commit is
// not stale after it.
function gitIndex(repo) {
  try {
    const files = execFileSync('git', ['-C', repo, 'ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
      .split('\n').filter(f => f && Object.values(INPUTS).some(re => re.test(f)) && !NOT_SOURCE.test(f) && existsSync(join(repo, f)))
    if (files.length === 0) return []
    const ids = execFileSync('git', ['-C', repo, 'hash-object', '--stdin-paths'], { input: files.join('\n'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter(Boolean)
    return files.map((f, i) => `${ids[i]}\t${f}`)
  } catch { return [] }
}

function main(argv) {
  const repo = argv.find(a => !a.startsWith('--'))
  if (!repo || !existsSync(repo)) { console.error('usage: init-status.mjs <repo> [--json | --mark <step>]'); return 2 }
  const read = f => { try { return JSON.parse(readFileSync(join(repo, f), 'utf8')) } catch { return null } }
  const index = gitIndex(repo)
  const current = Object.fromEntries(STEPS.map(s => [s, fingerprint(index, s)]))
  const markIdx = argv.indexOf('--mark')
  if (markIdx >= 0) {
    const mark = argv[markIdx + 1]
    if (!STEPS.includes(mark)) { console.error(`--mark takes one of ${STEPS.join(', ')}`); return 2 }
    const record = read(RECORD) || { steps: {} }
    record.steps[mark] = { done: true, at: new Date().toISOString().slice(0, 10), fingerprint: current[mark] }
    mkdirSync(join(repo, '.factory'), { recursive: true })
    writeFileSync(join(repo, RECORD), JSON.stringify(record, null, 2) + '\n')
    console.log(`marked ${mark} done`)
    return 0
  }
  const profile = read(PROFILE)
  const exists = f => existsSync(join(repo, f))
  const installed = n => isSkillInstalled(repo, n)
  const readText = f => { try { return readFileSync(join(repo, f), 'utf8') } catch { return null } }
  const problems = profile ? checkProfile(profile, exists, installed, readMcpServers(repo), readText) : []
  const s = initStatus({ profile, problems, record: read(RECORD), current })
  if (argv.includes('--json')) console.log(JSON.stringify(s, null, 2))
  else {
    console.log(`${s.state}: ${summary(s)}`)
    for (const p of s.problems) console.log(`  - ${p}`)
  }
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  process.exit(main(process.argv.slice(2)))
}
