// factory's issue-ready.sh: an issue runs only after a person marked it ready. A fake gh, no GitHub.
// Run: cd factory/claude && node --test tests/*.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('../factory/scripts/issue-ready.sh', import.meta.url))
const BOTH = ['status: needs-criteria', 'status: ready', 'type: feature']

function ready(t, { issue = [], repo = BOTH, fail = '', args = ['--issue', '42'] }) {
  const bin = mkdtempSync(join(tmpdir(), 'ready-'))
  t.after(() => rmSync(bin, { recursive: true, force: true }))
  const print = names => names.map(n => `echo '${n}'`).join('; ') || ':'
  writeFileSync(join(bin, 'gh'), `#!/usr/bin/env bash
case "$1 $2" in
  "issue view") [ "$3" = 42 ] || exit 9; [ "${fail}" != issue ] || exit 1; ${print(issue)} ;;
  "label list") [ "${fail}" != label ] || exit 1; ${print(repo)} ;;
  *) echo "gh $*: only reading is allowed" >&2; exit 9 ;;
esac
`)
  chmodSync(join(bin, 'gh'), 0o755)
  return spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } })
}

test('a ready issue runs', t => {
  const r = ready(t, { issue: ['type: feature', 'status: ready'] })
  assert.equal(r.status, 0, r.stderr)
})

test('an issue nobody marked ready does not, whatever else it says', t => {
  for (const issue of [[], ['type: feature'], ['status: needs-criteria'], ['not status: ready']]) {
    const r = ready(t, { issue })
    assert.equal(r.status, 10, issue.join())
    assert.match(r.stderr, /status: ready/)
  }
})

test('both labels is not ready', t => {
  const r = ready(t, { issue: ['status: ready', 'status: needs-criteria'] })
  assert.equal(r.status, 10)
  assert.match(r.stderr, /status: needs-criteria/)
})

test('a repository without the ready label has no gate, but needs-criteria still stops', t => {
  const repo = ['bug', 'status: needs-criteria']
  assert.equal(ready(t, { issue: ['bug'], repo }).status, 0)
  assert.equal(ready(t, { issue: ['status: needs-criteria'], repo }).status, 10)
})

test('labels that cannot be read never count as ready', t => {
  for (const fail of ['issue', 'label']) assert.equal(ready(t, { issue: ['type: feature'], fail }).status, 69, fail)
})

test('usage', t => {
  for (const args of [[], ['--issue'], ['--issue', 'NN'], ['--issue', '0'], ['--x', '1']]) assert.equal(ready(t, { args }).status, 64, args.join(' '))
})
