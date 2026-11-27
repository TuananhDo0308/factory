#!/usr/bin/env node
// A stand-in for `claude -p`, driven by a scenario module ($NF_FAKE_SCENARIO) whose
// default export maps a call { role, issue, n, model, effort, cwd, prompt } to what
// the agent does: { files, commit, result, hang, sleepMs, exit, api }.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const system = opt('--append-system-prompt') || '';
const role = (/^#\s+(\w+)/.exec(system)?.[1] || 'unknown').toLowerCase();
const prompt = fs.readFileSync(0, 'utf8');
const issue = /Ticket #(\d+)/.exec(prompt)?.[1] ? Number(/Ticket #(\d+)/.exec(prompt)[1]) : null;
const stateDir = process.env.NF_FAKE_STATE;
fs.mkdirSync(stateDir, { recursive: true });
const countFile = path.join(stateDir, `count-${role}-${issue ?? 'batch'}`);
const n = (fs.existsSync(countFile) ? Number(fs.readFileSync(countFile, 'utf8')) : 0) + 1;
fs.writeFileSync(countFile, String(n));
const cwd = process.cwd();
const call = { role, issue, n, model: opt('--model'), effort: opt('--effort') || null, cwd, prompt };
const start = Date.now();

const emit = (e) => process.stdout.write(`${JSON.stringify(e)}\n`);
const toolUse = (id, name, input) => emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const toolResult = (id, content, isError = false) => emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] } });

const scenario = (await import(pathToFileURL(process.env.NF_FAKE_SCENARIO).href)).default;
const act = (await scenario(call)) || {};
emit({ type: 'system', subtype: 'init', cwd, session_id: 'fake', tools: [] });

if (act.sleepMs) await new Promise((r) => setTimeout(r, act.sleepMs));
if (act.hang) {
  // A command that never exits by itself (watch mode): only a kill ends it.
  toolUse('hang1', 'Bash', { command: act.hang });
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', ...act.hang.split(' ')], { stdio: 'ignore' });
  fs.writeFileSync(path.join(stateDir, `hang-pid-${issue}`), String(child.pid));
  await new Promise((r) => child.on('exit', r));
  toolResult('hang1', 'Command was killed', true);
}
if (act.leaveServer) {
  const s = spawn(process.execPath, ['-e', "require('http').createServer((q, r) => { r.statusCode = 500; r.end('left over'); }).listen(process.env.PORT)"], { cwd, detached: true, stdio: 'ignore' });
  s.unref();
  fs.writeFileSync(path.join(stateDir, `left-pid-${issue}`), String(s.pid));
  await new Promise((r) => setTimeout(r, 300));
}
let k = 0;
for (const [f, content] of Object.entries(act.files || {})) {
  const id = `t${++k}`;
  toolUse(id, 'Write', { file_path: path.join(cwd, f) });
  const p = path.join(cwd, f);
  if (content === null) fs.rmSync(p, { force: true });
  else {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  toolResult(id, 'ok');
}
for (const [from, to] of act.rename || []) {
  fs.mkdirSync(path.dirname(path.join(cwd, to)), { recursive: true });
  fs.renameSync(path.join(cwd, from), path.join(cwd, to));
}
if (act.commit !== false && (act.files || act.rename)) {
  const st = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' });
  if (st.trim()) {
    toolUse('c1', 'Bash', { command: 'git add -A && git commit -m work' });
    execFileSync('git', ['add', '-A'], { cwd });
    execFileSync('git', ['-c', 'user.name=fake', '-c', 'user.email=fake@x', 'commit', '-q', '-m', act.commit || `${role} #${issue} round ${n}`], { cwd });
    toolResult('c1', 'committed');
  }
}

function defaults() {
  if (role === 'implementer') return { status: 'done', summary: 'built' };
  if (role === 'reviewer') return { verdict: 'pass', criteria: [], findings: [] };
  if (role === 'diagnoser') return { class: 'hard', diagnosis: 'fix the code', files: [], question: '' };
  if (role === 'qc') {
    const ids = [...prompt.matchAll(/^- \*\*(C\d+)\*\*/gm)].map((m) => m[1]);
    return { criteria: ids.map((id) => ({ id, met: true, evidence: 'seen' })), flows: [{ name: 'main', ok: true, problem: '' }] };
  }
  return {};
}
const structured = typeof act.result === 'function' ? act.result(defaults()) : act.result || defaults();
fs.appendFileSync(path.join(stateDir, 'calls.jsonl'), `${JSON.stringify({ role, issue, n, model: call.model, effort: call.effort, start, end: Date.now(), cwd, prompt })}\n`);
if (act.api) {
  emit({ type: 'result', subtype: 'error_during_execution', is_error: true, api_error_status: 529, result: 'API Error: 529 overloaded', total_cost_usd: 0 });
  process.exit(1);
}
emit({ type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } });
emit({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(structured), structured_output: structured, total_cost_usd: 0.01 });
process.exit(act.exit ?? 0);
