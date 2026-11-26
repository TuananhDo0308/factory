// Tests for the factory-init scripts: detect-design, find-routes,
// capture-screens, find-skills and init-skeleton. Run: node --test tests/
import test from 'node:test'
import assert from 'node:assert/strict'
import { detectDesign } from '../factory/scripts/detect-design.mjs'
import { findRoutes } from '../factory/scripts/find-routes.mjs'

test('detectDesign finds tokens, a design doc, Storybook and design links', () => {
  const files = ['tailwind.config.ts', 'src/styles/globals.css', 'DESIGN.md', '.storybook/main.ts', 'src/Button.stories.tsx', 'README.md', 'src/theme.ts']
  const text = {
    'tailwind.config.ts': 'export default { theme: { extend: {} } }',
    'src/styles/globals.css': ':root{' + Array.from({ length: 10 }, (_, i) => `--c${i}: #000;`).join('') + '}',
    'README.md': 'Designs: https://www.figma.com/design/AbC123/App?node-id=1-2. Brand on https://claude.ai/design/xyz',
    'src/theme.ts': 'export const theme = createTheme({ palette: {} })',
  }
  const d = detectDesign(files, f => text[f] || '')
  assert.deepEqual(d.tokens.map(t => t.kind), ['tailwind-theme', 'css-variables', 'ui-library-theme'])
  assert.equal(d.designDoc, 'DESIGN.md')
  assert.deepEqual(d.storybook, { configured: true, stories: 1 })
  assert.deepEqual(d.links.figma, ['https://www.figma.com/design/AbC123/App?node-id=1-2'])
  assert.deepEqual(d.links.claudeDesign, ['https://claude.ai/design/xyz'])
  assert.equal(d.hasDesign, true)
})

test('a repository with none of it has no design', () => {
  const d = detectDesign(['src/a.css', 'README.md'], f => (f === 'src/a.css' ? ':root{--a:1;}' : 'no links'))
  assert.equal(d.hasDesign, false)
  assert.deepEqual(d.tokens, [])
})

test('findRoutes reads the Next.js app router, skipping groups and slots', () => {
  const r = findRoutes(['app/page.tsx', 'app/(shop)/orders/page.tsx', 'app/orders/[id]/page.tsx', 'app/@modal/login/page.tsx', 'app/api/x/route.ts', 'app/layout.tsx'])
  assert.equal(r.router, 'next-app')
  assert.deepEqual(r.routes.map(x => [x.route, x.dynamic, x.group]), [['/', false, null], ['/login', false, null], ['/orders', false, '(shop)'], ['/orders/[id]', true, null]])
})

test('findRoutes reads the pages router without API routes or _app', () => {
  const r = findRoutes(['pages/index.tsx', 'pages/about.tsx', 'pages/_app.tsx', 'pages/api/hello.ts', 'pages/blog/[slug].tsx'])
  assert.equal(r.router, 'next-pages')
  assert.deepEqual(r.routes.map(x => x.route), ['/', '/about', '/blog/[slug]'])
})

test('findRoutes reads SvelteKit and Remix', () => {
  assert.deepEqual(findRoutes(['src/routes/+page.svelte', 'src/routes/settings/+page.svelte']).routes.map(x => x.route), ['/', '/settings'])
  const remix = findRoutes(['app/root.tsx', 'app/routes/_index.tsx', 'app/routes/orders.$id.tsx', 'app/routes/about.tsx'])
  assert.equal(remix.router, 'remix')
  assert.deepEqual(remix.routes.map(x => [x.route, x.dynamic]), [['/', false], ['/about', false], ['/orders/$id', true]])
})

test('no known router means no routes; the person names them', () => {
  assert.deepEqual(findRoutes(['src/main.tsx', 'src/App.tsx']), { router: null, routes: [] })
})

import { slug, shotPlan } from '../factory/scripts/capture-screens.mjs'
import { rankCandidates } from '../factory/scripts/find-skills.mjs'
import { addProblems } from '../factory/scripts/stack-skills.mjs'

test('screens are named by route, and a dynamic route waits for a real value', () => {
  assert.equal(slug('/'), 'home')
  assert.equal(slug('/orders/[id]/edit'), 'orders-id-edit')
  const p = shotPlan([{ route: '/', dynamic: false }, { route: '/orders/[id]', dynamic: true }, { route: '/blog/[slug]', dynamic: true }], { '/orders/[id]': '/orders/42' })
  assert.deepEqual(p.shots, [{ route: '/', path: '/', label: 'home' }, { route: '/orders/[id]', path: '/orders/42', label: 'orders-id' }])
  assert.deepEqual(p.skipped.map(s => s.route), ['/blog/[slug]'])
})

test('two routes with the same slug get distinct labels', () => {
  const p = shotPlan([{ route: '/a-b' }, { route: '/a/b' }])
  assert.deepEqual(p.shots.map(s => s.label), ['a-b', 'a-b-2'])
})

test('skills from the stack maker rank first, then stars and freshness; archived ones are dropped', () => {
  const now = '2026-11-19T00:00:00Z'
  const r = rankCandidates([
    { source: 'someone/skills', path: 'skills/nextjs', stars: 5000, pushedAt: '2026-11-01T00:00:00Z', license: 'MIT' },
    { source: 'vercel-labs/agent-skills', path: 'skills/react-best-practices', stars: 800, pushedAt: '2026-10-01T00:00:00Z', license: 'MIT' },
    { source: 'old/thing', path: 'nextjs', stars: 9000, pushedAt: '2023-01-01T00:00:00Z', license: null },
    { source: 'gone/repo', path: 'nextjs', stars: 99999, archived: true },
  ], 'nextjs', now)
  assert.deepEqual(r.map(c => c.source), ['vercel-labs/agent-skills', 'someone/skills', 'old/thing'])
  assert.equal(r[0].official, true)
  assert.ok(r[2].reasons.includes('no licence'))
  assert.ok(r[2].reasons.some(x => /not updated for/.test(x)))
})

test('a skill added by hand needs a name, a repository and the exact commit read', () => {
  assert.deepEqual(addProblems({ name: 'nextjs-guide', source: 'vercel-labs/agent-skills', commit: 'a'.repeat(40), path: 'skills/x' }), [])
  const p = addProblems({ name: 'Bad Name', source: 'nope', commit: 'main', path: '../etc' }).join(' ')
  assert.match(p, /--name/)
  assert.match(p, /owner\/repo/)
  assert.match(p, /40-character commit/)
  assert.match(p, /may not leave/)
})

import { readFileSync } from 'node:fs'
import { skeletonPlan, profileDraft, mcpWithBrowser, PLAYWRIGHT_MCP } from '../factory/scripts/init-skeleton.mjs'
import { checkProfile } from '../factory/scripts/project-check.mjs'

test('the skeleton creates what is missing and keeps what exists, including root docs', () => {
  const existing = new Set(['PRODUCT.md', '.factory/README.md'])
  const plan = skeletonPlan(p => existing.has(p), { designDoc: 'docs/DESIGN.md' })
  const paths = plan.filter(i => !i.kept).map(i => i.path)
  assert.ok(paths.includes('.factory/decisions.md'))
  assert.ok(!paths.includes('.factory/product.md'), 'PRODUCT.md at the root is used instead')
  assert.ok(!paths.includes('.factory/design/DESIGN.md'), 'the existing design doc is used instead')
  assert.deepEqual(plan.filter(i => i.kept).map(i => i.path), ['.factory/README.md'])
  assert.match(plan.find(i => i.path === '.factory/.gitignore').content, /runs\//)
  assert.equal(plan.find(i => i.path === 'CODING_STANDARDS.md'), undefined, 'no template, no file')
  const withStd = skeletonPlan(p => existing.has(p), null, '# Coding standards')
  assert.equal(withStd.find(i => i.path === 'CODING_STANDARDS.md').content, '# Coding standards')
  assert.ok(skeletonPlan(p => p === 'CODING_STANDARDS.md', null, 'x').find(i => i.path === 'CODING_STANDARDS.md').kept, 'an existing file is kept')
})

test('the profile draft carries the scans, points at existing docs, and leaves skills for the person', () => {
  const stack = { isNew: false, hasUi: true, stack: { languages: ['typescript'], frameworks: ['nextjs'] }, commands: { test: 'pnpm test', lint: 'pnpm lint' }, run: { start: 'pnpm dev' } }
  const design = { hasDesign: true, designDoc: null, tokens: [{ kind: 'tailwind-theme', file: 'tailwind.config.ts' }], links: { figma: ['https://www.figma.com/design/x'] } }
  const files = new Set(['CLAUDE.md', 'DECISIONS.md'])
  const d = profileDraft(stack, design, p => files.has(p))
  assert.deepEqual(d.commands, { test: 'pnpm test', lint: 'pnpm lint' })
  assert.deepEqual(d.run, { readyPath: '/', start: 'pnpm dev' })
  assert.equal(d.design.tokens, 'tailwind.config.ts')
  assert.equal(d.design.doc, '.factory/design/DESIGN.md')
  assert.deepEqual(d.design.sources.figma, ['https://www.figma.com/design/x'])
  assert.deepEqual(d.docs, { agents: 'CLAUDE.md', product: '.factory/product.md', decisions: 'DECISIONS.md' })
  assert.deepEqual(d.skills.implementer, [])
  assert.equal(d.browser, 'playwright')
  // With its files and the browser server in place the draft passes the project check.
  const template = readFileSync(new URL('../factory-init/references/coding-standards-template.md', import.meta.url), 'utf8')
  assert.equal(d.standards, 'CODING_STANDARDS.md')
  assert.deepEqual(checkProfile({ ...d, commands: { ...d.commands, format: 'pnpm format:check', typecheck: 'pnpm tsc' } }, () => true, () => true, ['playwright'], () => template), [])
  assert.equal(profileDraft({ ...stack, hasUi: false }, null, () => false).browser, undefined)
})

test('the browser server is added to .mcp.json, pinned and headless, keeping every server already there', () => {
  const merged = mcpWithBrowser({ mcpServers: { github: { command: 'gh-mcp' } }, other: 1 })
  assert.deepEqual(merged.mcpServers.github, { command: 'gh-mcp' })
  assert.equal(merged.other, 1)
  assert.deepEqual(merged.mcpServers.playwright, PLAYWRIGHT_MCP)
  assert.ok(PLAYWRIGHT_MCP.args.some(a => /^@playwright\/mcp@\d+\.\d+\.\d+$/.test(a)), 'pinned to an exact version')
  assert.ok(PLAYWRIGHT_MCP.args.includes('--headless'))
  assert.deepEqual(mcpWithBrowser(null).mcpServers, { playwright: PLAYWRIGHT_MCP })
  assert.equal(mcpWithBrowser({ mcpServers: { playwright: { command: 'mine' } } }), null, 'a server of that name is the person\'s; never replaced')
})
