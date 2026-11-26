// ba-ticket's check-ticket.mjs: what stops a ticket from going to the factory.
// Run: cd claude && node --test tests/*.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseForm, ticketProblems, ticketWarnings } from '../ba-ticket/scripts/check-ticket.mjs'

const CHECK_TICKET = fileURLToPath(new URL('../ba-ticket/scripts/check-ticket.mjs', import.meta.url))

const FORM_SOURCES = {
  '01-feature.yml': `name: "[FEAT] Feature"
description: "A new capability users do not have today, small enough for one pull request."
title: "[FEAT] <Verb-first: what a user can do after this merges>"
type: Feature
labels: ["type: feature", "status: needs-criteria"]
body:
  - type: textarea
    id: objective
    attributes:
      label: Objective
    validations:
      required: true
  - type: textarea
    id: stories
    attributes:
      label: User stories
      value: "- As a <user in a situation>, I want <capability>, so that <benefit>."
    validations:
      required: true
  - type: textarea
    id: criteria
    attributes:
      label: Acceptance criteria
      value: |
        - **C1** Given <context>, when <action>, then <observable result>.
    validations:
      required: true
  - type: textarea
    id: out-of-scope
    attributes:
      label: Out of scope
      value: "- "
    validations:
      required: true
  - type: textarea
    id: depends
    attributes:
      label: Depends on
      value: none
  - type: textarea
    id: constraints
    attributes:
      label: Constraints
  - type: textarea
    id: notes
    attributes:
      label: Notes
`,
  '03-bug.yml': `name: "[BUG] Bug report"
description: "Existing behavior is wrong."
title: "[BUG] Fix <what is wrong, in a few words>"
type: Bug
labels: ["type: bug", "status: needs-criteria"]
body:
  - type: textarea
    id: actual
    attributes:
      label: What happens
    validations:
      required: true
  - type: textarea
    id: steps
    attributes:
      label: Steps to reproduce
      value: |
        1.
        2.
    validations:
      required: true
  - type: textarea
    id: criteria
    attributes:
      label: Acceptance criteria
      value: "- **C1** Given <context>, when <action>, then <correct result>."
    validations:
      required: true
  - type: dropdown
    id: severity
    attributes:
      label: Severity
      options:
        - "Low - cosmetic or has an easy workaround"
        - "Medium - a feature is partly broken"
        - "High - a main flow is broken, no workaround"
    validations:
      required: true
  - type: input
    id: environment
    attributes:
      label: Where
  - type: textarea
    id: evidence
    attributes:
      label: Logs / screenshots
`,
  '09-spike.yml': `name: "[SPIKE] Spike"
description: "Time-boxed research to answer a question before committing to work."
title: "[SPIKE] <Question to answer>"
type: Task
labels: ["type: spike"]
body:
  - type: textarea
    id: question
    attributes:
      label: Questions to answer
      value: |
        1.
    validations:
      required: true
  - type: dropdown
    id: timebox
    attributes:
      label: Time box
      options:
        - "Half a day"
        - "1 day"
        - "2 days"
    validations:
      required: true
  - type: textarea
    id: output
    attributes:
      label: Expected output
      value: "A comment on this issue with the answer."
    validations:
      required: true
`,
}
const form = name => parseForm(FORM_SOURCES[name])

const TITLE = '[FEAT] Export a replay as JSON'
const body = (criteria = '- **C1** Given a replay, when Export is clicked on the Replay page, then `replay.json` downloads.\n- **C2** Given no replay, the Export button is disabled.', rest = '') => `## Objective

Agents can hand a replay to a customer.

## User stories

- As an agent, I want a file, so that I can send it.

## Acceptance criteria

Each criterion is checked on its own.

${criteria}

## Out of scope

- CSV (see #12).

## Depends on

none
${rest}`
const problems = (b, o = {}) => ticketProblems({ title: TITLE, body: b, ...o }).join('\n')

test('a well-formed ticket is clean, with ## or the ### GitHub gives a form, and with CRLF', () => {
  assert.equal(problems(body(), { form: form('01-feature.yml') }), '')
  assert.equal(problems(body().replace(/^## /gm, '### ')), '')
  assert.equal(problems(body().replace(/\n/g, '\r\n')), '')
})

test('each section the factory reads by name is there and not empty', () => {
  for (const s of ['Objective', 'Acceptance criteria', 'Out of scope', 'Depends on']) {
    assert.match(problems(body().replace(`## ${s}`, '## Other')), new RegExp(`no "${s}" section`))
  }
  assert.match(problems(body().replace('- CSV (see #12).', '-')), /"Out of scope" is empty/)
  assert.match(problems(body(undefined, '\n## Objective\n\nAgain.\n')), /"Objective" appears twice/)
})

test('criteria: missing, repeated, out of order, empty, misplaced, in another form', () => {
  assert.match(problems(body('nothing')), /no criteria/)
  assert.match(problems(body('- **C1** a\n- **C1** b')), /C1 is used twice/)
  assert.match(problems(body('- **C2** a\n- **C1** b')), /C1 comes after C2/)
  assert.match(problems(body('- **C1**')), /C1 has no text/)
  assert.match(problems(body('- **C1** a', '\n## Notes\n\n- **C9** hidden\n')), /C9 is outside "Acceptance criteria"/)
  for (const line of ['- C2: b', '2. **C2** b', '- [ ] **C2** b', '**C2** b']) assert.match(problems(body(`- **C1** a\n${line}`)), /is not written `- \*\*C2\*\*/, line)
})

test('a rule before the first criterion that no criterion number covers is not read', () => {
  for (const line of ['- The page loads.', '1. The page loads.', '- **c1** loads', '- **AC1** loads', '**AC1** loads', 'c1. loads', '| C1 | loads |']) assert.match(problems(body(`${line}\n- **C1** a`)), /is not (?:written|in any criterion)/, line)
  assert.match(ticketWarnings({ body: body('Admins may delete any replay.\n\n- **C1** a') }).join(), /text before the first criterion/)
})

test('an open question written into a section is found, words on a screen are not', () => {
  for (const q of ['Open question: which period?', '**Open questions:** which period', '- Open decision: the stack']) assert.match(problems(body(undefined, `\n## Notes\n\n${q}\n`)), /open question/i, q)
  const warn = b => ticketWarnings({ body: b }).join('\n')
  for (const q of ['Should it be CSV?', 'The limit is to be decided.', 'The limit is not decided yet.', 'Giới hạn chưa chốt.', 'Sẽ xác nhận sau.']) {
    assert.match(warn(body(`- **C1** ${q}`)), /unsettled/, q)
    assert.match(warn(body(undefined, `\n## Notes\n\n- ${q}\n`)), /unsettled/, q)
  }
  for (const ok of ['The dialog asks "Delete it?".', 'The dialog asks `Delete it?`', 'See https://a.test/x?y=1 for it.', 'An order to be confirmed by the buyer shows "Pending".']) assert.doesNotMatch(warn(body(`- **C1** ${ok}`)), /unsettled/, ok)
})

test('depends on: an issue, or none', () => {
  const on = d => ticketWarnings({ body: body().replace('\nnone\n', `\n${d}\n`) }).join('\n')
  for (const ok of ['none', '- None.', '- #12: the list', '- #T2: the list', '- o/r#12: the list', '- https://github.com/o/r/issues/12: the list', '- #12: the list,\n  with its filter']) assert.doesNotMatch(on(ok), /Depends on/, ok)
  for (const bad of ['the login thing', '- #12: the list\n- The stack: no issue yet', '- None of #12']) {
    if (bad.includes('None of')) assert.doesNotMatch(on(bad), /Depends on/)
    else assert.match(on(bad), /"Depends on" names no issue/, bad)
  }
})

test('a criterion that is named and not there', () => {
  const warn = b => ticketWarnings({ body: b }).join('\n')
  assert.match(warn(body('- **C1** As in C9, it opens.')), /C9 is named/)
  assert.match(warn(body(undefined, '\n## Notes\n\n- See C7.\n')), /C7 is named/)
  for (const ok of ['- **C1** a\n- **C2** As in C1.', '- **C1** The grade is `C9` or "C8".', '- **C1** As C3 of #12 says.']) assert.doesNotMatch(warn(body(ok)), /is named/, ok)
})

test('a number dropped from an existing issue leaves a gap, which is allowed', () => {
  assert.equal(problems(body('- **C1** a\n- **C3** b')), '')
})

test('a criterion is one line: a second line, a nested list or a table under it is lost', () => {
  for (const more of ['  and a second line', 'lazy second line', '  - nested', '\n  | a | b |']) assert.match(problems(body(`- **C1** a\n${more}\n- **C2** b`)), /text after C1 is not in any criterion/, more)
  assert.match(problems(body('- **C1** a\n\nA rule nobody will judge.')), /text after C1/)
})

test('placeholders, comments and open questions are left in no ticket', () => {
  for (const p of ['<context>', '<exactly what the user sees>', 'TBD', 'TBC', 'TODO: ask', '???']) assert.match(problems(body(`- **C1** Given ${p}, it opens.`)), /placeholder/, p)
  assert.match(problems(body(undefined, '\n<!-- leave out -->\n')), /comment/)
  assert.match(problems(body(undefined, '\n## Open decisions\n\n- Which stack?\n')), /open questions/i)
  assert.match(ticketProblems({ title: '[FEAT] <Verb-first>', body: body() }).join(), /title.*placeholder/)
})

test('what looks like a placeholder and is not: code, HTML, links, generics, a TODO list', () => {
  for (const ok of ['`<id>`', '<br>', '<img src="a" width="3">', '<details open>', '<https://a.test/x>', 'Map<string, number>', '5 < 6 and 7 > 6', 'the TODO list', '</details>']) assert.equal(problems(body(`- **C1** Shows ${ok} on the page.`)), '', ok)
  assert.equal(problems(body(undefined, '\n## Notes\n\n```bash\ngh issue view <n> # TBD\n```\n')), '')
})

test('secrets are never in a ticket', () => {
  for (const s of ['ghp_' + 'a'.repeat(36), 'AKIA' + 'A'.repeat(16), '-----BEGIN RSA PRIVATE KEY-----', 'sk-ant-' + 'a'.repeat(30), 'xoxb-1234567890-abcdef', 'AIza' + 'a'.repeat(35), 'sk_live_' + 'a'.repeat(24), 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcDEF123456', 'Bearer ' + 'a1'.repeat(20), 'postgres://admin:hunter22@db.host/x']) assert.match(problems(body(undefined, `\n## Notes\n\n\`${s}\`\n`)), /looks like a secret/, s)
})

test('what looks like a secret and is not: a named variable, a picture, a URL with no password', () => {
  for (const ok of ['GEMINI_API_KEY', '`Bearer <token>`', 'Bearer authentication-token-of-the-user', 'postgres://localhost/x', 'postgres://user:$DB_PASSWORD@db/x', `data:image/png;base64,AIza${'a'.repeat(60)}`]) assert.doesNotMatch(problems(body(undefined, `\n## Notes\n\n\`${ok}\`\n`)), /secret/, ok)
})

test('the form: prefix, required fields, dropdown answers', () => {
  const bug = form('03-bug.yml')
  const rest = '\n## What happens\n\nIt fails.\n\n## Steps to reproduce\n\n1. Open it.\n\n## Severity\n\nHigh - a main flow is broken, no workaround\n'
  const is = (b, title = '[BUG] Fix the export') => ticketProblems({ title, body: b, form: bug }).join('\n')
  assert.equal(is(body(undefined, rest)), '')
  assert.match(is(body(undefined, rest), '[FEAT] Export'), /title does not start with "\[BUG\] "/)
  assert.match(is(body(undefined, rest.replace('## Severity', '## Other'))), /required field "Severity" is missing/)
  assert.match(is(body(undefined, rest.replace('1. Open it.', '1.\n2.'))), /"Steps to reproduce" is empty/)
  assert.match(is(body(undefined, rest.replace('High - a main flow is broken, no workaround', 'High'))), /"Severity" is not one of its options/)
})

test('a form with no criteria (epic, spike) does not need the factory\'s sections', () => {
  const b = '## Questions to answer\n\n1. Which?\n\n## Time box\n\n1 day\n\n## Expected output\n\nA comment.\n'
  assert.equal(ticketProblems({ title: '[SPIKE] Which one?', body: b, form: form('09-spike.yml') }).join(), '')
  assert.match(ticketProblems({ title: '[SPIKE] Which one?', body: b.replace('1 day', ''), form: form('09-spike.yml') }).join(), /"Time box" is empty/)
})

test('every fixture form parses to a prefix and fields', () => {
  for (const f of Object.keys(FORM_SOURCES)) {
    const p = form(f)
    assert.match(p.prefix, /^\[[A-Z]+\] $/, f)
    assert.ok(p.fields.some(x => x.required), f)
    assert.ok(p.fields.every(x => x.label), f)
  }
})

test('warnings: vague words, too many criteria, an email address', () => {
  const warn = b => ticketWarnings({ body: b }).join('\n')
  assert.equal(warn(body()), '')
  for (const w of ['fast', 'user-friendly', 'properly', 'as needed', 'etc.', 'smoothly', 'soon', 'several']) assert.match(warn(body(`- **C1** The page loads ${w} now.`)), /C1 says/, w)
  assert.equal(warn(body('- **C1** The label reads `Export fast`, and "easy" is its tooltip.')), '', 'quoted text is what the user sees')
  assert.equal(warn(body('- **C1** The breakfast list opens.')), '')
  assert.match(warn(body(Array.from({ length: 9 }, (_, i) => `- **C${i + 1}** a`).join('\n'))), /9 criteria/)
  assert.match(warn(body(undefined, '\n## Notes\n\nAsk lan@customer.vn\n')), /email address/)
  for (const n of ['0912 345 678', '+84 912.345.678', '(028) 3822 1234']) assert.match(warn(body(undefined, `\n## Notes\n\nCall ${n}\n`)), /phone number/, n)
  for (const n of ['2026-11-26', '10,000 messages', '1440 and 390 wide', 'commit 0912345678abcdef', '#123456789']) assert.doesNotMatch(warn(body(undefined, `\n## Notes\n\n${n}\n`)), /phone number/, n)
  for (const n of ['password: Hunter22!', 'API_KEY=a1b2c3d4e5']) assert.match(warn(body(undefined, `\n## Notes\n\n${n}\n`)), /password or key/, n)
  for (const n of ['password: at least 8 characters', 'password: $TEST_PASSWORD1', 'token: `TEST_TOKEN_1`']) assert.doesNotMatch(warn(body(undefined, `\n## Notes\n\n${n}\n`)), /password or key/, n)
})

test('the command: exit 0 with warnings, 1 with problems, 64 on bad usage', t => {
  const dir = mkdtempSync(join(tmpdir(), 'ba-ticket-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = join(dir, 'body.md')
  const formFile = join(dir, '01-feature.yml')
  writeFileSync(formFile, FORM_SOURCES['01-feature.yml'])
  const run = (...a) => spawnSync('node', [CHECK_TICKET, ...a], { encoding: 'utf8' })
  writeFileSync(file, body('- **C1** The page is fast.'))
  const ok = run('--title', TITLE, '--ticket', file, '--form', formFile)
  assert.equal(ok.status, 0, ok.stderr)
  assert.match(ok.stderr, /^look: C1 says "fast"/m)
  writeFileSync(file, body('- **C1** a\n- **C1** TBD'))
  const bad = run('--title', TITLE, '--ticket', file)
  assert.equal(bad.status, 1)
  assert.match(bad.stderr, /^problem: C1 is used twice/m)
  assert.equal(run('--title', TITLE).status, 64)
  assert.equal(run('--title', TITLE, '--ticket', join(dir, 'none.md')).status, 64)
})
