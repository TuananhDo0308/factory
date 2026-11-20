// Tests for the project setup scripts: detect-stack, stack-skills and
// project-check. Run: node --test tests/
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { detectStack } from '../factory/scripts/detect-stack.mjs'
import { planSkills } from '../factory/scripts/stack-skills.mjs'
import { checkProfile, contractPart } from '../factory/scripts/project-check.mjs'

const catalog = JSON.parse(readFileSync(new URL('../factory/catalog/stack-skills.json', import.meta.url), 'utf8'))

test('an empty repository, or one with only docs and config, is new', () => {
  assert.equal(detectStack({ files: ['README.md', '.gitignore'] }).isNew, true)
  assert.equal(detectStack({ files: ['README.md', 'docs/index.ts', 'vite.config.ts', 'eslint.config.mjs'] }).isNew, true)
  assert.equal(detectStack({ files: ['src/app.ts'] }).isNew, false)
  assert.equal(detectStack({ files: ['src/app.test.ts', 'tests/x.ts'] }).isNew, true, 'tests alone are not a product')
})

test('a Next.js app is read from its manifest: frameworks, tests, commands, how to run', () => {
  const pkg = {
    scripts: { dev: 'next dev', build: 'next build', test: 'vitest run', lint: 'next lint', 'test:e2e': 'playwright test', 'db:seed': 'tsx seed.ts' },
    dependencies: { next: '15.0.0', react: '19.0.0', '@prisma/client': '6', tailwindcss: '4' },
    devDependencies: { vitest: '3', '@playwright/test': '1', typescript: '5', eslint: '9' },
  }
  const r = detectStack({ files: ['package.json', 'pnpm-lock.yaml', 'app/page.tsx', '.env.example', '.github/workflows/ci.yml'], pkg })
  assert.equal(r.isNew, false)
  assert.equal(r.hasUi, true)
  assert.deepEqual(r.stack.languages, ['typescript'])
  assert.deepEqual(r.stack.frameworks.sort(), ['nextjs', 'prisma', 'react', 'tailwind'])
  assert.deepEqual(r.stack.tests.sort(), ['playwright', 'vitest'])
  assert.equal(r.stack.packageManager, 'pnpm')
  assert.deepEqual(r.stack.ci, ['github-actions'])
  assert.deepEqual(r.commands, { install: 'pnpm install --frozen-lockfile', test: 'pnpm test', lint: 'pnpm lint', build: 'pnpm build', typecheck: 'pnpm exec tsc --noEmit', testFile: 'pnpm exec vitest run {files}', e2e: 'pnpm test:e2e' })
  assert.deepEqual(r.run, { start: 'pnpm dev', env: '.env.example', seed: 'pnpm db:seed' })
})

test('a Python service is read from pyproject', () => {
  const r = detectStack({ files: ['pyproject.toml', 'app/main.py', 'tests/test_main.py'], pyproject: '[project]\ndependencies = ["fastapi", "sqlalchemy"]\n[tool.ruff]\n[dependency-groups]\ndev = ["pytest", "mypy"]' })
  assert.deepEqual(r.stack.languages, ['python'])
  assert.deepEqual(r.stack.frameworks.sort(), ['fastapi', 'sqlalchemy'])
  assert.equal(r.commands.test, 'python -m pytest -q')
  assert.equal(r.commands.lint, 'ruff check .')
  assert.equal(r.hasUi, false)
})

test('stack skills come from the catalog only, per role, without repeats', () => {
  const p = planSkills(catalog, ['nextjs', 'vitest', 'playwright', 'web-ui', 'rails'])
  assert.deepEqual(p.roles.implementer, ['vitest', 'playwright-best-practices'])
  assert.deepEqual(p.roles.qc, ['playwright-best-practices'])
  assert.deepEqual(p.install.map(i => i.name), ['vitest', 'playwright-best-practices'])
  assert.equal(p.install[0].path, 'skills/vitest')
  assert.equal(p.install[1].path, 'playwright-best-practices')
  assert.deepEqual(p.unvetted, ['nextjs'])
  assert.deepEqual(p.unknown, ['rails'])
})

test('every catalog skill names a source with a pinned commit', () => {
  for (const [stack, entries] of Object.entries(catalog.stacks)) {
    for (const e of entries) {
      assert.ok(catalog.sources[e.source], `${stack}: ${e.name} names an unknown source`)
      assert.match(catalog.sources[e.source].commit, /^[0-9a-f]{40}$/)
    }
  }
})

const profile = {
  stack: { languages: ['typescript'], frameworks: ['nextjs'], adr: 'docs/adr/0001-stack.md' },
  commands: { install: 'pnpm i', test: 'pnpm test', lint: 'pnpm lint', tokens: 'pnpm lint:tokens' },
  run: { start: 'pnpm dev --port $PORT', readyPath: '/', env: '.env.example', auth: 'scripts/test-login.ts', seed: 'pnpm db:seed' },
  skills: { implementer: ['vitest'], qc: ['playwright-best-practices'] },
  design: { doc: 'DESIGN.md', tokens: 'src/styles/tokens.css', uiStore: 'docs/ui', mockups: 'docs/mockups' },
  docs: { agents: 'CLAUDE.md', decisions: 'DECISIONS.md' },
  escalate: ['auth', 'ui'],
}
const all = () => true

test('a complete profile has no problems', () => {
  assert.deepEqual(checkProfile(profile, all, all), [])
})

test('missing files, commands, skills and run steps are each named', () => {
  const p = checkProfile({ ...profile, commands: { lint: 'pnpm lint', build: '' }, run: {}, escalate: ['moon'] }, f => f !== 'DESIGN.md', n => n !== 'vitest')
  const text = p.join('\n')
  assert.match(text, /commands\.build is empty/)
  assert.match(text, /commands\.test is missing/)
  assert.match(text, /run\.start is missing/)
  assert.match(text, /design\.doc names DESIGN\.md, which does not exist/)
  assert.match(text, /skills\.implementer: vitest is not installed/)
  assert.match(text, /escalate: moon/)
  assert.match(checkProfile(null, all, all)[0], /Run \/factory-init/)
})

test('the profile gives a run its checks, how to run it, its design pointers and its args', () => {
  const c = contractPart(profile)
  assert.deepEqual(c.checks, [{ name: 'test', command: 'pnpm test' }, { name: 'lint', command: 'pnpm lint' }, { name: 'tokens', command: 'pnpm lint:tokens' }])
  assert.match(c.run, /Start: pnpm dev --port \$PORT/)
  assert.match(c.run, /Sign in as the test user with scripts\/test-login\.ts/)
  assert.deepEqual(c.design, { doc: 'DESIGN.md', tokens: 'src/styles/tokens.css', uiStore: 'docs/ui', screens: [], baseline: [], reuse: [] })
  assert.equal(c.testFileCommand, undefined)
  const more = contractPart({ ...profile, commands: { ...profile.commands, testFile: 'pnpm vitest run {files}', migrate: 'pnpm db:up', rollback: 'pnpm db:down' } })
  assert.equal(more.testFileCommand, 'pnpm vitest run {files}')
  assert.deepEqual(more.migration, { up: 'pnpm db:up', down: 'pnpm db:down' })
  assert.deepEqual(c.args.projectStack, profile.stack)
  const bad = checkProfile({ ...profile, commands: { ...profile.commands, testFile: 'pnpm vitest', migrate: 'x' } }, all, all).join(' ')
  assert.match(bad, /testFile must contain \{files\}/)
  assert.match(bad, /migrate and commands\.rollback go together/)
  assert.deepEqual(c.args.projectSkills, profile.skills)
  assert.deepEqual(c.args.escalate, ['auth', 'ui'])
})
