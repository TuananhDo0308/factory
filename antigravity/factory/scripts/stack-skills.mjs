#!/usr/bin/env node
// Which vetted skills a project's stack gets, per role, and installing them
// into the project at their pinned commits.
//
//   node stack-skills.mjs plan --stacks nextjs,prisma,vitest
//   node stack-skills.mjs install --repo <repo> --stacks nextjs,prisma,vitest
//
// `plan` prints { roles: { implementer: [...], ... }, install: [...], unvetted: [...] }:
// the `skills` part of .factory/project.json, what install will fetch, and the
// stacks with no vetted skill (their conventions belong in GEMINI.md).
// `install` copies each skill into <repo>/.agents/skills/<name>, never over an
// existing one, from factory/catalog/stack-skills.json. `add` installs one
// skill a person found (find-skills.mjs), read and approved, at that commit.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ROLES = ['planner', 'implementer', 'qa', 'reviewer', 'qc']

export function planSkills(catalog, stacks) {
  const roles = Object.fromEntries(ROLES.map(r => [r, []]))
  const install = new Map()
  const unvetted = []
  const unknown = []
  for (const stack of stacks) {
    const entries = catalog.stacks[stack]
    if (entries === undefined) { unknown.push(stack); continue }
    if (entries.length === 0) { unvetted.push(stack); continue }
    for (const e of entries) {
      for (const r of e.roles) if (roles[r] && !roles[r].includes(e.name)) roles[r].push(e.name)
      const src = catalog.sources[e.source]
      if (!src) throw new Error(`catalog: skill ${e.name} names source ${e.source}, which is not in "sources"`)
      install.set(e.name, { name: e.name, source: e.source, commit: src.commit, path: [src.base, e.path].filter(p => p && p !== '.').join('/') })
    }
  }
  return { roles, install: [...install.values()], unvetted, unknown }
}

// What is wrong with a skill to add by hand; empty when it can be installed.
export function addProblems(item) {
  const problems = []
  if (!/^[a-z0-9][a-z0-9-]*$/.test(item.name || '')) problems.push('--name must be lower-case letters, digits and "-"')
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(item.source || '')) problems.push('--source must be owner/repo')
  if (!/^[0-9a-f]{40}$/.test(item.commit || '')) problems.push('--commit must be the full 40-character commit the person read, not a branch')
  if (/(^|\/)\.\.(\/|$)/.test(item.path || '')) problems.push('--path may not leave the repository')
  return problems
}

const here = dirname(fileURLToPath(import.meta.url))
function loadCatalog() {
  return JSON.parse(readFileSync(join(here, '..', 'catalog', 'stack-skills.json'), 'utf8'))
}

function install(repo, items) {
  const target = join(repo, '.agents', 'skills')
  const tmp = mkdtempSync(join(tmpdir(), 'stack-skills-'))
  try {
    for (const item of items) {
      const dest = join(target, item.name)
      if (existsSync(dest)) { console.log(`kept      ${item.name} (already in ${target})`); continue }
      const dir = join(tmp, item.source.replace('/', '_'))
      if (!existsSync(dir)) {
        execFileSync('git', ['init', '-q', dir])
        execFileSync('git', ['-C', dir, 'fetch', '-q', '--depth', '1', `https://github.com/${item.source}.git`, item.commit])
        execFileSync('git', ['-C', dir, 'checkout', '-q', 'FETCH_HEAD'])
      }
      const src = join(dir, item.path)
      if (!existsSync(join(src, 'SKILL.md'))) throw new Error(`${item.source}@${item.commit.slice(0, 7)} has no ${item.path}/SKILL.md`)
      cpSync(src, dest, { recursive: true })
      console.log(`installed ${item.name} from ${item.source}@${item.commit.slice(0, 7)}`)
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

function main(argv) {
  const [cmd] = argv
  const opt = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined }
  const stacks = (opt('--stacks') || '').split(',').map(s => s.trim()).filter(Boolean)
  const plan = planSkills(loadCatalog(), stacks)
  if (cmd === 'plan') { console.log(JSON.stringify(plan, null, 2)); return 0 }
  if (cmd === 'add') {
    // One skill a person read and approved, from any GitHub repository, at the
    // exact commit they read (find-skills.mjs prints it).
    const repo = opt('--repo')
    const item = { name: opt('--name'), source: opt('--source'), commit: opt('--commit'), path: opt('--path') || '.' }
    const problems = addProblems(item)
    if (!repo || !existsSync(repo)) problems.push('--repo must name an existing directory')
    if (problems.length) { console.error(problems.join('\n')); return 2 }
    install(repo, [item])
    return 0
  }
  if (cmd === 'install') {
    const repo = opt('--repo')
    if (!repo || !existsSync(repo)) { console.error('install needs --repo <existing directory>'); return 2 }
    install(repo, plan.install)
    if (plan.unvetted.length) console.log(`no vetted skill for: ${plan.unvetted.join(', ')} (write their conventions into GEMINI.md)`)
    if (plan.unknown.length) console.log(`not in the catalog: ${plan.unknown.join(', ')}`)
    return 0
  }
  console.error('usage: stack-skills.mjs plan|install [--repo R] --stacks a,b | add --repo R --name N --source owner/repo --commit SHA [--path P]')
  return 2
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exit(main(process.argv.slice(2)))
