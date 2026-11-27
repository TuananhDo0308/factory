#!/usr/bin/env node
// Screenshot HTML files: the design directions offered in step 1, or any page.
//
//   node shoot.mjs --out <dir> [--widths 1440,390] [--themes light] [--playwright <dir>] <file.html> [...]
//
// Each file is opened with the network blocked (a file that is content only gets the
// same skeleton as check-prototype.mjs) and shot at each width and theme, the first
// screen only (not the full page), as <out>/<name>-<width>-<theme>.png.
// Then it writes <out>/compare.html: every shot side by side, to open in a browser
// or publish as a private Artifact, so the user can pick a direction.
//
// Exit codes: 0 ok (paths on stdout) · 64 usage · 69 no Playwright
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { wrap } from './check-prototype.mjs';

function args(argv) {
  const out = { files: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[++i];
    else out.files.push(argv[i]);
  }
  return out;
}

async function main() {
  const a = args(process.argv.slice(2));
  if (!a.out || a.files.length === 0) {
    console.error('usage: shoot.mjs --out <dir> [--widths 1440,390] [--themes light] [--playwright <dir>] <file.html> [...]');
    return 64;
  }
  const require = createRequire(path.join(path.resolve(a.playwright || '.'), 'package.json'));
  let chromium;
  for (const name of ['playwright', '@playwright/test', 'playwright-core']) {
    try {
      chromium = require(name).chromium;
      break;
    } catch {}
  }
  if (!chromium) {
    console.error('Playwright not found; pass --playwright <a directory where it is installed>');
    return 69;
  }
  const out = path.resolve(a.out);
  fs.mkdirSync(out, { recursive: true });
  const widths = (a.widths || '1440,390').split(',').map(Number);
  const themes = (a.themes || 'light').split(',');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'new-ba-shoot-'));
  const browser = await chromium.launch();
  const shots = [];
  try {
    for (const file of a.files) {
      const name = path.basename(file, path.extname(file));
      const page0 = path.join(tmp, `${name}.html`);
      fs.writeFileSync(page0, wrap(fs.readFileSync(file, 'utf8')));
      for (const width of widths) {
        for (const theme of themes) {
          const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, colorScheme: theme, reducedMotion: 'reduce' });
          await ctx.route(/^https?:/, (r) => r.abort());
          const page = await ctx.newPage();
          page.on('pageerror', (e) => console.error(`${name} (${width}, ${theme}): script error: ${e.message}`));
          await page.goto(pathToFileURL(page0).href, { waitUntil: 'load' });
          await page.waitForTimeout(300);
          const shot = path.join(out, `${name}-${width}-${theme}.png`);
          await page.screenshot({ path: shot });
          shots.push({ name, width, theme, file: path.basename(shot) });
          await ctx.close();
        }
      }
    }
  } finally {
    await browser.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const groups = [...new Set(shots.map((s) => s.name))];
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Directions</title>
<style>body{margin:0;padding:24px;font:15px/1.4 ui-sans-serif,system-ui;background:#f4f3f0;color:#1d1c1a}h2{margin:32px 0 12px;font-size:18px}.row{display:flex;gap:16px;align-items:flex-start;overflow-x:auto}figure{margin:0}figcaption{font-size:12px;color:#555;margin-top:4px}img{display:block;border:1px solid #d9d6cf;max-width:100%}.w1440 img{width:720px}.w390 img{width:195px}@media (prefers-color-scheme:dark){body{background:#151514;color:#eee}figcaption{color:#aaa}img{border-color:#333}}</style></head><body>
${groups.map((g) => `<h2>${g}</h2><div class="row">${shots.filter((s) => s.name === g).map((s) => `<figure class="w${s.width}"><img src="${s.file}" alt="${g} at ${s.width}, ${s.theme}"><figcaption>${s.width}px · ${s.theme}</figcaption></figure>`).join('')}</div>`).join('\n')}
</body></html>\n`;
  fs.writeFileSync(path.join(out, 'compare.html'), html);
  console.log([...shots.map((s) => path.join(out, s.file)), path.join(out, 'compare.html')].join('\n'));
  return 0;
}

main().then(
  (code) => (process.exitCode = code),
  (e) => {
    console.error(e.message);
    process.exitCode = 1;
  },
);
