#!/usr/bin/env node
// What design a repository already has, so factory-init asks only about what
// is missing: token sources (a tokens file, Tailwind theme, CSS variables, a
// UI library theme), a design doc, Storybook, and links to Figma, Penpot or
// Claude Design in its docs.
//
//   node detect-design.mjs <repo>
//
// Prints JSON. It reads files; it opens no link and runs nothing. The pure
// function `detectDesign` is tested in tests/init.test.mjs.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const LINKS = [
  ['figma', /https:\/\/(?:www\.)?figma\.com\/(?:file|design|proto|board)\/[A-Za-z0-9]+[^\s)"'>\]]*/g],
  ['penpot', /https:\/\/(?:design\.penpot\.app|[a-z0-9.-]*penpot[a-z0-9.-]*)\/[^\s)"'>\]]+/g],
  ['claudeDesign', /https:\/\/claude\.ai\/(?:design|artifact)\/[^\s)"'>\]]+/g],
]

// files: repository paths. read(path): its text, or '' when unreadable.
export function detectDesign(files, read) {
  const has = re => files.filter(f => re.test(f))
  const tokens = []
  for (const f of has(/(^|\/)(design-)?tokens?\.(json|ya?ml)$|(^|\/)tokens\/[^/]+\.(json|ya?ml)$/)) tokens.push({ kind: 'tokens-file', file: f })
  for (const f of has(/(^|\/)tailwind\.config\.(js|cjs|mjs|ts)$/)) if (/theme\s*:/.test(read(f))) tokens.push({ kind: 'tailwind-theme', file: f })
  for (const f of has(/\.(css|scss)$/).filter(f => !/node_modules|dist\/|build\//.test(f)).slice(0, 400)) {
    const t = read(f)
    const vars = (t.match(/--[a-z0-9-]+\s*:/gi) || []).length
    if (vars >= 8) tokens.push({ kind: 'css-variables', file: f, count: vars })
    else if (/@theme\b/.test(t)) tokens.push({ kind: 'tailwind-v4-theme', file: f })
  }
  for (const f of has(/(^|\/)(theme|themes)\.(ts|tsx|js|mjs)$|(^|\/)theme\/index\.(ts|js)$/)) {
    if (/createTheme|extendTheme|palette|colors\s*:/.test(read(f))) tokens.push({ kind: 'ui-library-theme', file: f })
  }
  const designDoc = files.find(f => /(^|\/)DESIGN\.md$/i.test(f) && !f.startsWith('node_modules/')) || null
  const storybook = files.some(f => /(^|\/)\.storybook\/main\.(js|cjs|mjs|ts)$/.test(f))
  const stories = has(/\.stories\.(tsx|ts|jsx|js|mdx|svelte|vue)$/).length

  const links = { figma: new Set(), penpot: new Set(), claudeDesign: new Set() }
  const docs = files.filter(f => /\.(md|mdx|txt)$/i.test(f) && !/node_modules\//.test(f)).slice(0, 300)
  for (const f of [...docs, ...has(/^\.factory\/project\.json$/)]) {
    const t = read(f)
    for (const [k, re] of LINKS) for (const m of t.match(re) || []) links[k].add(m.replace(/[.,;:]+$/, ''))
  }
  return {
    tokens,
    designDoc,
    storybook: { configured: storybook, stories },
    links: Object.fromEntries(Object.entries(links).map(([k, v]) => [k, [...v]])),
    hasDesign: tokens.length > 0 || !!designDoc || storybook || Object.values(links).some(v => v.size > 0),
  }
}

function main(argv) {
  const repo = argv.find(a => !a.startsWith('--'))
  if (!repo || !existsSync(repo)) { console.error('usage: detect-design.mjs <repo>'); return 2 }
  let files = []
  try {
    files = execFileSync('git', ['-C', repo, 'ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\n').filter(Boolean)
  } catch {
    console.error('detect-design: not a git repository')
    return 2
  }
  const read = f => {
    try {
      const p = join(repo, f)
      return statSync(p).size < 512 * 1024 ? readFileSync(p, 'utf8') : ''
    } catch { return '' }
  }
  console.log(JSON.stringify(detectDesign(files, read), null, 2))
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exit(main(process.argv.slice(2)))
