// Tests for the mechanical readiness check, factory/scripts/ready-check.mjs.
// Run: node --test tests/
import test from 'node:test'
import assert from 'node:assert/strict'
import { checkIssue, draftIssue, sections, vagueWords, unansweredQuestions, findCycle, criteria, uiProblems } from '../factory/scripts/ready-check.mjs'

const body = `# Export orders as CSV

## Objective

Let an admin download the orders of a month.

## User stories

- As an admin, I want a CSV, so that I can do the books.

## Acceptance criteria

- **C1** Given orders in March, when the admin clicks "Export CSV", then a file orders-2026-03.csv downloads with one row per order.
- **C2** Given no orders in the month, when the admin clicks "Export CSV", then the message "No orders in March 2026" shows and nothing downloads.

## UI and states

- Screens: Orders — https://www.figma.com/design/abc
- States: empty, loading, error.

## Data and API

Reads orders; no new API.

## Permissions

Admins only; others do not see the button.

## Copy

- Button: "Export CSV"

## Out of scope

- PDF export.

## Depends on

- #3: the orders list.
`

const ready = { number: 7, state: 'OPEN', labels: ['factory', 'kind/report'], body, comments: [] }

test('a complete issue passes the mechanical check and notes what it waits for', () => {
  const r = checkIssue(ready)
  assert.deepEqual(r.problems, [])
  assert.equal(r.ready, true)
  assert.match(r.notes[0], /#3/)
})

test('an issue without the factory label, or waiting for answers, is not ready', () => {
  assert.match(checkIssue({ ...ready, labels: [] }).problems.join(' '), /no "factory" label/)
  assert.match(checkIssue({ ...ready, labels: ['factory', 'needs-info'] }).problems.join(' '), /needs-info/)
  assert.match(checkIssue({ ...ready, state: 'CLOSED' }).problems.join(' '), /closed/)
})

test('missing, empty and placeholder sections are each named', () => {
  const p = checkIssue({ ...ready, body: body.replace(/## Permissions[\s\S]*?## Copy/, '## Copy').replace('Reads orders; no new API.', '').replace('PDF export.', '<What a reader might expect>') }).problems.join(' ')
  assert.match(p, /"Permissions" is missing/)
  assert.match(p, /"Data and API" is empty/)
  assert.match(p, /"Out of scope" still holds a template placeholder/)
})

test('criteria must be numbered C1..Cn in order', () => {
  assert.deepEqual(criteria('- **C1** a\n- **C2** b').map(c => c.id), ['C1', 'C2'])
  const p = checkIssue({ ...ready, body: body.replace('**C2**', '**C3**') }).problems.join(' ')
  assert.match(p, /found C3 at position 2/)
})

test('vague words in a criterion are refused, in English and Vietnamese, as whole words only', () => {
  assert.deepEqual(vagueWords('The page loads fast and is easy to use, etc.'), ['fast', 'easy', 'etc'])
  assert.deepEqual(vagueWords('Hiển thị nhanh, giao diện thân thiện, v.v.'), ['nhanh', 'thân thiện', 'v.v'])
  assert.deepEqual(vagueWords('The breakfast menu shows 20 items'), [], '"fast" inside "breakfast" is not the word')
  const p = checkIssue({ ...ready, body: body.replace('one row per order', 'one row per order, quickly') }).problems.join(' ')
  assert.match(p, /C1 uses words that hide a decision: "quickly"/)
})

test('a visible change must link its mockup; "No visible change" needs none', () => {
  assert.deepEqual(uiProblems('No visible change'), [])
  assert.deepEqual(uiProblems('Không có thay đổi giao diện'), [])
  assert.match(uiProblems('- Screens: Orders')[0], /gives no mockup/)
  assert.deepEqual(uiProblems('- Orders: .factory/design/mockups/12/orders.png'), [], 'an image in the repository counts')
})

test('a Q line is open until a later comment answers it with the same number', () => {
  const qs = [{ body: 'Q1: Is the CSV in UTF-8 with BOM?\nQ2: Which time zone?' }, { body: 'A1: Yes, with BOM.' }]
  assert.deepEqual(unansweredQuestions(qs), ['Q2: Which time zone?'])
  assert.deepEqual(unansweredQuestions([{ body: 'A1: early' }, { body: 'Q1: late?' }]), ['Q1: late?'], 'an answer before the question does not count')
  const p = checkIssue({ ...ready, comments: qs }).problems.join(' ')
  assert.match(p, /Unanswered question in the comments: Q2: Which time zone\?/)
})

test('a dependency cycle through other open issues is refused, with its path', () => {
  assert.equal(findCycle({ 1: [2], 2: [3], 3: [] }), null)
  assert.deepEqual(findCycle({ 1: [2], 2: [1] }), [1, 2, 1])
  const p = checkIssue(ready, { 3: [5], 5: [7] }).problems.join(' ')
  assert.match(p, /Dependency cycle: #7 -> #3 -> #5 -> #7/)
})

test('sections are read by their second-level heading', () => {
  const s = sections('# T\n\n## A\n\nx\n\n## B\n')
  assert.equal(s.A, 'x')
  assert.equal(s.B, '')
})

test('a draft is checked like an open factory issue with no comments yet', () => {
  assert.deepEqual(checkIssue(draftIssue(body)).problems, [])
  assert.match(checkIssue(draftIssue(body.replace('## Copy', '## Words'))).problems.join(' '), /"Copy" is missing/)
})
