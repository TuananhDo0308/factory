#!/usr/bin/env node
// Put a checked batch on GitHub: the epic first, then the tickets in wave order with
// #T<n> replaced by real numbers, the prototype on its own branch, and the plan
// (with its hash) in the epic's body. Run it again on the same folder to apply a
// revision: existing issues are edited, new tickets created, numbers kept.
//
//   node publish-batch.mjs --dir <batch dir> --repo <owner/name>
//        [--label ready] [--git <clone of the repo, for the prototype branch>]
//        [--create-labels] [--drop] [--dry-run]
//
// It refuses before touching GitHub when check-ticket, check-batch or scan-secrets
// finds a problem, when a label is missing (unless --create-labels), or when an issue
// changed on GitHub after it was published or pulled (run pull-batch.mjs again).
// State is written to <dir>/published.json after every step, so a run that stops
// half-way is finished by running it again; nothing is created twice.
//
// stdout: one JSON object, the result. stderr: progress, problem:, look:, warning:.
// Exit codes: 0 published · 1 refused or failed · 64 usage
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { batchProblems } from './check-batch.mjs';
import { ticketProblems } from './check-ticket.mjs';
import { HERE, buildPlan, criteriaOf, gh, ghJson, readBatchDir, renderPlanBlock } from './lib.mjs';

const say = (s) => console.error(s);
const fail = (s) => {
  say(`problem: ${s}`);
  process.exit(1);
};

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '');
    if (['create-labels', 'drop', 'dry-run'].includes(k)) out[k] = true;
    else out[k] = argv[++i];
  }
  return out;
}

export const replaceRefs = (text, numbers) => text.replace(/#T(\d+)\b/g, (m, n) => (numbers[`T${n}`] ? `#${numbers[`T${n}`]}` : m));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'new-ba-publish-'));
let fileNo = 0;
const bodyFile = (text) => {
  const f = path.join(tmp, `body-${++fileNo}.md`);
  fs.writeFileSync(f, text);
  return f;
};
const numberOf = (url) => Number(/\/issues\/(\d+)\s*$/.exec(url.trim())?.[1]);

// The ## Prototype section of a ticket: its screens, pinned to the pushed commit.
export function prototypeSection({ repo, branch, commit, folder, manifest, criteria, shots }) {
  const mine = (manifest.screens || []).filter((s) => (s.criteria || []).some((c) => criteria.includes(c)));
  const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
  const img = (id, vp, w) => shots.filter((f) => new RegExp(`^${id}-${vp}-(light|dark)\\.png$`).test(f)).sort().reverse().map((f) => `<img src="https://github.com/${repo}/raw/${commit}/shots/${f}" width="${w}" alt="${id}, ${f.slice(id.length + 1, -4)}">`).join(' ') || 'not shot';
  return [
    '## Prototype',
    '',
    `The prototype of the whole flow is on branch \`${branch}\`, commit \`${commit}\`. The factory copies it to \`${folder}\` before the batch runs; this ticket's criteria name the screens and slots it builds. What it shows around them belongs to other tickets.`,
    '',
    '| Screen | Criteria | Shows | Desktop | Mobile |',
    '|---|---|---|---|---|',
    ...mine.map((s) => `| \`${s.id}\`: ${cell(s.title)} | ${(s.criteria || []).filter((c) => criteria.includes(c)).join(', ')} | ${cell(s.shows)} | ${img(s.id, 'desktop', 360)} | ${img(s.id, 'mobile', 160)} |`),
  ].join('\n');
}

// Put a section before "## Notes" (or at the end), replacing one of the same name.
export function setSection(body, title, section) {
  const re = new RegExp(`^##\\s+${title}\\s*$[\\s\\S]*?(?=^##\\s|(?![\\s\\S]))`, 'm');
  if (re.test(body)) return body.replace(re, `${section}\n\n`).trimEnd() + '\n';
  const notes = body.search(/^##\s+Notes\s*$/m);
  if (notes >= 0) return `${body.slice(0, notes)}${section}\n\n${body.slice(notes)}`;
  return `${body.trimEnd()}\n\n${section}\n`;
}

function main(argv) {
  const a = args(argv);
  if (!a.dir || !a.repo || !/^[\w.-]+\/[\w.-]+$/.test(a.repo)) {
    say('usage: publish-batch.mjs --dir <batch dir> --repo <owner/name> [--label ready] [--git <clone>] [--create-labels] [--drop] [--dry-run]');
    return 64;
  }
  const dir = path.resolve(a.dir);
  const label = a.label ?? 'ready';
  const statePath = path.join(dir, 'published.json');
  const { batch, tickets, published } = readBatchDir(dir);
  const state = published || { repo: a.repo, epic: null, issues: {}, criteria: {} };
  if (state.repo !== a.repo) fail(`${statePath} is for ${state.repo}, not ${a.repo}`);
  const save = () => fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

  // 1. Checks, all before GitHub.
  let refused = false;
  for (const t of tickets) {
    if (t.body === null) fail(`${t.key}.md is missing`);
    for (const p of ticketProblems({ title: t.title || '', body: t.body })) {
      say(`problem: ${t.key}: ${p}`);
      refused = true;
    }
  }
  const meta = { id: batch.id, title: batch.title, architecture: batch.architecture, waveLimitReason: batch.waveLimitReason };
  const { plan: draft, parsed } = buildPlan(meta, tickets);
  const checked = batchProblems(draft, parsed, { previous: published });
  for (const p of checked.problems) say(`problem: ${p}`);
  for (const l of checked.looks) say(`look: ${l}`);
  if (checked.problems.length) refused = true;
  try {
    execFileSync('node', [path.join(HERE, 'scan-secrets.mjs'), dir], { stdio: ['ignore', 'ignore', 'inherit'] });
  } catch {
    refused = true;
  }
  if (refused) fail('not published: fix the problems above first');
  if (!batch.title) fail('batch.json has no title for the epic');
  const epicFile = path.join(dir, 'epic.md');
  if (!fs.existsSync(epicFile)) fail('epic.md is missing');

  // 2. The repository, its visibility and labels.
  const repoInfo = ghJson(['repo', 'view', a.repo, '--json', 'nameWithOwner,visibility']);
  if (repoInfo.visibility === 'PUBLIC') say(`warning: ${a.repo} is public; the tickets and the prototype are visible to everyone`);
  const labels = new Set(ghJson(['label', 'list', '-R', a.repo, '--limit', '200', '--json', 'name']).map((l) => l.name));
  const wanted = [label, 'epic'].filter(Boolean);
  for (const l of wanted.filter((x) => !labels.has(x))) {
    if (l === 'epic' && !a['create-labels']) continue;
    if (!a['create-labels']) fail(`label "${l}" does not exist in ${a.repo}; create it or pass --create-labels`);
    if (!a['dry-run']) gh(['label', 'create', l, '-R', a.repo, '--color', l === 'epic' ? '5319e7' : '0e8a16']);
    labels.add(l);
  }
  const epicLabels = wanted.filter((l) => labels.has(l));

  // 3. Nothing on GitHub changed behind our back.
  for (const [key, info] of Object.entries(state.issues)) {
    const now = ghJson(['issue', 'view', String(info.number), '-R', a.repo, '--json', 'updatedAt,state']);
    if (info.updatedAt && now.updatedAt !== info.updatedAt) fail(`#${info.number} (${key}) changed on GitHub after it was published or pulled; run pull-batch.mjs, apply the change again, and publish`);
    if (!tickets.some((t) => t.key === key) && !a.drop) fail(`${key} (#${info.number}) is published but no longer in the batch; pass --drop to close it`);
  }
  if (state.epic) {
    const e = ghJson(['issue', 'view', String(state.epic), '-R', a.repo, '--json', 'updatedAt']);
    if (state.epicUpdatedAt && e.updatedAt !== state.epicUpdatedAt) fail(`the epic #${state.epic} changed on GitHub after it was published; run pull-batch.mjs first`);
  }

  const order = draft.waves.flatMap((w) => w.tickets.map((t) => tickets.find((x) => x.key === t.key)));
  if (a['dry-run']) {
    console.log(JSON.stringify({ dryRun: true, repo: a.repo, visibility: repoInfo.visibility, epic: state.epic ? `edit #${state.epic}` : `create "${batch.title}"`, tickets: order.map((t) => ({ key: t.key, title: t.title, action: state.issues[t.key] ? `edit #${state.issues[t.key].number}` : 'create' })), hash: draft.hash }, null, 2));
    return 0;
  }

  // 4. The epic, so the tickets can be its sub-issues.
  const epicText = fs.readFileSync(epicFile, 'utf8').trim();
  if (!state.epic) {
    const url = gh(['issue', 'create', '-R', a.repo, '--title', batch.title, '--body-file', bodyFile(`${epicText}\n\n## Plan\n\nBeing written by new-ba.\n`), ...epicLabels.flatMap((l) => ['--label', l])]);
    state.epic = numberOf(url);
    state.epicUrl = url.trim();
    save();
    say(`created epic #${state.epic}`);
  }

  // 5. Tickets in wave order; references to tickets not yet created are fixed in step 6.
  const numbers = () => Object.fromEntries(Object.entries(state.issues).map(([k, v]) => [k, v.number]));
  const sent = {};
  for (const t of order) {
    const body = replaceRefs(t.body, numbers());
    const info = state.issues[t.key];
    if (info) {
      gh(['issue', 'edit', String(info.number), '-R', a.repo, '--title', t.title, '--body-file', bodyFile(body), '--add-label', label]);
      say(`edited #${info.number} (${t.key})`);
    } else {
      const url = gh(['issue', 'create', '-R', a.repo, '--title', t.title, '--body-file', bodyFile(body), '--label', label]);
      state.issues[t.key] = { number: numberOf(url), url: url.trim() };
      save();
      say(`created #${state.issues[t.key].number} (${t.key})`);
      try {
        const id = gh(['api', `repos/${a.repo}/issues/${state.issues[t.key].number}`, '--jq', '.id']).trim();
        gh(['api', '-X', 'POST', `repos/${a.repo}/issues/${state.epic}/sub_issues`, '-F', `sub_issue_id=${id}`]);
      } catch (e) {
        say(`warning: could not make #${state.issues[t.key].number} a sub-issue of #${state.epic}: ${String(e.stderr || e.message).split('\n')[0]}`);
      }
    }
    sent[t.key] = body;
  }
  if (a.drop) {
    for (const [key, info] of Object.entries(state.issues)) {
      if (tickets.some((t) => t.key === key)) continue;
      gh(['issue', 'close', String(info.number), '-R', a.repo, '--comment', `Dropped from batch ${batch.id} by new-ba.`]);
      say(`closed #${info.number} (${key}), dropped from the batch`);
      delete state.issues[key];
      save();
    }
  }

  // 6. Every #T<n> now has a number.
  const final = {};
  for (const t of order) {
    final[t.key] = replaceRefs(t.body, numbers());
    if (final[t.key] !== sent[t.key]) gh(['issue', 'edit', String(state.issues[t.key].number), '-R', a.repo, '--body-file', bodyFile(final[t.key])]);
  }

  // 7. The prototype, on its own branch, and a section in each ticket that has screens.
  let prototype;
  const protoDir = path.join(dir, 'prototype');
  if (fs.existsSync(path.join(protoDir, 'prototype.json'))) {
    const allCriteria = order.flatMap((t) => criteriaOf(final[t.key]));
    const named = [...new Set(allCriteria.flatMap((c) => [...c.text.matchAll(/[^\s`"'()[\]#]*index\.html/g)].map((m) => m[0])))];
    if (named.length !== 1) fail(`the criteria name ${named.length} prototype paths; exactly one is expected`);
    const folder = named[0].replace(/index\.html$/, '');
    const commit = execFileSync('bash', [path.join(HERE, 'publish-prototype.sh'), '--dir', protoDir, '--name', batch.id], { cwd: path.resolve(a.git || '.'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
    prototype = { branch: `prototype/${batch.id}`, commit, path: folder };
    const manifest = JSON.parse(fs.readFileSync(path.join(protoDir, 'prototype.json'), 'utf8'));
    const shots = fs.existsSync(path.join(protoDir, 'shots')) ? fs.readdirSync(path.join(protoDir, 'shots')) : [];
    for (const t of order) {
      const criteria = criteriaOf(final[t.key]);
      if (!criteria.some((c) => c.text.includes('index.html'))) continue;
      const body = setSection(final[t.key], 'Prototype', prototypeSection({ repo: a.repo, branch: prototype.branch, commit, folder, manifest, criteria: criteria.map((c) => c.id), shots }));
      if (body !== final[t.key]) gh(['issue', 'edit', String(state.issues[t.key].number), '-R', a.repo, '--body-file', bodyFile(body)]);
      final[t.key] = body;
    }
    say(`prototype pushed to ${prototype.branch} at ${commit}`);
  }

  // 8. Read everything back, build the plan from what GitHub holds, check it once more.
  const back = order.map((t) => {
    const i = ghJson(['issue', 'view', String(state.issues[t.key].number), '-R', a.repo, '--json', 'number,title,body,state,labels,url']);
    if (i.body.trim() !== final[t.key].trim()) say(`warning: #${i.number} on GitHub differs from what was sent`);
    if (/#T\d+\b/.test(i.body)) say(`problem: #${i.number} still names #T<n>`);
    if (!i.labels.some((l) => l.name === label)) say(`warning: #${i.number} does not have the label ${label}`);
    return { issue: i.number, key: t.key, title: i.title, body: i.body, state: i.state, size: t.size, sizeReason: t.sizeReason };
  });
  const { plan, parsed: parsedBack } = buildPlan({ ...meta, repo: a.repo, epic: state.epic, prototype }, back);
  const after = batchProblems(plan, parsedBack);
  for (const p of after.problems) say(`problem: after publishing: ${p}`);
  fs.writeFileSync(path.join(dir, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`);

  const list = plan.waves.map((w) => [`**Wave ${w.wave}**${w.wave === 0 && plan.waves.length > 1 ? ' (foundation)' : ''}`, '', ...w.tickets.map((t) => `- #${t.issue} (${t.size})`), ''].join('\n')).join('\n');
  const epicBody = `${replaceRefs(epicText, numbers())}\n\n## Tickets\n\nTickets of one wave run in parallel; a ticket starts once what it depends on is merged.\n\n${list}\n${renderPlanBlock(plan)}`;
  gh(['issue', 'edit', String(state.epic), '-R', a.repo, '--body-file', bodyFile(epicBody), ...epicLabels.flatMap((l) => ['--add-label', l])]);

  // 9. Remember what was published, for the next revision.
  for (const t of order) state.issues[t.key].updatedAt = ghJson(['issue', 'view', String(state.issues[t.key].number), '-R', a.repo, '--json', 'updatedAt']).updatedAt;
  state.epicUpdatedAt = ghJson(['issue', 'view', String(state.epic), '-R', a.repo, '--json', 'updatedAt']).updatedAt;
  state.criteria = Object.fromEntries(order.flatMap((t) => criteriaOf(final[t.key]).map((c) => [c.id, t.key])));
  state.hash = plan.hash;
  save();

  console.log(JSON.stringify({ repo: a.repo, visibility: repoInfo.visibility, epic: { number: state.epic, url: state.epicUrl || `https://github.com/${a.repo}/issues/${state.epic}` }, label, hash: plan.hash, prototype, tickets: plan.waves.flatMap((w) => w.tickets.map((t) => ({ wave: w.wave, key: t.key, issue: t.issue, url: state.issues[t.key].url, size: t.size, title: t.title }))), problemsAfter: after.problems }, null, 2));
  return after.problems.length ? 1 : 0;
}

if (process.argv[1]?.endsWith('publish-batch.mjs')) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    say(`problem: ${String(e.stderr || e.message).trim().split('\n')[0]}`);
    say('state so far is in published.json; run the same command again to finish');
    process.exitCode = 1;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
