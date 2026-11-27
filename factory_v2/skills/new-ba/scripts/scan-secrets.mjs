#!/usr/bin/env node
// Look for secrets and real people's data in what is about to be published:
// the ticket bodies, the epic and the prototype.
//
//   node scan-secrets.mjs <file or dir> [...]
//
// Problems block publishing: a secret, an email address at a real domain, a card
// number that passes the Luhn check (known test cards aside). Warnings ("look:")
// are phone numbers and images, which a script cannot judge: look at them.
// Pictures embedded as data: URIs (fonts, images) are skipped.
//
// Exit codes: 0 nothing found · 1 problems · 64 usage
import fs from 'node:fs';
import path from 'node:path';
import { secretLines, withoutPictures } from './check-ticket.mjs';

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next']);
const IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp|tiff?)$/i;
const TEST_CARDS = new Set(['4242424242424242', '4000056655665556', '5555555555554444', '2223003122003222', '5200828282828210', '378282246310005', '371449635398431', '6011111111111117', '3056930009020004', '4111111111111111', '4012888888881881']);
const SAFE_EMAIL = /@(?:[\w-]+\.)*(?:example\.(?:com|org|net)|example|test|invalid|localhost)$|\.(?:png|jpe?g|svg|webp|gif|woff2?)$|^(?:noreply|no-reply)@|@users\.noreply\.github\.com$/i;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\b/gi;
const PHONE = /(?<![\w#./:-])(?:\+\d{1,3}[ .-]?|\(0\d{1,3}\)[ .-]?|0)\d(?:[ .-]?\d){7,10}(?![\w-])/g;
const CARD = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g;

function luhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return sum % 10 === 0;
}

export function scanText(name, text) {
  const problems = [];
  const looks = [];
  for (const n of secretLines(text)) problems.push(`${name}, line ${n}: looks like a secret`);
  withoutPictures(text).split(/\r?\n/).forEach((line, i) => {
    for (const e of line.match(EMAIL) || []) if (!SAFE_EMAIL.test(e)) problems.push(`${name}, line ${i + 1}: email address ${e}; use a name at example.com`);
    for (const c of line.match(CARD) || []) {
      const d = c.replace(/\D/g, '');
      if (d.length >= 13 && luhn(d) && !TEST_CARDS.has(d) && !/^(\d)\1+$/.test(d)) problems.push(`${name}, line ${i + 1}: ${c.trim()} passes the card-number check; use a test card such as 4242 4242 4242 4242`);
    }
    for (const p of line.match(PHONE) || []) looks.push(`${name}, line ${i + 1}: phone number ${p.trim()}; is it a real person's?`);
  });
  return { problems, looks };
}

function* files(p) {
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    for (const f of fs.readdirSync(p).sort()) if (!SKIP.has(f)) yield* files(path.join(p, f));
  } else if (st.isFile()) yield p;
}

function main(argv) {
  if (argv.length === 0) {
    console.error('usage: scan-secrets.mjs <file or dir> [...]');
    return 64;
  }
  const problems = [];
  const looks = [];
  let images = 0;
  for (const root of argv) {
    if (!fs.existsSync(root)) {
      console.error(`cannot read ${root}`);
      return 64;
    }
    for (const f of files(root)) {
      if (IMAGE.test(f)) {
        images++;
        continue;
      }
      const buf = fs.readFileSync(f);
      if (buf.includes(0)) continue;
      const rel = path.relative(process.cwd(), f);
      const r = scanText(rel && !rel.startsWith('..') ? rel : f, buf.toString('utf8'));
      problems.push(...r.problems);
      looks.push(...r.looks);
    }
  }
  if (images) looks.push(`${images} image(s) not read by the script; look at each for real names, faces, addresses or another company's material`);
  for (const p of problems) console.error(`problem: ${p}`);
  for (const l of looks) console.error(`look: ${l}`);
  console.log(problems.length ? `scan-secrets: ${problems.length} problem(s)` : 'scan-secrets: clean');
  return problems.length ? 1 : 0;
}

if (process.argv[1]?.endsWith('scan-secrets.mjs')) process.exitCode = main(process.argv.slice(2));
