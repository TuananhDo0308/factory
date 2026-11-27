// Step 6: once every ticket rests. One full check on the final staging, e2e results
// per criterion from the test tags, then one QC agent in the browser for the smoke
// and the criteria no e2e test covers. Failures go back to their tickets.
import fs from 'node:fs';
import path from 'node:path';
import { qcTask, system } from './briefs.mjs';
import { criteriaResults } from './checks.mjs';
import { head } from './git.mjs';
import { checkStaging, reopen } from './merge.mjs';
import { QC } from './models.mjs';
import { MCP_PACKAGE } from './prepare.mjs';
import { answers, freePort, killTree, shell, sleep } from './sh.mjs';
import { now } from './state.mjs';

// The epic's own text without the Tickets and Plan sections: the flow a user walks.
export const flowsOf = (epicBody = '') => epicBody.split(/^##\s+(?:Tickets|Plan)\s*$/m)[0].trim();

async function startServer(ctx, port) {
  const st = ctx.store.state;
  let pid = null;
  const done = shell(ctx.profile.dev, { cwd: ctx.base, allowFail: true, env: { PORT: String(port), BASE_URL: `http://localhost:${port}`, CI: '1' }, log: path.join(ctx.runDir, 'logs', 'qc-server.log'), onSpawn: (c) => (pid = c.pid) });
  st.final.serverPid = pid;
  ctx.store.save();
  const deadline = Date.now() + Number(process.env.NF_SERVER_WAIT_MS || 60000);
  while (Date.now() < deadline && !(await answers(port))) await sleep(300);
  return { pid, done, up: await answers(port) };
}

// Returns 'done' or 'again' (something went back to a ticket).
export async function finalPhase(ctx) {
  const st = ctx.store.state;
  st.final ||= { checks: 0, e2e: {}, qcPassed: [], qcFailed: [], flows: [], flowsDone: false, qcRuns: 0 };
  const f = st.final;
  f.checks += 1;
  ctx.store.save();
  const r = await checkStaging(ctx, 'final', { step: 'final check' });
  Object.assign(f.e2e, criteriaResults(r.res.results));
  f.lastCheck = { at: now(), ok: r.ok, sha: await head(ctx.base) };
  ctx.store.save();
  if (!r.ok) return r.routed ? 'again' : 'done';

  const merged = Object.values(st.tickets).filter((t) => t.status === 'merged');
  const todo = merged.flatMap((t) => t.criteria.map((c) => ({ ...c, issue: t.issue }))).filter((c) => !f.qcPassed.includes(c.id));
  const byHand = todo.filter((c) => f.e2e[c.id] !== 'pass');
  for (const c of todo.filter((c) => f.e2e[c.id] === 'pass')) f.qcPassed.push(c.id);
  const smoke = !f.flowsDone && merged.length > 0;
  if (!byHand.length && !smoke) return 'done';
  if (!ctx.profile.dev) {
    f.qcSkipped = 'the project has no dev server script; QC could not open the app';
    ctx.log(f.qcSkipped);
    return 'done';
  }

  ctx.store.begin('qc');
  const port = await freePort();
  const server = await startServer(ctx, port);
  let out;
  try {
    if (!server.up) {
      out = { ok: false, error: `the dev server did not answer on PORT=${port}` };
    } else {
      out = await ctx.agents.run({
        role: 'qc',
        issue: null,
        step: 'qc',
        ...QC,
        cwd: ctx.base,
        env: { BASE_URL: `http://localhost:${port}`, PORT: String(port) },
        system: system(ctx.skillDir, 'qc'),
        prompt: qcTask(ctx, { baseUrl: `http://localhost:${port}`, criteria: byHand, flows: smoke ? flowsOf(st.epicBody) || merged.map((t) => `- ${t.title}`).join('\n') : null, prototype: st.plan.prototype ? path.join(ctx.base, st.plan.prototype.path, 'index.html') : null }),
        mcpConfig: { mcpServers: { playwright: { command: 'npx', args: ['-y', MCP_PACKAGE, '--headless', '--isolated'] } } },
      });
    }
  } finally {
    if (server.pid) killTree(server.pid);
    await Promise.race([server.done, sleep(5000)]);
    if (server.pid) killTree(server.pid, 'SIGKILL');
    st.final.serverPid = null;
    ctx.store.end('qc');
  }
  f.qcRuns += 1;
  if (!out.ok || !out.structured) {
    f.qcError = String(out.error).slice(0, 500);
    ctx.log(`QC could not run: ${f.qcError}`);
    ctx.alarm({ step: 'qc', reason: 'QC could not run', handled: 'the batch is reported without QC', tail: out.tail || [] });
    return 'done';
  }
  if (smoke) f.flowsDone = true;
  const v = out.structured;
  const owner = (id) => merged.find((t) => t.criteria.some((c) => c.id === id))?.issue;
  const back = new Map();
  const send = (issue, failure) => issue && back.set(issue, [...(back.get(issue) || []), failure]);
  for (const c of byHand) {
    const got = (v.criteria || []).find((x) => x.id === c.id);
    if (!got) continue;
    if (got.met) f.qcPassed.push(c.id);
    else {
      f.qcFailed.push({ id: c.id, at: now(), evidence: got.evidence });
      send(c.issue, { kind: 'qc', message: `QC: ${c.id} is not met in the running app: ${got.evidence || ''}` });
    }
  }
  for (const fl of v.flows || []) {
    f.flows.push({ ...fl, at: now() });
    if (!fl.ok && fl.criterion && owner(fl.criterion)) send(owner(fl.criterion), { kind: 'qc', message: `QC smoke, flow "${fl.name}": ${fl.problem}` });
  }
  ctx.store.save();
  if (!back.size) return 'done';
  for (const [issue, failures] of back) reopen(ctx, issue, failures);
  return 'again';
}
