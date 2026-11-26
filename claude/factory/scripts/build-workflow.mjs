#!/usr/bin/env node
// Assembles `factory/workflow/factory.js` from the modular blocks under
// `factory/workflow/src/`. Claude Code's Workflow runtime requires a single
// plain-JS file with no imports or filesystem access, so this script lets us
// edit clean, focused blocks (models, skills, policy, rules, prompts, pipeline)
// while keeping the runtime bundle self-contained and syntax-verified.
//
// Usage:
//   node factory/scripts/build-workflow.mjs          # write workflow/factory.js
//   node factory/scripts/build-workflow.mjs --check  # exit 1 if out of sync

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export const WORKFLOW_BLOCKS = [
  '00-meta.js',
  '01-primitives.js',
  'config/02-models.js',
  'config/03-skills.js',
  'config/04-policy.js',
  'rules/05-specs.js',
  'rules/06-evaluation.js',
  'telemetry/07-dashboard.js',
  'prompts/08-renderers.js',
  'prompts/09-schemas.js',
  'pipeline/10-agent-calls.js',
  'pipeline/11-run-setup.js',
  'pipeline/12-phase-spec.js',
  'pipeline/13-phase-build.js',
  'pipeline/14-phase-check-review.js',
]

const workflowDir = fileURLToPath(new URL('../workflow', import.meta.url))
const srcDir = join(workflowDir, 'src')
const outFile = join(workflowDir, 'factory.js')

function listJsFiles(dir, base = dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      out.push(...listJsFiles(full, base))
    } else if (name.endsWith('.js')) {
      out.push(relative(base, full).replace(/\\/g, '/'))
    }
  }
  return out.sort()
}

export function assembleWorkflow() {
  const actualFiles = listJsFiles(srcDir)
  const expectedFiles = [...WORKFLOW_BLOCKS].sort()
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    const missing = expectedFiles.filter(f => !actualFiles.includes(f))
    const extra = actualFiles.filter(f => !expectedFiles.includes(f))
    throw new Error(
      `workflow/src/ files do not match WORKFLOW_BLOCKS manifest.` +
        (missing.length ? ` Missing: ${missing.join(', ')}.` : '') +
        (extra.length ? ` Unlisted: ${extra.join(', ')}.` : ''),
    )
  }

  const banner =
    '// GENERATED FILE — DO NOT EDIT DIRECTLY.\n' +
    '// Edit modular blocks under `workflow/src/` and rebuild with:\n' +
    '//   node factory/scripts/build-workflow.mjs'

  const sections = WORKFLOW_BLOCKS.map((rel, idx) => {
    const body = readFileSync(join(srcDir, rel), 'utf8').trimEnd()
    if (idx === 0) return `${body}\n\n${banner}`
    return `// === BLOCK: workflow/src/${rel} ===\n\n${body}`
  })

  // Keep `export const meta = {` on line 1 for Claude Code's Workflow parser.
  const combined = `${sections.join('\n\n')}\n`

  // Syntax check (supports top-level `await` & `return`, like tests/factory-workflow.test.mjs).
  const AsyncFunction = (async () => {}).constructor
  const checkSource = combined.replace(/^export const meta/m, 'const meta')
  new AsyncFunction('args', 'agent', 'parallel', 'phase', 'log', checkSource)

  return combined
}

function main() {
  const checkOnly = process.argv.includes('--check')
  const built = assembleWorkflow()
  if (checkOnly) {
    const current = readFileSync(outFile, 'utf8')
    if (current !== built) {
      console.error('factory/workflow/factory.js is out of sync with factory/workflow/src/.')
      console.error('Run: node factory/scripts/build-workflow.mjs')
      process.exit(1)
    }
    console.log(`OK: factory/workflow/factory.js matches ${WORKFLOW_BLOCKS.length} source blocks.`)
    return
  }
  writeFileSync(outFile, built, 'utf8')
  console.log(`Built factory/workflow/factory.js from ${WORKFLOW_BLOCKS.length} blocks (${built.split('\n').length - 1} lines).`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
}
