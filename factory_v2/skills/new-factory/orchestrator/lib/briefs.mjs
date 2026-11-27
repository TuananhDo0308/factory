// The role briefs (roles/*.md) as system prompts, and the task each agent gets.
import fs from 'node:fs';
import path from 'node:path';
import { effectiveOwns, matches, testOwns } from './owns.mjs';

const cache = new Map();
export function system(skillDir, role, { size } = {}) {
  const key = `${role}:${size}`;
  if (!cache.has(key)) {
    let text = fs.readFileSync(path.join(skillDir, 'roles', `${role}.md`), 'utf8');
    if (role === 'reviewer' && size !== 'L') text = text.split('<!-- L only -->')[0];
    cache.set(key, text.replace('<!-- L only -->\n', '').trim());
  }
  return cache.get(key);
}

const bullets = (xs) => xs.map((x) => `- ${x}`).join('\n');

function failuresText(failures) {
  return failures
    .map((f, i) => {
      const detail = f.detail ? `\n\n\`\`\`\n${String(f.detail).slice(-3000)}\n\`\`\`` : '';
      return `${i + 1}. [${f.kind}${f.check ? `: ${f.check}` : ''}] ${f.message}${detail}`;
    })
    .join('\n\n');
}

// The contracts a ticket provides (their file is in its Owns: build them exactly)
// and the ones it uses (from an earlier ticket: call them as written).
export function contractsText(plan, t) {
  const all = plan.architecture?.contracts || [];
  const line = (c) => `\`${c.name}\` in \`${c.file}\`: ${c.summary}`;
  const provided = all.filter((c) => t.owns.some((g) => matches(c.file, g)));
  const used = all.filter((c) => t.uses.includes(c.name) && !provided.includes(c));
  return [
    `## Contracts you provide (build each exactly as written; later tickets build against this text)\n\n${provided.length ? bullets(provided.map(line)) : 'none'}`,
    `## Contracts you use\n\n${used.length ? bullets(used.map(line)) : 'none'}`,
  ].join('\n\n');
}

function checksText(profile) {
  const names = Object.entries(profile.checks);
  return names.length ? bullets(names.map(([n, c]) => `${n}: \`${c.cmd}\``)) : 'none (the project has no checks yet)';
}

// opts: { round, failures, diagnosis, answer, port, wt }
export function implementerTask(ctx, t, opts) {
  const { plan } = ctx;
  const profile = opts.profile || ctx.profile;
  const parts = [
    `Ticket #${t.issue}: ${t.title}`,
    `Size ${t.size}. ${opts.round ? `Fix round ${opts.round}.` : 'First build.'} Your worktree is the current directory, on branch \`${t.branch}\`, made from \`staging\`.`,
    `PORT=${opts.port} and BASE_URL=http://localhost:${opts.port} are set in your environment; use them for anything that listens.`,
    `## The ticket\n\n${t.body.trim()}`,
    `## You own (only these may change)\n\n${bullets(t.owns.map((o) => `\`${o}\``))}\n${bullets(testOwns(t).slice(0, 1).map((o) => `\`${o}\` (your e2e tests may go here)`))}${t.extraOwns.length ? `\n${bullets(t.extraOwns.map((o) => `\`${o}\` (granted for this fix${(plan.architecture?.contracts || []).some((c) => c.file === o) ? '; a contract file: add only, never change what is there' : ''})`))}` : ''}\nTests next to an owned file (\`x.test.ts\` beside \`x.ts\`) are yours too. ${t.owns.includes('package.json') ? '\`package.json\` is yours for scripts and settings; its dependencies are installed already and must stay as they are.' : '\`package.json\` and the lockfile are not yours to change.'}`,
    contractsText(plan, t),
    `## Checks (run them before you finish)\n\n${checksText(profile)}`,
  ];
  if (opts.failures?.length) parts.push(`## Failures to fix\n\n${failuresText(opts.failures)}`);
  if (opts.failures?.some((f) => f.kind === 'conflict')) parts.push('Merging `staging` into your branch left conflict markers in the files above. Resolve them so both sides keep working, then commit; that finishes the merge.');
  if (opts.diagnosis) parts.push(`## Diagnosis\n\n${opts.diagnosis.diagnosis}`);
  if (opts.answer) parts.push(`## The user's decision\n\nThe ticket was stopped for a decision. The user answered:\n\n${opts.answer}\n\nBuild to that answer.`);
  return parts.join('\n\n');
}

export function reviewerTask(ctx, t, { base, diff, arbiter }) {
  const ids = t.criteria.map((c) => `- **${c.id}** ${c.text}`).join('\n');
  return [
    `Ticket #${t.issue}: ${t.title} (size ${t.size}). The worktree is the current directory; the ticket's base is \`${base}\`.`,
    arbiter ? `A first reviewer failed this ticket and a diagnoser thinks that judgement may be wrong. You decide, independently. The first review said:\n\n${arbiter}` : null,
    `## The ticket\n\n${t.body.trim()}`,
    `## Criteria to judge\n\n${ids}`,
    `## Files the ticket owns\n\n${bullets(effectiveOwns(t).map((o) => `\`${o}\``))}`,
    contractsText(ctx.plan, t),
    `## The diff (\`git diff ${base.slice(0, 12)}..HEAD\`)\n\n\`\`\`diff\n${diff}\n\`\`\``,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function diagnoserTask(ctx, t, { base, failures, history }) {
  return [
    `Ticket #${t.issue}: ${t.title} (size ${t.size}). The worktree is the current directory; the ticket's base is \`${base}\`. It has had ${t.rounds} fix round(s).`,
    `## The ticket\n\n${t.body.trim()}`,
    `## Files the ticket owns\n\n${bullets(effectiveOwns(t).map((o) => `\`${o}\``))}`,
    contractsText(ctx.plan, t),
    `## What happened so far\n\n${bullets(history)}`,
    `## The failures now\n\n${failuresText(failures)}`,
  ].join('\n\n');
}

export function qcTask(ctx, { baseUrl, criteria, flows, prototype }) {
  return [
    `The app runs at ${baseUrl}.`,
    flows ? `## Main flows to smoke\n\n${flows}` : '## Main flows\n\nNone this time: check only the criteria below.',
    `## Check by hand\n\n${criteria.length ? criteria.map((c) => `- **${c.id}** (#${c.issue}) ${c.text}`).join('\n') : 'none'}`,
    prototype ? `## Prototype\n\n\`${prototype}\` (open it with the browser as a file:// URL when a criterion names it).` : null,
  ]
    .filter(Boolean)
    .join('\n\n');
}
