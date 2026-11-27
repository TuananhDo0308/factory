// The main loop: start what the graph allows, wait for any ticket to rest, and when
// nothing runs and nothing can start, do the final check and QC.
import { finalPhase } from './final.mjs';
import { needsDecision } from './fixloop.mjs';
import { checkStaging } from './merge.mjs';
import { next, settled } from './scheduler.mjs';
import { drive } from './ticket.mjs';

// A ticket waiting for a holder to merge goes back to work once it has.
function wake(st) {
  for (const t of Object.values(st.tickets)) {
    if (t.status === 'waiting' && st.tickets[t.waitingFor]?.status === 'merged') t.status = 'reopened';
  }
}

export async function loop(ctx) {
  const st = ctx.store.state;
  const active = new Map();
  ctx.store.begin('tickets');
  for (;;) {
    wake(st);
    const { start, block } = next(st.tickets, new Set(active.keys()), { hold: st.stagingRed });
    for (const b of block) {
      const t = st.tickets[b];
      t.status = 'blocked';
      t.blockedBy ||= t.dependsOn.find((d) => ['needs-decision', 'blocked'].includes(st.tickets[d]?.status)) ?? null;
    }
    for (const i of start) {
      const t = st.tickets[i];
      const p = drive(ctx, t)
        .catch(async (e) => {
          ctx.log(`#${i}: orchestrator error: ${e.stack || e.message}`);
          await needsDecision(ctx, t, { reason: `the orchestrator hit an error: ${String(e.message).split('\n')[0]}`, question: `The factory stopped #${i} on an error of its own (see the run log). Rerun with --retry ${i} once it is understood.` });
        })
        .finally(() => active.delete(i));
      active.set(i, p);
    }
    ctx.store.save();
    if (active.size) {
      await Promise.race(active.values());
      continue;
    }
    if (st.stagingRed) {
      // Nothing runs and staging is red: check again (a revert may have fixed it).
      const r = await checkStaging(ctx, 'recheck');
      if (!r.ok && !r.routed) st.stagingRed = false;
      continue;
    }
    const stuck = Object.values(st.tickets).filter((t) => !settled(t));
    if (stuck.length) {
      for (const t of stuck) await needsDecision(ctx, t, { reason: `it cannot start: it waits on ${t.waitingFor ? `#${t.waitingFor}` : t.dependsOn.map((d) => `#${d}`).join(', ')}, which cannot finish in this run`, question: `#${t.issue} is waiting on tickets that cannot finish. Decide the order or the Owns, then rerun with --retry ${t.issue}.` });
      continue;
    }
    ctx.store.end('tickets');
    if ((await finalPhase(ctx)) === 'done') return;
    ctx.store.begin('tickets');
  }
}
