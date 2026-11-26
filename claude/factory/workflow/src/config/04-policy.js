// Caches that running a project's checks leaves behind. They are never source,
// and a repository without a .gitignore for them would otherwise stop every run
// at the first check, because the agents and the checker run the tests.
const GENERATED = ['**/__pycache__', '*.pyc', '**/.pytest_cache', '**/.mypy_cache', '**/.ruff_cache', '**/.DS_Store']

// Factory workspace artifacts (BA briefs, decisions, plans, mockups, run logs,
// init fingerprints) written by BA/clarify/init steps. They are not source code
// and not check configuration, so they must never block a run as stray or
// protected files.
const FACTORY_ARTIFACTS = [
  '.factory/product.md',
  '.factory/decisions.md',
  '.factory/plans',
  '.factory/runs',
  '.factory/design',
  '.factory/init.json',
]

// An ignore entry is an exact path, a directory (everything beneath it),
// `*.ext` (any file with that ending) or `**/name` (a file or directory of that
// name at any depth).
function matchesIgnore(file, entry) {
  const e = normPath(entry)
  if (!e) return false
  if (e.startsWith('**/')) return file.split('/').includes(e.slice(3))
  if (e.startsWith('*.')) return file.endsWith(e.slice(1))
  return file === e || file.startsWith(`${e}/`)
}

// A path pattern: `**` matches across directories, `*` within one name, and a
// pattern without a slash matches that name at any depth. Case is ignored, so
// `*auth*` also catches `UserAuthGuard.tsx` (and, harmlessly, `Author.tsx`).
function matchesGlob(file, pattern) {
  const f = normPath(file)
  let p = normPath(pattern)
  if (!f || !p) return false
  if (!p.includes('/')) p = `**/${p}`
  const re = p
    .split('**/')
    .map(part => part.split('**').map(s => s.split('*').map(x => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*'))
    .join('(?:.*/)?')
  return new RegExp(`^${re}$`, 'i').test(f)
}

// Files no agent may change unless the caller allows it for this run: the
// checks a run is judged by (CI, test runner, linter and type-checker
// configuration). A run that could edit them could pass by weakening them.
const PROTECTED = [
  '.github/**', '.gitlab-ci.yml', '.circleci/**', 'Jenkinsfile', 'azure-pipelines.yml',
  'vitest.config.*', 'vitest.workspace.*', 'jest.config.*', 'playwright.config.*', 'karma.conf.*', 'cypress.config.*',
  'pytest.ini', 'tox.ini', 'noxfile.py', 'mypy.ini', '.flake8', 'ruff.toml', '.ruff.toml',
  '.eslintrc*', 'eslint.config.*', '.prettierrc*', 'prettier.config.*', 'biome.json', 'biome.jsonc', 'tsconfig*.json',
  'factory/checks.sh', '.factory/project.json', 'CODING_STANDARDS.md',
]

function allowsAllProtected(allowed) {
  if (allowed === true) return true
  if (typeof allowed === 'string') {
    const p = normPath(allowed)
    return p === '*' || p === '**'
  }
  if (Array.isArray(allowed)) {
    return allowed.some(x => x === true || (typeof x === 'string' && (normPath(x) === '*' || normPath(x) === '**')))
  }
  return false
}

function normalizeAllowedPatterns(allowed) {
  if (typeof allowed === 'string') {
    const p = normPath(allowed)
    return p ? [p] : []
  }
  if (Array.isArray(allowed)) {
    return allowed.filter(x => typeof x === 'string').map(normPath).filter(Boolean)
  }
  return []
}

function protectedList(extra, allowed) {
  if (allowsAllProtected(allowed)) return []
  const allow = normalizeAllowedPatterns(allowed)
  return [...PROTECTED, ...(extra || [])].map(normPath).filter(p => p && !allow.includes(p))
}

// The files among `files` that a protected pattern matches. `allowed` lists
// patterns or exact paths the caller lets this run change (or `true` / `**`).
function protectedFiles(files, extra, allowed) {
  if (allowsAllProtected(allowed)) return []
  const patterns = protectedList(extra, allowed)
  const allow = normalizeAllowedPatterns(allowed)
  return (files || []).map(normPath).filter(f => f && !allow.some(a => a === f || matchesGlob(f, a)) && patterns.some(p => matchesGlob(f, p)))
}

// --- Risk -------------------------------------------------------------------
// Kinds of change a person must see before it ships, recognised by path. Code
// uses them twice: to raise the risk the planner rated (a change to auth is
// never `low`), and, once the run passes, to say whether it may be merged
// without a person (`escalation`).
const SENSITIVE = {
  auth: ['**/auth/**', '**/*auth*', '**/*login*', '**/*session*', '**/*permission*', '**/*rbac*', '**/*acl*', '**/*oauth*', '**/*jwt*', '**/*password*'],
  money: ['**/*payment*', '**/*billing*', '**/*invoice*', '**/*stripe*', '**/*checkout*', '**/*pricing*', '**/*subscription*'],
  migration: ['**/migrations/**', '**/migrate/**', '**/*.sql', '**/schema.prisma', '**/alembic/**'],
  dependency: ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'requirements*.txt', 'pyproject.toml', 'poetry.lock', 'uv.lock', 'Pipfile', 'Pipfile.lock', 'go.mod', 'go.sum', 'Cargo.toml', 'Cargo.lock', 'Gemfile', 'Gemfile.lock', 'composer.json', 'composer.lock'],
  ci: ['.github/**', '.gitlab-ci.yml', '.circleci/**', 'Jenkinsfile', 'Dockerfile', '**/Dockerfile', 'docker-compose*.yml', 'compose*.yml', 'vercel.json', 'netlify.toml', 'fly.toml', '**/*.tf', 'Procfile', 'app.yaml'],
}
const UI_FILES = ['*.tsx', '*.jsx', '*.vue', '*.svelte', '*.astro', '*.css', '*.scss', '*.sass', '*.less', '*.html', '*.erb', '*.blade.php']
const RISKS = ['low', 'medium', 'high']
const SURFACES = ['ui', 'security', 'data']

// The sensitive kinds `files` touch, in SENSITIVE's order.
function sensitiveKinds(files) {
  const list = (files || []).map(normPath).filter(Boolean)
  return Object.keys(SENSITIVE).filter(k => list.some(f => SENSITIVE[k].some(p => matchesGlob(f, p))))
}

// The run's risk and surfaces, from what the planner (or the caller) rated,
// raised to what the files the specs own show: code never lets a change to
// auth, money or a migration be `low`. Returns { risk, surfaces, raisedBy }.
function assessRisk(rated, surfaces, specs) {
  const files = (specs || []).flatMap(s => s.filesOwned || [])
  const kinds = sensitiveKinds(files)
  let risk = RISKS.includes(rated) ? rated : 'medium'
  const s = new Set((surfaces || []).filter(x => SURFACES.includes(x)))
  const raisedBy = []
  const raise = (to, why) => {
    if (RISKS.indexOf(to) > RISKS.indexOf(risk)) { risk = to; raisedBy.push(why) }
  }
  if (kinds.includes('auth') || kinds.includes('money')) { s.add('security'); raise('high', `the specs own ${kinds.filter(k => k === 'auth' || k === 'money').join(' and ')} files`) }
  if (kinds.includes('migration')) { s.add('data'); raise('high', 'the specs own a migration') }
  if (kinds.includes('dependency') || kinds.includes('ci')) raise('medium', `the specs own ${kinds.filter(k => k === 'dependency' || k === 'ci').join(' and ')} files`)
  if (files.map(normPath).some(f => UI_FILES.some(p => matchesGlob(f, p)))) s.add('ui')
  return { risk, surfaces: SURFACES.filter(x => s.has(x)), raisedBy }
}

// Whether a passing run may be merged with no person looking, from facts code
// can see. Each reason names what a person must look at; none means it may be
// merged. `escalate` lists the kinds that need a person: by default all of
// auth, money, migration, dependency, ci, high-risk, ui and tests-rewritten.
const ESCALATE = ['auth', 'money', 'migration', 'dependency', 'ci', 'high-risk', 'ui', 'tests-rewritten']
function escalation(changedFiles, assessed, testsChangedInRebuild, escalate) {
  const on = new Set(Array.isArray(escalate) ? escalate : ESCALATE)
  const reasons = []
  const files = (changedFiles || []).map(normPath).filter(Boolean)
  for (const k of sensitiveKinds(files)) {
    if (!on.has(k)) continue
    const which = files.filter(f => SENSITIVE[k].some(p => matchesGlob(f, p)))
    reasons.push(`${k}: ${which.join(', ')}`)
  }
  if (on.has('high-risk') && assessed && assessed.risk === 'high') reasons.push(`high-risk: rated high${assessed.raisedBy && assessed.raisedBy.length ? ` (${assessed.raisedBy.join('; ')})` : ''}`)
  if (on.has('ui') && assessed && assessed.surfaces.includes('ui')) reasons.push('ui: a user will see this change; the person who asked for it should try it')
  if (on.has('tests-rewritten') && (testsChangedInRebuild || []).length > 0) {
    const tests = [...new Set(testsChangedInRebuild.flatMap(t => (typeof t === 'string' ? [t] : t.files || [])))]
    reasons.push(`tests-rewritten: test files changed after the first build (${tests.join(', ')})`)
  }
  return { decision: reasons.length > 0 ? 'person' : 'auto', reasons }
}
