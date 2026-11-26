// Runs the scripts of ui-refine-loop against scratch directories:
// refine-setup.sh detect (config, then package.json, then defaults; both
// Impeccable layouts; loud warnings), the parsing helpers of shoot.mjs, and
// pr-shots.sh. No dev server and no browser are started.
// Run: node --test
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const at = name => fileURLToPath(new URL(`../ui-refine-loop/scripts/${name}`, import.meta.url))
const SETUP = at('refine-setup.sh')
const PR_SHOTS = at('pr-shots.sh')

function scratch(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ui-refine-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (path, body = '') => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), body)
  }
  return { root, put, home: join(root, 'home') }
}

const setup = (cwd, home, ...argv) => spawnSync('bash', [SETUP, ...argv], { cwd, encoding: 'utf8', env: { ...process.env, HOME: home } })
const detect = (cwd, home, ...argv) => {
  const r = setup(cwd, home, 'detect', ...argv)
  assert.equal(r.status, 0, r.stderr)
  return { ...JSON.parse(r.stdout), stderr: r.stderr }
}
const impeccable = (put, dir, version, ...scripts) => {
  put(`${dir}/SKILL.md`, `---\nname: impeccable\nversion: ${version}\n---\n`)
  for (const s of scripts) put(`${dir}/scripts/${s}`)
}

test('detect: a bare app is resolved from package.json and the lockfile', t => {
  const { root, put, home } = scratch(t)
  put('app/package.json', '{"scripts":{"dev":"next dev","typecheck":"tsc --noEmit","lint":"eslint .","test":"jest"}}')
  put('app/pnpm-lock.yaml')
  put('app/.env.local')
  const d = detect(join(root, 'app'), home)
  assert.equal(d.config, null)
  assert.equal(d.packageManager, 'pnpm')
  assert.equal(d.devCommand, 'pnpm run dev --port $PORT')
  assert.deepEqual(d.checks, ['pnpm run typecheck', 'pnpm run lint', 'CI=1 pnpm run test'])
  assert.deepEqual(d.envFiles, ['.env.local'])
  assert.equal(d.authScript, null)
  assert.deepEqual(d.states, [{ name: 'main' }])
  assert.equal(d.rounds, 5)
  assert.equal(d.tasteFile, 'docs/design/taste.md')
  assert.equal(d.tasteExists, false)
})

test('detect: without Impeccable it falls back to the rubric and warns in the JSON and on stderr', t => {
  const { root, put, home } = scratch(t)
  put('app/package.json', '{"scripts":{"dev":"vite"}}')
  const d = detect(join(root, 'app'), home)
  assert.equal(d.critic, 'rubric')
  assert.equal(d.impeccable, null)
  assert.ok(d.warnings.some(w => /Impeccable NOT FOUND/.test(w)))
  assert.match(d.stderr, /!!! ui-refine-loop WARNING: Impeccable NOT FOUND/)
})

test('detect: npm passes the port after --, and a placeholder test script is not a check', t => {
  const { root, put, home } = scratch(t)
  put('vite/package.json', '{"scripts":{"dev":"vite"}}')
  put('cra/package.json', '{"scripts":{"start":"react-scripts start","test":"echo \\"Error: no test specified\\" && exit 1"}}')
  assert.equal(detect(join(root, 'vite'), home).devCommand, 'npm run dev -- --port $PORT')
  const cra = detect(join(root, 'cra'), home)
  assert.equal(cra.devCommand, 'npm run start')
  assert.deepEqual(cra.checks, [])
})

test('detect: .agents/ui-refine-loop.json wins over detection, comments allowed', t => {
  const { root, put, home } = scratch(t)
  impeccable(put, 'home/.gemini/config/skills/impeccable', '4.4.0', 'impeccable')
  put('app/package.json', '{"scripts":{"dev":"next dev","lint":"eslint ."}}')
  put('app/.agents/ui-refine-loop.json', `// a comment line
{"dev_command":"make serve PORT=$PORT","ready_path":"/health","check_commands":["make lint"],
 "auth_script":"scripts/auth.mjs","states":[{"name":"main"},{"name":"empty","query":"?empty=1"}],
 "rounds":6,"taste_file":"design/taste.md","env_files":[".env.test"]}`)
  const d = detect(join(root, 'app'), home)
  assert.equal(d.config, '.agents/ui-refine-loop.json')
  assert.equal(d.devCommand, 'make serve PORT=$PORT')
  assert.equal(d.readyPath, '/health')
  assert.deepEqual(d.checks, ['make lint'])
  assert.equal(d.authScript, 'scripts/auth.mjs')
  assert.equal(d.states.length, 2)
  assert.equal(d.rounds, 6)
  assert.equal(d.tasteFile, 'design/taste.md')
  assert.deepEqual(d.envFiles, ['.env.test'])
  // Impeccable's launcher layout (v4.4+), found under the home directory.
  const imp = join(home, '.gemini/config/skills/impeccable')
  assert.equal(d.critic, 'impeccable')
  assert.deepEqual(d.impeccable, { skillDir: imp, version: '4.4.0', reference: join(imp, 'reference'), layout: 'launcher', detect: `${imp}/scripts/impeccable detect --json`, context: `${imp}/scripts/impeccable context` })
  assert.deepEqual(d.warnings, [])
})

test('detect: --config names another file', t => {
  const { root, put, home } = scratch(t)
  put('app/package.json', '{"scripts":{"dev":"vite"}}')
  put('app/.agents/ui-refine-loop.json', '{"rounds":2}')
  put('app/other.json', '{"rounds":7}')
  assert.equal(detect(join(root, 'app'), home, '--config', 'other.json').rounds, 7)
})

test('detect: Impeccable\'s node layout is found in a parent directory; the launcher wins when both exist', t => {
  const { root, put, home } = scratch(t)
  const imp = join(root, 'mono/.agents/skills/impeccable')
  impeccable(put, 'mono/.agents/skills/impeccable', '4.0.4', 'detect.mjs', 'context.mjs')
  put('mono/projects/app/package.json', '{"scripts":{"dev":"vite"}}')
  const app = join(root, 'mono/projects/app')
  let d = detect(app, home)
  assert.equal(d.critic, 'impeccable')
  assert.equal(d.impeccable.layout, 'node')
  assert.equal(d.impeccable.version, '4.0.4')
  assert.equal(d.impeccable.detect, `node ${imp}/scripts/detect.mjs --json`)
  assert.equal(d.impeccable.context, `node ${imp}/scripts/context.mjs`)
  put('mono/.agents/skills/impeccable/scripts/impeccable')
  assert.equal(detect(app, home).impeccable.layout, 'launcher')
})

test('detect: the impeccable key may name a script file; one that points at nothing warns and the search goes on', t => {
  const { root, put, home } = scratch(t)
  impeccable(put, 'mono/.agents/skills/impeccable', '4.0.4', 'detect.mjs')
  impeccable(put, 'elsewhere/impeccable', '4.0.1', 'detect.mjs')
  const app = join(root, 'mono/app')
  put('mono/app/package.json', '{"scripts":{"dev":"vite"}}')
  put('mono/app/.agents/ui-refine-loop.json', JSON.stringify({ impeccable: join(root, 'elsewhere/impeccable/scripts/detect.mjs') }))
  assert.equal(detect(app, home).impeccable.version, '4.0.1')
  put('mono/app/.agents/ui-refine-loop.json', '{"impeccable":"/nope/impeccable"}')
  const d = detect(app, home)
  assert.ok(d.warnings.some(w => /is not an Impeccable install/.test(w)))
  assert.match(d.stderr, /WARNING: config impeccable/)
  assert.equal(d.impeccable.version, '4.0.4')
})

test('refine-setup.sh: usage errors exit 64', t => {
  const { root, put, home } = scratch(t)
  put('app/package.json', '{"scripts":{"dev":"vite"}}')
  const app = join(root, 'app')
  assert.equal(setup(app, home, 'bogus').status, 64)
  assert.equal(setup(app, home, 'down').status, 64)
  assert.equal(setup(app, home, 'up').status, 64)
  assert.equal(setup(app, home, 'up', '--worktree', '/tmp').status, 64)
})

test('shoot.mjs: states, themes and the names of the before | after pairs', async t => {
  const { root, put } = scratch(t)
  put('states.json', '[{"name":"dense","query":"?n=500"}]')
  const { parseStates, parseThemes, pairNames } = await import(at('shoot.mjs'))
  assert.deepEqual(parseStates(undefined), [{ name: 'main' }])
  assert.deepEqual(parseStates('main,empty'), [{ name: 'main' }, { name: 'empty' }])
  assert.deepEqual(parseStates('[{"name":"x"}]'), [{ name: 'x' }])
  assert.deepEqual(parseStates(join(root, 'states.json')), [{ name: 'dense', query: '?n=500' }])
  assert.deepEqual(parseThemes(), ['light', 'dark'])
  assert.deepEqual(parseThemes('dark'), ['dark'])
  assert.throws(() => parseThemes('sepia'), /unknown theme/)
  assert.deepEqual(pairNames('/r/round-3-main-mobile-dark.png', 'round-3', 'round-0'), { before: '/r/round-0-main-mobile-dark.png', sheet: '/r/cmp-round-3-main-mobile-dark.png' })
  assert.equal(spawnSync('node', [at('shoot.mjs')], { encoding: 'utf8' }).status, 1)
})

test('pr-shots.sh: commits the shots to the branch and prints a table of links pinned to the commit', t => {
  const { root, put } = scratch(t)
  const repo = join(root, 'g')
  const runDir = join(root, 'g.run')
  mkdirSync(repo)
  const git = (...argv) => {
    const r = spawnSync('git', ['-C', repo, ...argv], { encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    return r.stdout.trim()
  }
  git('init', '-q')
  for (const [k, v] of [['user.email', 't@t'], ['user.name', 't'], ['commit.gpgsign', 'false']]) git('config', k, v)
  git('commit', '-q', '--allow-empty', '-m', 'init')
  git('remote', 'add', 'origin', 'git@github.com:acme/app.git')
  for (const label of ['round-0', 'round-2']) for (const v of ['desktop', 'mobile']) for (const th of ['light', 'dark']) put(`g.run/shots/${label}-main-${v}-${th}.png`, 'x')
  put('g.run/base', git('rev-parse', 'HEAD'))
  const base = git('rev-parse', '--short', 'HEAD')
  const shots = (...extra) => spawnSync('bash', [PR_SHOTS, '--worktree', repo, '--run', runDir, '--slug', 'reports', '--final', 'round-2', ...extra], { encoding: 'utf8' })

  const r = shots()
  assert.equal(r.status, 0, r.stderr)
  const sha = git('rev-parse', 'HEAD')
  assert.equal(git('log', '-1', '--format=%s'), '[ui] reports: before/after screenshots')
  assert.equal(git('ls-files', 'docs/ui-refine/reports').split('\n').length, 8)
  assert.ok(r.stdout.includes(`| | Before \`${base}\` | After \`${base}\` (round-2) |`))
  assert.ok(r.stdout.includes(`https://github.com/acme/app/raw/${sha}/docs/ui-refine/reports/before-desktop-light.png`))
  assert.ok(r.stdout.includes('| Mobile 390 · dark |'))
  assert.doesNotMatch(r.stdout, /imgur|postimg|imgbb/i)

  // Printed again without committing: the code the shots show is the commit before them.
  rmSync(join(runDir, 'shots/round-2-main-mobile-dark.png'))
  rmSync(join(repo, 'docs/ui-refine/reports/after-mobile-dark.png'))
  const again = shots('--no-commit')
  assert.ok(again.stdout.includes('not shot'))
  assert.ok(again.stdout.includes(`After \`${base}\``))
  assert.ok(existsSync(join(repo, 'docs/ui-refine/reports/before-mobile-dark.png')))

  assert.equal(spawnSync('bash', [PR_SHOTS, '--worktree', repo], { encoding: 'utf8' }).status, 64)
  git('remote', 'set-url', 'origin', 'https://gitlab.com/acme/app.git')
  assert.equal(shots('--no-commit').status, 70)
})
