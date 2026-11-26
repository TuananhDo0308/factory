#!/usr/bin/env node
// Screenshots every screen an app already has into the project's UI store,
// so a project with no design files still has a picture of how it looks today:
// what new features must match, and what the factory compares against.
//
//   node capture-screens.mjs --repo <repo> --routes <find-routes.json>
//     [--values '{"/orders/[id]": "/orders/1"}']   real paths for dynamic routes
//     [--start "pnpm dev --port $PORT" --port 4317 --ready /]   or --base http://localhost:3000
//     [--auth scripts/test-login.mjs] [--env .env.local] [--themes light,dark]
//     [--out .factory/design/ui-store/screens]
//
// Each route is shot by ui-refine-loop's shoot.mjs at 1440 and 390 wide, in
// each theme, as <slug>-main-<viewport>-<theme>.png, and an index.json lists
// what was taken and what was skipped (a dynamic route with no value, a route
// that failed). Playwright must resolve from the repository. The pure
// functions are tested in tests/init.test.mjs.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export function slug(route) {
  const s = route.replace(/^\/+|\/+$/g, '').replace(/[\[\]$:]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()
  return s || 'home'
}

// routes: find-routes output; values: { route: real path } for dynamic ones.
export function shotPlan(routes, values = {}) {
  const shots = []
  const skipped = []
  for (const r of routes) {
    if (r.dynamic && !values[r.route]) { skipped.push({ route: r.route, reason: 'dynamic route with no real value; pass one in --values' }); continue }
    const path = r.dynamic ? values[r.route] : r.route
    shots.push({ route: r.route, path, label: slug(r.route) })
  }
  const labels = new Set()
  for (const s of shots) {
    let l = s.label
    for (let i = 2; labels.has(l); i++) l = `${s.label}-${i}`
    labels.add(l)
    s.label = l
  }
  return { shots, skipped }
}

const here = dirname(fileURLToPath(import.meta.url))

async function waitFor(url, seconds) {
  for (let i = 0; i < seconds; i++) {
    try {
      const res = await fetch(url)
      if (res.status < 500) return true
    } catch {}
    await new Promise(r => setTimeout(r, 1000))
  }
  return false
}

async function main(argv) {
  const opt = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined }
  const repo = resolve(opt('--repo') || '.')
  const routesFile = opt('--routes')
  if (!routesFile || !existsSync(routesFile)) { console.error('capture-screens: --routes <find-routes.json> is required'); return 2 }
  const shoot = join(here, '..', '..', 'ui-refine-loop', 'scripts', 'shoot.mjs')
  if (!existsSync(shoot)) { console.error(`capture-screens: ${shoot} is missing; install the ui-refine-loop skill next to factory`); return 2 }
  const { routes } = JSON.parse(readFileSync(routesFile, 'utf8'))
  const { shots, skipped } = shotPlan(routes, opt('--values') ? JSON.parse(opt('--values')) : {})
  const out = resolve(repo, opt('--out') || '.factory/design/ui-store/screens')
  mkdirSync(out, { recursive: true })

  let server = null
  let base = opt('--base')
  if (!base) {
    const start = opt('--start')
    if (!start) { console.error('capture-screens: give --base of a running app, or --start with --port'); return 2 }
    const port = opt('--port') || '4317'
    base = `http://localhost:${port}`
    server = spawn(start.replace(/\$PORT/g, port), { cwd: repo, shell: true, env: { ...process.env, PORT: port }, stdio: 'ignore', detached: true })
    if (!(await waitFor(base + (opt('--ready') || '/'), 180))) {
      try { process.kill(-server.pid) } catch {}
      console.error(`capture-screens: ${base} did not answer within 180 s`)
      return 1
    }
  }

  const index = { base: 'see .factory/project.json run.start', commit: '', screens: [], skipped }
  try { index.commit = execFileSync('git', ['-C', repo, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim() } catch {}
  try {
    for (const s of shots) {
      const args = [shoot, '--base', base, '--route', s.path, '--out', out, '--label', s.label, '--sections', 'none', '--themes', opt('--themes') || 'light,dark']
      if (opt('--auth')) args.push('--auth', resolve(repo, opt('--auth')))
      if (opt('--env')) args.push('--env', resolve(repo, opt('--env')))
      try {
        const printed = execFileSync('node', args, { cwd: repo, encoding: 'utf8', timeout: 180000 })
        const files = printed.split('\n').map(l => l.trim()).filter(l => l.endsWith('.png')).map(f => relative(repo, resolve(repo, f)))
        index.screens.push({ route: s.route, path: s.path, label: s.label, files })
        console.log(`shot     ${s.route} (${files.length} image(s))`)
      } catch (e) {
        index.skipped.push({ route: s.route, reason: `shoot failed: ${String(e.stderr || e.message).split('\n')[0]}` })
        console.log(`skipped  ${s.route}: shoot failed`)
      }
    }
  } finally {
    if (server) try { process.kill(-server.pid) } catch {}
  }
  writeFileSync(join(out, 'index.json'), JSON.stringify(index, null, 2) + '\n')
  for (const s of index.skipped) console.log(`skipped  ${s.route}: ${s.reason}`)
  console.log(`index    ${relative(repo, join(out, 'index.json'))}`)
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main(process.argv.slice(2)).then(code => process.exit(code))
