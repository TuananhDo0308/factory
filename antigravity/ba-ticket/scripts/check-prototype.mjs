#!/usr/bin/env node
// Check a ticket's prototype and take its screenshots.
//
//   node check-prototype.mjs --dir <prototype dir> --ticket <issue body file>
//                            [--themes light,dark] [--playwright <dir with playwright and axe-core>]
//
// The directory holds index.html (the Artifact page: content only, self-contained,
// no doctype or <html>) and prototype.json:
//   { "title": "...",
//     "binding": "look" or "flow",
//     "drawnFrom": { "commit": "<full id on the default branch>", "files": ["web/orders.tsx"],
//                    "unbuilt": ["<a screen another ticket has still to build>"] },
//     "screens":  [{ "id": "export-empty", "title": "No orders match", "criteria": ["C2"],
//                  "shows": "The message and a link that clears the filter" }],
//     "notShown": [{ "criterion": "C5", "why": "a server limit; nothing on screen" }] }
// index.html#<id> must open the screen whose element has data-screen="<id>", alone,
// with data-change on what the ticket changes in it.
//
// With --existing (a prototype the user already had, "source" in the manifest, and
// "images" when it is pictures) nothing is opened: the manifest is checked against
// the ticket, and each screen must have a screenshot in shots/.
//
// --secrets <dir> looks for secrets in index.html and prototype.json and does nothing else.
// --wrap <index.html> prints the page as a whole document and does nothing else.
//
// Otherwise every screen is opened at 1440 and 390 wide, in each theme, with the network
// blocked, inside the skeleton an Artifact is published in, and its buttons are pressed,
// those a press opens (a dialog) too.
// Screenshots go to <dir>/shots/<id>-<desktop|mobile>-<theme>.png.
// --playwright defaults to the current directory.
//
// Exit codes: 0 clean, "look:" lines aside · 1 problems, one per line · 64 usage · 69 no Playwright or axe-core
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CRITERION, secretLines, sections, withoutPictures } from './check-ticket.mjs';

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
export function manifestProblems(manifest, ids) {
  const out = [];
  const screens = Array.isArray(manifest.screens) ? manifest.screens : [];
  const notShown = Array.isArray(manifest.notShown) ? manifest.notShown : [];
  if (!manifest.title) out.push('prototype.json has no title');
  if (screens.length === 0) out.push('prototype.json lists no screens');
  if (!Object.hasOwn(BINDING, manifest.binding ?? '')) out.push('prototype.json: binding is "look" or "flow"');
  const drawn = manifest.drawnFrom || {};
  if (!/^[0-9a-f]{40,64}$/.test(drawn.commit || '')) out.push('prototype.json: drawnFrom.commit is the full id of the commit the screens were drawn from');
  if (!Array.isArray(drawn.files)) out.push('prototype.json: drawnFrom.files lists the files of the screens that exist already ([] when none do)');
  else for (const f of drawn.files) if (typeof f !== 'string' || !f || f.startsWith('/') || f.split('/').includes('..')) out.push(`prototype.json: drawnFrom.files has "${f}", which is not a path inside the repository`);
  if (drawn.unbuilt !== undefined && !(Array.isArray(drawn.unbuilt) && drawn.unbuilt.every((u) => typeof u === 'string' && /^\S.*$/.test(u)))) out.push('prototype.json: drawnFrom.unbuilt lists screens, one line of text each');
  if (ids.length === 0) out.push('the ticket has no criteria written `- **C1** ...`');
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
  for (const id of ids) if (!covered.has(id)) out.push(`${id} is on no screen and not in notShown`);
  for (const c of covered) if (!ids.includes(c)) out.push(`prototype.json names ${c}, which the ticket does not have`);
  return out;
}

// A screen drawn on one that another ticket has still to build is in no file yet, so no
// change of a file can show that it came out different. The manifest has to say so.
export function unbuiltProblems(manifest, body) {
  const depends = sections(body).filter((s) => /^depends on$/i.test(s.title.trim())).flatMap((s) => s.lines);
  if (depends.every((l) => /^\s*(?:[-*+]\s*)?(?:none\.?)?\s*$/i.test(l.raw)) || manifest.drawnFrom?.unbuilt !== undefined) return [];
  return ['the ticket depends on another; prototype.json: drawnFrom.unbuilt lists the screens it was drawn on that the other has still to build ([] when none)'];
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
  for (const p of paths) if (!/^([A-Za-z0-9_-][A-Za-z0-9._-]*\/)+issue-(NN|[1-9]\d*)\/index\.html$/.test(p)) out.push(`${p} is not <folder>/issue-<number>/index.html`);
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
  if (![screen, ...screen.querySelectorAll('[data-change]')].some((el) => el.hasAttribute('data-change') && shown(el)) && !screen.closest('[data-change]')) out.push('marks nothing with data-change: what does the ticket change here?');
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
  if (a.secrets) {
    const found = secretProblems(Object.fromEntries(['index.html', 'prototype.json'].map((f) => [f, fs.readFileSync(path.join(a.secrets, f), 'utf8')])));
    for (const p of found) console.error(`problem: ${p}`);
    return found.length > 0 ? 1 : 0;
  }
  if (!a.dir || !a.ticket) {
    console.error('usage: check-prototype.mjs --dir <dir> --ticket <body file> [--themes light,dark] [--playwright <dir>]');
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
  const body = fs.readFileSync(a.ticket, 'utf8');
  const problems = new Set([...manifestProblems(manifest, criteriaIds(body)), ...bindingProblems(manifest, body), ...unbuiltProblems(manifest, body)]);
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-prototype-'));
  const page0 = path.join(tmp, 'index.html');
  fs.writeFileSync(page0, wrap(html));
  fs.rmSync(shots, { recursive: true, force: true });
  fs.mkdirSync(shots);
  const browser = await chromium.launch();
  const files = [];
  const firstTheme = (a.themes || 'light').split(',')[0];
  try {
    for (const s of manifest.screens || []) {
      for (const [vp, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
        for (const theme of (a.themes || 'light').split(',')) {
          const where = `${s.id} (${vp}, ${theme})`;
          const open = async (hash) => {
            const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme, reducedMotion: 'reduce' });
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
          const file = path.join(shots, `${s.id}-${vp}-${theme}.png`);
          await page.screenshot({ path: file, fullPage: true });
          files.push(file);
          await page.evaluate(axe);
          const unreadable = await page.evaluate(contrast);
          for (const p of unreadable) problems.add(`${where}: ${p}`);
          const buttons = await page.evaluate(pressable, BUTTONS);
          await page.context().close();
          if (vp !== 'desktop' || theme !== firstTheme) continue;

          const other = (manifest.screens || []).find((x) => x.id !== s.id);
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
          for (const b of buttons) {
            const { page: pressed, noticed } = await press([b.i]);
            if (!noticed) problems.add(`${where}: button "${b.name}" ${dead}`);
            // What the press opened: one step further, each button by its name once.
            const opened = noticed && !tried.has(b.name) ? (await pressed.evaluate(pressable, BUTTONS)).filter((n) => !buttons.some((x) => x.name === n.name && x.over === n.over)) : [];
            if (noticed && !tried.has(b.name)) {
              await pressed.evaluate(axe);
              for (const p of await pressed.evaluate(contrast)) if (!unreadable.includes(p)) problems.add(`${where}: after "${b.name}": ${p}`);
            }
            tried.add(b.name);
            await pressed.context().close();
            for (const n of opened) {
              const next = await press([b.i, n.i]);
              if (!next.noticed) problems.add(`${where}: button "${n.name}" after "${b.name}" ${dead}`);
              await next.page.context().close();
            }
          }
        }
      }
    }
  } finally {
    await browser.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(files.join('\n'));
  for (const p of problems) console.error(`problem: ${p}`);
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
