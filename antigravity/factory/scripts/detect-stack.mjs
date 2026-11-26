#!/usr/bin/env node
// What a repository runs on, read from its files, so factory-init
// starts from facts instead of asking what the code already says.
//
//   node detect-stack.mjs <repo> [--json]
//
// Prints a draft of the `stack`, `commands` and `run` parts of
// .factory/project.json, plus `isNew` (no product code yet) and `hasUi`.
// Everything it prints is a guess for a person to confirm: it reads manifests
// and file names, it runs nothing. The pure function `detectStack` is tested
// in tests/detect-stack.test.mjs.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte|astro|py|go|rs|rb|php|java|kt|swift|cs|dart)$/
const UI = /\.(tsx|jsx|vue|svelte|astro|html|css|scss|erb|blade\.php)$/
const NOT_PRODUCT = /(^|\/)(node_modules|\.git|\.factory|\.agents|\.gemini|\.github|dist|build|coverage|\.next|vendor|docs)\//
const CONFIG_ONLY = /(^|\/)[^/]*\.config\.[a-z]+$|(^|\/)(eslint|prettier|vite|vitest|jest|tailwind|postcss|next|nuxt|svelte|astro|playwright)\.[^/]*$/

const FRAMEWORKS = [
  ['next', 'nextjs'], ['nuxt', 'nuxt'], ['@remix-run/react', 'remix'], ['@sveltejs/kit', 'sveltekit'], ['astro', 'astro'],
  ['react', 'react'], ['vue', 'vue'], ['svelte', 'svelte'], ['@angular/core', 'angular'], ['solid-js', 'solid'],
  ['express', 'express'], ['fastify', 'fastify'], ['@nestjs/core', 'nestjs'], ['hono', 'hono'],
  ['prisma', 'prisma'], ['@prisma/client', 'prisma'], ['drizzle-orm', 'drizzle'], ['@supabase/supabase-js', 'supabase'], ['firebase', 'firebase'],
  ['tailwindcss', 'tailwind'], ['@mui/material', 'mui'], ['@chakra-ui/react', 'chakra'], ['react-native', 'react-native'], ['expo', 'expo'],
]
const PY_FRAMEWORKS = [['django', 'django'], ['fastapi', 'fastapi'], ['flask', 'flask'], ['sqlalchemy', 'sqlalchemy'], ['pydantic', 'pydantic']]

function packageManager(files) {
  if (files.includes('pnpm-lock.yaml')) return 'pnpm'
  if (files.includes('yarn.lock')) return 'yarn'
  if (files.includes('bun.lockb') || files.includes('bun.lock')) return 'bun'
  if (files.includes('package-lock.json') || files.includes('package.json')) return 'npm'
  if (files.includes('uv.lock')) return 'uv'
  if (files.includes('poetry.lock')) return 'poetry'
  if (files.some(f => /^requirements.*\.txt$/.test(f)) || files.includes('pyproject.toml')) return 'pip'
  return null
}

// files: repository paths; pkg: parsed package.json or null; pyproject: its text or ''.
export function detectStack({ files = [], pkg = null, pyproject = '', goMod = '', cargo = '' }) {
  const top = files.filter(f => !f.includes('/'))
  const product = files.filter(f => CODE.test(f) && !NOT_PRODUCT.test(f) && !CONFIG_ONLY.test(f) && !/(^|\/)(tests?|__tests__|spec)\//.test(f) && !/\.(test|spec)\.[a-z]+$/.test(f))
  const deps = pkg ? { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) } : {}
  const has = name => Object.prototype.hasOwnProperty.call(deps, name)
  const scripts = (pkg && pkg.scripts) || {}

  const languages = new Set()
  if (files.some(f => /\.(ts|tsx)$/.test(f)) || has('typescript')) languages.add('typescript')
  else if (pkg || files.some(f => /\.(js|jsx|mjs)$/.test(f))) languages.add('javascript')
  if (pyproject || files.some(f => /\.py$/.test(f))) languages.add('python')
  if (goMod || files.some(f => /\.go$/.test(f))) languages.add('go')
  if (cargo || files.some(f => /\.rs$/.test(f))) languages.add('rust')

  const frameworks = new Set()
  for (const [dep, name] of FRAMEWORKS) if (has(dep)) frameworks.add(name)
  const py = pyproject.toLowerCase() + ' ' + files.filter(f => /^requirements.*\.txt$/.test(f)).join(' ')
  for (const [dep, name] of PY_FRAMEWORKS) if (py.includes(dep)) frameworks.add(name)
  if (frameworks.has('nextjs') || frameworks.has('remix')) frameworks.add('react')
  if (frameworks.has('nuxt')) frameworks.add('vue')
  if (frameworks.has('sveltekit')) frameworks.add('svelte')

  const tests = new Set()
  if (has('vitest')) tests.add('vitest')
  if (has('jest')) tests.add('jest')
  if (has('@playwright/test')) tests.add('playwright')
  if (has('cypress')) tests.add('cypress')
  if (py.includes('pytest') || files.some(f => /(^|\/)(pytest\.ini|conftest\.py)$/.test(f))) tests.add('pytest')
  if (goMod) tests.add('go-test')
  if (cargo) tests.add('cargo-test')

  const linters = new Set()
  if (has('eslint') || files.some(f => /(^|\/)(\.eslintrc[^/]*|eslint\.config\.[a-z]+)$/.test(f))) linters.add('eslint')
  if (has('prettier')) linters.add('prettier')
  if (has('@biomejs/biome')) linters.add('biome')
  if (py.includes('ruff') || files.includes('ruff.toml')) linters.add('ruff')
  if (py.includes('mypy') || files.includes('mypy.ini')) linters.add('mypy')

  const ci = []
  if (files.some(f => f.startsWith('.github/workflows/'))) ci.push('github-actions')
  if (files.includes('.gitlab-ci.yml')) ci.push('gitlab-ci')

  const pm = packageManager(top)
  const run = cmd => (pm === 'npm' ? (cmd === 'test' ? 'npm test' : `npm run ${cmd}`) : `${pm} ${cmd}`)
  const commands = {}
  if (pkg) {
    if (pm) commands.install = { pnpm: 'pnpm install --frozen-lockfile', yarn: 'yarn install --frozen-lockfile', bun: 'bun install --frozen-lockfile', npm: 'npm ci' }[pm]
    for (const name of ['test', 'lint', 'typecheck', 'build']) if (scripts[name]) commands[name] = run(name)
    if (!commands.typecheck && languages.has('typescript')) commands.typecheck = `${pm === 'npm' ? 'npx' : pm === 'pnpm' ? 'pnpm exec' : pm} tsc --noEmit`
    const exec = pm === 'npm' ? 'npx' : pm === 'pnpm' ? 'pnpm exec' : pm
    if (tests.has('vitest')) commands.testFile = `${exec} vitest run {files}`
    else if (tests.has('jest')) commands.testFile = `${exec} jest {files}`
    const e2e = Object.keys(scripts).find(s => /^(e2e|test:e2e)$/.test(s))
    if (e2e) commands.e2e = run(e2e)
  }
  if (languages.has('python')) {
    if (tests.has('pytest')) { commands.test = commands.test || 'python -m pytest -q'; commands.testFile = commands.testFile || 'python -m pytest -q {files}' }
    if (linters.has('ruff')) commands.lint = commands.lint || 'ruff check .'
    if (linters.has('mypy')) commands.typecheck = commands.typecheck || 'mypy .'
  }
  if (goMod) Object.assign(commands, { test: commands.test || 'go test ./...', build: commands.build || 'go build ./...', lint: commands.lint || 'go vet ./...' })
  if (cargo) Object.assign(commands, { test: commands.test || 'cargo test', build: commands.build || 'cargo build', lint: commands.lint || 'cargo clippy -- -D warnings' })

  const runInfo = {}
  const dev = ['dev', 'start', 'serve'].find(s => scripts[s])
  if (dev) runInfo.start = run(dev)
  if (files.some(f => /^\.env\.(example|sample|template)$/.test(f))) runInfo.env = files.find(f => /^\.env\.(example|sample|template)$/.test(f))
  const seed = Object.keys(scripts).find(s => /seed/.test(s))
  if (seed) runInfo.seed = run(seed)

  return {
    isNew: product.length === 0,
    hasUi: product.some(f => UI.test(f)) || ['react', 'vue', 'svelte', 'angular', 'solid', 'react-native'].some(f => frameworks.has(f)),
    stack: { languages: [...languages], frameworks: [...frameworks], packageManager: pm, tests: [...tests], linters: [...linters], ci },
    commands,
    run: runInfo,
    productFiles: product.length,
  }
}

function listFiles(repo) {
  try {
    return execFileSync('git', ['-C', repo, 'ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\n').filter(Boolean)
  } catch {
    const out = []
    const walk = dir => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === '.git') continue
        const p = join(dir, name)
        if (statSync(p).isDirectory()) walk(p)
        else out.push(relative(repo, p))
        if (out.length > 20000) return
      }
    }
    walk(repo)
    return out
  }
}

function main(argv) {
  const repo = argv.find(a => !a.startsWith('--'))
  if (!repo || !existsSync(repo)) {
    console.error('usage: detect-stack.mjs <repo> [--json]')
    return 2
  }
  const read = f => (existsSync(join(repo, f)) ? readFileSync(join(repo, f), 'utf8') : '')
  let pkg = null
  try { pkg = read('package.json') ? JSON.parse(read('package.json')) : null } catch {}
  const result = detectStack({ files: listFiles(repo), pkg, pyproject: read('pyproject.toml'), goMod: read('go.mod'), cargo: read('Cargo.toml') })
  console.log(JSON.stringify(result, null, 2))
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exit(main(process.argv.slice(2)))
