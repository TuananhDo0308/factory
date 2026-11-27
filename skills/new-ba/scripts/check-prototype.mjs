#!/usr/bin/env node
// Check the batch's prototype of the whole flow and take its screenshots.
//
//   node check-prototype.mjs --dir <prototype dir> --batch <batch dir>
//                            [--themes light,dark] [--playwright <dir with playwright and axe-core>]
//                            [--only <screen id,id>] [--jobs 6] [--timeout 300]
//
// The directory holds index.html (content only, self-contained, no doctype or <html>;
// fonts embedded as data: URIs are fine) and prototype.json:
//   { "title": "...",
//     "binding": "look" or "flow",
//     "drawnFrom": { "commit": "<full id>", "files": ["web/orders.tsx"] },     (optional; for screens that exist)
//     "screens":  [{ "id": "list", "title": "Tasks, some done", "criteria": ["C5", "C8"],
//                  "shows": "The list with the add field on top and a checkbox per row" }],
//     "notShown": [{ "criterion": "C3", "why": "a reload; nothing to draw" }] }
// index.html#<id> must open the screen whose element has data-screen="<id>", alone.
// Each part a ticket builds is marked data-slot="<name>" (the slot:<name> of the plan),
// or data-change when the whole screen is one ticket's.
// Criterion ids are unique across the batch, so a screen may carry several tickets'.
// Every criterion of a ticket that names index.html is on a screen or in notShown.
//
// With --existing (a prototype the user already had, "source" in the manifest, and
// "images" when it is pictures) nothing is opened: the manifest is checked against
// the batch, and each screen must have a screenshot in shots/.
//
// --wrap <index.html> prints the page as a whole document and does nothing else.
//
// Otherwise every screen is opened at 1440 and 390 wide, in each theme, with the network
// blocked, and its buttons are pressed, those a press opens (a dialog) too.
// Screenshots go to <dir>/shots/<id>-<desktop|mobile>-<theme>.png.
// --jobs is how many pages are open at once (6, fewer on a machine with fewer cores).
// --only checks just those screens and keeps the other screenshots, for a small fix;
// a review and publishing need a run on every screen.
// --timeout stops the browser checks after that many seconds (300) with a problem, so a
// press loop that grows cannot hang the run; "progress:" lines show how far it got.
// "look:" lines also name the generic defaults of references/taste-template.md that
// a script can see: default fonts, purple gradients, emoji icons, filler text, and
// content squeezed into a narrow column at 1440.
//
// Exit codes: 0 clean, "look:" lines aside · 1 problems, one per line · 64 usage · 69 no Playwright or axe-core
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { secretLines, withoutPictures } from './check-ticket.mjs';
import { CRITERION, readBatchDir } from './lib.mjs';

// What a criterion says it binds, word for word, so every agent compares the same things.
export const BINDING = {
  look: 'in layout, elements, order, labels and messages, states, colours and fonts',
  flow: 'in elements, order, labels and messages, and states, but not in layout, colours or fonts',
};

// The lines of a ticket that are criteria: { id, text }.
export const criteriaLines = (body) =>
  body.split(/\r?\n/).flatMap((l) => {
    const m = CRITERION.exec(l);
    return m ? [{ id: m[1], text: m[2] }] : [];
  });

// The ids of the ticket's criteria, from lines written `- **C1** ...`.
export const criteriaIds = (body) => [...new Set(criteriaLines(body).map((c) => c.id))];

// What is wrong with the manifest, against the ticket's criteria.
// required: criteria that must be shown or excused · known: every criterion of the batch.
export function manifestProblems(manifest, required, known = required) {
  const out = [];
  const screens = Array.isArray(manifest.screens) ? manifest.screens : [];
  const notShown = Array.isArray(manifest.notShown) ? manifest.notShown : [];
  if (!manifest.title) out.push('prototype.json has no title');
  if (screens.length === 0) out.push('prototype.json lists no screens');
  if (!Object.hasOwn(BINDING, manifest.binding ?? '')) out.push('prototype.json: binding is "look" or "flow"');
  const drawn = manifest.drawnFrom;
  if (drawn) {
    if (!/^[0-9a-f]{40,64}$/.test(drawn.commit || '')) out.push('prototype.json: drawnFrom.commit is the full id of the commit the existing screens were drawn from');
    if (!Array.isArray(drawn.files)) out.push('prototype.json: drawnFrom.files lists the files of the screens that exist already');
    else for (const f of drawn.files) if (typeof f !== 'string' || !f || f.startsWith('/') || f.split('/').includes('..')) out.push(`prototype.json: drawnFrom.files has "${f}", which is not a path inside the repository`);
  }
  if (required.length === 0) out.push('no ticket has a criterion that names the prototype (index.html)');
  const seen = new Set();
  const covered = new Set();
  for (const s of screens) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(s.id || '')) out.push(`screen id "${s.id}" is not lower-case words joined by hyphens`);
    if (seen.has(s.id)) out.push(`screen id "${s.id}" is used twice`);
    seen.add(s.id);
    if (/^(settings|sidebar|customize|upgrade|downloads)$|^comment-/.test(s.id || '')) out.push(`screen id "${s.id}" is reserved in an Artifact's URL`);
    if (!s.title) out.push(`screen "${s.id}" has no title`);
    if (!s.shows) out.push(`screen "${s.id}" does not say what it shows`);
    if (manifest.images && !(Array.isArray(s.text) && s.text.length > 0)) out.push(`screen "${s.id}" has no text: list every word on the image, in reading order`);
    for (const c of s.criteria || []) covered.add(c);
  }
  for (const n of notShown) {
    if (!n.why) out.push(`notShown ${n.criterion} does not say why`);
    if (covered.has(n.criterion)) out.push(`${n.criterion} is both shown and in notShown`);
    covered.add(n.criterion);
  }
  for (const id of required) if (!covered.has(id)) out.push(`${id} is on no screen and not in notShown`);
  for (const c of covered) if (!known.includes(c)) out.push(`prototype.json names ${c}, which no ticket of the batch has`);
  return out;
}

// What would be published to everyone who can see the repository, and stay in its history.
export const secretProblems = (texts) => Object.entries(texts).flatMap(([name, text]) => secretLines(text).map((n) => `${name}, line ${n}, has what looks like a secret`));

export function emailWarnings(text) {
  const found = new Set((withoutPictures(text).match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\b/gi) || []).filter((e) => !/@(?:.*\.)?example\.[a-z]+$|\.(?:example|test|invalid|localhost|png|jpe?g|svg|webp|gif)$/i.test(e)));
  return found.size > 0 ? [`${found.size} email address${found.size > 1 ? 'es' : ''} not at example.com, .example or .test; is any a real person's?`] : [];
}

// Screens no criterion binds. A criterion binds screens when it names the
// prototype's index.html and each screen's #id; for a prototype the user had,
// whose page may have no ids, the screen's title instead.
export function bindingProblems(manifest, body) {
  const binding = criteriaLines(body).filter((c) => c.text.includes('index.html'));
  if (binding.length === 0) return ['no criterion names the prototype (index.html)'];
  const out = [];
  const paths = new Set(binding.flatMap((c) => prototypePaths(c.text)));
  if (paths.size > 1) out.push(`the criteria name more than one path: ${[...paths].join(', ')}`);
  for (const p of paths) if (!/^([A-Za-z0-9_-][A-Za-z0-9._-]*\/)+[a-z0-9][a-z0-9-]*\/index\.html$/.test(p)) out.push(`${p} is not <folder>/<batch id>/index.html`);
  const words = BINDING[manifest.binding];
  for (const c of words ? binding : []) if (!c.text.includes(words)) out.push(`${c.id} does not say what binds; for "${manifest.binding}" the words are "${words}"`);
  const text = binding.map((c) => c.text).join('\n');
  const ids = new Set((manifest.screens || []).map((s) => s.id));
  const named = new Set([...text.matchAll(/#([a-z0-9][a-z0-9-]*)/gi)].map((m) => m[1]));
  for (const s of manifest.screens || []) {
    if (!named.has(s.id) && !(manifest.source && s.title && text.includes(s.title))) out.push(`screen "${s.id}" is in no criterion that names index.html`);
  }
  // Not a screen: an issue's number, a colour.
  for (const n of named) if (!ids.has(n) && !/^\d+$|^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(n)) out.push(`a criterion names #${n}, which the prototype does not have`);
  return out;
}

// The index.html paths a text names.
export const prototypePaths = (text) => [...text.matchAll(/[^\s`"'()[\]#]*index\.html/g)].map((m) => m[0]);

// A bound look drawn from no style file: a new theme would go unnoticed.
export function drawnWarnings(manifest) {
  const files = manifest.drawnFrom?.files;
  if (manifest.binding !== 'look' || !Array.isArray(files) || files.length === 0) return [];
  if (files.some((f) => /\.(css|scss|sass|less|styl)$|theme|tokens?\b|tailwind/i.test(f))) return [];
  return ['drawnFrom.files has no style file, so a changed theme would not stop the run; add the files the look comes from'];
}

// What would break index.html as an Artifact page.
export function pageProblems(html) {
  const out = [];
  if (/<!doctype|<html[\s>]|<body[\s>]/i.test(html)) out.push('index.html must be content only: no doctype, <html> or <body>');
  if (!/<title>[^<]+<\/title>/i.test(html)) out.push('index.html has no <title>');
  return out;
}

const SKELETON =
  '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#fff;color:#000}img{max-width:100%}[hidden]{display:none!important}</style></head><body>';

// The page as any browser opens it: a whole document stays as it is.
export const wrap = (html) => (/<!doctype|<html[\s>]/i.test(html) ? html : `${SKELETON}${html}</body></html>\n`);

// A whole PNG: signature, header with a size, and the end chunk.
export function isPng(b) {
  return b.length > 45 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && b.toString('latin1', 12, 16) === 'IHDR' && b.readUInt32BE(16) > 0 && b.readUInt32BE(20) > 0 && b.subarray(-12).includes('IEND');
}

// What is wrong with a prototype the user already had, given the files in shots/ by name.
export function existingProblems(manifest, shots) {
  const out = [];
  if (!manifest.source) out.push('prototype.json has no source: say where the prototype comes from');
  for (const s of manifest.screens || []) {
    const own = [...shots].filter(([f]) => new RegExp(`^${s.id}-(desktop|mobile)-(light|dark)\\.png$`).test(f));
    if (own.length === 0) out.push(`screen "${s.id}" has no screenshot`);
    for (const [f, data] of own) if (!isPng(data)) out.push(`shots/${f} is not a PNG`);
  }
  return out;
}

// What the agents may not manage with the user's own page, which is never edited:
// their screenshots and the manifest then have to be enough.
export function existingWarnings(html) {
  const out = [];
  if (/<(?:script|img|iframe|source|video|audio)\b[^>]*\bsrc\s*=\s*["']?(?:https?:)?\/\/|<link\b[^>]*\bhref\s*=\s*["']?(?:https?:)?\/\/|@import\s+(?:url\()?["']?(?:https?:)?\/\/|url\(\s*["']?(?:https?:)?\/\//i.test(html)) out.push('index.html loads from a server; an agent without the network sees something else, so the screenshots must be enough');
  if (html.length > 500_000) out.push(`index.html is ${Math.round(html.length / 1000)} KB, too long for an agent to read; the screenshots and the manifest must be enough`);
  return out;
}

// The generic defaults a script can see in the source (references/taste-template.md).
const GENERIC_FONTS = /^(?:inter|roboto|arial|helvetica(?: neue)?|open sans|lato|system-ui|-apple-system|blinkmacsystemfont|segoe ui|sans-serif|ui-sans-serif)$/i;
export function tasteWarnings(html) {
  const out = [];
  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n').replace(/url\(\s*["']?data:[^)]*\)/g, 'url()');
  const families = [...css.matchAll(/font-family\s*:\s*([^;}]+)/gi)].map((m) => m[1].split(',')[0].trim().replace(/^["']|["']$/g, ''));
  const firsts = families.filter((f) => !/^var\(/.test(f));
  if (firsts.length > 0 && firsts.every((f) => GENERIC_FONTS.test(f))) out.push(`every font-family starts with a default face (${[...new Set(firsts)].join(', ')}); embed a typeface chosen for this product (scripts/embed-font.mjs)`);
  if (/@font-face/.test(css) === false && firsts.length > 0) out.push('no @font-face: the page can only use the viewer\'s system fonts');
  if (/(?:linear|radial|conic)-gradient\([^)]*(?:#(?:6366f1|8b5cf6|7c3aed|a855f7|9333ea|6d28d9|4f46e5|c084fc)|purple|violet|indigo)/i.test(css)) out.push('a purple or indigo gradient, the most common AI default');
  const text = html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|<[^>]+>/g, ' ');
  const emoji = text.match(/\p{Extended_Pictographic}/gu) || [];
  if (emoji.length > 0) out.push(`${emoji.length} emoji in the text (${[...new Set(emoji)].slice(0, 5).join(' ')}); draw icons as inline SVG or leave them out`);
  if (/lorem ipsum|dolor sit amet|john doe|jane doe|acme(?: corp| inc)?\b|foo bar|sample text|placeholder text/i.test(text)) out.push('filler text or stock names; use content close to what real users will write');
  return out;
}

// Runs in the page: how much of the width the screen's content uses.
function spread(id) {
  const screen = document.querySelector(`[data-screen="${id}"]`);
  if (!screen) return 1;
  let left = Infinity;
  let right = -Infinity;
  for (const el of screen.querySelectorAll('*')) {
    if (!el.childElementCount && !el.textContent.trim() && !['INPUT', 'BUTTON', 'IMG', 'svg', 'TEXTAREA', 'SELECT'].includes(el.tagName)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.width >= window.innerWidth - 2) continue;
    left = Math.min(left, r.left);
    right = Math.max(right, r.right);
  }
  return right > left ? (right - left) / window.innerWidth : 1;
}

function args(argv) {
  const out = {};
  const i = argv.indexOf('--existing');
  if (i >= 0) {
    out.existing = true;
    argv = argv.toSpliced(i, 1);
  }
  for (let i = 0; i < argv.length; i += 2) out[argv[i].replace(/^--/, '')] = argv[i + 1];
  return out;
}

const list = (v) => (v ? String(v).split(',').map((x) => x.trim()).filter(Boolean) : []);

// Runs the jobs, at most n at a time; calls done() after each.
export async function pool(jobs, n, done = () => {}) {
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      await job();
      done();
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, worker));
}

// At most n held at once: take() waits for one, give() hands it back.
export function limiter(n) {
  let free = n;
  const waiting = [];
  return {
    take: () => (free > 0 ? ((free -= 1), Promise.resolve()) : new Promise((r) => waiting.push(r))),
    give: () => {
      const next = waiting.shift();
      if (next) next();
      else free += 1;
    },
  };
}

const requireFrom = (dir) => createRequire(path.join(path.resolve(dir), 'package.json'));

function loadChromium(dir) {
  const require = requireFrom(dir);
  for (const name of ['playwright', '@playwright/test', 'playwright-core']) {
    try {
      return require(name).chromium;
    } catch (e) {
      if (e.code !== 'MODULE_NOT_FOUND') throw e;
    }
  }
  return null;
}

function loadAxe(dir) {
  try {
    return fs.readFileSync(requireFrom(dir).resolve('axe-core/axe.min.js'), 'utf8');
  } catch {
    return null;
  }
}

// Runs in the page, after axe: text a person cannot read. Text the colour of its
// background is "incomplete" to axe, so it is asked for too.
async function contrast() {
  const r = await window.axe.run(document, { runOnly: ['color-contrast'], resultTypes: ['violations', 'incomplete'] });
  const at = (n) => `contrast too low: "${(document.querySelector(n.target[0])?.textContent || '').trim().slice(0, 40)}"`;
  return [
    ...r.violations.flatMap((v) => v.nodes.map(at)),
    ...r.incomplete.flatMap((v) => v.nodes.filter((n) => n.any.some((c) => c.data?.messageKey === 'equalRatio')).map(at)),
  ];
}

const BUTTONS = 'button, [role=button], input[type=button], input[type=submit], input[type=reset]';

// Runs in the page: the buttons to press, as indexes into every BUTTONS on it.
// One that says it is the current choice is right to do nothing.
function pressable(selector) {
  return [...document.querySelectorAll(selector)].flatMap((el, i) => {
    const off = el.disabled || el.getAttribute('aria-disabled') === 'true' || ['aria-current', 'aria-pressed', 'aria-selected'].some((a) => !['', 'false'].includes(el.getAttribute(a) || ''));
    const shown = el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    // In something laid over the page, such as a dialog the press before opened.
    const over = !!el.closest('dialog[open], [role=dialog], [role=alertdialog], :popover-open');
    return shown && !off ? [{ i, over, name: (el.getAttribute('aria-label') || el.textContent || el.value || '').trim().slice(0, 40) }] : [];
  });
}

// Runs in the page: everything a press could change that a person would notice.
function snapshot([selector, i]) {
  const el = document.querySelectorAll(selector)[i];
  const active = document.activeElement;
  return JSON.stringify([
    document.documentElement.outerHTML,
    location.href,
    document.title,
    [...document.querySelectorAll('input, select, textarea')].map((e) => [e.value, e.checked]),
    document.querySelectorAll('dialog[open], :popover-open').length,
    active === el || active === document.body ? '' : [...document.querySelectorAll('*')].indexOf(active),
    Math.round(window.scrollY),
  ]);
}

// Runs in the page: what a person would trip on in the screen that is open.
function inspect(id) {
  const out = [];
  const shown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const screen = document.querySelector(`[data-screen="${id}"]`);
  if (!screen) return [`no element has data-screen="${id}"`];
  if (!shown(screen)) out.push(`#${id} does not show the screen`);
  for (const other of document.querySelectorAll('[data-screen]')) {
    if (other !== screen && shown(other) && !other.contains(screen) && !screen.contains(other)) out.push(`also shows "${other.dataset.screen}"; a screen is shown alone`);
  }
  if (![screen, ...screen.querySelectorAll('[data-change], [data-slot]')].some((el) => (el.hasAttribute('data-change') || el.hasAttribute('data-slot')) && shown(el)) && !screen.closest('[data-change], [data-slot]')) out.push('marks nothing with data-slot or data-change: which ticket builds what here?');
  for (const el of document.querySelectorAll('body *')) {
    if (!shown(el) || getComputedStyle(el).cursor !== 'pointer' || getComputedStyle(el.parentElement).cursor === 'pointer') continue;
    if (el.closest('a[href], button, input, select, textarea, label, summary, option, [tabindex], [contenteditable]') || el.querySelector('a[href], button, input, select, textarea')) continue;
    out.push(`"${el.textContent.trim().slice(0, 40)}" is for a mouse only; a keyboard cannot reach it`);
  }
  const over = document.documentElement.scrollWidth - window.innerWidth;
  if (over > 1) out.push(`the page scrolls sideways by ${over}px`);
  const targets = new Set([...document.querySelectorAll('[data-screen]')].map((el) => el.dataset.screen));
  for (const a of document.querySelectorAll('a')) {
    if (!shown(a)) continue;
    const href = a.getAttribute('href') || '';
    const text = a.textContent.trim().slice(0, 40);
    if (href === '' || href === '#') out.push(`link "${text}" goes nowhere`);
    else if (href.startsWith('#') && !targets.has(href.slice(1)) && !document.getElementById(href.slice(1))) out.push(`link "${text}" goes to ${href}, which does not exist`);
  }
  for (const el of document.querySelectorAll('button, input:not([type=hidden]), select, textarea')) {
    if (!shown(el)) continue;
    const named = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.title || (el.labels && el.labels.length > 0) || (el.tagName === 'BUTTON' && el.textContent.trim()) || (/^(submit|button|reset)$/.test(el.type) && el.value);
    if (!named) out.push(`a ${el.tagName.toLowerCase()} has no name (${el.outerHTML.slice(0, 60)})`);
  }
  return out;
}

async function main() {
  const a = args(process.argv.slice(2));
  if (a.wrap) {
    process.stdout.write(wrap(fs.readFileSync(a.wrap, 'utf8')));
    return 0;
  }
  if (!a.dir || !a.batch) {
    console.error('usage: check-prototype.mjs --dir <dir> --batch <batch dir> [--themes light,dark] [--playwright <dir>] [--only <id,id>] [--jobs 6] [--timeout 300] [--existing]');
    return 64;
  }
  const dir = path.resolve(a.dir);
  const index = path.join(dir, 'index.html');
  if (!fs.existsSync(index)) {
    console.error(`no ${index}`);
    return 1;
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(dir, 'prototype.json'), 'utf8'));
  } catch (e) {
    console.error(`prototype.json: ${e.message}`);
    return 1;
  }
  const { tickets } = readBatchDir(a.batch);
  const bodies = tickets.map((t) => t.body || '');
  const body = bodies.join('\n');
  const required = bodies.filter((b) => criteriaLines(b).some((c) => c.text.includes('index.html'))).flatMap(criteriaIds);
  const problems = new Set([...manifestProblems(manifest, required, criteriaIds(body)), ...bindingProblems(manifest, body)]);
  const texts = { 'index.html': fs.readFileSync(index, 'utf8'), 'prototype.json': fs.readFileSync(path.join(dir, 'prototype.json'), 'utf8') };
  for (const p of secretProblems(texts)) problems.add(p);
  for (const w of emailWarnings(Object.values(texts).join('\n'))) console.error(`look: ${w}`);
  for (const w of drawnWarnings(manifest)) console.error(`look: ${w}`);
  if (a.existing) {
    const given = path.join(dir, 'shots');
    const shots = new Map((fs.existsSync(given) ? fs.readdirSync(given) : []).map((f) => [f, fs.readFileSync(path.join(given, f))]));
    for (const p of existingProblems(manifest, shots)) problems.add(p);
    for (const w of existingWarnings(fs.readFileSync(index, 'utf8'))) console.error(`look: ${w}`);
    for (const p of problems) console.error(`problem: ${p}`);
    return problems.size > 0 ? 1 : 0;
  }
  if (manifest.source) {
    console.error('prototype.json has a source, so it is the user\'s; pass --existing');
    return 64;
  }
  const chromium = loadChromium(a.playwright || '.');
  const axe = loadAxe(a.playwright || '.');
  if (!chromium || !axe) {
    console.error(`${chromium ? 'axe-core' : 'Playwright'} not found; pass --playwright <a directory where both are installed>`);
    return 69;
  }
  const shots = path.join(dir, 'shots');
  const html = fs.readFileSync(index, 'utf8');
  for (const p of pageProblems(html)) problems.add(p);
  for (const w of tasteWarnings(html)) console.error(`look: ${w}`);
  const themes = list(a.themes || 'light');
  const firstTheme = themes[0];
  const all = manifest.screens || [];
  const only = list(a.only);
  for (const id of only) if (!all.some((s) => s.id === id)) problems.add(`--only names "${id}", which prototype.json does not have`);
  const screens = only.length > 0 ? all.filter((s) => only.includes(s.id)) : all;
  const workers = Math.max(1, Number(a.jobs) || Math.min(6, os.availableParallelism()));
  const seconds = Number(a.timeout) || 300;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-prototype-'));
  const page0 = path.join(tmp, 'index.html');
  fs.writeFileSync(page0, wrap(html));
  if (only.length === 0) fs.rmSync(shots, { recursive: true, force: true });
  else for (const f of fs.existsSync(shots) ? fs.readdirSync(shots) : []) if (screens.some((s) => new RegExp(`^${s.id}-(desktop|mobile)-[a-z]+\\.png$`).test(f))) fs.rmSync(path.join(shots, f));
  fs.mkdirSync(shots, { recursive: true });
  const browser = await chromium.launch();
  const files = [];
  // A button with the same name pressed elsewhere already showed it works (the prototype bar, a filter).
  // The first press of a name is waited for; only one that did nothing is pressed again.
  const claims = new Map();
  const unlessWorks = async (key, pressIt) => {
    let seen;
    while (claims.has(key) && claims.get(key) !== seen) {
      seen = claims.get(key);
      if (await seen) return null;
    }
    const result = pressIt();
    claims.set(key, result.then((r) => r.noticed, () => false));
    return result;
  };
  // Every page is a browser context of its own, and none waits for a second one while it holds
  // one, so at most `workers` are open at a time.
  const gate = limiter(workers);

  // One check per screen, width and theme. The one at 1440 in the first theme also presses
  // the buttons, so those go first and the long ones start early.
  const check = (s, vp, width, height, theme) => async () => {
    const where = `${s.id} (${vp}, ${theme})`;
    const open = async (hash) => {
      await gate.take();
      let ctx;
      try {
        ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme, reducedMotion: 'reduce' });
      } catch (e) {
        gate.give();
        throw e;
      }
      ctx.on('close', gate.give);
      const loads = (url) => problems.add(`${where}: loads ${url}; the file must be self-contained`);
      await ctx.route(/^https?:/, (r) => (loads(r.request().url()), r.abort()));
      await ctx.routeWebSocket(/./, (ws) => (loads(ws.url()), ws.close()));
      const page = await ctx.newPage();
      page.on('pageerror', (e) => problems.add(`${where}: script error: ${e.message}`));
      page.on('console', (m) => {
        if (m.type() === 'error' && !/ERR_FAILED/.test(m.text())) problems.add(`${where}: console error: ${m.text()}`);
      });
      await page.goto(`${pathToFileURL(page0).href}#${hash}`, { waitUntil: 'load' });
      await page.waitForTimeout(300);
      return page;
    };
    const page = await open(s.id);
    for (const p of await page.evaluate(inspect, s.id)) problems.add(`${where}: ${p}`);
    if (vp === 'desktop' && theme === firstTheme) {
      const used = await page.evaluate(spread, s.id);
      if (used < 0.55) console.error(`look: ${s.id} at 1440 uses ${Math.round(used * 100)}% of the width; a narrow centred column with empty sides is the generic default. Use the width for what the product shows, or say why it is right`);
    }
    const file = path.join(shots, `${s.id}-${vp}-${theme}.png`);
    await page.screenshot({ path: file, fullPage: true });
    files.push(file);
    await page.evaluate(axe);
    const unreadable = await page.evaluate(contrast);
    for (const p of unreadable) problems.add(`${where}: ${p}`);
    const buttons = await page.evaluate(pressable, BUTTONS);
    await page.context().close();
    if (vp !== 'desktop' || theme !== firstTheme) return;

    const other = all.find((x) => x.id !== s.id);
    if (other) {
      const moved = await open(other.id);
      await moved.evaluate((id) => (location.hash = id), s.id);
      await moved.waitForTimeout(300);
      const shows = await moved.evaluate((id) => (document.querySelector(`[data-screen="${id}"]`)?.getClientRects().length ?? 0) > 0, s.id);
      if (!shows) problems.add(`${where}: does not open when the hash changes`);
      await moved.context().close();
    }
    // Presses the buttons one after another on a fresh screen; says whether a
    // person would notice the last press, and leaves the page open.
    const press = async (path) => {
      const page = await open(s.id);
      let noticed = false;
      page.on('dialog', (d) => ((noticed = true), d.accept().catch(() => {})));
      page.on('download', () => (noticed = true));
      await page.evaluate(() => (window.print = () => document.body.setAttribute('data-printed', '')));
      let before;
      for (const i of path) {
        noticed = false;
        before = await page.evaluate(snapshot, [BUTTONS, i]);
        // A press dispatched to the button itself, so a thing lying over it does not matter here.
        await page.evaluate(([selector, i]) => { const el = document.querySelectorAll(selector)[i]; el?.focus(); el?.click(); }, [BUTTONS, i]);
        await page.waitForTimeout(250);
      }
      return { page, noticed: noticed || before !== (await page.evaluate(snapshot, [BUTTONS, path.at(-1)])) };
    };
    const dead = 'does nothing a person would notice; make it work, or draw it disabled';
    const tried = new Set();
    const key = (b) => `${b.name}|${b.over}`;
    // Each button on a fresh page of its own, so they are pressed side by side.
    await pool(
      buttons.map((b) => async () => {
        const first = await unlessWorks(key(b), () => press([b.i]));
        if (!first) return;
        const { page: pressed, noticed } = first;
        if (!noticed) problems.add(`${where}: button "${b.name}" ${dead}`);
        // What the press opened: one step further, each button by its name once.
        const deeper = noticed && !tried.has(b.name);
        tried.add(b.name);
        const opened = deeper ? (await pressed.evaluate(pressable, BUTTONS)).filter((n) => !buttons.some((x) => x.name === n.name && x.over === n.over)) : [];
        if (deeper) {
          await pressed.evaluate(axe);
          for (const p of await pressed.evaluate(contrast)) if (!unreadable.includes(p)) problems.add(`${where}: after "${b.name}": ${p}`);
        }
        await pressed.context().close();
        await Promise.all(
          opened.map(async (n) => {
            const next = await unlessWorks(key(n), () => press([b.i, n.i]));
            if (!next) return;
            if (!next.noticed) problems.add(`${where}: button "${n.name}" after "${b.name}" ${dead}`);
            await next.page.context().close();
          }),
        );
      }),
      workers,
    );
  };
  const viewports = [['desktop', 1440, 900], ['mobile', 390, 844]];
  const jobs = [
    ...screens.map((s) => check(s, ...viewports[0], firstTheme)),
    ...screens.flatMap((s) => viewports.flatMap(([vp, w, h]) => themes.filter((t) => vp !== 'desktop' || t !== firstTheme).map((t) => check(s, vp, w, h, t)))),
  ];
  let done = 0;
  const step = Math.max(1, Math.ceil(jobs.length / 4));
  const running = pool(jobs, workers, () => {
    done += 1;
    if (done % step === 0 && done < jobs.length) console.error(`progress: ${done} of ${jobs.length} checks`);
  });
  running.catch(() => {});
  let timer;
  const late = new Promise((resolve) => (timer = setTimeout(() => resolve('late'), seconds * 1000)));
  try {
    if ((await Promise.race([running, late])) === 'late') problems.add(`stopped after ${seconds}s with ${done} of ${jobs.length} checks done; a button that opens many others makes the presses long: find it, or pass --timeout`);
  } finally {
    clearTimeout(timer);
    await browser.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (only.length > 0) console.error(`look: only ${screens.map((s) => s.id).join(', ')} checked; run it on every screen before a review and before publishing`);
  files.sort();
  console.log(files.join('\n'));
  for (const p of [...problems].sort()) console.error(`problem: ${p}`);
  return problems.size > 0 ? 1 : 0;
}

if (process.argv[1]?.endsWith('check-prototype.mjs')) {
  main().then(
    (code) => (process.exitCode = code),
    (e) => {
      console.error(e.message);
      process.exitCode = 1;
    },
  );
}
