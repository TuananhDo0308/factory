#!/usr/bin/env node
// How the pipeline's issues went after they were written, so the next ones
// can ask in advance what the earlier ones had to stop and ask.
//
//   node issue-history.mjs [--limit 50] [--kind crud] [--out file.jsonl]
//
// Run inside the repository. One JSON line per `factory` issue, newest first:
// the questions asked on it (Q lines, with their A answers), how many times it
// was sent back for information or failed, the bugs filed as its regressions
// ("Regression of #N" in another issue), and a score. Then one line per kind
// with how many of its issues ran straight through. It reads; it changes
// nothing. The pure functions are tested in tests/issue-history.test.mjs.
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// Q<n> / A<n> lines of the comments, paired: an answer is the first A<n>
// after its question.
export function questionsAndAnswers(comments) {
  const out = []
  comments.forEach((c, i) => {
    for (const m of String(c.body || '').matchAll(/^\s*\**Q(\d+)\**\s*:\s*(.+)$/gm)) {
      let answer = null
      for (const later of comments.slice(i + 1)) {
        const a = String(later.body || '').match(new RegExp(`^\\s*\\**A${m[1]}\\**\\s*:\\s*(.+)$`, 'm'))
        if (a) { answer = a[1].trim(); break }
      }
      out.push({ question: m[2].trim(), answer })
    }
  })
  return out
}

// issue numbers each issue body names as "Regression of #N".
export function regressionsOf(issues) {
  const map = {}
  for (const i of issues) {
    for (const m of String(i.body || '').matchAll(/regression of #(\d+)/gi)) {
      const n = Number(m[1])
      ;(map[n] = map[n] || []).push(i.number)
    }
  }
  return map
}

// labelEvents: names of the labels added to the issue over its life, in order.
export function summarize(issue, labelEvents, regressions) {
  const qa = questionsAndAnswers(issue.comments || [])
  const needsInfo = labelEvents.filter(l => l === 'needs-info').length
  const failed = labelEvents.filter(l => l === 'factory-failed').length
  const regs = regressions[issue.number] || []
  // Straight through: closed, never stopped for information, never failed,
  // no question asked after it was written, no regression filed against it.
  const straight = String(issue.state).toUpperCase() === 'CLOSED' && needsInfo === 0 && failed === 0 && qa.length === 0 && regs.length === 0
  return {
    number: issue.number,
    title: issue.title,
    kind: (issue.labels.find(l => l.startsWith('kind/')) || 'kind/other').slice(5),
    state: String(issue.state).toUpperCase(),
    questions: qa,
    needsInfo,
    failed,
    regressions: regs,
    score: straight ? 'straight' : needsInfo + failed + qa.length + regs.length > 2 ? 'rough' : 'bumpy',
  }
}

export function byKind(records) {
  const kinds = {}
  for (const r of records) {
    const k = (kinds[r.kind] = kinds[r.kind] || { kind: r.kind, issues: 0, straight: 0, questions: 0, regressions: 0 })
    k.issues++
    if (r.score === 'straight') k.straight++
    k.questions += r.questions.length
    k.regressions += r.regressions.length
  }
  return Object.values(kinds).sort((a, b) => b.issues - a.issues)
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
}

function main(argv) {
  const opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
  const limit = Number(opt('--limit') || 50)
  const kind = opt('--kind')
  const labels = ['--label', 'factory', ...(kind ? ['--label', `kind/${kind}`] : [])]
  const issues = JSON.parse(gh(['issue', 'list', ...labels, '--state', 'all', '--limit', String(limit), '--json', 'number,title,state,labels,comments,body']))
    .map(i => ({ ...i, labels: i.labels.map(l => l.name), comments: i.comments.map(c => ({ body: c.body })) }))
  // Regressions may be filed without the factory label, so look at every issue.
  const all = JSON.parse(gh(['issue', 'list', '--state', 'all', '--limit', '1000', '--search', 'regression of in:body', '--json', 'number,body']))
  const regressions = regressionsOf(all)
  const records = issues.map(i => {
    let events = []
    try {
      events = gh(['api', '--paginate', `repos/{owner}/{repo}/issues/${i.number}/events`, '--jq', '.[] | select(.event == "labeled") | .label.name']).split('\n').filter(Boolean)
    } catch {}
    return summarize(i, events, regressions)
  })
  const lines = [...records.map(r => JSON.stringify(r)), ...byKind(records).map(k => JSON.stringify({ summary: k }))].join('\n') + '\n'
  const out = opt('--out')
  if (out) writeFileSync(out, lines)
  else process.stdout.write(lines)
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exit(main(process.argv.slice(2)))
