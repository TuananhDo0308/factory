#!/usr/bin/env node
// Print @font-face rules with the font files embedded as data: URIs, so a
// self-contained prototype can use a typeface chosen for the product instead of the
// viewer's system fonts. Fonts come from Fontsource (open licences), installed with
// npm into a folder of your choice, never into the repository.
//
//   node embed-font.mjs --family "Be Vietnam Pro" --weights 400,600 [--subsets latin,vietnamese]
//                       [--italic] [--prefix <scratchpad>/fonts]
//
// Check the family covers the product's language (vietnamese for Vietnamese text).
// About 15-30 KB per weight and subset; keep to 2 families and 2-3 weights.
// The foundation ticket names the same package (@fontsource/<slug>) for the build.
//
// Exit codes: 0 ok (CSS on stdout) · 64 usage · 70 not found
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function main(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '');
    if (k === 'italic') a.italic = true;
    else a[k] = argv[++i];
  }
  if (!a.family) {
    console.error('usage: embed-font.mjs --family "<name>" [--weights 400,600] [--subsets latin,vietnamese] [--italic] [--prefix <dir>]');
    return 64;
  }
  const slug = a.family.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const prefix = path.resolve(a.prefix || 'fonts');
  const pkg = path.join(prefix, 'node_modules', '@fontsource', slug);
  if (!fs.existsSync(pkg)) {
    try {
      execFileSync('npm', ['install', '--silent', '--no-audit', '--no-fund', '--prefix', prefix, `@fontsource/${slug}`], { stdio: ['ignore', 'ignore', 'inherit'] });
    } catch {
      console.error(`@fontsource/${slug} not found; check the family's name on fontsource.org`);
      return 70;
    }
  }
  const weights = (a.weights || '400').split(',');
  const subsets = (a.subsets || 'latin').split(',');
  const style = a.italic ? 'italic' : 'normal';
  const out = [`/* ${a.family} from @fontsource/${slug}, embedded by embed-font.mjs */`];
  for (const w of weights) {
    const cssFile = path.join(pkg, `${w}${a.italic ? '-italic' : ''}.css`);
    if (!fs.existsSync(cssFile)) {
      console.error(`${a.family} has no weight ${w}${a.italic ? ' italic' : ''}`);
      return 70;
    }
    const css = fs.readFileSync(cssFile, 'utf8');
    for (const block of css.match(/@font-face\s*{[^}]*}/g) || []) {
      const file = /url\(\.\/files\/([^)]+\.woff2)\)/.exec(block)?.[1];
      if (!file || !subsets.some((s) => file.includes(`-${s}-${w}-${style}`))) continue;
      const data = fs.readFileSync(path.join(pkg, 'files', file)).toString('base64');
      const range = /unicode-range:\s*([^;]+);/.exec(block)?.[1];
      out.push(`@font-face{font-family:'${a.family}';font-style:${style};font-weight:${w};font-display:swap;src:url(data:font/woff2;base64,${data}) format('woff2');${range ? `unicode-range:${range};` : ''}}`);
    }
  }
  if (out.length === 1) {
    console.error(`no files for subsets ${subsets.join(', ')}; see ${path.join(pkg, 'files')}`);
    return 70;
  }
  console.log(out.join('\n'));
  return 0;
}

process.exitCode = main(process.argv.slice(2));
