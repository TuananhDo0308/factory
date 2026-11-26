// Tests for factory/scripts/issue-history.mjs. Run: node --test tests/
import test from 'node:test'
import assert from 'node:assert/strict'
import { questionsAndAnswers, regressionsOf, summarize, byKind } from '../factory/scripts/issue-history.mjs'

test('questions are paired with the first later answer of the same number', () => {
  const qa = questionsAndAnswers([
    { body: 'Q1: Soft or hard delete?\nQ2: Who may restore?' },
    { body: 'A1: Soft, 30 days.' },
    { body: 'Q1: Is restore logged?' },
    { body: 'A1: Yes.' },
  ])
  assert.deepEqual(qa, [
    { question: 'Soft or hard delete?', answer: 'Soft, 30 days.' },
    { question: 'Who may restore?', answer: null },
    { question: 'Is restore logged?', answer: 'Yes.' },
  ])
})

test('regressions are found by "Regression of #N" in other issues, in any case', () => {
  assert.deepEqual(regressionsOf([{ number: 9, body: 'Regression of #4' }, { number: 11, body: 'regression of #4 and of nothing else' }, { number: 12, body: 'no' }]), { 4: [9, 11] })
})

const issue = { number: 4, title: 'Delete orders', state: 'CLOSED', labels: ['factory', 'kind/crud'], comments: [] }

test('an issue that went straight through scores straight', () => {
  const r = summarize(issue, ['factory', 'ready'], {})
  assert.equal(r.score, 'straight')
  assert.equal(r.kind, 'crud')
})

test('questions, stops, failures and regressions make an issue bumpy, then rough', () => {
  assert.equal(summarize(issue, ['ready', 'needs-info', 'ready'], {}).score, 'bumpy')
  const rough = summarize({ ...issue, comments: [{ body: 'Q1: a?' }] }, ['needs-info', 'factory-failed'], { 4: [9] })
  assert.equal(rough.score, 'rough')
  assert.deepEqual(rough.regressions, [9])
  assert.equal(summarize({ ...issue, state: 'OPEN' }, [], {}).score, 'bumpy', 'an open issue has not gone straight through yet')
})

test('kinds are summed, most issues first', () => {
  const k = byKind([
    summarize(issue, [], {}),
    summarize({ ...issue, number: 5 }, ['needs-info'], {}),
    summarize({ ...issue, number: 6, labels: ['factory'] }, [], {}),
  ])
  assert.deepEqual(k[0], { kind: 'crud', issues: 2, straight: 1, questions: 0, regressions: 0 })
  assert.equal(k[1].kind, 'other')
})
