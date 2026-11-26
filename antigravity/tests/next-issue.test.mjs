// Tests for the dispatcher's choice, factory/scripts/next-issue.mjs.
// Run: node --test tests/
import test from 'node:test'
import assert from 'node:assert/strict'
import { pick, reasonsAgainst } from '../factory/scripts/next-issue.mjs'

const issue = (number, over = {}) => ({
  number, state: 'OPEN', labels: ['factory', 'ready'], body: '## Depends on\n\nnone\n', author: 'factory-bot',
  createdAt: `2026-11-${String(10 + number).padStart(2, '0')}T00:00:00Z`, readyBy: 'pm', readyByPermission: 'write', ...over,
})

test('the oldest buildable issue is picked', () => {
  const r = pick([issue(5), issue(2), issue(3)], {})
  assert.equal(r.next, 2)
  assert.deepEqual(r.skipped, [])
})

test('an issue waits until every issue it depends on is closed', () => {
  const blocked = issue(2, { body: '## Depends on\n\n- #1: the model\n- #4: the API\n' })
  assert.deepEqual(reasonsAgainst(blocked, { 1: 'CLOSED', 4: 'OPEN' }, []), ['waiting for #4'])
  assert.deepEqual(reasonsAgainst(blocked, { 1: 'CLOSED', 4: 'CLOSED' }, []), [])
  assert.deepEqual(reasonsAgainst(blocked, { 1: 'CLOSED' }, []), ['waiting for #4'], 'a dependency of unknown state counts as open')
})

test('only factory issues marked ready by someone who can write are built', () => {
  assert.deepEqual(reasonsAgainst(issue(1, { labels: ['ready'] }), {}, []), ['no "factory" label'])
  assert.deepEqual(reasonsAgainst(issue(1, { labels: ['factory'] }), {}, []), ['no "ready" label'])
  assert.deepEqual(reasonsAgainst(issue(1, { readyByPermission: 'triage' }), {}, []), ['"ready" was added by pm, who cannot write to the repository'])
  assert.deepEqual(reasonsAgainst(issue(1, { readyBy: null }), {}, []), ['nobody is recorded adding "ready"'])
})

test('issues waiting for answers, running or failed are left alone', () => {
  for (const l of ['needs-info', 'factory-running', 'factory-failed']) {
    assert.deepEqual(reasonsAgainst(issue(1, { labels: ['factory', 'ready', l] }), {}, []), [`labelled "${l}"`])
  }
})

test('with FACTORY_AUTHORS set, an issue someone else wrote is not built', () => {
  const r = pick([issue(1, { author: 'stranger' }), issue(2)], {}, ['factory-bot'])
  assert.equal(r.next, 2)
  assert.deepEqual(r.skipped, [{ number: 1, reasons: ['written by stranger, who is not in FACTORY_AUTHORS'] }])
})

test('nothing buildable picks nothing', () => {
  assert.equal(pick([issue(1, { labels: ['factory'] })], {}).next, null)
})
