#!/usr/bin/env node
// The mechanical half of the readiness check: what code can decide about an
// issue before anyone builds it. The other half, the questions only reading
// the code can raise, is the planner run with `questionsOnly` (factory
// SKILL.md, "Check an issue is ready").
//
//   node ready-check.mjs <issue number> [--json]
//   node ready-check.mjs --body-file <draft.md> [--json]   a draft, before it is an issue
//
// Run inside the repository the issue belongs to. Exit 0 when nothing below
// fails, 1 when something does (each problem printed), 2 on a usage or gh
// error. The pure functions are exported for tests/ready-check.test.mjs.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const REQUIRED_SECTIONS = ['Objective', 'Acceptance criteria', 'UI and states', 'Data and API', 'Permissions', 'Copy', 'Out of scope', 'Depends on']

// Words that hide a decision in a criterion. English and Vietnamese, since
// tickets are written in the repository's language.
export const VAGUE = [
  'fast', 'quickly', 'quick', 'easy', 'easily', 'user-friendly', 'intuitive', 'appropriate', 'appropriately', 'suitable',
  'reasonable', 'nice', 'beautiful', 'modern', 'clean', 'etc', 'and so on', 'similar', 'as needed', 'if needed', 'some', 'various',
  'nhanh', 'dễ dùng', 'dễ sử dụng', 'thân thiện', 'phù hợp', 'hợp lý', 'đẹp', 'hiện đại', 'v.v', 'vân vân', 'tương tự', 'nếu cần', 'một số',
]

const NO_UI = /^(no visible change|không có thay đổi giao diện)/i

// "## Heading" -> body text, for every second-level heading.
export function sections(body) {
  const out = {}
  let name = null
  for (const line of String(body || '').split(/\r?\n/)) {
    const m = line.match(/^##\s+(.+?)\s*$/)
    if (m) { name = m[1]; out[name] = []; continue }
    if (name) out[name].push(line)
  }
  for (const k of Object.keys(out)) out[k] = out[k].join('\n').trim()
  return out
}

// A section that is missing, empty or still holds template placeholders.
export function sectionProblems(secs) {
  const problems = []
  for (const name of REQUIRED_SECTIONS) {
    const text = secs[name]
    if (text === undefined) problems.push(`Section "${name}" is missing.`)
    else if (text === '') problems.push(`Section "${name}" is empty.`)
    else if (/<[a-z][^<>\n]*>/i.test(text.replace(/<!--[\s\S]*?-->/g, '').replace(/`[^`]*`/g, ''))) problems.push(`Section "${name}" still holds a template placeholder (<...>).`)
  }
  return problems
}

// Criteria lines "- **C1** ..." in order.
export function criteria(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map(l => l.match(/^\s*[-*]\s*\*\*(C\d+)\*\*\s*(.*)$/))
    .filter(Boolean)
    .map(m => ({ id: m[1], text: m[2].trim() }))
}

export function criteriaProblems(list) {
  const problems = []
  if (list.length === 0) problems.push('No acceptance criteria in the form "- **C1** ...".')
  list.forEach((c, i) => {
    if (c.id !== `C${i + 1}`) problems.push(`Criteria are not numbered C1..Cn in order: found ${c.id} at position ${i + 1}.`)
    if (c.text === '') problems.push(`${c.id} is empty.`)
  })
  if (list.length > 8) problems.push(`${list.length} criteria: more than about eight usually means the issue is more than one pull request.`)
  return problems
}

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export function vagueWords(text) {
  const found = []
  const t = String(text || '')
  for (const w of VAGUE) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${esc(w)}(?=$|[^\\p{L}\\p{N}])`, 'iu')
    if (re.test(t)) found.push(w)
  }
  return found
}

export function uiProblems(text) {
  const t = String(text || '').trim()
  if (t === '' || NO_UI.test(t)) return []
  return /https?:\/\/\S+|\S+\.(png|jpe?g|webp|gif)\b/i.test(t) ? [] : ['"UI and states" names screens but gives no mockup (an image in the repository, under .factory/design/mockups/<issue>/, or a link).']
}

// Issue numbers in a "Depends on" section.
export function dependsOn(text) {
  return [...String(text || '').matchAll(/#(\d+)/g)].map(m => Number(m[1]))
}

// Q<n> lines that no later comment answers with A<n>. Comments in order.
export function unansweredQuestions(comments) {
  const open = []
  comments.forEach((c, i) => {
    for (const m of String(c.body || '').matchAll(/^\s*\**Q(\d+)\**\s*:\s*(.+)$/gm)) {
      const n = m[1]
      const answered = comments.slice(i + 1).some(later => new RegExp(`^\\s*\\**A${n}\\**\\s*:\\s*\\S`, 'm').test(String(later.body || '')))
      if (!answered) open.push(`Q${n}: ${m[2].trim()}`)
    }
  })
  return open
}

// A cycle in "number -> numbers it depends on", as a path, or null. The
// search starts at `first` when given, so the path reads from that issue.
export function findCycle(graph, first) {
  const state = new Map()
  const path = []
  const visit = n => {
    if (state.get(n) === 'done') return null
    if (state.get(n) === 'open') return [...path.slice(path.indexOf(n)), n]
    state.set(n, 'open')
    path.push(n)
    for (const m of graph[n] || []) {
      const c = visit(m)
      if (c) return c
    }
    path.pop()
    state.set(n, 'done')
    return null
  }
  const starts = Object.keys(graph).map(Number)
  if (first !== undefined) starts.unshift(first)
  for (const n of starts) {
    const c = visit(n)
    if (c) return c
  }
  return null
}

// issue: { number, state, labels: [names], body, comments: [{ body }] }
// graph: dependencies of the other open issues, { number: [numbers] }
export function checkIssue(issue, graph = {}) {
  const problems = []
  const notes = []
  if (String(issue.state).toUpperCase() !== 'OPEN') problems.push('The issue is closed.')
  if (!issue.labels.includes('factory')) problems.push('The issue has no "factory" label, so the pipeline may not build it.')
  if (issue.labels.includes('needs-info')) problems.push('The issue is labelled "needs-info": answer its questions and remove the label first.')
  const secs = sections(issue.body)
  problems.push(...sectionProblems(secs))
  const list = criteria(secs['Acceptance criteria'])
  problems.push(...criteriaProblems(list))
  for (const c of list) {
    const words = vagueWords(c.text)
    if (words.length) problems.push(`${c.id} uses words that hide a decision: ${words.map(w => `"${w}"`).join(', ')}. Replace each with the number, list or example it stands for.`)
  }
  problems.push(...uiProblems(secs['UI and states']))
  for (const q of unansweredQuestions(issue.comments || [])) problems.push(`Unanswered question in the comments: ${q}`)
  const deps = dependsOn(secs['Depends on'])
  if (deps.includes(issue.number)) problems.push('The issue depends on itself.')
  const cycle = findCycle({ ...graph, [issue.number]: deps }, issue.number)
  if (cycle) problems.push(`Dependency cycle: ${cycle.map(n => `#${n}`).join(' -> ')}.`)
  if (deps.length) notes.push(`Depends on ${deps.map(n => `#${n}`).join(', ')}; it is built only once those are closed.`)
  return { ready: problems.length === 0, problems, notes }
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
}

// A draft written by factory-clarify, before it is an issue: checked the same
// way, as an open issue labelled factory, with no comments yet. Its
// dependencies are checked against the open issues when gh can read them.
export function draftIssue(body, number = 0) {
  return { number, state: 'OPEN', labels: ['factory'], body, comments: [] }
}

function main(argv) {
  const json = argv.includes('--json')
  const bodyFile = argv[argv.indexOf('--body-file') + 1]
  if (argv.includes('--body-file')) {
    if (!bodyFile || !existsSync(bodyFile)) { console.error('ready-check: --body-file must name a file'); return 2 }
    let graph = {}
    try {
      const open = JSON.parse(execFileSync('gh', ['issue', 'list', '--label', 'factory', '--state', 'open', '--limit', '500', '--json', 'number,body'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
      graph = Object.fromEntries(open.map(o => [o.number, dependsOn(sections(o.body)['Depends on'])]))
    } catch {}
    const result = checkIssue(draftIssue(readFileSync(bodyFile, 'utf8')), graph)
    if (json) console.log(JSON.stringify({ draft: bodyFile, ...result }, null, 2))
    else {
      console.log(result.ready ? 'Draft: no mechanical problems. Next: the planner\'s questions (questionsOnly).' : 'Draft: not ready.')
      for (const p of result.problems) console.log(`  - ${p}`)
      for (const note of result.notes) console.log(`  note: ${note}`)
    }
    return result.ready ? 0 : 1
  }
  const n = Number(argv.find(a => /^\d+$/.test(a)))
  if (!n) {
    console.error('usage: ready-check.mjs <issue number> [--json] | --body-file <draft.md> [--json]')
    return 2
  }
  let issue, graph
  try {
    const raw = JSON.parse(gh(['issue', 'view', String(n), '--json', 'number,state,labels,body,comments']))
    issue = { ...raw, labels: raw.labels.map(l => l.name), comments: raw.comments.map(c => ({ body: c.body })) }
    const open = JSON.parse(gh(['issue', 'list', '--label', 'factory', '--state', 'open', '--limit', '500', '--json', 'number,body']))
    graph = Object.fromEntries(open.filter(o => o.number !== n).map(o => [o.number, dependsOn(sections(o.body)['Depends on'])]))
  } catch (e) {
    console.error(`ready-check: could not read issue #${n} with gh: ${e.message}`)
    return 2
  }
  const result = checkIssue(issue, graph)
  if (json) console.log(JSON.stringify({ issue: n, ...result }, null, 2))
  else {
    console.log(result.ready ? `#${n}: no mechanical problems. Next: the planner's questions (questionsOnly).` : `#${n}: not ready.`)
    for (const p of result.problems) console.log(`  - ${p}`)
    for (const note of result.notes) console.log(`  note: ${note}`)
  }
  return result.ready ? 0 : 1
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exit(main(process.argv.slice(2)))
