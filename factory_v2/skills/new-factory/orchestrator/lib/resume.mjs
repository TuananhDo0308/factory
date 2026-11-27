// Step 7: running the same command again. After a crash, every ticket goes on from
// its last finished step. With --retry, a needs-decision ticket goes on with the
// user's answer: one never merged gets the newest staging merged into its branch;
// one that was reverted gets a new branch from staging with its revert reverted.
import { setLabel } from './notify.mjs';
import { dependents } from './scheduler.mjs';
import { alive, ghJson, run, sleep } from './sh.mjs';

// The comments posted on the issue after the factory's needs-decision comment.
export async function answerFor(ctx, t) {
  const st = ctx.store.state;
  try {
    const comments = await ghJson('api', `repos/${st.repo}/issues/${t.issue}/comments?per_page=100`);
    const marker = `new-factory:${st.runId}:needs-decision:${t.issue}:`;
    const last = comments.map((c) => (c.body || '').includes(marker)).lastIndexOf(true);
    return comments
      .slice(last + 1)
      .map((c) => (c.body || '').trim())
      .filter((b) => b && !b.includes('<!-- new-factory:'))
      .join('\n\n');
  } catch (e) {
    ctx.log(`could not read the answer on #${t.issue}: ${e.message}`);
    return '';
  }
}

// After a crash: what was running starts again from its last finished step. An agent
// of the crashed run still alive is waited for (never killed) before its ticket goes on.
export async function afterCrash(ctx) {
  const st = ctx.store.state;
  const isAgent = async (pid) => alive(pid) && /claude/i.test((await run('ps', ['-p', String(pid), '-o', 'command='], { allowFail: true })).stdout);
  for (const a of st.agents.filter((x) => !x.end && x.pid)) {
    if (await isAgent(a.pid)) ctx.log(`waiting for ${a.id} (PID ${a.pid}) of the crashed run to finish`);
    while (await isAgent(a.pid)) await sleep(1000);
    a.end = a.end || new Date().toISOString();
    a.ok = a.ok ?? null;
    a.orphan = true;
  }
  for (const t of Object.values(st.tickets)) if (t.status === 'running') t.status = 'reopened';
  ctx.store.save();
}

export async function retry(ctx, issues, note = '') {
  const st = ctx.store.state;
  const done = [];
  for (const issue of issues) {
    const t = st.tickets[issue];
    if (!t) {
      ctx.log(`--retry ${issue}: not a ticket of this batch`);
      continue;
    }
    if (t.status !== 'needs-decision') {
      ctx.log(`--retry ${issue}: it is ${t.status}, not waiting on a decision`);
      continue;
    }
    const answer = [await answerFor(ctx, t), note].filter(Boolean).join('\n\n') || '(no written answer: the ticket itself may have been edited; build to the ticket as it is now)';
    t.answer = answer;
    t.pending = [{ kind: 'decision', message: `The ticket was stopped (${t.decision?.reason}). The question was: ${t.decision?.question} The user answered: ${answer}` }];
    t.rounds = 0;
    t.diagnoses = [];
    t.decision = null;
    t.status = 'reopened';
    if (t.reverted) t.restore = 'revert';
    else t.syncStaging = true;
    await setLabel(ctx, issue, 'needs-decision', false);
    for (const d of dependents(st.tickets, issue)) {
      const x = st.tickets[d];
      if (x.status === 'blocked' || (x.status === 'needs-decision' && x.decision?.waitingOn === issue)) {
        x.status = x.status === 'needs-decision' ? 'reopened' : 'pending';
        x.blockedBy = null;
        if (x.reverted) x.restore = 'revert';
        else if (x.status === 'reopened') x.syncStaging = true;
      }
    }
    const ids = new Set([issue, ...dependents(st.tickets, issue)].flatMap((i) => st.tickets[i].criteria.map((c) => c.id)));
    if (st.final) st.final.qcPassed = st.final.qcPassed.filter((id) => !ids.has(id));
    done.push(issue);
  }
  ctx.store.save();
  return done;
}
