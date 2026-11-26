#!/usr/bin/env node
// Check a ticket's text for what would stop a factory run or make it guess.
//
//   node check-ticket.mjs --title "<title>" --ticket <issue body file> [--form .github/ISSUE_TEMPLATE/<form>.yml]
//
// Problems are faults in the form of the ticket and must be fixed. Warnings
// ("look:") are for judgement: fix the line, or be able to say why it is right.
// It reads the text only. Whether a criterion is the right one is for a person.
//
// A form with no "Acceptance criteria" field (an epic, a spike) is not for the
// factory, so only the form's own fields are checked.
//
// Exit codes: 0 no problems · 1 problems, one per line on stderr · 64 usage
import fs from 'node:fs';

const SECTIONS = ['Objective', 'Acceptance criteria', 'Out of scope', 'Depends on'];
export const CRITERION = /^\s*[-*+]\s+\*\*(C\d+(?:\.\d+)*)\.?\*\*\s*(.*)$/;
// A line meant as a criterion that the readers of `- **C1** ...` would miss.
const NEARLY = /^\s*(?:(?:[-*+]|\d+[.)])\s+)?(?:\[[ xX]\]\s+)?\**(A?C\d+(?:\.\d+)*)\b(?:\.?\*\*|[.:)]|\s+[-–—]\s)/i;
const SECRET = new RegExp(
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

const lines = (text) => text.split(/\r?\n/);

// The text without fenced code, line numbers kept.
function withoutFences(text) {
  let fence = '';
  return lines(text).map((line) => {
    const mark = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (mark && mark[0] === fence[0] && mark.length >= fence.length) fence = '';
      return '';
    }
    if (mark) {
      fence = mark;
      return '';
    }
    return line;
  });
}

// Pictures written into the text: random letters that can look like anything.
export const withoutPictures = (text) => text.replace(/data:[^,"'\s)]*;base64,[A-Za-z0-9+/=_-]*/g, '');

// The numbers of the lines that hold what looks like a secret.
export const secretLines = (text) => lines(withoutPictures(text)).flatMap((line, i) => (SECRET.test(line) ? [i + 1] : []));

const withoutCode = (line) => line.replace(/(`+)(?:(?!\1).)+\1/g, '');

// The sections under ## and ### headings, in order: { title, lines }.
export function sections(body) {
  const out = [];
  const raw = lines(body);
  withoutFences(body).forEach((line, i) => {
    const heading = /^ {0,3}#{1,3}\s+(.+?)\s*#*$/.exec(line);
    if (heading) out.push({ title: heading[1], lines: [] });
    else if (out.length > 0) out.at(-1).lines.push({ text: line, raw: raw[i] });
  });
  return out;
}

const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

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

// A GitHub issue form, as far as a ticket is checked against it. It reads the
// forms' regular layout, not YAML in general.
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

// The criteria of the ticket, and what is wrong with how they are written.
function criteria(found) {
  const list = [];
  const out = [];
  for (const s of found) {
    const inside = same(s.title, 'Acceptance criteria');
    let last = '';
    for (const { text, raw } of s.lines) {
      const m = CRITERION.exec(text);
      if (m && !inside) out.push(`${m[1]} is outside "Acceptance criteria", in "${s.title}"`);
      else if (m) {
        list.push({ id: m[1], text: m[2] });
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
  return { list, out };
}

const number = (id) => id.slice(1).split('.').map(Number);
const before = (a, b) => {
  const [x, y] = [number(a), number(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? -1) !== (y[i] ?? -1)) return (x[i] ?? -1) < (y[i] ?? -1);
  return false;
};

// Gaps in the numbers are allowed: an existing issue keeps its numbers when one is dropped.
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
  const forFactory = !form || form.fields.some((f) => same(f.label, 'Acceptance criteria'));

  if (!title.trim()) out.push('there is no title');
  if (form?.prefix && !title.startsWith(form.prefix)) out.push(`the title does not start with "${form.prefix}"`);
  if (placeholder(title)) out.push(`the title has a placeholder: ${placeholder(title)}`);

  const required = new Set(forFactory ? SECTIONS : []);
  for (const t of required) {
    if (named(t).length === 0) out.push(`there is no "${t}" section`);
    else if (named(t).every(isEmpty)) out.push(`"${t}" is empty`);
    if (named(t).length > 1) out.push(`"${t}" appears twice`);
  }
  for (const f of form?.fields || []) {
    const s = named(f.label)[0];
    if (!s) {
      if (f.required && !required.has(f.label)) out.push(`the required field "${f.label}" is missing`);
    } else if (f.required && !required.has(f.label) && isEmpty(s)) out.push(`"${f.label}" is empty`);
    else if (f.options.length > 0 && !isEmpty(s) && !f.options.includes(s.lines.map((l) => l.raw).join('\n').trim())) out.push(`"${f.label}" is not one of its options, word for word`);
  }

  const { list, out: written } = criteria(found);
  if (forFactory && list.length === 0) out.push('there are no criteria written `- **C1** ...` under "Acceptance criteria"');
  if (forFactory) out.push(...written, ...numbering(list));

  for (const s of found) if (/^open (?:questions?|decisions?|points?|issues?)\b|^open$/i.test(s.title) && !isEmpty(s) && forFactory) out.push(`"${s.title}" holds open questions; a ticket with one is not ready`);
  withoutFences(body).forEach((line, i) => {
    if (forFactory && /^\W*open (?:questions?|decisions?|points?|issues?)\W*:/i.test(line)) out.push(`line ${i + 1} is an open question; a ticket with one is not ready`);
    const p = placeholder(line);
    if (p) out.push(`line ${i + 1} has a placeholder: ${p}`);
    if (withoutCode(line).includes('<!--')) out.push(`line ${i + 1} has a comment left from a template`);
  });
  for (const n of secretLines(body)) out.push(`line ${n} has what looks like a secret`);
  return out;
}

// Not settled, in the words of the ticket. What is quoted is what a user sees.
const UNSETTLED = /\?\W*$|\?\s|\bto be (?:decided|defined|determined|agreed)\b|\b(?:not (?:yet )?|un)(?:decided|agreed)\b|chưa (?:chốt|quyết|rõ)|sẽ (?:xác nhận|chốt|quyết)/i;
const PHONE = /(?<![\w#./-])(?:\+\d{1,3}[ .-]?|\(0\d{1,3}\)[ .-]?|0)\d(?:[ .-]?\d){6,10}(?![\w-])/;
const PASSWORD = /\b(?:password|passwd|pwd|secret|token|api[_ -]?key)\s*[:=]\s*(?=\S*\d)(?=\S*[a-z])(?![$<{`"'])\S{8,}/i;
// #T1 is a ticket of the same task that has no number yet.
const ISSUE = /#T?\d+\b|\/issues\/\d+\b/;

// A Depends on entry without an issue: no run can wait for it.
function unnumberedDependencies(found) {
  const entries = [];
  for (const { raw } of found.filter((s) => same(s.title, 'Depends on')).flatMap((s) => s.lines)) {
    if (!raw.trim()) continue;
    if (/^\s+/.test(raw) && entries.length > 0 && !/^\s*[-*+]\s/.test(raw)) entries[entries.length - 1] += ` ${raw.trim()}`;
    else entries.push(raw.trim());
  }
  return entries.filter((e) => !/^(?:[-*+]\s*)?(?:none\.?)?$/i.test(e) && !ISSUE.test(e));
}

export function ticketWarnings({ body }) {
  const out = [];
  const { list } = criteria(sections(body));
  for (const { id, text } of list) {
    // Quoted text is what the user sees, so its words are exact.
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
  for (const e of unnumberedDependencies(found)) out.push(`"Depends on" names no issue, so no run can wait for it: ${e.slice(0, 60)}`);
  const named = new Set();
  for (const s of found) for (const l of s.lines) if (!/#\d/.test(l.text)) for (const m of spoken(l.text).matchAll(/(?<![\w-])C\d+(?:\.\d+)*\b(?!-)/g)) if (!ids.has(m[0]) && ids.size > 0) named.add(m[0]);
  for (const id of named) out.push(`${id} is named and is not a criterion of this ticket`);
  if (withoutFences(body).some((l) => PHONE.test(l))) out.push('there is a phone number; is it personal data?');
  if (lines(body).some((l) => PASSWORD.test(l))) out.push('there may be a password or key; name the account or the variable, never its value');
  if (list.length > 8) out.push(`${list.length} criteria; more than about eight is a sign of several tickets`);
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
