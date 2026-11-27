// Comments, labels, alarms. A comment carries a marker; one already posted (recorded
// in state, or found on the issue after a crash) is never posted again.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gh, ghJson, run } from './sh.mjs';
import { now } from './state.mjs';

const markerOf = (ctx, key) => `<!-- new-factory:${ctx.store.state.runId}:${key} -->`;

export async function comment(ctx, issue, key, body) {
  const st = ctx.store.state;
  const marker = markerOf(ctx, key);
  if (st.comments[key]) return st.comments[key];
  try {
    const existing = await ghJson('api', `repos/${st.repo}/issues/${issue}/comments?per_page=100`);
    const found = existing.find((c) => (c.body || '').includes(marker));
    if (found) return (st.comments[key] = String(found.id));
    const file = path.join(os.tmpdir(), `nf-comment-${process.pid}-${Date.now()}.md`);
    fs.writeFileSync(file, `${body}\n\n${marker}\n`);
    const url = (await gh('issue', 'comment', String(issue), '-R', st.repo, '--body-file', file)).trim();
    fs.rmSync(file, { force: true });
    st.comments[key] = url || 'posted';
    ctx.store.save();
    return st.comments[key];
  } catch (e) {
    ctx.log(`could not comment on #${issue}: ${e.message}`);
    return null;
  }
}

export async function setLabel(ctx, issue, label, on = true) {
  const st = ctx.store.state;
  try {
    if (on && !st.labelsMade?.includes(label)) {
      await run(process.env.NF_GH_BIN || 'gh', ['label', 'create', label, '-R', st.repo, '--color', 'd93f0b', '--description', 'new-factory: waiting on a decision'], { allowFail: true });
      (st.labelsMade ||= []).push(label);
    }
    await gh('issue', 'edit', String(issue), '-R', st.repo, on ? '--add-label' : '--remove-label', label);
  } catch (e) {
    ctx.log(`could not ${on ? 'add' : 'remove'} label ${label} on #${issue}: ${e.message}`);
  }
}

export function notifyMac(title, message) {
  if (process.env.NF_NO_NOTIFY === '1' || process.platform !== 'darwin') return;
  const q = (s) => JSON.stringify(String(s).slice(0, 220));
  run('osascript', ['-e', `display notification ${q(message)} with title ${q(title)}`], { allowFail: true }).catch(() => {});
}

// { issue, step, agent, elapsedMs, reason, handled, tail }
export async function alarm(ctx, a) {
  const st = ctx.store.state;
  const entry = { at: now(), ...a, tail: (a.tail || []).slice(-20) };
  st.alarms.push(entry);
  ctx.store.save();
  const head = `#${a.issue ?? 'batch'} ${a.step || ''}: ${a.reason}`;
  ctx.log(`ALARM ${head}. ${a.handled || ''}`);
  notifyMac('new-factory alarm', `${head}. ${a.handled || ''}`);
  if (!a.issue) return;
  const mins = a.elapsedMs ? `${Math.round(a.elapsedMs / 60000)} min` : '';
  const body = [
    `**new-factory alarm**: ${a.reason}`,
    '',
    `- ticket: #${a.issue}`,
    `- step: ${a.step || '?'}`,
    a.agent ? `- agent: ${a.agent}` : null,
    mins ? `- running for: ${mins}` : null,
    `- handled: ${a.handled || 'nothing; needs a look'}`,
    '',
    'Last lines of the log:',
    '',
    '```',
    ...(entry.tail.length ? entry.tail : ['(empty)']),
    '```',
  ].filter((x) => x !== null);
  await comment(ctx, a.issue, `alarm:${st.alarms.length}`, body.join('\n'));
}
