#!/usr/bin/env node
// Check one ticket's text for what would stop a factory run or make it guess.
//
//   node check-ticket.mjs --title "<title>" --ticket <body file> [--form .github/ISSUE_TEMPLATE/<form>.yml]
//
// Problems are faults in the form of the ticket and must be fixed. Warnings
// ("look:") are for judgement: fix the line, or be able to say why it is right.
// It reads the text only; check-batch.mjs checks the tickets against each other.
//
// Exit codes: 0 no problems · 1 problems, one per line on stderr · 64 usage
import fs from 'node:fs';
import { CRITERION, DEPENDENCY, SECTIONS, criteriaOf, globProblems, lines, parseTicket, same, sectionLines, sections, withoutCode, withoutFences } from './lib.mjs';

// A line meant as a criterion that the readers of `- **C1** ...` would miss.
const NEARLY = /^\s*(?:(?:[-*+]|\d+[.)])\s+)?(?:\[[ xX]\]\s+)?\**(A?C\d+(?:\.\d+)*)\b(?:\.?\*\*|[.:)]|\s+[-–—]\s)/i;
export const SECRET = new RegExp(
  [
    /gh[pousr]_[A-Za-z0-9]{30,}|github_pat_\w{30,}/, // GitHub
    /AKIA[0-9A-Z]{16}/, // AWS
    /\bAIza[\w-]{35}/, // Google
    /\bsk-[A-Za-z0-9_-]{20,}|\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/, // Anthropic, OpenAI, Stripe
    /\bxox[abprs]-[A-Za-z0-9-]{10,}/, // Slack
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\beyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/, // a JWT
    /\bBearer\s+(?=[\w.~+/-]*\d)[\w.~+/-]{32,}/,
    /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:(?![$<{])[^\s:@/]+@/, // a URL with a password
  ].map((r) => r.source).join('|'),
);
const VAGUE = /(?<![\w-])(fast|quick|quickly|slow|easy|easily|simple|simply|intuitive|user-friendly|nice|nicely|clean|modern|seamless|seamlessly|robust|properly|correctly|appropriate|appropriately|reasonable|reasonably|as needed|if needed|if possible|when possible|as expected|smooth|smoothly|soon|efficient|efficiently|several|and so on|etc)(?![\w-])/gi;

// Pictures written into the text: random letters that can look like anything.
export const withoutPictures = (text) => text.replace(/data:[^,"'\s)]*;base64,[A-Za-z0-9+/=_-]*/g, '');
export const secretLines = (text) => lines(withoutPictures(text)).flatMap((line, i) => (SECRET.test(line) ? [i + 1] : []));

// Nothing but blank lines and the bullets or numbers a form starts with.
const isEmpty = (s) => s.lines.every((l) => /^\s*(?:(?:[-*+]|\d+[.)])\s*)?$/.test(l.raw));

function placeholder(line) {
  const text = withoutCode(line);
  const word = /\b(?:TBD|TBC|FIXME)\b|\bTODO:|\?\?\?/.exec(text);
  if (word) return word[0];
  for (const m of text.matchAll(/(?<!\w)<([^<>\s](?:[^<>]*[^<>\s])?)>/g)) {
    if (/^[a-z][a-z0-9+.-]*:\/\/|^mailto:|^[^\s@]+@[^\s@]+$/i.test(m[1])) continue;
    if (/^\/?(?:a|b|br|code|details|em|hr|i|img|kbd|li|ol|p|pre|strong|sub|summary|sup|table|tbody|td|th|thead|tr|u|ul)(?:\s+[\w-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"']+))|\s+open)*\s*\/?$/i.test(m[1])) continue;
    return m[0];
  }
  return '';
}

// A GitHub issue form, as far as a ticket is checked against it.
export function parseForm(yml) {
  const unquote = (s) => s.trim().replace(/^(["'])(.*)\1$/, '$2');
  const prefix = /^title:\s*["']?(\[[^\]]+\] ?)/m.exec(yml)?.[1] || '';
  const fields = [];
  let field = null;
  let inOptions = false;
  for (const line of lines(yml.slice(yml.search(/^body:/m)))) {
    const type = /^\s*- type:\s*(\S+)/.exec(line)?.[1];
    if (type) {
      field = { type, label: '', required: false, options: [] };
      inOptions = false;
      if (type !== 'markdown') fields.push(field);
      continue;
    }
    if (!field) continue;
    const label = /^\s*label:\s*(.+)$/.exec(line);
    if (label && !field.label) field.label = unquote(label[1]);
    if (/^\s*required:\s*true\s*$/.test(line)) field.required = true;
    if (/^\s*options:\s*$/.test(line)) inOptions = true;
    else if (inOptions) {
      const option = /^\s*-\s+(.+)$/.exec(line);
      if (option) field.options.push(unquote(option[1]));
      else if (line.trim()) inOptions = false;
    }
  }
  return { prefix, fields };
}

// What is wrong with how the criteria are written.
function criteriaForm(found) {
  const out = [];
  for (const s of found) {
    const inside = same(s.title, 'Acceptance criteria');
    let last = '';
    for (const { text, raw } of s.lines) {
      const m = CRITERION.exec(text);
      if (m && !inside) out.push(`${m[1]} is outside "Acceptance criteria", in "${s.title}"`);
      else if (m) {
        last = m[1];
        if (!m[2].trim()) out.push(`${m[1]} has no text`);
      } else if (inside) {
        const near = NEARLY.exec(text);
        if (near) out.push(`${near[1]} is not written \`- **C${near[1].replace(/^\D+/, '')}** ...\`, so it is not read: ${raw.trim().slice(0, 60)}`);
        else if (!last && /^\s*(?:[-*+]|\d+[.)])\s+\S|^\s*\|/.test(text)) out.push(`text before the first criterion is not in any criterion; number it or drop it: ${raw.trim().slice(0, 60)}`);
        else if (last && raw.trim() && !/^\s*#{4,}\s/.test(raw)) out.push(`text after ${last} is not in any criterion; put it on the criterion's own line or drop it: ${raw.trim().slice(0, 60)}`);
      }
    }
  }
  return out;
}

const number = (id) => id.slice(1).split('.').map(Number);
const before = (a, b) => {
  const [x, y] = [number(a), number(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? -1) !== (y[i] ?? -1)) return (x[i] ?? -1) < (y[i] ?? -1);
  return false;
};

// Gaps are allowed: numbers are unique across the batch and kept when one is dropped.
function numbering(list) {
  const out = [];
  const seen = new Set();
  let highest = '';
  for (const { id } of list) {
    if (seen.has(id)) out.push(`${id} is used twice`);
    else if (highest && before(id, highest)) out.push(`${id} comes after ${highest}`);
    else highest = id;
    seen.add(id);
  }
  return out;
}

export function ticketProblems({ title, body, form }) {
  const out = [];
  const found = sections(body);
  const named = (t) => found.filter((s) => same(s.title, t));

  if (!title.trim()) out.push('there is no title');
  if (form?.prefix && !title.startsWith(form.prefix)) out.push(`the title does not start with "${form.prefix}"`);
  if (placeholder(title)) out.push(`the title has a placeholder: ${placeholder(title)}`);

  for (const t of SECTIONS) {
    if (named(t).length === 0) out.push(`there is no "${t}" section`);
    else if (named(t).every(isEmpty)) out.push(`"${t}" is empty${['Uses', 'Depends on', 'Out of scope'].includes(t) ? '; write "none" when there is nothing' : ''}`);
    if (named(t).length > 1) out.push(`"${t}" appears twice`);
  }
  for (const f of form?.fields || []) {
    const s = named(f.label)[0];
    if (!s) {
      if (f.required && !SECTIONS.includes(f.label)) out.push(`the required field "${f.label}" is missing`);
    } else if (f.required && !SECTIONS.includes(f.label) && isEmpty(s)) out.push(`"${f.label}" is empty`);
    else if (f.options.length > 0 && !isEmpty(s) && !f.options.includes(s.lines.map((l) => l.raw).join('\n').trim())) out.push(`"${f.label}" is not one of its options, word for word`);
  }

  const list = criteriaOf(body);
  if (list.length === 0) out.push('there are no criteria written `- **C1** ...` under "Acceptance criteria"');
  out.push(...criteriaForm(found), ...numbering(list));

  const t = parseTicket(body);
  if (named('Wave').length > 0 && t.wave === null) out.push('"Wave" is not a single number (0, 1, 2)');
  if (named('Size').length > 0 && (!t.size || !t.sizeReason)) out.push('"Size" is S, M or L and a reason on one line: `M: one form in an existing slot`');
  if (named('Owns').length > 0) {
    if (t.owns.length === 0) out.push('"Owns" lists no path; a ticket owns at least one file or folder');
    for (const g of t.owns) out.push(...globProblems(g).map((p) => `Owns: ${p}`));
  }
  for (const d of t.newDependencies) if (!DEPENDENCY.test(d)) out.push(`New dependencies: "${d}" is not name@version, e.g. \`zod@3.23.8\``);
  for (const l of sectionLines(body, 'Owns')) if (/^\s*[-*+]\s+[^`\s]/.test(l.text) && !/^\s*[-*+]\s+none\b/i.test(l.text)) out.push(`Owns: write each path in backticks: ${l.raw.trim().slice(0, 60)}`);
  for (const l of sectionLines(body, 'Uses')) if (/^\s*[-*+]\s+[^`\s]/.test(l.text) && !/^\s*[-*+]\s+none\b/i.test(l.text)) out.push(`Uses: write each contract's name in backticks first: ${l.raw.trim().slice(0, 60)}`);
  for (const l of sectionLines(body, 'Depends on')) if (/^\s*[-*+]\s+\S/.test(l.text) && !/^\s*[-*+]\s+(?:none\b|#T?\d+)/i.test(l.text)) out.push(`Depends on: each line starts with the ticket, #T<n> or #<issue>: ${l.raw.trim().slice(0, 60)}`);

  for (const s of found) if (/^open (?:questions?|decisions?|points?|issues?)\b|^open$/i.test(s.title) && !isEmpty(s)) out.push(`"${s.title}" holds open questions; a ticket with one is not ready`);
  withoutFences(body).forEach((line, i) => {
    if (/^\W*open (?:questions?|decisions?|points?|issues?)\W*:/i.test(line)) out.push(`line ${i + 1} is an open question; a ticket with one is not ready`);
    const p = placeholder(line);
    if (p) out.push(`line ${i + 1} has a placeholder: ${p}`);
    if (withoutCode(line).includes('<!--')) out.push(`line ${i + 1} has a comment left from a template`);
  });
  for (const n of secretLines(body)) out.push(`line ${n} has what looks like a secret`);
  return out;
}

const UNSETTLED = /\?\W*$|\?\s|\bto be (?:decided|defined|determined|agreed)\b|\b(?:not (?:yet )?|un)(?:decided|agreed)\b|chưa (?:chốt|quyết|rõ)|sẽ (?:xác nhận|chốt|quyết)/i;
const PHONE = /(?<![\w#./-])(?:\+\d{1,3}[ .-]?|\(0\d{1,3}\)[ .-]?|0)\d(?:[ .-]?\d){6,10}(?![\w-])/;
const PASSWORD = /\b(?:password|passwd|pwd|secret|token|api[_ -]?key)\s*[:=]\s*(?=\S*\d)(?=\S*[a-z])(?![$<{`"'])\S{8,}/i;

export function ticketWarnings({ body }) {
  const out = [];
  const list = criteriaOf(body);
  for (const { id, text } of list) {
    const own = withoutCode(text).replace(/"[^"]*"|“[^”]*”/g, '');
    for (const w of new Set([...own.matchAll(VAGUE)].map((m) => m[1].toLowerCase()))) out.push(`${id} says "${w}"; could two people disagree on whether it is met?`);
  }
  const found = sections(body);
  const ids = new Set(list.map((c) => c.id));
  const spoken = (line) => withoutCode(line).replace(/"[^"]*"|“[^”]*”|https?:\/\/\S+/g, '');
  for (const s of found.filter((x) => same(x.title, 'Acceptance criteria'))) {
    const first = s.lines.findIndex((l) => CRITERION.test(l.text));
    for (const l of s.lines.slice(0, Math.max(first, 0))) if (/^\w/.test(l.text.trim()) && !/^Each (?:criterion )?is checked\b/.test(l.text.trim())) out.push(`text before the first criterion is not judged: ${l.raw.trim().slice(0, 60)}`);
  }
  for (const s of found) for (const l of s.lines) if (UNSETTLED.test(spoken(l.text))) out.push(`"${s.title}" has something unsettled: ${l.raw.trim().slice(0, 60)}`);
  for (const s of found) {
    if (same(s.title, 'Acceptance criteria')) continue;
    for (const l of s.lines) for (const m of spoken(l.text).matchAll(/(?<![\w-])C\d+(?:\.\d+)*\b(?!-)/g)) if (!ids.has(m[0]) && !/#\d|#T\d/.test(l.text)) out.push(`${m[0]} is named in "${s.title}" and is not a criterion of this ticket`);
  }
  if (withoutFences(body).some((l) => PHONE.test(l))) out.push('there is a phone number; is it personal data?');
  if (lines(body).some((l) => PASSWORD.test(l))) out.push('there may be a password or key; name the account or the variable, never its value');
  if (list.length > 8) out.push(`${list.length} criteria; more than about eight is one implementer guessing. Split the slice, or move feature logic out of the foundation`);
  if (/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(body.replace(/git@|noreply@/g, ''))) out.push('there is an email address; is it personal data?');
  return out;
}

function main(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 2) a[argv[i].replace(/^--/, '')] = argv[i + 1];
  const unreadable = [a.ticket, a.form].find((f) => f && !fs.existsSync(f));
  if (!a.title || !a.ticket || unreadable) {
    console.error(unreadable ? `cannot read ${unreadable}` : 'usage: check-ticket.mjs --title "<title>" --ticket <body file> [--form <form.yml>]');
    return 64;
  }
  const ticket = { title: a.title, body: fs.readFileSync(a.ticket, 'utf8'), form: a.form ? parseForm(fs.readFileSync(a.form, 'utf8')) : undefined };
  const problems = ticketProblems(ticket);
  for (const p of problems) console.error(`problem: ${p}`);
  for (const w of ticketWarnings(ticket)) console.error(`look: ${w}`);
  return problems.length > 0 ? 1 : 0;
}

if (process.argv[1]?.endsWith('check-ticket.mjs')) process.exitCode = main(process.argv.slice(2));
