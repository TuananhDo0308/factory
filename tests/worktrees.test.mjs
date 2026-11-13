// Runs the two worktree scripts for real, with bash, against a scratch
// repository, and feeds what they print to the two readers.
// Run: node --test tests/
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync, lstatSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { helpers as h } from './load.mjs'

const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' }).trim()
const bash = script => spawnSync('bash', ['-c', script], { encoding: 'utf8' }).stdout

function scratch(t) {
  const repo = join(realpathSync(mkdtempSync(join(tmpdir(), 'factory-test-'))), "re po's")
  mkdirSync(join(repo, 'tests'), { recursive: true })
  t.after(() => rmSync(join(repo, '..'), { recursive: true, force: true }))
  git(repo, 'init', '-q')
  writeFileSync(join(repo, 'a.py'), 'x = 1\n')
  writeFileSync(join(repo, 'tests/test_old.py'), 'old\n')
  writeFileSync(join(repo, '.gitignore'), 'node_modules/\n.env\n')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-qm', 'base')
  const spec = { id: 'S1', filesOwned: ['a.py'], testFiles: ['tests/test_old.py', 'tests/test new.py'] }
  const items = [{ spec, tree: h.worktreeOf(`${repo}-factory-worktrees`, spec, [spec]) }]
  return { repo, base: git(repo, 'rev-parse', 'HEAD'), items, tree: items[0].tree }
}

test('setup creates the worktree at the base commit; gather copies the tests back', t => {
  const { repo, base, items, tree } = scratch(t)
  writeFileSync(join(repo, 'tests/test_old.py'), 'user work in progress\n')

  const setup = h.readSetup(bash(h.setupScript(items, repo, base)), items)
  assert.deepEqual(setup.problems, [])
  assert.deepEqual(setup.seeded, [['tests/test_old.py']])
  assert.equal(setup.hashes[0][1], 'none')
  assert.equal(readFileSync(join(tree, 'tests/test_old.py'), 'utf8'), 'user work in progress\n')
  assert.equal(readFileSync(join(tree, 'a.py'), 'utf8'), 'x = 1\n')

  writeFileSync(join(repo, 'a.py'), 'x = 2\n') // the implementer, in the repository
  writeFileSync(join(tree, 'tests/test new.py'), 'new\n') // the tester, in its worktree
  mkdirSync(join(tree, 'tests/__pycache__'))
  writeFileSync(join(tree, 'tests/__pycache__/c.pyc'), '')

  const gathered = h.readGather(bash(h.gatherScript(items, repo, setup.hashes)), items, [])
  assert.deepEqual(gathered.problems, [])
  assert.equal(readFileSync(join(repo, 'tests/test new.py'), 'utf8'), 'new\n')
  assert.equal(readFileSync(join(tree, 'a.py'), 'utf8'), 'x = 1\n')
})

test('setup links ignored dependencies and config into the worktree, and only those', t => {
  const { repo, base, items, tree } = scratch(t)
  mkdirSync(join(repo, 'node_modules/pkg'), { recursive: true })
  writeFileSync(join(repo, 'node_modules/pkg/index.js'), 'module.exports = 1\n')
  writeFileSync(join(repo, '.env'), 'DATABASE_URL=x\n')
  mkdirSync(join(repo, 'notes')) // untracked but not ignored: never linked
  const share = h.sharedPaths(['notes', 'a.py', './node_modules'])
  assert.deepEqual(share.slice(-2), ['notes', 'a.py'])
  assert.equal(share.filter(p => p === 'node_modules').length, 1)

  const setup = h.readSetup(bash(h.setupScript(items, repo, base, share)), items, share)
  assert.deepEqual(setup.problems, [])
  assert.deepEqual(setup.shared, [['node_modules', '.env']])
  assert.ok(lstatSync(join(tree, 'node_modules')).isSymbolicLink())
  assert.equal(readFileSync(join(tree, 'node_modules/pkg/index.js'), 'utf8'), 'module.exports = 1\n')
  assert.equal(readFileSync(join(tree, '.env'), 'utf8'), 'DATABASE_URL=x\n')
  assert.ok(!existsSync(join(tree, 'notes')))
  assert.ok(!lstatSync(join(tree, 'a.py')).isSymbolicLink())

  // git lists the node_modules link as new (`node_modules/` does not match a
  // link); it is not the tester's, so gathering must not stop on it.
  writeFileSync(join(tree, 'tests/test new.py'), 'new\n')
  const gathered = h.readGather(bash(h.gatherScript(items, repo, setup.hashes)), items, [], share)
  assert.deepEqual(gathered.problems, [])

  // Removing the worktree removes the links, never what they point to.
  git(repo, 'worktree', 'remove', '--force', tree)
  assert.ok(existsSync(join(repo, 'node_modules/pkg/index.js')))
  assert.ok(existsSync(join(repo, '.env')))
})

test('without the share list, the node_modules link stops the gathering', t => {
  const { repo, base, items, tree } = scratch(t)
  mkdirSync(join(repo, 'node_modules'))
  const share = h.sharedPaths()
  const setup = h.readSetup(bash(h.setupScript(items, repo, base, share)), items, share)
  assert.deepEqual(setup.shared, [['node_modules']])
  const gathered = h.readGather(bash(h.gatherScript(items, repo, setup.hashes)), items, [])
  assert.ok(gathered.problems.some(p => /does not own.*node_modules/.test(p)), gathered.problems.join('|'))
})

test('gather stops on a tester that changed a file it does not own', t => {
  const { repo, base, items, tree } = scratch(t)
  const setup = h.readSetup(bash(h.setupScript(items, repo, base)), items)
  writeFileSync(join(tree, 'a.py'), 'x = 3\n')
  writeFileSync(join(tree, 'tests/test new.py'), 'new\n')
  const gathered = h.readGather(bash(h.gatherScript(items, repo, setup.hashes)), items, [])
  assert.ok(gathered.problems.some(p => /does not own.*a\.py/.test(p)), gathered.problems.join('|'))
})

test('gather refuses to overwrite a test file changed in the repository during the build', t => {
  const { repo, base, items, tree } = scratch(t)
  const setup = h.readSetup(bash(h.setupScript(items, repo, base)), items)
  writeFileSync(join(tree, 'tests/test new.py'), 'from the tester\n')
  writeFileSync(join(repo, 'tests/test new.py'), 'from the implementer\n')
  const gathered = h.readGather(bash(h.gatherScript(items, repo, setup.hashes)), items, [])
  assert.ok(gathered.problems.some(p => /test new\.py was changed in the repository/.test(p)))
  assert.equal(readFileSync(join(repo, 'tests/test new.py'), 'utf8'), 'from the implementer\n')
})

test('a test file the tester did not write is a note, not a problem', t => {
  const { repo, base, items } = scratch(t)
  const setup = h.readSetup(bash(h.setupScript(items, repo, base)), items)
  const gathered = h.readGather(bash(h.gatherScript(items, repo, setup.hashes)), items, [])
  assert.deepEqual(gathered.problems, [])
  assert.equal(gathered.notes.length, 1)
  assert.ok(!existsSync(join(repo, 'tests/test new.py')))
})

test('readers report output that is missing or cut short', t => {
  const { items } = scratch(t)
  assert.equal(h.readSetup('', items).problems.length, 1)
  assert.equal(h.readSetup('FACTORY worktree 0\nFACTORY main 0 0 abc', items).problems.length, 1)
  assert.equal(h.readGather('FACTORY worktree 0', items, []).problems.length, 1)
})
