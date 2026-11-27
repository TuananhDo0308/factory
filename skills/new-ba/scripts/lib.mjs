// Shared by the new-ba scripts, and meant to be imported by the new factory too:
// how a ticket body is read, how globs are compared, how the plan is built,
// validated and hashed, and how a batch is read from disk or from GitHub.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SCHEMA_PATH = path.join(HERE, '..', 'references', 'plan-schema.json');

// ---------------------------------------------------------------- ticket text

export const SECTIONS = ['Objective', 'Acceptance criteria', 'Out of scope', 'Wave', 'Size', 'Owns', 'Uses', 'Depends on'];
export const CRITERION = /^\s*[-*+]\s+\*\*(C\d+(?:\.\d+)*)\.?\*\*\s*(.*)$/;
export const lines = (text) => text.split(/\r?\n/);
export const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

// The text without fenced code, line numbers kept.
export function withoutFences(text) {
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

export const withoutCode = (line) => line.replace(/(`+)(?:(?!\1).)+\1/g, '');

// The sections under ## and ### headings, in order: { title, lines: [{ text, raw }] }.
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

export const sectionLines = (body, title) => sections(body).filter((s) => same(s.title, title)).flatMap((s) => s.lines);

// Bullet entries of a section, blank lines dropped, "none" dropped.
function entries(body, title) {
  return sectionLines(body, title)
    .map((l) => l.text.trim())
    .filter((t) => t && !/^(?:[-*+]\s*)?(?:none|n\/a|—|-)\.?$/i.test(t))
    .map((t) => t.replace(/^(?:[-*+]|\d+[.)])\s+/, ''));
}

// The first `code` of an entry, or its first word.
const head = (entry) => (/`([^`]+)`/.exec(entry)?.[1] ?? entry.split(/\s+/)[0]).trim();

// A ticket reference: #12 is an issue, #T3 a ticket of this batch not yet created.
export const REF = /#(T?\d+)\b/g;
export const refOf = (s) => (/^T\d+$/.test(s) ? s : Number(s));

export const criteriaOf = (body) => {
  const inside = sectionLines(body, 'Acceptance criteria');
  return inside.flatMap((l) => {
    const m = CRITERION.exec(l.text);
    return m ? [{ id: m[1], text: m[2].trim() }] : [];
  });
};

// What the plan takes from a ticket body. Missing parts come back empty; check-ticket says why.
export function parseTicket(body) {
  const waveText = entries(body, 'Wave')[0] ?? '';
  const wave = /^\d+$/.test(waveText.trim()) ? Number(waveText.trim()) : null;
  const owns = entries(body, 'Owns').map(head).map(normalizeGlob);
  const uses = entries(body, 'Uses').map(head);
  const dependsOn = [...new Set(entries(body, 'Depends on').flatMap((e) => [...e.matchAll(REF)].map((m) => refOf(m[1]))))];
  // "M: one form in an existing slot" (or "M — ...").
  const sizeLine = entries(body, 'Size')[0] ?? '';
  const sm = /^\**([SML])\**\s*(?:[:—–-]\s*)?(.*)$/.exec(sizeLine.trim());
  // "New dependencies": `name@version` per line, or none. Absent is none.
  const newDependencies = [...new Set(entries(body, 'New dependencies').map(head))];
  return { wave, owns, uses, dependsOn, newDependencies, size: sm?.[1] ?? null, sizeReason: sm?.[2].trim() || null, criteria: criteriaOf(body) };
}

// ---------------------------------------------------------------- globs

// "src/x/" means the folder: src/x/**. Leading "./" goes.
export const normalizeGlob = (g) => g.trim().replace(/^\.\//, '').replace(/\/+$/, (m) => (m ? '/**' : ''));

export function globProblems(g) {
  const out = [];
  if (!g) out.push('an empty path');
  if (g.startsWith('/') || g.split('/').includes('..')) out.push(`"${g}" is not a path inside the repository`);
  if (/[{}[\]]/.test(g)) out.push(`"${g}" uses braces or brackets; list each path on its own line`);
  if (/^\*\*(?:\/\*+)?$|^\*$/.test(g)) out.push(`"${g}" owns the whole repository`);
  if (g.includes('\\')) out.push(`"${g}" uses a backslash; write paths with /`);
  return out;
}

const hasWild = (s) => /[*?]/.test(s);
const literalPrefix = (s) => s.slice(0, s.search(/[*?]|$/));
const literalSuffix = (s) => s.slice(Math.max(s.lastIndexOf('*'), s.lastIndexOf('?')) + 1);
const segRegex = (s) => new RegExp(`^${s.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);

// Could two path segments (with * and ?) name the same file name? Errs towards yes.
function segmentsMeet(a, b) {
  if (!hasWild(a) && !hasWild(b)) return a === b;
  if (!hasWild(a)) return segRegex(b).test(a);
  if (!hasWild(b)) return segRegex(a).test(b);
  const [pa, pb, sa, sb] = [literalPrefix(a), literalPrefix(b), literalSuffix(a), literalSuffix(b)];
  return (pa.startsWith(pb) || pb.startsWith(pa)) && (sa.endsWith(sb) || sb.endsWith(sa));
}

// Could some file be matched by both globs? ** is any number of folders.
export function globsOverlap(x, y) {
  const a = normalizeGlob(x).split('/');
  const b = normalizeGlob(y).split('/');
  const memo = new Map();
  const meet = (i, j) => {
    const key = `${i},${j}`;
    if (memo.has(key)) return memo.get(key);
    let r;
    if (i === a.length && j === b.length) r = true;
    else if (i === a.length) r = b.slice(j).every((s) => s === '**');
    else if (j === b.length) r = a.slice(i).every((s) => s === '**');
    else if (a[i] === '**') r = meet(i + 1, j) || meet(i, j + 1);
    else if (b[j] === '**') r = meet(i, j + 1) || meet(i + 1, j);
    else r = segmentsMeet(a[i], b[j]) && meet(i + 1, j + 1);
    memo.set(key, r);
    return r;
  };
  return meet(0, 0);
}

// "zod@3.23.8", "@fontsource/be-vietnam-pro@5.1.0": a package and an exact or ranged version.
export const DEPENDENCY = /^(?:@[a-z0-9][\w.~-]*\/)?[a-z0-9][\w.~-]*@[^\s@]+$/;
export const splitDependency = (d) => {
  const at = d.lastIndexOf('@');
  return { name: d.slice(0, at), version: d.slice(at + 1) };
};

// ---------------------------------------------------------------- size

const RISK_TEXT = /\b(?:auth\w*|log(?:s|ged|ging)?[- ]?in|sign(?:s|ed|ing)?[- ]?(?:in|up|out)|passwords?|passkeys?|oauth|jwt|(?:access|refresh|api|auth|csrf|session)[ -]?tokens?|permissions?|payments?|billing|invoices?|checkout|refunds?|subscriptions?|migrations?|migrate|encrypt\w*|security|secrets?|csrf|xss)\b/i;
const RISK_PATH = /(?:^|\/)(?:auth\w*|login|session|payments?|billing|checkout|migrations?|security|secrets?|permissions?)(?:\/|\.|$)/i;

// The smallest size the factory will accept for a ticket, with the reasons. It only raises.
export function sizeFloor(t, { body = '', title = '' } = {}) {
  const reasons = [];
  let floor = 'S';
  const raise = (to, why) => {
    if ('SML'.indexOf(to) > 'SML'.indexOf(floor)) floor = to;
    reasons.push(why);
  };
  const text = [title, ...t.criteria.map((c) => c.text)].join('\n');
  const risky = RISK_TEXT.exec(text)?.[0] || t.owns.find((g) => RISK_PATH.test(g));
  if (risky) raise('L', `touches auth, money, migration or security ("${risky}")`);
  if (t.criteria.length > 8) raise('L', `${t.criteria.length} criteria`);
  if (/index\.html/.test(t.criteria.map((c) => c.text).join('\n')) || /^##\s+Prototype\b/m.test(body)) raise('M', 'has a screen in the prototype');
  if (t.criteria.length > 3) raise('M', `${t.criteria.length} criteria`);
  return { floor, reasons };
}

// ---------------------------------------------------------------- plan

export const idOf = (t) => (t.issue ? `#${t.issue}` : t.key);
const refText = (r) => (typeof r === 'number' ? `#${r}` : r);
const norm = (s) => s.replace(/\s+/g, ' ').trim();

// sha256 over what decides how the batch runs: each ticket's wave, owns, uses,
// depends on, new dependencies and criteria (id and text), in a fixed order. Titles, prose and
// size are left out: a change there needs no new check-batch.
export function planHash(plan) {
  const tickets = plan.waves
    .flatMap((w) => w.tickets.map((t) => ({ t, wave: w.wave })))
    .map(({ t, wave }) => ({
      id: idOf(t),
      wave,
      owns: [...t.owns].map(normalizeGlob).sort(),
      uses: [...t.uses].sort(),
      dependsOn: t.dependsOn.map(refText).sort(),
      newDependencies: [...(t.newDependencies || [])].sort(),
      criteria: (t.criteriaText || t.criteria.map((id) => ({ id, text: '' }))).map((c) => [c.id, norm(c.text)]),
    }))
    .sort((x, y) => x.wave - y.wave || x.id.localeCompare(y.id, 'en', { numeric: true }));
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(tickets)).digest('hex')}`;
}

// Build the plan from the batch's own fields and the ticket bodies. The bodies are
// the source of truth for wave, owns, uses, depends on and criteria.
// meta: { id, title?, epic?, repo?, architecture, waveLimitReason?, prototype? }
// tickets: [{ issue?, key?, title, body, size, sizeReason }]
export function buildPlan(meta, tickets) {
  const byWave = new Map();
  const parsed = [];
  for (const t of tickets) {
    const p = parseTicket(t.body);
    const entry = {
      ...(t.issue ? { issue: t.issue } : {}),
      ...(t.key ? { key: t.key } : {}),
      ...(t.title ? { title: t.title } : {}),
      owns: p.owns,
      uses: p.uses,
      dependsOn: p.dependsOn,
      newDependencies: p.newDependencies,
      criteria: p.criteria.map((c) => c.id),
      size: p.size ?? t.size,
      sizeReason: p.sizeReason ?? t.sizeReason,
    };
    parsed.push({ entry, parsed: p, source: t });
    const w = p.wave ?? -1;
    if (!byWave.has(w)) byWave.set(w, []);
    byWave.get(w).push(entry);
  }
  const plan = {
    id: meta.id,
    ...(meta.title ? { title: meta.title } : {}),
    ...(meta.repo ? { repo: meta.repo } : {}),
    ...(meta.epic ? { epic: meta.epic } : {}),
    architecture: meta.architecture,
    ...(meta.waveLimitReason ? { waveLimitReason: meta.waveLimitReason } : {}),
    ...(meta.prototype ? { prototype: meta.prototype } : {}),
    waves: [...byWave.keys()].sort((a, b) => a - b).map((wave) => ({ wave, tickets: byWave.get(wave) })),
  };
  const textById = new Map(parsed.map((x) => [idOf(x.entry), x.parsed.criteria]));
  const hashable = { waves: plan.waves.map((w) => ({ wave: w.wave, tickets: w.tickets.map((t) => ({ ...t, criteriaText: textById.get(idOf(t)) })) })) };
  plan.hash = planHash(hashable);
  return { plan, parsed };
}

// ---------------------------------------------------------------- schema

// Enough of JSON Schema 2020-12 for plan-schema.json: type, required, properties,
// additionalProperties: false, items, minItems, minLength, minimum, pattern, enum,
// anyOf and local $ref. The factory may use any full validator on the same file.
export function validate(schema, value, root = schema, at = '$') {
  const out = [];
  if (schema.$ref) {
    const target = schema.$ref.replace(/^#\//, '').split('/').reduce((o, k) => o?.[k], root);
    return validate(target, value, root, at);
  }
  const typeOf = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : Number.isInteger(v) ? 'integer' : typeof v);
  if (schema.type) {
    const types = [].concat(schema.type);
    const t = typeOf(value);
    if (!types.includes(t) && !(t === 'integer' && types.includes('number'))) return [`${at} must be ${types.join(' or ')}`];
  }
  if (schema.enum && !schema.enum.includes(value)) out.push(`${at} must be one of ${schema.enum.join(', ')}`);
  if (typeof value === 'string') {
    if (schema.minLength && value.length < schema.minLength) out.push(`${at} must not be empty`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) out.push(`${at} "${value}" does not match ${schema.pattern}`);
  }
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) out.push(`${at} must be at least ${schema.minimum}`);
  if (Array.isArray(value)) {
    if (schema.minItems && value.length < schema.minItems) out.push(`${at} must have at least ${schema.minItems} item(s)`);
    if (schema.items) value.forEach((v, i) => out.push(...validate(schema.items, v, root, `${at}[${i}]`)));
  }
  if (typeOf(value) === 'object') {
    for (const k of schema.required || []) if (!(k in value)) out.push(`${at}.${k} is required`);
    for (const [k, v] of Object.entries(value)) {
      if (schema.properties?.[k]) out.push(...validate(schema.properties[k], v, root, `${at}.${k}`));
      else if (schema.additionalProperties === false) out.push(`${at}.${k} is not a field of the plan`);
    }
  }
  if (schema.anyOf && !schema.anyOf.some((s) => validate(s, value, root, at).length === 0)) out.push(`${at}: ${schema.anyOfMessage || 'matches none of the allowed forms'}`);
  return out;
}

export const loadSchema = () => JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));

// ---------------------------------------------------------------- batch on disk

// <dir>/batch.json, <dir>/epic.md, <dir>/<key>.md, optional <dir>/published.json.
export function readBatchDir(dir) {
  const batch = JSON.parse(fs.readFileSync(path.join(dir, 'batch.json'), 'utf8'));
  const tickets = (batch.tickets || []).map((t) => {
    const file = path.join(dir, `${t.key}.md`);
    return { ...t, file, body: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null };
  });
  const pubFile = path.join(dir, 'published.json');
  const published = fs.existsSync(pubFile) ? JSON.parse(fs.readFileSync(pubFile, 'utf8')) : null;
  // A ticket already on GitHub is named by its number in the other bodies.
  for (const t of tickets) if (published?.issues?.[t.key]?.number) t.issue = published.issues[t.key].number;
  return { batch, tickets, published };
}

// ---------------------------------------------------------------- GitHub

export const gh = (args, opts = {}) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'], ...opts });
export const ghJson = (args) => JSON.parse(gh(args));

const PLAN_BLOCK = /^##\s+Plan\s*$[\s\S]*?^```json\s*$([\s\S]*?)^```\s*$/m;

export function planFromEpicBody(body) {
  const m = PLAN_BLOCK.exec(body || '');
  if (!m) return null;
  return JSON.parse(m[1]);
}

export function renderPlanBlock(plan) {
  return `## Plan\n\nWritten by new-ba for the factory. Change the tickets, not this block: the factory compares \`hash\` with the tickets and re-checks them when they differ.\n\n\`\`\`json\n${JSON.stringify(plan, null, 2)}\n\`\`\`\n`;
}

export function replacePlanBlock(body, plan) {
  const block = renderPlanBlock(plan);
  const at = body.search(/^##\s+Plan\s*$/m);
  if (at < 0) return `${body.trimEnd()}\n\n${block}`;
  const rest = body.slice(at);
  const end = PLAN_BLOCK.exec(rest);
  return `${body.slice(0, at)}${block}${end ? rest.slice(end.index + end[0].length).replace(/^\n+/, '\n') : ''}`.trimEnd() + '\n';
}

// The epic's plan and each ticket's issue, read from GitHub.
export function readBatchFromGitHub(repo, epic) {
  const e = ghJson(['issue', 'view', String(epic), '-R', repo, '--json', 'number,title,body,url,updatedAt,labels']);
  const plan = planFromEpicBody(e.body);
  if (!plan) throw new Error(`issue #${epic} has no "## Plan" section with a json block`);
  const tickets = plan.waves.flatMap((w) => w.tickets).map((t) => {
    const i = ghJson(['issue', 'view', String(t.issue), '-R', repo, '--json', 'number,title,body,state,url,updatedAt,labels']);
    return { issue: i.number, key: t.key, title: i.title, body: i.body, state: i.state, url: i.url, updatedAt: i.updatedAt, labels: (i.labels || []).map((l) => l.name), size: t.size, sizeReason: t.sizeReason };
  });
  return { epic: e, plan, tickets };
}
