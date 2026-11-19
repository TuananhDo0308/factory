#!/usr/bin/env node
// Picks the next issue the dispatcher may build, and refuses the ones it may
// not, so the GitHub Action only decides when to run, never what.
//
//   node next-issue.mjs [--authors a,b] [--json]
//
// Run inside the repository. Prints the chosen issue's number (or nothing) and
// exits 0; with --json, prints { next, skipped: [{ number, reasons }] }. An
// issue is buildable when every rule below holds; `skipped` says why the
// others are not. The pure function `pick` is tested in tests/next-issue.test.mjs.
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { sections, dependsOn } from './ready-check.mjs'

const WRITERS = ['admin', 'maintain', 'write']

// issues: [{ number, state, labels, body, author, createdAt, readyBy, readyByPermission }]
// states: { number: 'OPEN' | 'CLOSED' } for every issue a dependency names
// authors: logins allowed to have written a buildable issue; empty allows any
export function reasonsAgainst(issue, states, authors) {
  const reasons = []
  const labels = issue.labels || []
  if (String(issue.state).toUpperCase() !== 'OPEN') reasons.push('closed')
  if (!labels.includes('factory')) reasons.push('no "factory" label')
  if (!labels.includes('ready')) reasons.push('no "ready" label')
  for (const l of ['needs-info', 'factory-running', 'factory-failed']) if (labels.includes(l)) reasons.push(`labelled "${l}"`)
  if (authors.length > 0 && !authors.includes(issue.author)) reasons.push(`written by ${issue.author}, who is not in FACTORY_AUTHORS`)
  if (!issue.readyBy) reasons.push('nobody is recorded adding "ready"')
  else if (!WRITERS.includes(issue.readyByPermission)) reasons.push(`"ready" was added by ${issue.readyBy}, who cannot write to the repository`)
  const open = dependsOn(sections(issue.body)['Depends on']).filter(n => String(states[n] || 'OPEN').toUpperCase() !== 'CLOSED')
  if (open.length) reasons.push(`waiting for ${open.map(n => `#${n}`).join(', ')}`)
  return reasons
}

// The oldest buildable issue, so work goes in the order it was approved.
export function pick(issues, states, authors = []) {
  const skipped = []
  const buildable = []
  for (const issue of issues) {
    const reasons = reasonsAgainst(issue, states, authors)
    if (reasons.length) skipped.push({ number: issue.number, reasons })
    else buildable.push(issue)
  }
  buildable.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.number - b.number)
  return { next: buildable.length ? buildable[0].number : null, skipped }
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
}

function readyEvent(n) {
  // One login per line, oldest first, across every page; the last one counts.
  const logins = gh(['api', '--paginate', `repos/{owner}/{repo}/issues/${n}/events`, '--jq', '.[] | select(.event == "labeled" and .label.name == "ready") | .actor.login'])
    .split('\n').map(s => s.trim()).filter(Boolean)
  return logins.length ? logins[logins.length - 1] : null
}

function permission(login) {
  try {
    return gh(['api', `repos/{owner}/{repo}/collaborators/${login}/permission`, '--jq', '.permission']).trim()
  } catch {
    return 'none'
  }
}

function main(argv) {
  const json = argv.includes('--json')
  const i = argv.indexOf('--authors')
  const authors = (i >= 0 ? argv[i + 1] : process.env.FACTORY_AUTHORS || '').split(',').map(s => s.trim()).filter(Boolean)
  const raw = JSON.parse(gh(['issue', 'list', '--label', 'factory', '--label', 'ready', '--state', 'open', '--limit', '200', '--json', 'number,state,labels,body,author,createdAt']))
  const issues = raw.map(r => {
    const readyBy = readyEvent(r.number)
    return { ...r, labels: r.labels.map(l => l.name), author: r.author && r.author.login, readyBy, readyByPermission: readyBy ? permission(readyBy) : 'none' }
  })
  const states = {}
  for (const n of new Set(issues.flatMap(x => dependsOn(sections(x.body)['Depends on'])))) {
    try {
      states[n] = gh(['issue', 'view', String(n), '--json', 'state', '--jq', '.state']).trim()
    } catch {
      states[n] = 'OPEN'
    }
  }
  const result = pick(issues, states, authors)
  if (json) console.log(JSON.stringify(result, null, 2))
  else if (result.next) console.log(result.next)
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exit(main(process.argv.slice(2)))
