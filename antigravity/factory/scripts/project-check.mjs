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
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'

export const PROFILE = '.factory/project.json'
export const ROLES = ['planner', 'implementer', 'qa', 'reviewer', 'qc']
export const CHECKS = ['test', 'typecheck', 'lint', 'format', 'build', 'tokens', 'e2e']
export const ESCALATE = ['auth', 'money', 'migration', 'dependency', 'ci', 'high-risk', 'ui', 'tests-rewritten']

const blank = v => v === undefined || v === null || String(v).trim() === ''

// The rules of a CODING_STANDARDS.md: every table row whose first cell is an
// id S1..Sn, as { id, text, severity, enforced, check }. "Kept by" is
// `review`, or `check: <name>` for a rule a command decides.
export function parseStandards(md) {
  const rules = []
  for (const line of String(md || '').split('\n')) {
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
    if (cells.length < 4 || !/^S\d+$/.test(cells[0])) continue
    const kept = cells[3].toLowerCase()
    const check = /^check\s*:/.test(kept) ? kept.replace(/^check\s*:\s*/, '').trim() : undefined
    rules.push({ id: cells[0], text: cells[1], severity: cells[2].toLowerCase(), enforced: check !== undefined ? 'tool' : kept, ...(check !== undefined ? { check } : {}) })
  }
  return rules
}

// What is wrong with the standards' rules, against the profile's commands.
export function standardsProblems(rules, commands) {
  const problems = []
  if (rules.length === 0) return ['the coding standards have no rules: rows of a table whose first cell is S1, S2, ...']
  const seen = new Set()
  for (const r of rules) {
    if (seen.has(r.id)) problems.push(`coding standards: ${r.id} is given twice.`)
    seen.add(r.id)
    if (blank(r.text)) problems.push(`coding standards: ${r.id} has no rule.`)
    if (!['blocking', 'minor'].includes(r.severity)) problems.push(`coding standards: ${r.id} must be blocking or minor, not "${r.severity}".`)
    if (r.enforced === 'tool' && blank((commands || {})[r.check])) problems.push(`coding standards: ${r.id} is kept by the check "${r.check}", which commands does not have; add the command or change the rule.`)
    else if (!['tool', 'review'].includes(r.enforced)) problems.push(`coding standards: ${r.id} must be kept by "review" or "check: <command>", not "${r.enforced}".`)
  }
  return problems
}

// exists(path) and installed(skill) are supplied by the caller, so this stays pure.
// `mcpServers` lists the servers in the project's or user's mcp_config.json;
// `read(path)` returns a repository file's text, or null.
export function checkProfile(p, exists, installed, mcpServers = [], read = () => null) {
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
  if (Array.isArray(s.languages) && s.languages.length > 0 && blank(c.lint)) problems.push('commands.lint is missing: the coding standards are kept by a linter, so a run can decide them without a reviewer\'s opinion.')
  if (blank(p.standards)) problems.push('standards is missing: name the project\'s CODING_STANDARDS.md (factory-init writes it from its template), so every run builds and is judged by written rules.')
  else if (!exists(p.standards)) problems.push(`standards names ${p.standards}, which does not exist.`)
  else problems.push(...standardsProblems(parseStandards(read(p.standards)), c))
  if (blank(c.migrate) !== blank(c.rollback)) problems.push('commands.migrate and commands.rollback go together: a migration is run up, down and up again.')

  const d = p.design
  const ui = p.ui === true || !!d
  if (ui && blank((p.run || {}).start)) problems.push('The project has a UI but run.start is missing: QC cannot open it.')
  if (ui && blank(p.browser)) problems.push('The project has a UI but no browser: QC clicks through its screens with Playwright MCP. Set browser to "playwright" and add the server to .agents/plugins/factory-browser/mcp_config.json or ~/.gemini/config/mcp_config.json (init-skeleton.mjs or agy mcp add does this).')
  if (!blank(p.browser) && !mcpServers.includes(p.browser)) problems.push(`browser names the MCP server "${p.browser}", which mcp_config.json does not have.`)
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
  if (blank(docs.agents)) problems.push('docs.agents is missing: name the GEMINI.md (or AGENTS.md) every agent reads first.')
  for (const [k, v] of Object.entries(docs)) if (!blank(v) && !exists(v)) problems.push(`docs.${k} names ${v}, which does not exist.`)

  const sk = p.skills || {}
  for (const [role, names] of Object.entries(sk)) {
    if (!ROLES.includes(role)) { problems.push(`skills.${role}: not a role (${ROLES.join(', ')}).`); continue }
    if (!Array.isArray(names)) { problems.push(`skills.${role} must be a list.`); continue }
    for (const n of names) if (!installed(n)) problems.push(`skills.${role}: ${n} is not installed in the project's .agents/skills or ~/.gemini/config/skills.`)
  }

  for (const e of p.escalate || []) if (!ESCALATE.includes(e)) problems.push(`escalate: ${e} is not one of ${ESCALATE.join(', ')}.`)
  if (p.protectedPaths !== undefined && !Array.isArray(p.protectedPaths)) problems.push('protectedPaths must be a list.')
  return problems
}

// The profile's share of a run: contract.checks, contract.run, the coding
// standards (from the text of the file it names), the design
// pointers contract.design starts from, and the args.
export function contractPart(p, standardsMd) {
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
    standards: blank(p.standards) || !standardsMd ? undefined : { file: p.standards, rules: parseStandards(standardsMd) },
    testFileCommand: blank(c.testFile) ? undefined : c.testFile,
    migration: !blank(c.migrate) && !blank(c.rollback) ? { up: c.migrate, down: c.rollback } : undefined,
    args: {
      projectSkills: p.skills || {},
      projectStack: p.stack || {},
      projectDocs: p.docs || {},
      ...(blank(p.browser) ? {} : { browser: p.browser }),
      protectedPaths: p.protectedPaths || [],
      ...(p.escalate ? { escalate: p.escalate } : {}),
    },
  }
}

export function isSkillInstalled(repo, name, home = homedir()) {
  const dirs = [
    join(repo, '.agents', 'skills'),
    join(repo, '.gemini', 'skills'),
    join(home, '.gemini', 'config', 'skills'),
    join(home, '.gemini', 'antigravity', 'skills'),
    join(home, '.gemini', 'skills'),
    join(home, '.agents', 'skills'),
  ]
  return dirs.some(dir => existsSync(join(dir, name, 'SKILL.md')))
}

export function readMcpServers(repo, home = homedir()) {
  const servers = new Set()
  const addFrom = file => {
    try {
      const cfg = JSON.parse(readFileSync(file, 'utf8'))
      for (const name of Object.keys(cfg.mcpServers || {})) servers.add(name)
    } catch {}
  }
  addFrom(join(repo, '.agents', 'mcp_config.json'))
  const pluginsDir = join(repo, '.agents', 'plugins')
  try {
    for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) addFrom(join(pluginsDir, entry.name, 'mcp_config.json'))
    }
  } catch {}
  addFrom(join(home, '.gemini', 'config', 'mcp_config.json'))
  return [...servers]
}

function main(argv) {
  const repo = argv.find(a => !a.startsWith('--'))
  if (!repo || !existsSync(repo)) { console.error('usage: project-check.mjs <repo> [--run | --contract]'); return 2 }
  let profile = null
  try { profile = JSON.parse(readFileSync(join(repo, PROFILE), 'utf8')) } catch {}
  if (argv.includes('--contract')) {
    if (!profile) { console.error(`${PROFILE} is missing or not JSON. Run /factory-init.`); return 1 }
    let md = null
    try { md = profile.standards ? readFileSync(join(repo, profile.standards), 'utf8') : null } catch {}
    console.log(JSON.stringify(contractPart(profile, md), null, 2))
    return 0
  }
  const exists = f => existsSync(join(repo, f))
  const installed = n => isSkillInstalled(repo, n)
  const mcpServers = readMcpServers(repo)
  const read = f => { try { return readFileSync(join(repo, f), 'utf8') } catch { return null } }
  const problems = checkProfile(profile, exists, installed, mcpServers, read)
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
