// Step 8: measured and reported by code. report.md for the user and the skill,
// dashboard.html (static, reads state.js, refreshes itself) to watch a run.
import fs from 'node:fs';
import path from 'node:path';

const mins = (ms) => (ms >= 60000 ? `${(ms / 60000).toFixed(1)} min` : `${Math.round(ms / 1000)} s`);
const span = (a, b) => (a ? (b ? Date.parse(b) : Date.now()) - Date.parse(a) : 0);

export function summary(st) {
  const tickets = Object.values(st.tickets);
  const by = (s) => tickets.filter((t) => t.status === s);
  const cost = st.agents.reduce((n, a) => n + (a.cost || 0), 0);
  const byRole = {};
  for (const a of st.agents) {
    const r = (byRole[a.role] ||= { n: 0, cost: 0, ms: 0 });
    r.n++;
    r.cost += a.cost || 0;
    r.ms += a.ms || 0;
  }
  const runs = (st.runSpans || []).map((r) => span(r.start, r.end));
  const total = runs.length ? runs.reduce((a, b) => a + b, 0) : span(st.startedAt, st.finishedAt);
  return { delivered: by('merged'), decision: by('needs-decision'), blocked: by('blocked'), other: tickets.filter((t) => !['merged', 'needs-decision', 'blocked'].includes(t.status)), cost, byRole, total, runs, since: span(st.startedAt, st.finishedAt) };
}

export function reportText(st) {
  const s = summary(st);
  const L = [];
  L.push(`# new-factory report: epic #${st.epic} (${st.repo})`, '');
  L.push(`Status: **${st.status}**. Run time ${mins(s.total)}${s.runs.length > 1 ? ` over ${s.runs.length} runs (${s.runs.map(mins).join(', ')}); ${mins(s.since)} since the first one started` : ''}. ${st.agents.length} agent call(s), $${s.cost.toFixed(2)}.`, '');
  if (st.refusal) L.push('## Refused', '', st.refusal, '');
  L.push('## Tickets', '', '| Ticket | Size | Status | Rounds | Time | Notes |', '|---|---|---|---|---|---|');
  for (const t of Object.values(st.tickets).sort((a, b) => a.wave - b.wave || a.issue - b.issue)) {
    const notes = [t.sizeBA !== t.size ? `raised from ${t.sizeBA}` : '', t.reviewAs ? 'reviewed as M (shared file)' : '', t.reverted ? 'reverted from staging' : '', t.blockedBy ? `waits on #${t.blockedBy}` : '', t.extraOwns?.length ? `Owns widened: ${t.extraOwns.join(', ')}` : ''].filter(Boolean).join('; ');
    L.push(`| #${t.issue} ${t.title} | ${t.size} | ${t.status === 'merged' ? 'delivered' : t.status === 'blocked' ? 'not delivered' : t.status} | ${t.rounds} | ${mins(t.activeMs ?? span(t.startedAt, t.mergedAt))} | ${notes} |`);
  }
  L.push('');
  if (s.decision.length) {
    L.push('## Needs a decision', '');
    for (const t of s.decision) L.push(`- **#${t.issue}** ${t.title}: ${t.decision?.reason}.`, `  Question: ${t.decision?.question}`);
    L.push('', `Answer on the issue, then rerun with \`--retry <issue>\`.`, '');
  }
  if (s.blocked.length) L.push('## Not delivered (wait on a decision)', '', ...s.blocked.map((t) => `- #${t.issue} ${t.title}${t.blockedBy ? ` (waits on #${t.blockedBy})` : ''}`), '');
  if (st.changedAfterBA?.length) L.push('## Changed after BA', '', ...st.changedAfterBA.map((c) => `- ${c}`), '');
  const f = st.final;
  if (f) {
    L.push('## Final check and QC', '');
    L.push(`- Full check on staging: ${f.lastCheck ? (f.lastCheck.ok ? 'pass' : 'FAIL') : 'not run'} (${f.checks} run(s)).`);
    const e2e = Object.entries(f.e2e || {});
    if (e2e.length) L.push(`- e2e by criterion: ${e2e.sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })).map(([id, v]) => `${id} ${v}`).join(', ')}.`);
    L.push(`- QC: ${f.qcRuns || 0} run(s); passed ${f.qcPassed?.length || 0} criteria${f.qcFailed?.length ? `; failed on the way: ${f.qcFailed.map((x) => x.id).join(', ')}` : ''}.${f.qcSkipped ? ` ${f.qcSkipped}.` : ''}${f.qcError ? ` QC error: ${f.qcError}` : ''}`);
    for (const fl of (f.flows || []).filter((x) => !x.ok)) L.push(`- Smoke problem, ${fl.name}: ${fl.problem}`);
    L.push('');
  }
  const red = (st.stagingChecks || []).filter((c) => !c.ok);
  if (red.length || st.blames?.length) {
    L.push('## Checks on staging that failed', '');
    for (const c of red) L.push(`- ${c.at.slice(11, 19)} ${c.label}: ${c.checks.filter((x) => !x.ok).map((x) => `${x.name}${x.failedFiles?.length ? ` (${x.failedFiles.join(', ')})` : ''}`).join(', ')}`);
    for (const b of st.blames || []) L.push(`- ${b.at.slice(11, 19)} ${b.bisected ? 'bisect' : 'no single merge found;'} sent to #${b.culprit}${b.affected?.length ? `, failing tests owned by ${b.affected.map((a) => `#${a}`).join(', ')}` : ''}`);
    L.push('');
  }
  L.push('## Time by step', '', '| Step | Time |', '|---|---|');
  for (const [k, v] of Object.entries(st.steps)) L.push(`| ${k} | ${mins(v.ms + (v.end ? 0 : span(v.restart || v.start)))} |`);
  L.push('', '## Agents', '', '| Role | Calls | Time | Cost |', '|---|---|---|---|');
  for (const [role, r] of Object.entries(s.byRole)) L.push(`| ${role} | ${r.n} | ${mins(r.ms)} | $${r.cost.toFixed(2)} |`);
  if (st.alarms.length) L.push('', '## Alarms', '', ...st.alarms.map((a) => `- ${a.at.slice(11, 19)} #${a.issue ?? 'batch'} ${a.step || ''}: ${a.reason}. ${a.handled || ''}`));
  if (st.notes.length) L.push('', '## Notes', '', ...st.notes.map((n) => `- ${n}`));
  L.push('', 'The factory never touches `main`. Check `staging` yourself and decide what goes to main.');
  return `${L.join('\n')}\n`;
}

export function writeReport(runDir, st, skillDir) {
  fs.writeFileSync(path.join(runDir, 'report.md'), reportText(st));
  const dash = path.join(runDir, 'dashboard.html');
  if (!fs.existsSync(dash)) fs.copyFileSync(path.join(skillDir, 'orchestrator', 'dashboard.html'), dash);
}
