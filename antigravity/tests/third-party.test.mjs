// The third-party copies: each is listed with its source and license, and the one
// ba-ticket reads is where it says.
// Run: cd factory/claude && node --test tests/*.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const at = p => fileURLToPath(new URL(`../${p}`, import.meta.url))
const readme = readFileSync(at('third-party/README.md'), 'utf8')

test('every third-party skill is in the README, and every license it links exists', () => {
  const skills = readdirSync(at('third-party')).filter(d => existsSync(at(`third-party/${d}/SKILL.md`)))
  for (const s of skills) assert.match(readme, new RegExp(`^\\| \`${s}\` \\|`, 'm'), s)
  for (const [, link] of readme.matchAll(/\]\((?!https?:)([^)]+)\)/g)) assert.ok(existsSync(at(join('third-party', link))), link)
})

test('ba-ticket reads frontend-design, unmodified and with its license', () => {
  const guide = readFileSync(at('ba-ticket/references/prototype.md'), 'utf8')
  const [, link] = /\]\(([^)]*frontend-design\/SKILL\.md)\)/.exec(guide) || []
  assert.ok(link, 'prototype.md links the design skill')
  assert.match(readFileSync(at(join('ba-ticket/references', link)), 'utf8'), /^---\nname: frontend-design\n/)
  assert.match(readFileSync(at('third-party/frontend-design/LICENSE.txt'), 'utf8'), /Apache License/)
  assert.match(readme, /^\| `frontend-design` \|.*\b[0-9a-f]{40}\b/m)
})
