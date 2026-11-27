// 4d: fix and escalate. Rounds 1-2: a new implementer with the failures. Then a
// diagnoser sorts the failure: hard code (stronger model), the ticket needs more
// room (the lock table), a wrong judge (rerun and a second reviewer), or a
// contradiction (needs-decision). At most MAX_ROUNDS fix rounds per ticket per batch.
import { Agents } from './agents.mjs';
import { diagnoserTask, system } from './briefs.mjs';
import { mergeBase, STAGING } from './git.mjs';
import { revert } from './merge.mjs';
import { DIAGNOSER, ARBITER } from './models.mjs';
import { grant, request } from './locks.mjs';
import { comment, setLabel } from './notify.mjs';
import { dependents } from './scheduler.mjs';
import { now } from './state.mjs';

export const MAX_ROUNDS = 4;

// The ticket needs `files` it does not own. Returns {} when granted, { stop } otherwise.
export async function needRoom(ctx, t, files, plan) {
  const st = ctx.store.state;
  const r = request(st.tickets, st.locks, t.issue, files);
  const { note } = await import('./ticket.mjs');
  if (r.result === 'granted') {
    grant(st.locks, t.issue, files);
    for (const x of r.transfers) note(ctx, t, `lock on ${x.file} handed over from #${x.from}, which runs only after this ticket`);
    t.extraOwns = [...new Set([...t.extraOwns, ...files])];
    note(ctx, t, `Owns widened to ${files.join(', ')}`);
    return {};
  }
  if (r.result === 'needs-decision') return needsDecision(ctx, t, { reason: `waiting on #${r.holder}`, question: `#${t.issue} needs ${r.file}, which #${r.holder} owns, and #${r.holder} waits on a decision. Answer #${r.holder} first; then rerun this ticket.`, waitingOn: r.holder });
  if (r.result === 'cycle') return needsDecision(ctx, t, { reason: `needs ${r.file}, held by #${r.holder}, and waiting for it would wait forever`, question: `#${t.issue} needs to change ${r.file}, which #${r.holder} owns, while #${r.holder} (directly or not) waits on #${t.issue}. Should #${t.issue} own ${r.file}, or should this change move to #${r.holder}?` });
  t.status = 'waiting';
  t.waitingFor = r.holder;
  t.waitPlan = { files, ...plan };
  note(ctx, t, `waits for #${r.holder} to merge: it holds ${r.file}`);
  return { stop: true };
}

export async function needsDecision(ctx, t, { reason, question, diagnosis = null, waitingOn = null }) {
  const st = ctx.store.state;
  const { note } = await import('./ticket.mjs');
  const n = (t.decisions = (t.decisions || 0) + 1);
  t.status = 'needs-decision';
  t.decision = { at: now(), reason, question, diagnosis, waitingOn, rounds: t.rounds, failures: (t.lastFailures || []).map((f) => f.message) };
  note(ctx, t, `needs-decision: ${reason}`);
  const body = [
    `**new-factory: this ticket needs a decision** (${reason}).`,
    '',
    `**Question:** ${question}`,
    diagnosis ? `\n**Diagnosis:** ${diagnosis}` : null,
    t.decision.failures.length ? `\n**Last failures:**\n${t.decision.failures.slice(0, 8).map((f) => `- ${f.replace(/\n/g, ' ').slice(0, 300)}`).join('\n')}` : null,
    '',
    `The code is kept on branch \`${t.branch}\`. Answer here, then rerun the factory for this batch with \`--retry ${t.issue}\`. Tickets that depend on this one wait and are reported as not delivered.`,
  ].filter((x) => x !== null);
  await comment(ctx, t.issue, `needs-decision:${t.issue}:${n}`, body.join('\n'));
  await setLabel(ctx, t.issue, 'needs-decision', true);
  if (t.merges.length && !t.reverted) await revert(ctx, t);
  for (const d of dependents(st.tickets, t.issue)) {
    const x = st.tickets[d];
    if (x.status === 'pending') {
      x.status = 'blocked';
      x.blockedBy = t.issue;
    }
  }
  for (const w of Object.values(st.tickets)) {
    if (w.status === 'waiting' && w.waitingFor === t.issue) await needsDecision(ctx, w, { reason: `waiting on #${t.issue}`, question: `#${w.issue} waits for #${t.issue}, which now needs a decision. Answer #${t.issue} first.`, waitingOn: t.issue });
  }
  ctx.store.save();
  return { stop: true };
}

async function diagnose(ctx, t, failures) {
  const base = await mergeBase(t.wt, 'HEAD', STAGING);
  t.phase = 'diagnose';
  const r = await ctx.agents.run({
    role: 'diagnoser',
    issue: t.issue,
    step: 'diagnose',
    ...DIAGNOSER,
    cwd: t.wt,
    system: system(ctx.skillDir, 'diagnoser'),
    prompt: diagnoserTask(ctx, t, { base, failures, history: t.history.slice(-15) }),
  });
  const d = r.structured || { class: 'hard', diagnosis: `(the diagnoser could not finish: ${String(r.error).slice(0, 200)})`, files: [], question: '' };
  t.diagnoses = [...(t.diagnoses || []), { at: now(), ...d }];
  const { note } = await import('./ticket.mjs');
  note(ctx, t, `diagnosis: ${d.class}`);
  return d;
}

const isOutside = (f) => f.kind === 'owns' && f.ownsKind === 'outside';

// Returns { failures } to verify again (after a round, or with nothing to fix
// when the room was granted), or { stop: true } when the ticket rests.
export async function fix(ctx, t, failures, { resumeWait = false } = {}) {
  const { implement, review, syncStaging, verify } = await import('./ticket.mjs');
  if (resumeWait) {
    // The holder merged: take the newest staging, then do what was waiting.
    const wp = t.waitPlan;
    t.waitPlan = null;
    t.waitingFor = null;
    const room = await needRoom(ctx, t, wp.files, wp);
    if (room.stop) return room;
    if (wp.then !== 'round') return { failures: [] };
    return round(ctx, t, wp.failures || [], { diagnosis: wp.diagnosis, implement });
  }

  // Edited outside Owns: the lock table decides at once; no agent needed when the
  // file is free, since the change is already there.
  const outside = [...new Set(failures.filter(isOutside).map((f) => f.file))];
  if (outside.length) {
    const room = await needRoom(ctx, t, outside, { then: 'recheck' });
    if (room.stop) return room;
    failures = failures.filter((f) => !isOutside(f));
    if (!failures.length) return { failures: [] };
  }
  if (failures.some((f) => f.kind === 'conflict')) await syncStaging(ctx, t);
  if (t.rounds >= MAX_ROUNDS) {
    const last = t.diagnoses?.at(-1);
    return needsDecision(ctx, t, { reason: `${MAX_ROUNDS} fix rounds did not make it pass`, question: last?.question || `After ${MAX_ROUNDS} fix rounds #${t.issue} still fails (see the failures below). Should the criteria change, should the ticket own more files, or is there another approach?`, diagnosis: last?.diagnosis });
  }
  const blocked = failures.some((f) => f.kind === 'blocked');
  if (t.rounds < 2 && !blocked) return round(ctx, t, failures, { implement });

  const d = await diagnose(ctx, t, failures);
  if (d.class === 'contradiction') return needsDecision(ctx, t, { reason: 'the criteria contradict each other or can be read more than one way', question: d.question || d.diagnosis, diagnosis: d.diagnosis });
  if (d.class === 'missing-owns' && d.files?.length) {
    const room = await needRoom(ctx, t, d.files, { then: 'round', diagnosis: d, failures });
    if (room.stop) return room;
    return round(ctx, t, failures, { diagnosis: d, implement });
  }
  if (d.class === 'wrong-judge' && t.size !== 'S') {
    const again = await verify(ctx, t, { skipReview: true });
    if (again.length) return round(ctx, t, again, { diagnosis: d, escalate: true, implement });
    if (!failures.some((f) => f.kind === 'review')) return { failures: [] };
    const base = await mergeBase(t.wt, 'HEAD', STAGING);
    const v = await review(ctx, t, { base, arbiter: failures.filter((f) => f.kind === 'review').map((f) => `- ${f.message}`).join('\n'), model: ARBITER });
    if (v.pass) {
      const { head } = await import('./git.mjs');
      t.reviewedTip = await head(t.wt);
      return { failures: [] };
    }
    return round(ctx, t, v.failures, { diagnosis: d, escalate: true, implement });
  }
  return round(ctx, t, failures, { diagnosis: d, escalate: true, implement });
}

async function round(ctx, t, failures, { diagnosis = null, escalate = false, implement }) {
  if (t.rounds >= MAX_ROUNDS) return fix(ctx, t, failures);
  t.rounds += 1;
  t.phase = `fix ${t.rounds}`;
  ctx.store.save();
  const answer = t.answer || null;
  const r = await implement(ctx, t, { round: t.rounds, failures, diagnosis, escalate, answer });
  if (r.blocked) return { failures: [{ kind: 'blocked', message: `the implementer stopped: ${r.blocked}` }] };
  return { failures: [] };
}

export { Agents };
