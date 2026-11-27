#!/usr/bin/env node
// Check a whole batch of tickets: can its waves run in parallel and merge without conflict?
//
//   node check-batch.mjs --dir <batch dir>                       # a draft, before the issues exist
//   node check-batch.mjs --repo <owner/name> --epic <n>          # what is on GitHub now
//   options: --write <plan.json>  write the plan built from the tickets
//            --json               print that plan on stdout instead of the summary
//
// The tickets are the source of truth for wave, owns, uses, depends on and criteria;
// the plan is built from them (lib.mjs buildPlan) and its hash computed. On GitHub the
// stored plan in the epic gives the rest (id, architecture, size) and its hash is
// compared: "hash: matches" means the tickets are as they were when check-batch passed.
//
// Exit codes: 0 no problems · 1 problems ("problem:" lines on stderr) · 64 usage · 70 cannot read
import fs from 'node:fs';
import path from 'node:path';
import { buildPlan, globsOverlap, idOf, loadSchema, readBatchDir, readBatchFromGitHub, sizeFloor, splitDependency, validate } from './lib.mjs';

const MAX_WAVES = 3;
const SIZES = 'SML';

// plan: from buildPlan · parsed: [{ entry, parsed, source }] · previous: published.json or null
export function batchProblems(plan, parsed, { previous = null } = {}) {
  const problems = [];
  const looks = [];
  const schema = loadSchema();
  problems.push(...validate(schema, plan).map((p) => `plan: ${p}`));

  const all = parsed.map((x) => ({ ...x, id: idOf(x.entry), wave: x.parsed.wave }));
  const byRef = new Map();
  for (const t of all) {
    if (t.entry.issue) byRef.set(t.entry.issue, t);
    if (t.entry.key) byRef.set(t.entry.key, t);
  }
  for (const t of all) {
    if (t.source.body === null) problems.push(`${t.id}: its body file is missing`);
    if (t.wave === null) problems.push(`${t.id}: "Wave" is missing or not a number`);
  }

  // Waves: 0, 1, 2 with no gap, at most three.
  const waves = [...new Set(all.map((t) => t.wave).filter((w) => w !== null))].sort((a, b) => a - b);
  waves.forEach((w, i) => {
    if (w !== i) problems.push(`waves are numbered 0, 1, 2 with no gap; found ${waves.join(', ')}`);
  });
  if (waves.length > MAX_WAVES) {
    if (plan.waveLimitReason) looks.push(`${waves.length} waves (more than ${MAX_WAVES}): ${plan.waveLimitReason}`);
    else problems.push(`${waves.length} waves; at most ${MAX_WAVES}. Merge slices that wait on each other, or write waveLimitReason (the code is too tightly coupled to split) and say so in the report`);
  }
  if (waves.length > 1) {
    const foundation = all.filter((t) => t.wave === 0);
    if (foundation.length > 1) looks.push(`${foundation.length} foundation tickets (${foundation.map((t) => t.id).join(', ')}); keep more than one only for parts that are truly apart (backend schema, frontend shell)`);
  }
  for (const w of waves) {
    const n = all.filter((t) => t.wave === w).length;
    if (n > 4) looks.push(`wave ${w} has ${n} tickets; the factory runs about 4 at a time, the rest wait`);
  }

  // Same wave, same file: a merge conflict.
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const [a, b] = [all[i], all[j]];
      if (a.wave === null || a.wave !== b.wave) continue;
      for (const x of a.parsed.owns) for (const y of b.parsed.owns) if (globsOverlap(x, y)) problems.push(`${a.id} and ${b.id} are both in wave ${a.wave} and both own ${x === y ? `\`${x}\`` : `\`${x}\` / \`${y}\``}; merge the two slices, or move the shared part into the foundation`);
    }
  }

  // The factory starts a ticket as soon as what it depends on is merged, whatever its
  // wave. Two tickets owning one file must therefore be ordered by Depends on.
  const reaches = (from, to, seen = new Set()) => {
    if (from === to) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return from.parsed.dependsOn.some((r) => byRef.get(r) && reaches(byRef.get(r), to, seen));
  };
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const [a, b] = [all[i], all[j]];
      if (a.wave === null || b.wave === null || a.wave === b.wave) continue;
      const [early, late] = a.wave < b.wave ? [a, b] : [b, a];
      if (reaches(late, early)) continue;
      const pair = early.parsed.owns.flatMap((x) => late.parsed.owns.filter((y) => globsOverlap(x, y)).map((y) => (x === y ? `\`${x}\`` : `\`${x}\` / \`${y}\``)));
      if (pair.length) problems.push(`${early.id} (wave ${early.wave}) and ${late.id} (wave ${late.wave}) both own ${pair[0]}, and ${late.id} does not depend on ${early.id}, directly or through another ticket; the factory may run them at the same time. Add the dependency, or split the file`);
    }
  }

  // Depends on: only earlier waves of this batch.
  for (const t of all) {
    for (const r of t.parsed.dependsOn) {
      const d = byRef.get(r);
      const name = typeof r === 'number' ? `#${r}` : `#${r}`;
      if (!d) problems.push(`${t.id} depends on ${name}, which is not a ticket of this batch`);
      else if (d === t) problems.push(`${t.id} depends on itself`);
      else if (t.wave !== null && d.wave !== null && d.wave >= t.wave) problems.push(`${t.id} (wave ${t.wave}) depends on ${d.id} (wave ${d.wave}); a ticket depends only on earlier waves. Move it to a later wave, or merge the two`);
    }
  }

  // Criteria: each id and each rule in exactly one ticket.
  const owner = new Map();
  const textOwner = new Map();
  for (const t of all) {
    for (const c of t.parsed.criteria) {
      if (owner.has(c.id) && owner.get(c.id) !== t) problems.push(`${c.id} is in ${owner.get(c.id).id} and in ${t.id}; criterion ids are unique across the batch`);
      else owner.set(c.id, t);
      const key = c.text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      if (key && textOwner.has(key) && textOwner.get(key) !== t) problems.push(`${t.id} ${c.id} says the same as a criterion of ${textOwner.get(key).id}; each rule lives in one ticket`);
      else if (key) textOwner.set(key, t);
    }
  }

  // Contracts: defined once, provided by an earlier wave the user depends on.
  const contracts = new Map();
  for (const c of plan.architecture?.contracts || []) {
    if (contracts.has(c.name)) problems.push(`contract ${c.name} is defined twice`);
    contracts.set(c.name, c);
  }
  const used = new Set();
  for (const t of all) {
    for (const u of t.parsed.uses) {
      used.add(u);
      const c = contracts.get(u);
      if (!c) {
        problems.push(`${t.id} uses \`${u}\`, which is not in architecture.contracts`);
        continue;
      }
      const providers = all.filter((p) => p.wave !== null && p.parsed.owns.some((g) => globsOverlap(g, c.file))).sort((x, y) => x.wave - y.wave);
      const p = providers[0];
      if (!p) looks.push(`no ticket owns ${c.file}, where \`${u}\` lives; it must exist in the repository already`);
      else if (p === t) continue;
      else if (t.wave !== null && p.wave >= t.wave) problems.push(`${t.id} (wave ${t.wave}) uses \`${u}\`, provided by ${p.id} in wave ${p.wave}; a contract comes from an earlier wave`);
      else if (!t.parsed.dependsOn.some((r) => byRef.get(r) === p)) problems.push(`${t.id} uses \`${u}\` from ${p.id} but does not list ${p.id} under "Depends on"`);
    }
  }
  for (const name of contracts.keys()) if (!used.has(name)) looks.push(`contract \`${name}\` is used by no ticket`);

  // Shared files belong to the foundation.
  if (waves.length > 1) {
    for (const f of plan.architecture?.shared || []) {
      const holders = all.filter((t) => t.wave > 0 && t.parsed.owns.some((g) => globsOverlap(g, f)));
      for (const h of holders) looks.push(`shared file ${f} is owned by ${h.id} in wave ${h.wave}; is this change one only that slice needs? Otherwise it goes in the foundation`);
    }
  }

  // The commands the factory runs as checks.
  const arch = plan.architecture || {};
  if (!Array.isArray(arch.checks) || arch.checks.length === 0) problems.push('architecture.checks is missing or empty: list the commands the factory runs (test, e2e, lint, typecheck, build), read from the repository, or for a new one the commands the foundation makes work');

  // A new repository is laid out pages-features (references/slicing.md); an existing one keeps its own structure.
  if (arch.layout === 'pages-features' && waves.length > 1) {
    const FEATURE = /^src\/pages\/([^/*]+)\/features\/([^/*]+)\/|^src\/features\/([^/*]+)\//;
    const pages = new Set();
    for (const c of arch.contracts || []) {
      const m = /^src\/pages\/([^/*]+)\//.exec(c.file);
      if (m) pages.add(m[1]);
    }
    for (const t of all.filter((x) => x.wave > 0)) {
      const e2ePrefixes = [];
      for (const g of t.parsed.owns) {
        const m = FEATURE.exec(g);
        if (globsOverlap(g, 'src/app/**')) problems.push(`${t.id} owns \`${g}\`, inside src/app, which is the foundation's`);
        else if (globsOverlap(g, 'src/shared/**')) problems.push(`${t.id} owns \`${g}\`, inside src/shared, which is the foundation's (after wave 0, contract files are only added to)`);
        else if (globsOverlap(g, 'src/pages/*/page.tsx')) problems.push(`${t.id} owns \`${g}\`, which includes a page.tsx; the foundation draws every page, a slice fills a slot`);
        else if (m) {
          if (m[1]) pages.add(m[1]);
          e2ePrefixes.push(m[1] ? `e2e/${m[1]}/${m[2]}/` : `e2e/${m[3]}/`);
        } else if (!/^e2e\//.test(g)) problems.push(`${t.id} owns \`${g}\`, outside its feature folder; a slice owns src/pages/<page>/features/<feature>/** or src/features/<feature>/**, and its e2e/<page>/<feature>/**`);
      }
      for (const g of t.parsed.owns.filter((x) => /^e2e\//.test(x))) if (!e2ePrefixes.some((p) => `${g}/`.startsWith(p))) looks.push(`${t.id} owns \`${g}\`; its e2e tests belong under ${e2ePrefixes.join(' or ') || 'e2e/<page>/<feature>/'}`);
    }
    const foundation = all.filter((x) => x.wave === 0);
    const owned = (path) => foundation.some((t) => t.parsed.owns.some((g) => globsOverlap(g, path)));
    if (!owned('CLAUDE.md')) problems.push('the foundation does not own CLAUDE.md; with pages-features it writes it (stack, checks, folders, feature folder, import rule, test names)');
    if (!owned('src/app/probe.ts') || !owned('src/app/deep/probe.ts')) problems.push('the foundation does not own src/app/**');
    for (const p of pages) if (!owned(`src/pages/${p}/page.tsx`)) problems.push(`the foundation does not own src/pages/${p}/page.tsx; it draws every page of the prototype with its slots, so every feature is wave 1`);
    const text = foundation.flatMap((t) => t.parsed.criteria.map((c) => c.text)).join('\n');
    for (const c of arch.checks || []) if (c.command && !text.includes(c.command)) looks.push(`no foundation criterion names the check \`${c.command}\` (${c.name}); in a new repository the foundation makes every check work`);
  }

  // New dependencies: the factory installs them all once, so one version per package.
  const declared = new Map();
  for (const t of all) {
    for (const d of t.parsed.newDependencies) {
      const { name, version } = splitDependency(d);
      const seen = declared.get(name);
      if (seen && seen.version !== version) problems.push(`${t.id} declares ${name}@${version} and ${seen.t.id} declares ${name}@${seen.version}; the factory installs one version for the whole batch. Agree on one`);
      else if (!seen) declared.set(name, { version, t });
    }
  }

  // Each ticket needs somewhere to put its tests, or the factory's Owns check stops it.
  const TEST_FILE = /(?:^|\/)(?:tests?|__tests__|spec)\/|\.(?:test|spec)\.[\w]+$|_test\.[\w]+$|(?:^|\/)test_[^/]*$/;
  for (const t of all) {
    const roomy = t.parsed.owns.some((g) => g.endsWith('/**') || TEST_FILE.test(g) || /(?:^|\/)e2e\//.test(g));
    if (t.parsed.owns.length && !roomy) problems.push(`${t.id} owns no place for its tests: no folder (dir/**), no test file, no e2e/ path. Add its test file or own its folder`);
  }

  // Parallel worktrees need the foundation to set the port and isolate e2e.
  const hasE2e = all.some((t) => t.parsed.owns.some((g) => /(?:^|\/)e2e\/|playwright\.config/.test(g)) || t.parsed.criteria.some((c) => /\be2e\b|playwright/i.test(c.text)));
  if (waves.length > 1 && hasE2e) {
    const foundation = all.filter((t) => t.wave === 0);
    if (!foundation.some((t) => t.parsed.criteria.some((c) => /\bPORT\b/.test(c.text)))) problems.push(`the batch has e2e tests but no foundation criterion names \`PORT\`; the factory runs about 4 worktrees at once, each on its own port. Add the criterion that the dev server and e2e read PORT and BASE_URL (references/slicing.md, "Run in parallel")`);
  }

  // Size: the factory raises a size below the floor; say it now.
  let lBySize = 0;
  for (const t of all) {
    const { floor, reasons } = sizeFloor(t.parsed, { body: t.source.body || '', title: t.source.title || '' });
    const size = t.entry.size;
    if (size && SIZES.indexOf(size) < SIZES.indexOf(floor)) problems.push(`${t.id} is size ${size} but is at least ${floor}: ${reasons.join('; ')}`);
    if (size === 'L' && !reasons.some((r) => r.startsWith('touches'))) lBySize++;
  }
  if (lBySize > Math.max(1, Math.floor(all.length / 4))) looks.push(`${lBySize} tickets are L by size, not by risk; L should be rare. Split them`);

  // One prototype path for the batch.
  const paths = new Set(all.flatMap((t) => t.parsed.criteria.flatMap((c) => [...c.text.matchAll(/[^\s`"'()[\]#]*index\.html/g)].map((m) => m[0]))));
  if (paths.size > 1) problems.push(`the criteria name more than one prototype: ${[...paths].join(', ')}`);
  for (const p of paths) if (plan.id && !p.endsWith(`/${plan.id}/index.html`)) looks.push(`the prototype path ${p} is not <folder>/${plan.id}/index.html`);

  // Published: every ticket is an issue, every reference a number.
  if (plan.epic) {
    for (const t of all) {
      if (!t.entry.issue) problems.push(`${t.id} has no issue number in a published plan`);
      if (/#T\d+\b/.test(t.source.body || '')) problems.push(`${t.id} still names a ticket as #T<n>; replace it with the issue number`);
      if (t.source.state && t.source.state !== 'OPEN') looks.push(`${t.id} is ${t.source.state.toLowerCase()}`);
    }
  }

  // A revision keeps the numbers of criteria already published.
  if (previous?.criteria) {
    const prevMax = Math.max(0, ...Object.keys(previous.criteria).map((id) => Number(id.slice(1).split('.')[0])));
    for (const t of all) {
      for (const c of t.parsed.criteria) {
        const was = previous.criteria[c.id];
        const key = t.entry.key;
        if (was && key && was !== key) problems.push(`${c.id} was in ${was} and is now in ${key}; a criterion keeps its ticket. Give the moved rule a new number`);
        if (!was && Number(c.id.slice(1).split('.')[0]) <= prevMax) problems.push(`${t.id} ${c.id} is new but not above C${prevMax}; new criteria take numbers above the highest published one, so no number means two things`);
      }
    }
    const now = new Set(all.flatMap((t) => t.parsed.criteria.map((c) => c.id)));
    for (const id of Object.keys(previous.criteria)) if (!now.has(id)) looks.push(`${id} (${previous.criteria[id]}) was dropped; say so in the report`);
  }

  return { problems: [...new Set(problems)], looks: [...new Set(looks)] };
}

export function summary(plan) {
  return plan.waves.map((w) => `wave ${w.wave}: ${w.tickets.map((t) => `${idOf(t)} [${t.size || '?'}] ${t.criteria.length} criteria`).join(', ')}`);
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '');
    if (k === 'json') out.json = true;
    else out[k] = argv[++i];
  }
  return out;
}

function main(argv) {
  const a = args(argv);
  let plan;
  let parsed;
  let previous = null;
  let stored = null;
  try {
    if (a.dir) {
      const { batch, tickets, published } = readBatchDir(a.dir);
      previous = published;
      const meta = { id: batch.id, title: batch.title, architecture: batch.architecture, waveLimitReason: batch.waveLimitReason };
      ({ plan, parsed } = buildPlan(meta, tickets.map((t) => ({ ...t, body: t.body ?? '' }))));
      parsed.forEach((p, i) => (p.source.body = tickets[i].body));
    } else if (a.repo && a.epic) {
      const got = readBatchFromGitHub(a.repo, Number(a.epic));
      stored = got.plan;
      const meta = { ...stored, epic: Number(a.epic), repo: a.repo };
      ({ plan, parsed } = buildPlan(meta, got.tickets));
    } else {
      console.error('usage: check-batch.mjs --dir <batch dir> | --repo <owner/name> --epic <n>  [--write <plan.json>] [--json]');
      return 64;
    }
  } catch (e) {
    console.error(`cannot read the batch: ${e.message.split('\n')[0]}`);
    return 70;
  }
  const { problems, looks } = batchProblems(plan, parsed, { previous });
  for (const p of problems) console.error(`problem: ${p}`);
  for (const l of looks) console.error(`look: ${l}`);
  if (a.write) fs.writeFileSync(path.resolve(a.write), `${JSON.stringify(plan, null, 2)}\n`);
  if (a.json) console.log(JSON.stringify(plan, null, 2));
  else {
    for (const l of summary(plan)) console.log(l);
    console.log(`hash: ${plan.hash}`);
    if (stored) console.log(stored.hash === plan.hash ? 'hash: matches the plan in the epic' : `hash: changed since the plan in the epic (${stored.hash})`);
    console.log(problems.length ? `check-batch: ${problems.length} problem(s)` : 'check-batch: pass');
  }
  return problems.length > 0 ? 1 : 0;
}

if (process.argv[1]?.endsWith('check-batch.mjs')) process.exitCode = main(process.argv.slice(2));
