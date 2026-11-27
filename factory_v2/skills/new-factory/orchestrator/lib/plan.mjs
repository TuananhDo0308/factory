// Step 1: read and check the plan. The tickets are the only source of truth;
// new-ba's check-batch.mjs builds the plan from them, and is called as it is.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { bin, ghJson, run } from './sh.mjs';

export const READY = 'ready';
const SIZES = 'SML';

export function baDir(skillDir) {
  const candidates = [process.env.NF_BA_DIR, path.join(skillDir, '..', 'new-ba'), path.join(os.homedir(), '.claude', 'skills', 'new-ba')].filter(Boolean);
  const found = candidates.find((d) => fs.existsSync(path.join(d, 'scripts', 'check-batch.mjs')));
  if (!found) throw new Error(`cannot find the new-ba skill (scripts/check-batch.mjs) in ${candidates.join(', ')}; set NF_BA_DIR`);
  return found;
}

export const baLib = (dir) => import(pathToFileURL(path.join(dir, 'scripts', 'lib.mjs')).href);

// check-batch runs gh itself; when tests replace gh, it must find the same one.
function envForGh() {
  const g = process.env.NF_GH_BIN;
  if (!g || path.basename(g) !== 'gh') return undefined;
  return { PATH: `${path.dirname(g)}:${process.env.PATH}` };
}

export async function checkBatch(ba, repo, epic, outFile) {
  const r = await run('node', [path.join(ba, 'scripts', 'check-batch.mjs'), '--repo', repo, '--epic', String(epic), '--write', outFile], { allowFail: true, env: envForGh() });
  const problems = r.stderr.split('\n').filter((l) => l.startsWith('problem:')).map((l) => l.slice(9).trim());
  const looks = r.stderr.split('\n').filter((l) => l.startsWith('look:')).map((l) => l.slice(5).trim());
  const hashLine = r.stdout.split('\n').find((l) => l.startsWith('hash: matches') || l.startsWith('hash: changed'));
  return {
    code: r.code,
    ok: r.code === 0,
    problems,
    looks,
    fatal: r.code !== 0 && r.code !== 1 ? (r.stderr || r.stdout).trim() : null,
    hashMatches: hashLine ? hashLine.startsWith('hash: matches') : null,
    plan: fs.existsSync(outFile) && r.code <= 1 ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : null,
  };
}

const sha = (s) => `sha256:${crypto.createHash('sha256').update(s).digest('hex')}`;
const issueView = (repo, n) => ghJson('issue', 'view', String(n), '-R', repo, '--json', 'number,title,body,labels,state,updatedAt');

// Tickets of the plan that differ from the plan new-ba stored in the epic.
export function changedTickets(stored, built) {
  const key = (t, wave) => JSON.stringify({ wave, owns: [...t.owns].sort(), uses: [...t.uses].sort(), dependsOn: [...t.dependsOn].map(String).sort(), newDependencies: [...(t.newDependencies || [])].sort(), criteria: [...t.criteria] });
  const index = (plan) => new Map((plan?.waves || []).flatMap((w) => w.tickets.map((t) => [t.issue, key(t, w.wave)])));
  const before = index(stored);
  const after = index(built);
  const out = [];
  for (const [issue, k] of after) if (before.get(issue) !== k) out.push(issue);
  for (const issue of before.keys()) if (!after.has(issue)) out.push(issue);
  return out;
}

// Read the epic and every ticket, check labels and the plan. Returns
// { ok, refusal?, plan, tickets, epic, changedAfterBA, looks }.
export async function readPlan({ skillDir, repo, epic, runDir }) {
  const ba = baDir(skillDir);
  const lib = await baLib(ba);
  const outFile = path.join(runDir, 'plan.json');
  const [cb, epicIssue] = await Promise.all([checkBatch(ba, repo, epic, outFile), issueView(repo, epic)]);
  if (cb.fatal) return { ok: false, refusal: `check-batch could not read the batch: ${cb.fatal}` };
  if (!cb.plan) return { ok: false, refusal: `check-batch wrote no plan (exit ${cb.code})` };
  const plan = cb.plan;
  const entries = plan.waves.flatMap((w) => w.tickets.map((t) => ({ ...t, wave: w.wave })));
  const issues = await Promise.all(entries.map((t) => issueView(repo, t.issue)));

  const missing = [epicIssue, ...issues].filter((i) => !i.labels.some((l) => l.name === READY)).map((i) => `#${i.number}`);
  const refusals = [];
  if (missing.length) refusals.push(`these issues do not have the label "${READY}": ${missing.join(', ')}`);
  if (!cb.ok) refusals.push(...cb.problems.map((p) => `check-batch: ${p}`));
  if (refusals.length) return { ok: false, refusal: refusals.join('\n') };

  const stored = lib.planFromEpicBody(epicIssue.body);
  const changed = cb.hashMatches === false ? changedTickets(stored, plan) : [];
  const changedAfterBA = changed.map((n) => `ticket #${n} changed after BA`);
  if (cb.hashMatches === false && changed.length === 0) changedAfterBA.push('the criteria text of at least one ticket changed after BA (the plan in the epic has no per-ticket hash, so which one is not known)');

  const tickets = {};
  for (const [i, t] of entries.entries()) {
    const issue = issues[i];
    const parsed = lib.parseTicket(issue.body);
    const { floor, reasons } = lib.sizeFloor(parsed, { body: issue.body, title: issue.title });
    const size = SIZES[Math.max(SIZES.indexOf(t.size), SIZES.indexOf(floor))];
    tickets[t.issue] = {
      issue: t.issue,
      key: t.key || null,
      title: issue.title,
      wave: t.wave,
      size,
      sizeBA: t.size,
      sizeRaisedBecause: size !== t.size ? reasons : [],
      owns: t.owns,
      uses: t.uses,
      dependsOn: t.dependsOn.filter((d) => typeof d === 'number'),
      newDependencies: t.newDependencies || [],
      criteria: parsed.criteria,
      body: issue.body,
      status: 'pending',
      rounds: 0,
      extraOwns: [],
      merges: [],
      reverts: [],
      failures: [],
      history: [],
    };
  }
  const snapshot = Object.fromEntries(issues.map((i) => [i.number, { title: i.title, updatedAt: i.updatedAt, hash: sha(`${i.title}\n${i.body}`) }]));
  return { ok: true, plan, tickets, epic: { number: epicIssue.number, title: epicIssue.title }, epicBody: epicIssue.body, snapshot, changedAfterBA, looks: cb.looks };
}

// Shared files (architecture.shared, contract files, other foundation tickets' Owns):
// an S whose diff touches one is raised to M for a review.
export function sharedFiles(plan, tickets, self) {
  const foundation = Object.values(tickets).filter((t) => t.wave === 0 && t.issue !== self.issue).flatMap((t) => t.owns);
  return [...new Set([...(plan.architecture?.shared || []), ...foundation, ...(plan.architecture?.contracts || []).map((c) => c.file)])];
}

export { bin };
