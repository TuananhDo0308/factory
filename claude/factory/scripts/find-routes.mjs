#!/usr/bin/env node
// The pages of an app, read from its file-system router, so factory-init can
// screenshot every screen that exists. Covers Next.js (app and pages routers),
// SvelteKit, Nuxt, Remix, Astro and a plain `pages`/`routes` folder.
//
//   node find-routes.mjs <repo>
//
// Prints JSON: { router, routes: [{ route, file, dynamic, group }] }. A dynamic
// route ([id], $id, :id) needs a real value before it can be opened: the
// person or the seed data supplies one. It reads file names only.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const ROUTERS = [
  { name: 'next-app', page: /^(?:src\/)?app\/(.*?)\/?page\.(tsx|ts|jsx|js|mdx)$/ },
  { name: 'next-pages', page: /^(?:src\/)?pages\/(?!api\/|_)(.*?)\.(tsx|ts|jsx|js|mdx)$/ },
  { name: 'sveltekit', page: /^src\/routes\/(.*?)\/?\+page\.svelte$/ },
  { name: 'nuxt', page: /^(?:app\/)?pages\/(.*?)\.vue$/ },
  { name: 'remix', page: /^app\/routes\/(.*?)\.(tsx|ts|jsx|js)$/ },
  { name: 'astro', page: /^src\/pages\/(.*?)\.(astro|md|mdx)$/ },
]

function toRoute(router, raw) {
  let parts = raw.split('/').filter(Boolean)
  if (router === 'remix') parts = raw.replace(/\.(tsx|ts|jsx|js)$/, '').split('.').filter(p => p !== '_index' && p !== 'route')
  const group = parts.find(p => /^\(.+\)$/.test(p)) || null
  parts = parts
    .filter(p => !/^\(.+\)$/.test(p) && !p.startsWith('@')) // route groups and parallel slots
    .map(p => p.replace(/^_/, ''))
  if (router === 'next-pages' || router === 'nuxt' || router === 'astro') parts = parts.filter((p, i, a) => !(i === a.length - 1 && p === 'index'))
  const route = '/' + parts.join('/')
  const dynamic = parts.some(p => /^\[.+\]$|^\$|^:/.test(p))
  return { route: route === '/' ? '/' : route.replace(/\/$/, ''), dynamic, group }
}

export function findRoutes(files) {
  for (const { name, page } of ROUTERS) {
    const hits = files.map(f => [f, f.match(page)]).filter(([, m]) => m)
    if (hits.length === 0) continue
    if (name === 'remix' && !files.some(f => /^app\/root\.(tsx|jsx|ts|js)$/.test(f))) continue
    if (name === 'nuxt' && !files.some(f => /^nuxt\.config\./.test(f))) continue
    const seen = new Map()
    for (const [file, m] of hits) {
      const r = toRoute(name, m[1])
      if (!seen.has(r.route)) seen.set(r.route, { ...r, file })
    }
    const routes = [...seen.values()].sort((a, b) => a.route.localeCompare(b.route))
    return { router: name, routes }
  }
  return { router: null, routes: [] }
}

function main(argv) {
  const repo = argv.find(a => !a.startsWith('--'))
  if (!repo || !existsSync(repo)) { console.error('usage: find-routes.mjs <repo>'); return 2 }
  const files = execFileSync('git', ['-C', repo, 'ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\n').filter(Boolean)
  console.log(JSON.stringify(findRoutes(files), null, 2))
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exit(main(process.argv.slice(2)))
