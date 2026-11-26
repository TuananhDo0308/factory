#!/usr/bin/env node
// Lays out .factory/ in a project and drafts its profile from what the scans
// found, without overwriting anything that is already there.
//
//   node init-skeleton.mjs <repo> --stack <detect-stack.json> --design <detect-design.json> [--dry-run]
//
// Creates the folders and the files that are missing, adds the browser QC
// uses (Playwright MCP) to .agents/plugins/factory-browser/mcp_config.json when
// the project has a UI, and writes .factory/project.draft.json: the profile as
// the scans see it, for the factory-init session to complete with the person's
// answers and save as .factory/project.json. Prints every path it created or
// kept. The pure functions are tested in tests/init.test.mjs.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const LAYOUT = `# .factory

Everything the factory needs to know about this project. People own it and change it through pull requests; agents read it and never edit it during a run.

| Path | What it is |
|---|---|
| \`project.json\` | Stack, check commands, how to run the app for QC, stack skills per role, design pointers, what needs a person before merging. Checked by \`project-check.mjs\`. |
| \`product.md\` | What the product is, for whom, and what is out of scope. |
| \`decisions.md\` | Answers people gave to questions, one line each with its source. Nobody asks them again; no ticket contradicts them. |
| \`design/\` | \`DESIGN.md\` (rules), \`tokens.json\` (W3C design tokens) or a pointer to where tokens live, \`ui-store/\` (screens and components as they are today), \`mockups/\` (approved mockups, by issue). |
| \`plans/\` | The plan the planner made when a ticket was clarified, kept so the build reuses what the person approved while the code it touches is unchanged. |
| \`init.json\` | Which setup steps are done, and what each was based on (\`init-status.mjs\`). |
| \`runs/\` | Working files of clarify and of runs on this machine. Not committed. |

Stack skills live in \`.agents/skills/\`, where Gemini Antigravity loads them.
`

const PRODUCT = `# Product

> Draft by factory-init. Replace each line with the answer, or delete it if it does not apply.

## Problem

## Users

## What it does today

## What comes next

## Out of scope

## Open questions
`

const DECISIONS = `# Decisions

Answers people gave, so nobody asks them again and no ticket contradicts them. One line each, newest last. Change a decision by adding a line that replaces it.

| # | Decision | Applies to | Source | Replaces |
|---|---|---|---|---|
`

// The browser QC clicks through: Playwright MCP, pinned, headless so it runs
// on a machine with no screen, isolated so it keeps no profile on disk.
export const MCP_PLUGIN_DIR = '.agents/plugins/factory-browser'
export const MCP_PLUGIN_MANIFEST = `${MCP_PLUGIN_DIR}/plugin.json`
export const MCP_CONFIG_PATH = `${MCP_PLUGIN_DIR}/mcp_config.json`
export const BROWSER_SERVER = 'playwright'
export const PLAYWRIGHT_MCP = { command: 'npx', args: ['-y', '@playwright/mcp@0.0.84', '--headless', '--isolated'] }

// The project's mcp_config.json with the browser server added, or null when it
// has one already. Every server it had is kept as it was.
export function mcpWithBrowser(existing) {
  const cfg = existing && typeof existing === 'object' ? existing : {}
  const servers = cfg.mcpServers && typeof cfg.mcpServers === 'object' ? cfg.mcpServers : {}
  if (servers[BROWSER_SERVER]) return null
  return { ...cfg, mcpServers: { ...servers, [BROWSER_SERVER]: PLAYWRIGHT_MCP } }
}

// What to create. `has(path)` says whether it exists already.
export function skeletonPlan(has, design, standardsTemplate) {
  const out = []
  const file = (path, content, why) => out.push(has(path) ? { path, kept: true } : { path, content, why })
  const dir = (path, why) => out.push(has(path) ? { path, kept: true } : { path, dir: true, why })
  file('.factory/README.md', LAYOUT, 'what lives in .factory')
  file('.factory/.gitignore', 'runs/\nproject.draft.json\n', 'run state stays on the machine')
  if (!has('PRODUCT.md')) file('.factory/product.md', PRODUCT, 'the product, filled in with the person')
  if (!has('DECISIONS.md')) file('.factory/decisions.md', DECISIONS, 'decisions people make from now on')
  if (standardsTemplate) file('CODING_STANDARDS.md', standardsTemplate, 'the coding standards, from the template, to settle with the tech lead')
  dir('.factory/design/ui-store', 'screens and components as they are today')
  dir('.factory/design/mockups', 'approved mockups, by issue')
  file('.factory/design/mockups/.gitkeep', '', 'keeps the empty folder in git')
  file('.factory/design/ui-store/.gitkeep', '', 'keeps the empty folder in git')
  if (!design || !design.designDoc) file('.factory/design/DESIGN.md', '# Design\n\n> Draft by factory-init: written from the code and the screenshots in ui-store/, or from the design the person chose. Each rule says what to do.\n', 'the design rules')
  return out
}

// The profile as the scans see it. Gaps are left empty for the person to fill.
export function profileDraft(stack, design, has) {
  const tokenSource = (design && design.tokens && design.tokens[0] && design.tokens[0].file) || '.factory/design/tokens.json'
  const doc = (design && design.designDoc) || '.factory/design/DESIGN.md'
  const docs = { agents: has('AGENTS.md') && !has('GEMINI.md') ? 'AGENTS.md' : 'GEMINI.md' }
  docs.product = has('PRODUCT.md') ? 'PRODUCT.md' : '.factory/product.md'
  docs.decisions = has('DECISIONS.md') ? 'DECISIONS.md' : '.factory/decisions.md'
  if (has('GLOSSARY.md')) docs.glossary = 'GLOSSARY.md'
  const commands = { ...(stack.commands || {}) }
  return {
    $comment: 'Draft by factory-init from the repository scans. Confirm every value with the person before saving as project.json.',
    stack: { ...stack.stack, adr: has('docs/adr') ? 'docs/adr' : undefined },
    commands,
    run: { readyPath: '/', ...(stack.run || {}) },
    ui: !!stack.hasUi,
    browser: stack.hasUi ? BROWSER_SERVER : undefined,
    skills: { planner: [], implementer: [], qa: [], reviewer: [], qc: [] },
    design: stack.hasUi || (design && design.hasDesign)
      ? { doc, tokens: tokenSource, uiStore: '.factory/design/ui-store', mockups: '.factory/design/mockups', sources: design ? design.links : {} }
      : undefined,
    docs,
    standards: 'CODING_STANDARDS.md',
    protectedPaths: [],
    escalate: ['auth', 'money', 'migration', 'dependency', 'ci', 'high-risk', 'ui', 'tests-rewritten'],
  }
}

function main(argv) {
  const repo = argv.find(a => !a.startsWith('--'))
  const opt = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined }
  if (!repo || !existsSync(repo)) { console.error('usage: init-skeleton.mjs <repo> --stack <file> --design <file> [--dry-run]'); return 2 }
  const read = f => (f && existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null)
  const stack = read(opt('--stack'))
  const design = read(opt('--design'))
  if (!stack) { console.error('init-skeleton: --stack must name the output of detect-stack.mjs'); return 2 }
  const has = p => existsSync(join(repo, p))
  const dry = argv.includes('--dry-run')
  const template = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'factory-init', 'references', 'coding-standards-template.md')
  const standards = existsSync(template) ? readFileSync(template, 'utf8') : null
  if (!standards) console.error(`init-skeleton: no coding standards template at ${template}; write CODING_STANDARDS.md by hand`)
  for (const item of skeletonPlan(has, design, standards)) {
    if (item.kept) { console.log(`kept     ${item.path}`); continue }
    console.log(`${dry ? 'would add' : 'added   '} ${item.path}  (${item.why})`)
    if (dry) continue
    const p = join(repo, item.path)
    if (item.dir) mkdirSync(p, { recursive: true })
    else { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, item.content) }
  }
  if (stack.hasUi) {
    if (!has(MCP_PLUGIN_MANIFEST)) {
      console.log(`${dry ? 'would add' : 'added   '} ${MCP_PLUGIN_MANIFEST}  (Antigravity workspace plugin for browser QC)`)
      if (!dry) {
        mkdirSync(dirname(join(repo, MCP_PLUGIN_MANIFEST)), { recursive: true })
        writeFileSync(join(repo, MCP_PLUGIN_MANIFEST), JSON.stringify({ name: 'factory-browser' }, null, 2) + '\n')
      }
    } else {
      console.log(`kept     ${MCP_PLUGIN_MANIFEST}`)
    }
    let current = null
    if (has(MCP_CONFIG_PATH)) {
      try { current = JSON.parse(readFileSync(join(repo, MCP_CONFIG_PATH), 'utf8')) } catch { console.error(`init-skeleton: ${MCP_CONFIG_PATH} is not JSON; add the playwright server by hand`); current = undefined }
    }
    const merged = current === undefined ? null : mcpWithBrowser(current)
    if (!merged) console.log(`kept     ${MCP_CONFIG_PATH}`)
    else {
      console.log(`${dry ? 'would add' : 'added   '} ${MCP_CONFIG_PATH} server "${BROWSER_SERVER}"  (the browser QC clicks through)`)
      if (!dry) {
        mkdirSync(dirname(join(repo, MCP_CONFIG_PATH)), { recursive: true })
        writeFileSync(join(repo, MCP_CONFIG_PATH), JSON.stringify(merged, null, 2) + '\n')
      }
    }
  }
  const draft = JSON.stringify(profileDraft(stack, design, has), null, 2) + '\n'
  if (!dry) { mkdirSync(join(repo, '.factory'), { recursive: true }); writeFileSync(join(repo, '.factory', 'project.draft.json'), draft) }
  console.log(`${dry ? 'would write' : 'wrote   '} .factory/project.draft.json`)
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exit(main(process.argv.slice(2)))
