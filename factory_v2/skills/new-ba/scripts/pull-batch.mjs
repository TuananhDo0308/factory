#!/usr/bin/env node
// Bring a published batch back into a folder, to revise it after feedback.
//
//   node pull-batch.mjs --repo <owner/name> --epic <n> --out <dir>
//
// Writes batch.json, epic.md (the epic without its generated Tickets and Plan
// sections), one <key>.md per ticket as it is on GitHub now, and published.json
// (issue numbers, updatedAt, which ticket holds which criterion). Tickets already on
// GitHub keep naming each other by number; a new ticket is added as T<n> with a key
// above the others. Then edit, run check-batch.mjs --dir, and publish-batch.mjs.
// The prototype is not pulled: `git fetch origin <branch> && git archive <commit> | tar -x -C <dir>/prototype`.
//
// Exit codes: 0 ok · 64 usage · 70 cannot read
import fs from 'node:fs';
import path from 'node:path';
import { criteriaOf, readBatchFromGitHub } from './lib.mjs';

function main(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 2) a[argv[i].replace(/^--/, '')] = argv[i + 1];
  if (!a.repo || !a.epic || !a.out) {
    console.error('usage: pull-batch.mjs --repo <owner/name> --epic <n> --out <dir>');
    return 64;
  }
  let got;
  try {
    got = readBatchFromGitHub(a.repo, Number(a.epic));
  } catch (e) {
    console.error(`cannot read the batch: ${String(e.stderr || e.message).split('\n')[0]}`);
    return 70;
  }
  const out = path.resolve(a.out);
  fs.mkdirSync(out, { recursive: true });
  if (fs.existsSync(path.join(out, 'batch.json'))) {
    console.error(`${out} already holds a batch; pull into an empty folder`);
    return 64;
  }
  const { plan, epic, tickets } = got;
  const keyed = tickets.map((t) => ({ ...t, key: t.key || `T${t.issue}` }));
  for (const t of keyed) fs.writeFileSync(path.join(out, `${t.key}.md`), t.body.endsWith('\n') ? t.body : `${t.body}\n`);
  const epicText = epic.body.replace(/^##\s+Tickets\s*$[\s\S]*$/m, '').replace(/^##\s+Plan\s*$[\s\S]*$/m, '').trim();
  fs.writeFileSync(path.join(out, 'epic.md'), `${epicText}\n`);
  const batch = {
    id: plan.id,
    title: epic.title,
    architecture: plan.architecture,
    ...(plan.waveLimitReason ? { waveLimitReason: plan.waveLimitReason } : {}),
    tickets: keyed.map((t) => ({ key: t.key, title: t.title })),
  };
  fs.writeFileSync(path.join(out, 'batch.json'), `${JSON.stringify(batch, null, 2)}\n`);
  const published = {
    repo: a.repo,
    epic: epic.number,
    epicUrl: epic.url,
    epicUpdatedAt: epic.updatedAt,
    issues: Object.fromEntries(keyed.map((t) => [t.key, { number: t.issue, url: t.url, updatedAt: t.updatedAt }])),
    criteria: Object.fromEntries(keyed.flatMap((t) => criteriaOf(t.body).map((c) => [c.id, t.key]))),
    hash: plan.hash,
    ...(plan.prototype ? { prototype: plan.prototype } : {}),
  };
  fs.writeFileSync(path.join(out, 'published.json'), `${JSON.stringify(published, null, 2)}\n`);
  const highest = Math.max(0, ...Object.keys(published.criteria).map((id) => Number(id.slice(1).split('.')[0])));
  const nextKey = Math.max(0, ...keyed.map((t) => Number(t.key.slice(1)))) + 1;
  console.log(`pulled ${keyed.length} tickets of #${epic.number} into ${out}`);
  console.log(`new criteria start at C${highest + 1}; a new ticket is T${nextKey}`);
  if (plan.prototype) console.log(`prototype: ${plan.prototype.branch} at ${plan.prototype.commit}`);
  return 0;
}

if (process.argv[1]?.endsWith('pull-batch.mjs')) process.exitCode = main(process.argv.slice(2));
