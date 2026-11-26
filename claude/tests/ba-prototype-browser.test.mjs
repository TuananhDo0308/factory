// check-prototype.mjs on real pages. Needs Playwright and axe-core in a directory
// named by PLAYWRIGHT_DIR; without it these tests are skipped:
//   npm install --prefix <dir> playwright axe-core && npx --prefix <dir> playwright install chromium
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('../ba-ticket/scripts/check-prototype.mjs', import.meta.url))
const skip = process.env.PLAYWRIGHT_DIR ? false : 'PLAYWRIGHT_DIR is not set'

const GOOD = {
  style: 'main[hidden]{display:none}',
  a: '<h1>Orders</h1><div data-change><button id="b">Export</button><p id="out"></p></div>',
  b: '<h1>Orders</h1><div data-change><p>No orders</p></div>',
  script: `const show=()=>{const id=location.hash.slice(1)||'orders';for(const m of document.querySelectorAll('[data-screen]'))m.hidden=m.dataset.screen!==id};addEventListener('hashchange',show);show();document.getElementById('b').onclick=()=>{document.getElementById('out').textContent='Exported'}`,
}
const page = o => {
  const p = { ...GOOD, ...o }
  return `<title>Orders</title><style>${p.style}</style><nav><a href="#orders">List</a> <a href="#orders-empty">Empty</a></nav><main data-screen="orders">${p.a}</main><main data-screen="orders-empty">${p.b}</main><script>${p.script}</script>`
}

function check(t, o) {
  const dir = mkdtempSync(join(tmpdir(), 'ba-browser-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  writeFileSync(join(dir, 'index.html'), page(o))
  writeFileSync(join(dir, 'prototype.json'), JSON.stringify({ title: 'Orders', binding: 'look', drawnFrom: { commit: 'a'.repeat(40), files: [] }, screens: ['orders', 'orders-empty'].map(id => ({ id, title: id, criteria: ['C1'], shows: 's' })) }))
  writeFileSync(join(dir, 'body.md'), '- **C1** matches `d/issue-NN/index.html` at `#orders` and `#orders-empty` in layout, elements, order, labels and messages, states, colours and fonts.')
  const r = spawnSync('node', [SCRIPT, '--dir', dir, '--ticket', join(dir, 'body.md'), '--playwright', process.env.PLAYWRIGHT_DIR], { encoding: 'utf8' })
  return { ...r, dir }
}

test('in CI the browser is there, so these tests are never skipped', () => {
  assert.ok(!process.env.CI || process.env.PLAYWRIGHT_DIR, 'CI must set PLAYWRIGHT_DIR')
})

test('a sound prototype is clean and has its screenshots', { skip }, t => {
  const r = check(t, {})
  assert.equal(r.stderr, '')
  assert.equal(r.status, 0)
  assert.ok(existsSync(join(r.dir, 'shots/orders-empty-mobile-light.png')))
})

const BAD = [
  ['two screens at once', { script: GOOD.script.replace('m.hidden=m.dataset.screen!==id', '0') }, /orders-empty.*also shows "orders"/],
  ['the hash is read on load only', { script: GOOD.script.replace("addEventListener('hashchange',show);", '') }, /does not open when the hash changes/],
  ['a button that does nothing', { a: GOOD.a.replace('</div>', '<button>Share</button></div>') }, /button "Share" does nothing/],
  ['a control only a mouse can use', { a: GOOD.a.replace('</div>', '<span style="cursor:pointer">Delete</span></div>') }, /"Delete".*keyboard/],
  ['white on white', { b: GOOD.b.replace('<p>', '<p style="color:#fff">') }, /contrast.*No orders/],
  ['pale grey on white', { b: GOOD.b.replace('<p>', '<p style="color:#ccc">') }, /contrast.*No orders/],
  ['a screen that does not mark what changes', { b: '<p>No orders</p>' }, /orders-empty.*data-change/],
  ['a secret', { b: GOOD.b + `<p>ghp_${'a'.repeat(36)}</p>` }, /index\.html, line 1, has what looks like a secret/],
  ['a WebSocket', { script: GOOD.script + ';new WebSocket("ws://127.0.0.1:9/x")' }, /ws:\/\/127\.0\.0\.1:9\/x; the file must be self-contained/],
  ['a dead button inside a dialog', { a: GOOD.a.replace('</div>', '<button onclick="d.showModal()">Open</button><dialog id="d"><button>Share</button><button onclick="d.close()">Close</button></dialog></div>') }, /button "Share" after "Open" does nothing/],
  ['unreadable text inside a dialog', { a: GOOD.a.replace('</div>', '<button onclick="d.showModal()">Open</button><dialog id="d"><p style="color:#ccc;background:#fff">Sure about it</p></dialog></div>') }, /after "Open".*contrast.*Sure about it/],
  ['a request', { b: GOOD.b + '<img alt="" src="https://example.com/x.png">' }, /self-contained/],
]
for (const [name, o, message] of BAD) {
  test(name, { skip }, t => {
    const r = check(t, o)
    assert.match(r.stderr, message)
    assert.equal(r.status, 1)
  })
}

test('a sound dialog, opened from a list drawn again at each press, is clean', { skip }, t => {
  const script = `${GOOD.script};const list=()=>{l.innerHTML='<button class="r">Row</button><button class="r">Row two</button>';for(const b of l.children)b.onclick=()=>{list();d.showModal()}};list();ok.onclick=()=>{d.close();out.textContent='Done'}`
  const r = check(t, { a: GOOD.a.replace('</div>', '<div id="l"></div><dialog id="d"><p>Sure?</p><button id="ok">Yes</button><button disabled>Later</button></dialog></div>'), script })
  assert.equal(r.stderr, '')
  assert.equal(r.status, 0)
})

test('a button of a dialog that was open all along is pressed once, not again after itself', { skip }, t => {
  const r = check(t, { a: GOOD.a.replace('</div>', '<div role="dialog"><button onclick="out.textContent=1">One</button><button onclick="out.textContent=2">Two</button></div></div>') })
  assert.equal(r.stderr, '')
})

test('what has an effect is not called dead', { skip }, t => {
  const extra = '<button disabled>Later</button><button aria-pressed="true">Current</button><dialog id="d"><p>Sure?</p></dialog><button onclick="d.showModal()">Open</button><button onclick="alert(1)">Ask</button><button id="p" popovertarget="pop">Menu</button><div popover id="pop">Items</div><form><label>Name <input required></label><button>Save</button></form><button style="cursor:pointer" onclick="document.title+=1"><span>Icon</span></button>'
  const r = check(t, { a: GOOD.a.replace('</div>', `${extra}</div>`) })
  assert.equal(r.stderr, '')
})
