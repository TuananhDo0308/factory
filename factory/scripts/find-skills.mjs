#!/usr/bin/env node
// Candidate skills for a stack, found on GitHub and ranked, for a person to
// choose from. It installs nothing: a skill becomes part of every prompt that
// loads it, so a person reads it and approves it first, and it is installed at
// the commit they read (stack-skills.mjs add).
//
//   node find-skills.mjs --stack nextjs [--limit 5]
//
// Prints JSON: { stack, catalog: [...vetted entries], candidates: [{ source,
// path, commit, stars, pushedAt, license, official, score, reasons }] }.
// Needs `gh`, logged in. The pure function `rankCandidates` is tested in
// tests/init.test.mjs.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Organisations whose skill for a stack counts as its maker's own.
export const OFFICIAL = {
  nextjs: ['vercel', 'vercel-labs'], react: ['facebook', 'reactjs', 'vercel-labs'], vue: ['vuejs'], nuxt: ['nuxt'],
  svelte: ['sveltejs'], sveltekit: ['sveltejs'], angular: ['angular'], tailwind: ['tailwindlabs'], prisma: ['prisma'],
  drizzle: ['drizzle-team'], supabase: ['supabase', 'supabase-community'], firebase: ['firebase'], expo: ['expo'],
  'react-native': ['facebook', 'expo'], nestjs: ['nestjs'], django: ['django'], fastapi: ['fastapi', 'tiangolo'],
  playwright: ['microsoft', 'currents-dev'], vitest: ['vitest-dev', 'antfu'], stripe: ['stripe'], remix: ['remix-run'],
}
const ALWAYS = ['anthropics'] // Anthropic's own skills

// cands: [{ source: 'owner/repo', path, stars, pushedAt, license, archived }]
// now: the time to measure age against, as an ISO string (passed in, so tests are stable).
export function rankCandidates(cands, stack, now) {
  const official = [...(OFFICIAL[stack] || []), ...ALWAYS]
  const nowMs = Date.parse(now)
  return cands
    .filter(c => !c.archived)
    .map(c => {
      const owner = c.source.split('/')[0].toLowerCase()
      const reasons = []
      let score = 0
      const isOfficial = official.includes(owner)
      if (isOfficial) { score += 100; reasons.push(`from ${owner}, the stack's maker or Anthropic`) }
      const stars = c.stars || 0
      score += Math.min(40, Math.round(Math.log10(stars + 1) * 10))
      reasons.push(`${stars} stars`)
      const days = c.pushedAt ? Math.round((nowMs - Date.parse(c.pushedAt)) / 86400000) : null
      if (days !== null && days <= 90) { score += 20; reasons.push(`updated ${days} days ago`) }
      else if (days !== null && days <= 365) { score += 10; reasons.push(`updated ${days} days ago`) }
      else reasons.push(days === null ? 'last update unknown' : `not updated for ${days} days`)
      if (c.license) { score += 5; reasons.push(`licence ${c.license}`) } else reasons.push('no licence')
      const nameHit = new RegExp(stack.replace(/[^a-z0-9]/gi, '.?'), 'i').test(c.path)
      if (nameHit) { score += 10; reasons.push('the skill is named for the stack') }
      return { ...c, official: isOfficial, score, reasons }
    })
    .sort((a, b) => b.score - a.score || (b.stars || 0) - (a.stars || 0))
}

const here = dirname(fileURLToPath(import.meta.url))
const gh = args => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

function main(argv) {
  const opt = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined }
  const stack = (opt('--stack') || '').toLowerCase()
  if (!stack) { console.error('usage: find-skills.mjs --stack <name> [--limit 5]'); return 2 }
  const limit = Number(opt('--limit') || 5)
  const catalog = JSON.parse(readFileSync(join(here, '..', 'catalog', 'stack-skills.json'), 'utf8'))
  let hits = []
  try {
    hits = JSON.parse(gh(['search', 'code', stack, '--filename', 'SKILL.md', '--limit', '60', '--json', 'repository,path']))
  } catch (e) {
    console.error(`find-skills: GitHub search failed (${String(e.stderr || e.message).split('\n')[0]}). Is gh logged in?`)
    return 1
  }
  // The stack maker's and Anthropic's own repositories are searched by name too,
  // so a skill they publish is never crowded out of the general results.
  for (const owner of [...(OFFICIAL[stack] || []), ...ALWAYS]) {
    try { hits.push(...JSON.parse(gh(['search', 'code', stack, '--owner', owner, '--filename', 'SKILL.md', '--limit', '10', '--json', 'repository,path']))) } catch {}
  }
  const byRepo = new Map()
  for (const h of hits) {
    const source = h.repository.nameWithOwner || h.repository.fullName
    const path = h.path.replace(/\/?SKILL\.md$/, '') || '.'
    if (!byRepo.has(source)) byRepo.set(source, [])
    if (!byRepo.get(source).includes(path)) byRepo.get(source).push(path)
  }
  // Metadata costs two API calls a repository: look up the official ones and
  // the repositories with the most matching skills, at most 20.
  const official = new Set([...(OFFICIAL[stack] || []), ...ALWAYS])
  const repos = [...byRepo.entries()]
    .sort((a, b) => Number(official.has(b[0].split('/')[0].toLowerCase())) - Number(official.has(a[0].split('/')[0].toLowerCase())) || b[1].length - a[1].length)
    .slice(0, 20)
  const cands = []
  for (const [source, paths] of repos) {
    let meta = {}
    try { meta = JSON.parse(gh(['api', `repos/${source}`, '--jq', '{stars: .stargazers_count, pushedAt: .pushed_at, license: .license.spdx_id, archived: .archived, branch: .default_branch}'])) } catch { continue }
    let commit = ''
    try { commit = gh(['api', `repos/${source}/commits/${meta.branch}`, '--jq', '.sha']).trim() } catch {}
    for (const path of paths) cands.push({ source, path, commit, stars: meta.stars, pushedAt: meta.pushedAt, license: meta.license && meta.license !== 'NOASSERTION' ? meta.license : null, archived: meta.archived })
  }
  // At most two skills from one repository, so one large repository does not
  // fill the list. A framework's own repository may hold skills for developing
  // the framework itself: the person reads each description before choosing.
  const perSource = new Map()
  const ranked = rankCandidates(cands, stack, new Date().toISOString())
    .filter(c => { const n = (perSource.get(c.source) || 0) + 1; perSource.set(c.source, n); return n <= 2 })
    .slice(0, limit)
  console.log(JSON.stringify({ stack, catalog: catalog.stacks[stack] || [], candidates: ranked }, null, 2))
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exit(main(process.argv.slice(2)))
