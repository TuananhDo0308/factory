// ba-ticket's prototype scripts: the manifest rules of check-prototype.mjs,
// publish-prototype.sh against a bare repository, the section prototype-section.mjs
// prints, and the factory taking the page back with add-prototype.sh. No browser, no GitHub.
// What a page looks like in a browser is in ba-prototype-browser.test.mjs.
// Run: cd factory/claude && node --test tests/*.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bindingProblems, criteriaIds, existingProblems, drawnWarnings, emailWarnings, secretProblems, unbuiltProblems, existingWarnings, isPng, manifestProblems, pageProblems, wrap } from '../ba-ticket/scripts/check-prototype.mjs'
import { ticketProblems } from '../ba-ticket/scripts/check-ticket.mjs'
import { isArtifactUrl, repoOf, ticketPath } from '../ba-ticket/scripts/prototype-section.mjs'

const DRAWN = { commit: 'a'.repeat(40), files: ['web/orders.tsx'] }
const LOOK = 'in layout, elements, order, labels and messages, states, colours and fonts'
const FLOW = 'in elements, order, labels and messages, and states, but not in layout, colours or fonts'

test('criteriaIds reads criteria lines only', () => {
  assert.deepEqual(criteriaIds('- **C1** a\n- **C2.** b\ntext C3\n- **C1** again\n- see **C9**'), ['C1', 'C2'])
})

test('manifestProblems: clean, uncovered, unknown, excused without a reason, repeated', () => {
  const ok = { title: 't', binding: 'look', drawnFrom: DRAWN, screens: [{ id: 'a', title: 'A', criteria: ['C1'], shows: 's' }], notShown: [{ criterion: 'C2', why: 'server' }] }
  const is = (o, ids = ['C1', 'C2']) => manifestProblems({ ...ok, ...o }, ids).join('\n')
  assert.equal(is({}), '')
  assert.match(is({}, ['C1', 'C2', 'C3']), /C3 is on no screen/)
  assert.match(is({}, ['C1']), /C2, which the ticket does not have/)
  assert.match(is({ notShown: [{ criterion: 'C2' }] }), /does not say why/)
  assert.match(is({ screens: [...ok.screens, ...ok.screens] }), /used twice/)
  assert.match(is({ notShown: [{ criterion: 'C1', why: 'x' }] }, ['C1']), /both shown/)
  assert.match(is({ screens: [{ id: 'comment-1', title: 'A', criteria: ['C1'] }] }), /reserved[^]*does not say what it shows/)
  assert.match(manifestProblems({}, []).join(), /no screens/)
})

test('manifestProblems: what binds, what it was drawn from, the words on an image', () => {
  const ok = { title: 't', binding: 'flow', drawnFrom: { ...DRAWN, files: [] }, screens: [{ id: 'a', title: 'A', criteria: ['C1'], shows: 's' }] }
  const is = o => manifestProblems({ ...ok, ...o }, ['C1']).join('\n')
  assert.equal(is({}), '')
  for (const binding of [undefined, 'both']) assert.match(is({ binding }), /binding is "look" or "flow"/)
  for (const drawnFrom of [undefined, { commit: 'abc', files: [] }, { commit: DRAWN.commit }]) assert.match(is({ drawnFrom }), /drawnFrom/)
  for (const f of ['../x', '/x', '', 'a/../../b', 3]) assert.match(is({ drawnFrom: { ...DRAWN, files: [f] } }), /drawnFrom.*path/, String(f))
  assert.match(is({ images: true, source: 'Figma' }), /"a" has no text/)
  assert.equal(is({ images: true, source: 'Figma', screens: [{ ...ok.screens[0], text: ['Export'] }] }), '')
})

test('manifestProblems: unbuilt names screens, one text each', () => {
  const is = unbuilt => manifestProblems({ title: 't', binding: 'flow', drawnFrom: { ...DRAWN, files: [], unbuilt }, screens: [{ id: 'a', title: 'A', criteria: ['C1'], shows: 's' }] }, ['C1']).join('\n')
  for (const ok of [undefined, [], ['the Orders page, from "Show the orders"']]) assert.equal(is(ok), '')
  for (const bad of ['Orders', [''], [3], ['a\nb'], {}]) assert.match(is(bad), /drawnFrom\.unbuilt/, JSON.stringify(bad))
})

test('unbuiltProblems: a ticket that depends on another says whether it was drawn on screens that one builds', () => {
  const is = (depends, drawnFrom) => unbuiltProblems({ drawnFrom }, `## Depends on\n\n${depends}\n\n## Notes\n\n- x\n`).join()
  for (const none of ['none', '- None.', '']) assert.equal(is(none, DRAWN), '', none)
  for (const some of ['- #12: the list', '- The ticket "Show the orders"', '- none of the open ones but #4']) {
    assert.match(is(some, DRAWN), /drawnFrom\.unbuilt/, some)
    assert.equal(is(some, { ...DRAWN, unbuilt: [] }), '')
    assert.equal(is(some, { ...DRAWN, unbuilt: ['Orders'] }), '')
  }
})

const TOKEN = 'ghp_' + 'a'.repeat(36)

test('secretProblems: names the file and line, never the secret; a picture is not one', () => {
  assert.deepEqual(secretProblems({ 'index.html': '<p>x</p>', 'prototype.json': '{}' }), [])
  const p = secretProblems({ 'index.html': `<p>x</p>\n<p>${TOKEN}</p>` }).join()
  assert.match(p, /index\.html, line 2, has what looks like a secret/)
  assert.ok(!p.includes(TOKEN))
  assert.deepEqual(secretProblems({ 'index.html': `<img src="data:image/png;base64,AIza${'a'.repeat(60)}">` }), [])
})

test('emailWarnings: an address that could be a person, not a made-up one', () => {
  for (const ok of ['a@example.com', 'lan@shop.example', 'x@mail.test', 'logo@2x.png', 'a@b.invalid']) assert.deepEqual(emailWarnings(ok), [], ok)
  assert.match(emailWarnings('<p>lan@customer.vn</p>').join(), /1 email address/)
})

test('pageProblems: an Artifact page is content only, with a title', () => {
  assert.deepEqual(pageProblems('<title>Orders</title><main><header></header></main>'), [])
  assert.match(pageProblems('<!doctype html><title>x</title>').join(), /content only/)
  assert.match(pageProblems('<main></main>').join(), /no <title>/)
})

test('drawnWarnings: a look drawn from no style file would not notice a new theme', () => {
  const warn = (binding, files) => drawnWarnings({ binding, drawnFrom: { ...DRAWN, files } }).join()
  assert.match(warn('look', ['web/orders.html', 'web/orders.js']), /no style file/)
  for (const f of ['web/theme.css', 'web/a.scss', 'tailwind.config.ts', 'src/tokens.json', 'src/theme/index.ts']) assert.equal(warn('look', ['web/orders.html', f]), '', f)
  assert.equal(warn('flow', ['web/orders.html']), '')
  assert.equal(warn('look', []), '')
  assert.deepEqual(drawnWarnings({}), [])
})

test('bindingProblems: every screen is in a criterion that names index.html', () => {
  const m = { binding: 'look', screens: [{ id: 'a', title: 'A' }, { id: 'a-b', title: 'Empty' }] }
  const c = (at, how = LOOK, path = 'd/issue-NN/index.html') => `- **C1** x\n- **C2** matches \`${path}\` at ${at} ${how}`
  assert.deepEqual(bindingProblems(m, c('`#a` and `#a-b`, see #12')), [])
  assert.match(bindingProblems(m, c('`#a-b`')).join(), /"a" is in no criterion/)
  assert.match(bindingProblems(m, c('`#a`, `#a-b`, `#ghost`')).join(), /#ghost, which/)
  assert.match(bindingProblems(m, '- **C1** x\nindex.html#a').join(), /no criterion names/)
  assert.deepEqual(bindingProblems({ ...m, source: 'Figma' }, c('the screens A and Empty')), [])
})

test('bindingProblems: a colour is not a screen', () => {
  const m = { binding: 'look', screens: [{ id: 'a', title: 'A' }] }
  for (const hex of ['#e11d48', '`#FFF`', '#abcd']) assert.deepEqual(bindingProblems(m, `- **C1** matches \`d/issue-NN/index.html\` at \`#a\` ${LOOK}; the accent is ${hex}`), [], hex)
  assert.deepEqual(bindingProblems({ binding: 'look', screens: [{ id: 'add', title: 'Add' }] }, `- **C1** matches \`d/issue-NN/index.html\` at \`#add\` ${LOOK}`), [])
})

test('bindingProblems: the words say what binds, and the path is one issue folder', () => {
  const is = (binding, how, path = 'd/issue-NN/index.html', more = '') => bindingProblems({ binding, screens: [{ id: 'a', title: 'A' }] }, `- **C1** matches \`${path}\` at \`#a\` ${how}${more}`).join()
  assert.equal(is('look', LOOK), '')
  assert.equal(is('flow', FLOW), '')
  assert.match(is('flow', LOOK), /C1 does not say what binds.*but not in layout/)
  assert.match(is('look', FLOW), /C1 does not say what binds/)
  assert.match(is('look', LOOK, 'other/index.html'), /not <folder>\/issue-<number>\/index\.html/)
  assert.match(is('look', LOOK, undefined, `\n- **C2** matches \`e/issue-NN/index.html\` at \`#a\` ${LOOK}`), /more than one path/)
})

test('wrap makes a fragment a whole page and leaves a whole page alone', () => {
  assert.match(wrap('<title>x</title><header></header>'), /^<!doctype html>.*charset=utf8.*<title>x<\/title>/s)
  assert.equal(wrap('<!doctype html><title>x</title>'), '<!doctype html><title>x</title>')
})

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

test('existingProblems: a source and a real screenshot per screen, by exact id', () => {
  const m = { source: 'Figma', screens: [{ id: 'a' }, { id: 'a-b' }] }
  const shots = o => new Map(Object.entries(o))
  assert.deepEqual(existingProblems(m, shots({ 'a-mobile-dark.png': PNG, 'a-b-desktop-light.png': PNG })), [])
  assert.match(existingProblems(m, shots({ 'a-b-desktop-light.png': PNG })).join(), /"a" has no screenshot/)
  assert.match(existingProblems({ ...m, source: '' }, shots({ 'a-mobile-dark.png': PNG, 'a-b-desktop-light.png': PNG })).join(), /no source/)
  for (const bad of [Buffer.alloc(0), Buffer.from('GIF89a'), PNG.subarray(0, 20)]) assert.match(existingProblems(m, shots({ 'a-mobile-dark.png': bad, 'a-b-desktop-light.png': PNG })).join(), /a-mobile-dark\.png is not a PNG/)
  assert.ok(isPng(PNG))
})

test('existingWarnings: a page that needs a server, or is too long to read', () => {
  assert.deepEqual(existingWarnings('<title>x</title><a href="https://a.test">out</a><img src="data:image/png;base64,AA">'), [])
  for (const h of ['<script src="https://cdn.test/x.js">', '<link rel="stylesheet" href="//cdn.test/x.css">', '<style>@import url(https://f.test/a)</style>', '<img src="http://a.test/b.png">']) assert.match(existingWarnings(h).join(), /server/, h)
  assert.match(existingWarnings('x'.repeat(600_000)).join(), /KB/)
})

test('ticketPath: the one path the criteria name, with the issue number', () => {
  const c = p => `- **C1** a\n- **C2** matches \`${p}\` at \`#a\``
  assert.equal(ticketPath(c('docs/ba/prototypes/issue-42/index.html'), '42'), 'docs/ba/prototypes/issue-42/index.html')
  for (const p of ['docs/issue-4/index.html', 'docs/issue-NN/index.html', '/docs/issue-42/index.html', 'docs/../issue-42/index.html', 'issue-42/index.html']) assert.equal(ticketPath(c(p), '42'), '', p)
  assert.equal(ticketPath(`${c('a/issue-42/index.html')}\n- **C3** \`b/issue-42/index.html\``, '42'), '')
  assert.equal(ticketPath('see a/issue-42/index.html', '42'), '')
})

test('isArtifactUrl, repoOf', () => {
  assert.ok(isArtifactUrl('https://claude.ai/artifact/AbC') && isArtifactUrl('https://claude.ai/code/artifact/c1-d2'))
  for (const u of ['https://claude.ai/chat/1', 'https://evil.test/artifact/a', undefined]) assert.ok(!isArtifactUrl(u))
  for (const u of ['https://github.com/o/r.git', 'https://tok@github.com/o/r', 'git@github.com:o/r.git', 'ssh://git@github.com/o/r']) assert.equal(repoOf(u), 'o/r')
  assert.equal(repoOf('https://gitlab.com/o/r'), '')
})

const at = p => fileURLToPath(new URL(`../${p}`, import.meta.url))
const DEST = 'docs/ba/prototypes/issue-42/index.html'

function setup(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ba-proto-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const repo = join(root, 'repo')
  const dir = join(root, 'proto')
  const put = (p, body) => (mkdirSync(dirname(p), { recursive: true }), writeFileSync(p, body))
  const git = (...a) => {
    const r = spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    return r.stdout.trim()
  }
  spawnSync('git', ['init', '-q', '--bare', join(root, 'remote.git')])
  spawnSync('git', ['init', '-q', '-b', 'staging', repo])
  git('config', 'user.name', 'T')
  git('config', 'user.email', 't@example.com')
  git('config', 'core.autocrlf', 'false')
  git('remote', 'add', 'origin', join(root, 'remote.git'))
  put(join(repo, 'code.txt'), 'code')
  put(join(repo, 'web/orders.tsx'), 'orders')
  git('add', '.')
  git('commit', '-qm', 'first')
  git('push', '-q', 'origin', 'staging')
  git('fetch', '-q', 'origin')
  const drawnFrom = { commit: git('rev-parse', 'HEAD'), files: ['web/orders.tsx'] }
  put(join(repo, 'wip.txt'), 'staged')
  git('add', 'wip.txt')
  const page = v => put(join(dir, 'index.html'), `<title>Orders</title><main data-screen="a">Minh Khai ${v}</main>\r\n`)
  const manifest = o => put(join(dir, 'prototype.json'), JSON.stringify({ title: 'Orders', binding: 'look', drawnFrom, screens: [{ id: 'a', title: 'A | b', criteria: ['C1'], shows: 'the list' }, { id: 'a-desktop', title: 'Frame', shows: 'nav' }], notShown: [{ criterion: 'C2', why: 'server' }], ...o }))
  page('v1')
  manifest({})
  for (const f of ['a-desktop-light', 'a-mobile-light', 'a-desktop-desktop-light']) put(join(dir, 'shots', `${f}.png`), PNG)
  put(join(dir, 'secret.env'), 'no')
  const ticket = join(root, 'body.md')
  const CRITERIA = `- **C1** On the Orders page, the list matches \`${DEST}\` at \`#a\` and \`#a-desktop\` ${LOOK}.\n- **C2** At most 50.`
  put(ticket, CRITERIA)
  const run = (cmd, ...a) => spawnSync(cmd, a, { cwd: repo, encoding: 'utf8' })
  return {
    root, repo, dir, ticket, CRITERIA, git, drawnFrom, put, page, manifest,
    tip: () => git('ls-remote', 'origin', 'refs/heads/prototype/issue-42').split('\t')[0],
    publish: (issue = '42') => run('bash', at('ba-ticket/scripts/publish-prototype.sh'), '--dir', dir, '--issue', issue),
    section: (...a) => run('node', at('ba-ticket/scripts/prototype-section.mjs'), '--issue', '42', '--ticket', ticket, '--repo', 'o/r', ...a),
  }
}

test('publish: its own branch with the prototype files only, repository untouched', t => {
  const { git, publish, tip } = setup(t)
  const before = [git('rev-parse', 'HEAD'), git('status', '--short'), git('branch')]
  const r = publish()
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual([git('rev-parse', 'HEAD'), git('status', '--short'), git('branch')], before)
  assert.equal(r.stdout.trim(), tip())
  assert.deepEqual(git('ls-tree', '-r', '--name-only', tip()).split('\n'), ['index.html', 'prototype.json', 'shots/a-desktop-desktop-light.png', 'shots/a-desktop-light.png', 'shots/a-mobile-light.png'])
  assert.equal(git('rev-list', '--count', tip()), '1')
  assert.match(git('show', `${tip()}:index.html`), /^<!doctype html>/)
})

test('publish again: the same files keep the commit, a change adds one on top', t => {
  const { git, page, publish, tip } = setup(t)
  publish()
  const first = tip()
  assert.equal(publish().stdout.trim(), first)
  page('v2')
  assert.equal(publish().status, 0)
  assert.equal(git('rev-parse', `${tip()}^`), first)
})

test("publish: the user's own page is pushed byte for byte", t => {
  const { dir, git, manifest, publish, tip } = setup(t)
  manifest({ source: 'orders.html' })
  publish()
  assert.equal(git('rev-parse', `${tip()}:index.html`), git('hash-object', '--no-filters', join(dir, 'index.html')))
})

test('publish refuses a bad issue number and a prototype with no shots', t => {
  const { dir, publish } = setup(t)
  for (const n of ['0', 'NN', '../main', '4 2']) assert.equal(publish(n).status, 64, n)
  rmSync(join(dir, 'shots'), { recursive: true })
  assert.equal(publish().status, 70)
})

test('publish refuses a prototype drawn from what no one else can see', t => {
  const { git, manifest, publish, drawnFrom } = setup(t)
  manifest({ drawnFrom: { ...drawnFrom, files: ['web/gone.tsx'] } })
  assert.match(publish().stderr, /web\/gone\.tsx is not in/)
  git('commit', '-qm', 'local only')
  manifest({ drawnFrom: { ...drawnFrom, commit: git('rev-parse', 'HEAD') } })
  assert.match(publish().stderr, /not on a branch of the remote/)
  manifest({ drawnFrom: undefined })
  assert.equal(publish().status, 70)
})

test('publish refuses a secret in the page or the manifest, the user\'s own page too, and pushes nothing', t => {
  const { dir, put, manifest, publish, tip } = setup(t)
  const refused = () => {
    const r = publish()
    assert.equal(r.status, 70)
    assert.match(r.stderr, /looks like a secret/)
    assert.ok(!r.stderr.includes(TOKEN))
    assert.equal(tip(), '')
  }
  manifest({ source: `Figma ${TOKEN}` })
  refused()
  for (const o of [{}, { source: 'orders.html' }]) {
    manifest(o)
    put(join(dir, 'index.html'), `<title>Orders</title>\n<p>${TOKEN}</p>`)
    refused()
  }
})

test('section: says which screens it was drawn on before they were built', t => {
  const { manifest, publish, section, drawnFrom } = setup(t)
  manifest({ drawnFrom: { ...drawnFrom, files: [], unbuilt: ['the Orders | page'] } })
  assert.match(section('--commit', publish().stdout.trim()).stdout, /Drawn before they were built: the Orders \\\| page/)
})

test('section: pinned to the pushed commit, whatever the working copy says now', t => {
  const { page, put, ticket, CRITERIA, publish, section } = setup(t)
  const commit = publish().stdout.trim()
  page('changed later')
  const r = section('--commit', commit, '--artifact', 'https://claude.ai/artifact/AbC')
  assert.equal(r.status, 0, r.stderr)
  for (const x of [`Commit: \`${commit}\``, `\`${DEST}\``, 'claude.ai/artifact/AbC', `git archive ${commit}`, '- C2: server', 'A \\| b', 'colours and fonts', '`web/orders.tsx`']) assert.ok(r.stdout.includes(x), x)
  const row = r.stdout.split('\n').find(l => l.startsWith('| `a`:'))
  assert.ok(row.includes(`raw/${commit}/shots/a-desktop-light.png`) && !row.includes('a-desktop-desktop'))
  assert.deepEqual(criteriaIds(`${CRITERIA}\n${r.stdout}`), ['C1', 'C2'])
  assert.deepEqual(ticketProblems({ title: 'x', body: `## Objective\na\n## Acceptance criteria\n${CRITERIA}\n## Out of scope\n- b\n## Depends on\nnone\n${r.stdout}` }), [])
  assert.ok(!section('--commit', commit).stdout.includes('claude.ai'))
  assert.equal(section('--commit', 'abc').status, 64)
  assert.equal(section('--commit', '0'.repeat(40)).status, 70)
  put(ticket, CRITERIA.replace('issue-42', 'issue-NN'))
  assert.match(section('--commit', commit).stderr, /criteria/)
})

test('section: says so when it cannot tell the repository', t => {
  const { publish, section } = setup(t)
  const commit = publish().stdout.trim()
  const r = section('--commit', commit, '--repo', '')
  assert.equal(r.status, 64)
  assert.match(r.stderr, /cannot tell the repository from origin; pass --repo/)
})

test('section: when only the flow binds it does not claim the look', t => {
  const { manifest, publish, section } = setup(t)
  manifest({ binding: 'flow' })
  const out = section('--commit', publish().stdout.trim()).stdout
  assert.match(out, /but not in layout, colours or fonts/)
  assert.ok(!out.includes('states, colours and fonts'))
})

// A run on another machine: a clone that never saw the prototype. A file:// clone,
// because a clone by path copies every object, the prototype's included.
function onRun(t, o = {}) {
  const s = setup(t)
  if (o.manifest) s.manifest(o.manifest)
  if (o.drawn) s.manifest({ drawnFrom: { ...s.drawnFrom, ...o.drawn } })
  const commit = s.publish().stdout.trim()
  const body = `## Acceptance criteria\n${s.CRITERIA}\n\n${s.section('--commit', commit).stdout}`
  const other = join(s.root, 'other')
  if (o.later) o.later(s)
  spawnSync('git', ['clone', '-q', '--single-branch', '-b', 'staging', `file://${join(s.root, 'remote.git')}`, other])
  const git = (...a) => spawnSync('git', ['-C', other, ...a], { encoding: 'utf8' }).stdout.trim()
  git('config', 'user.name', 'T')
  git('config', 'user.email', 't@example.com')
  git('switch', '-qc', 'factory/run-1')
  s.put(join(other, 'wip.txt'), 'wip')
  git('add', 'wip.txt')
  assert.notEqual(spawnSync('git', ['-C', other, 'cat-file', '-e', commit]).status, 0)
  const add = (text = body, ...more) => {
    s.put(s.ticket, text)
    return spawnSync('bash', [at('factory/scripts/add-prototype.sh'), '--issue', '42', '--ticket', s.ticket, ...more], { cwd: other, encoding: 'utf8' })
  }
  return { ...s, commit, body, other, git, add, prototypeGit: s.git }
}

const FOLDER = DEST.replace('index.html', '')

test('factory: takes the approved files from the branch, commits them alone, prints the base', t => {
  const { git, add, body, other, commit } = onRun(t)
  const r = add()
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout.trim(), git('rev-parse', 'HEAD'))
  assert.deepEqual(git('show', '--name-only', '--format=', 'HEAD').split('\n'), [DEST, `${FOLDER}prototype.json`])
  assert.equal(git('status', '--short'), 'A  wip.txt')
  assert.equal(git('rev-parse', `HEAD:${DEST}`), git('rev-parse', `${commit}:index.html`))
  assert.match(readFileSync(join(other, DEST), 'utf8'), /Minh Khai v1/)
  assert.equal(add(body.replace(/\n/g, '\r\n')).stdout.trim(), r.stdout.trim(), 'the same files again, from a body with CRLF, commit nothing')
})

test("factory: the user's own prototype comes with its pictures", t => {
  const { git, add } = onRun(t, { manifest: { source: 'Figma' } })
  assert.equal(add().status, 0)
  assert.deepEqual(git('show', '--name-only', '--format=', 'HEAD').split('\n').filter(f => f.endsWith('.png')), ['a-desktop-desktop-light', 'a-desktop-light', 'a-mobile-light'].map(f => `${FOLDER}shots/${f}.png`))
})

test('factory: a later change on the branch does not change what the run takes', t => {
  const { add, other, page, publish } = onRun(t)
  page('v2')
  publish()
  assert.equal(add().status, 0)
  assert.match(readFileSync(join(other, DEST), 'utf8'), /v1/)
})

const change = file => s => {
  s.put(join(s.repo, file), 'changed')
  s.git('add', file)
  s.git('commit', '-qm', 'later', '--', file)
  s.git('push', '-q', 'origin', 'staging')
}

test('factory: stops when the screen changed after it was drawn, unless the user accepts it', t => {
  const { add, git } = onRun(t, { later: change('web/orders.tsx') })
  const r = add()
  assert.equal(r.status, 75)
  assert.match(r.stderr, /web\/orders\.tsx/)
  assert.equal(git('status', '--short'), 'A  wip.txt')
  assert.equal(add(undefined, '--accept-changed').status, 0)
})

test('factory: stops when it was drawn on screens not yet built, unless the user accepts it', t => {
  const { add, git } = onRun(t, { drawn: { files: [], unbuilt: ['the Orders page'] } })
  const r = add()
  assert.equal(r.status, 75)
  assert.match(r.stderr, /the Orders page/)
  assert.equal(git('status', '--short'), 'A  wip.txt')
  assert.equal(add(undefined, '--accept-changed').status, 0)
})

test('factory: a change elsewhere does not stop it', t => {
  assert.equal(onRun(t, { later: change('code.txt') }).add().status, 0)
})

test('factory: refuses a missing commit, other paths and branches, symlinks, work in progress', t => {
  const { root, git, add, body, commit, other, put } = onRun(t)
  const moved = path => body.replaceAll(DEST, path)
  assert.equal(add(body.replaceAll(commit, '0'.repeat(40))).status, 69)
  for (const path of ['../issue-42/index.html', '/tmp/issue-42/index.html', 'docs/../issue-42/index.html', 'docs/issue-7/index.html', '.git/issue-42/index.html']) assert.equal(add(moved(path)).status, 64, path)
  assert.equal(add('no section').status, 64)
  assert.match(add(body.replace(DEST, 'docs/issue-42/index.html')).stderr, /criteria name/)
  mkdirSync(join(root, 'out'))
  symlinkSync(join(root, 'out'), join(other, 'link'))
  assert.equal(add(moved('link/issue-42/index.html')).status, 70)
  put(join(other, DEST), 'mine')
  assert.equal(add().status, 70)
  assert.equal(readFileSync(join(other, DEST), 'utf8'), 'mine')
  git('switch', '-q', 'staging')
  assert.match(add(moved('docs/issue-42/index.html')).stderr, /not on a factory/)
})

test('factory: a deleted branch is reported, before anything is written', t => {
  const { root, add, prototypeGit, git } = onRun(t)
  prototypeGit('push', '-q', 'origin', ':prototype/issue-42')
  spawnSync('git', ['-C', join(root, 'remote.git'), 'gc', '-q', '--prune=now'])
  const r = add()
  assert.equal(r.status, 69)
  assert.match(r.stderr, /deleted\?/)
  assert.equal(git('status', '--short'), 'A  wip.txt')
})
