#!/usr/bin/env node
// Is this project ready for factory runs? Checks .factory/project.json, the
// profile factory-init writes and the tech lead owns, against the repository.
//
//   node project-check.mjs <repo>            problems, exit 0 when none, 1 otherwise
//   node project-check.mjs <repo> --run      also runs each check command on the current checkout
//   node project-check.mjs <repo> --contract prints the profile's part of a run's
//                                            contract and args: checks, run, design, projectSkills
//
// The pure functions are tested in tests/project-check.test.mjs.
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'

export const PROFILE = '.factory/project.json'
export const ROLES = ['planner', 'implementer', 'qa', 'reviewer', 'qc']
export const CHECKS = ['test', 'typecheck', 'lint', 'build', 'tokens', 'e2e']
export const ESCALATE = ['auth', 'money', 'migration', 'dependency', 'ci', 'high-risk', 'ui', 'tests-rewritten']

const blank = v => v === undefined || v === null || String(v).trim() === ''

// exists(path) and installed(skill) are supplied by the caller, so this stays pure.
export function checkProfile(p, exists, installed) {
  const problems = []
  if (!p || typeof p !== 'object') return [`${PROFILE} is missing or is not a JSON object. Run /factory-init.`]

  const s = p.stack || {}
  if (!Array.isArray(s.languages) || s.languages.length === 0) problems.push('stack.languages is empty.')
  if (!blank(s.adr) && !exists(s.adr)) problems.push(`stack.adr names ${s.adr}, which does not exist.`)

  const c = p.commands || {}
  const checks = CHECKS.filter(k => !blank(c[k]))
  if (checks.length === 0) problems.push(`commands has none of ${CHECKS.join(', ')}: a run would have nothing to check against.`)
  for (const [k, v] of Object.entries(c)) if (blank(v)) problems.push(`commands.${k} is empty; remove it or give the command.`)
  if (blank(c.test)) problems.push('commands.test is missing: every run builds test-first, so the project needs a test command, even if it runs one test.')
  if (!blank(c.testFile) && !String(c.testFile).includes('{files}')) problems.push('commands.testFile must contain {files}, where the test files go: it runs a spec\'s new tests on the base code.')
  if (blank(c.migrate) !== blank(c.rollback)) problems.push('commands.migrate and commands.rollback go together: a migration is run up, down and up again.')

  const d = p.design
  const ui = p.ui === true || !!d
  if (ui && blank((p.run || {}).start)) problems.push('The project has a UI but run.start is missing: QC cannot open it.')
  if (d) {
    for (const k of ['doc', 'tokens']) {
      if (blank(d[k])) problems.push(`design.${k} is missing.`)
      else if (!exists(d[k])) problems.push(`design.${k} names ${d[k]}, which does not exist.`)
    }
    for (const k of ['uiStore', 'mockups']) if (!blank(d[k]) && !exists(d[k])) problems.push(`design.${k} names ${d[k]}, which does not exist.`)
  }
  const run = p.run || {}
  for (const k of ['auth', 'env']) if (!blank(run[k]) && !exists(run[k])) problems.push(`run.${k} names ${run[k]}, which does not exist.`)

  const docs = p.docs || {}
  if (blank(docs.agents)) problems.push('docs.agents is missing: name the CLAUDE.md (or AGENTS.md) every agent reads first.')
  for (const [k, v] of Object.entries(docs)) if (!blank(v) && !exists(v)) problems.push(`docs.${k} names ${v}, which does not exist.`)

  const sk = p.skills || {}
  for (const [role, names] of Object.entries(sk)) {
    if (!ROLES.includes(role)) { problems.push(`skills.${role}: not a role (${ROLES.join(', ')}).`); continue }
    if (!Array.isArray(names)) { problems.push(`skills.${role} must be a list.`); continue }
    for (const n of names) if (!installed(n)) problems.push(`skills.${role}: ${n} is not installed in the project's .claude/skills or ~/.claude/skills.`)
  }

  for (const e of p.escalate || []) if (!ESCALATE.includes(e)) problems.push(`escalate: ${e} is not one of ${ESCALATE.join(', ')}.`)
  if (p.protectedPaths !== undefined && !Array.isArray(p.protectedPaths)) problems.push('protectedPaths must be a list.')
  return problems
}

// The profile's share of a run: contract.checks, contract.run, the design
// pointers contract.design starts from, and the args.
export function contractPart(p) {
  const c = p.commands || {}
  const run = p.run || {}
  const runText = [
    run.start && `Start: ${run.start} (choose a free port for $PORT)`,
    run.readyPath && `Ready when ${run.readyPath} answers`,
    run.env && `Environment: copy ${run.env}; it holds test values only`,
    run.seed && `Test data: ${run.seed}`,
    run.auth && `Sign in as the test user with ${run.auth}`,
    run.notes,
  ].filter(Boolean).join('. ')
  return {
    checks: CHECKS.filter(k => !blank(c[k])).map(k => ({ name: k, command: c[k] })),
    run: runText || undefined,
    design: p.design ? { doc: p.design.doc, tokens: p.design.tokens, uiStore: p.design.uiStore, screens: [], baseline: [], reuse: [] } : undefined,
    testFileCommand: blank(c.testFile) ? undefined : c.testFile,
    migration: !blank(c.migrate) && !blank(c.rollback) ? { up: c.migrate, down: c.rollback } : undefined,
    args: {
      projectSkills: p.skills || {},
      projectStack: p.stack || {},
      projectDocs: p.docs || {},
      protectedPaths: p.protectedPaths || [],
      ...(p.escalate ? { escalate: p.escalate } : {}),
    },
  }
}

function main(argv) {
  const repo = argv.find(a => !a.startsWith('--'))
  if (!repo || !existsSync(repo)) { console.error('usage: project-check.mjs <repo> [--run | --contract]'); return 2 }
  let profile = null
  try { profile = JSON.parse(readFileSync(join(repo, PROFILE), 'utf8')) } catch {}
  if (argv.includes('--contract')) {
    if (!profile) { console.error(`${PROFILE} is missing or not JSON. Run /factory-init.`); return 1 }
    console.log(JSON.stringify(contractPart(profile), null, 2))
    return 0
  }
  const exists = f => existsSync(join(repo, f))
  const installed = n => existsSync(join(repo, '.claude', 'skills', n, 'SKILL.md')) || existsSync(join(homedir(), '.claude', 'skills', n, 'SKILL.md'))
  const problems = checkProfile(profile, exists, installed)
  for (const p of problems) console.log(`- ${p}`)
  let failed = problems.length > 0
  if (argv.includes('--run') && profile) {
    for (const { name, command } of contractPart(profile).checks) {
      try {
        execSync(command, { cwd: repo, stdio: 'pipe', timeout: 15 * 60 * 1000 })
        console.log(`ok   ${name}: ${command}`)
      } catch (e) {
        failed = true
        console.log(`FAIL ${name}: ${command} (exit ${e.status ?? 'timeout'})`)
      }
    }
  }
  if (!failed) console.log('Project is ready for factory runs.')
  return failed ? 1 : 0
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exit(main(process.argv.slice(2)))
