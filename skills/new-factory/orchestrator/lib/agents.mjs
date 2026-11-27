// Every agent is `claude -p` in the ticket's worktree, its stream-json log on disk.
// Tools are limited by flags, never by skipping permissions: an agent edits files
// in its own worktree and commits there; git beyond that, gh and installs are denied.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { bin, sleep } from './sh.mjs';
import { now } from './state.mjs';

const str = { type: 'string' };
export const SCHEMAS = {
  implementer: { type: 'object', properties: { status: { enum: ['done', 'blocked'] }, summary: str, blockedReason: str }, required: ['status', 'summary'] },
  reviewer: {
    type: 'object',
    properties: {
      verdict: { enum: ['pass', 'fail'] },
      criteria: { type: 'array', items: { type: 'object', properties: { id: str, met: { type: 'boolean' }, why: str }, required: ['id', 'met'] } },
      findings: { type: 'array', items: { type: 'object', properties: { severity: { enum: ['blocking', 'minor'] }, file: str, problem: str, fix: str }, required: ['severity', 'problem'] } },
    },
    required: ['verdict', 'criteria', 'findings'],
  },
  diagnoser: { type: 'object', properties: { class: { enum: ['hard', 'missing-owns', 'wrong-judge', 'contradiction'] }, diagnosis: str, files: { type: 'array', items: str }, question: str }, required: ['class', 'diagnosis'] },
  qc: {
    type: 'object',
    properties: {
      criteria: { type: 'array', items: { type: 'object', properties: { id: str, met: { type: 'boolean' }, evidence: str }, required: ['id', 'met'] } },
      flows: { type: 'array', items: { type: 'object', properties: { name: str, ok: { type: 'boolean' }, problem: str, criterion: str }, required: ['name', 'ok'] } },
    },
    required: ['criteria', 'flows'],
  },
};

const both = (cmd) => [`Bash(${cmd})`, `Bash(${cmd} *)`];
const DENY_GIT = ['push', 'pull', 'fetch', 'merge', 'rebase', 'reset', 'checkout', 'switch', 'branch', 'worktree', 'revert', 'tag', 'remote', 'stash', 'cherry-pick', 'restore', 'clean', 'update-ref', 'config'];
const DENY_INSTALL = ['npm install', 'npm i', 'npm add', 'npm ci', 'npm uninstall', 'pnpm add', 'pnpm install', 'pnpm i', 'pnpm remove', 'yarn add', 'yarn install', 'yarn remove', 'bun add', 'bun install', 'pip install', 'pip3 install'];
const DENY_ALWAYS = ['gh', 'pkill', 'killall', 'sudo', ...DENY_GIT.map((c) => `git ${c}`), ...DENY_GIT.map((c) => `git -C * ${c}`)];
const READ_BASH = ['git diff', 'git log', 'git show', 'git status', 'ls', 'cat', 'head', 'tail', 'grep', 'rg', 'find', 'wc'];

export function permissions(role, cwd) {
  const abs = `/${cwd}/**`;
  if (role === 'implementer') {
    return { tools: 'Bash,Read,Edit,Write', allow: ['Read', `Edit(${abs})`, `Write(${abs})`, 'Bash'], deny: [...DENY_ALWAYS, ...DENY_INSTALL].flatMap(both) };
  }
  if (role === 'qc') return { tools: 'Read', allow: ['Read', 'mcp__playwright'], deny: [] };
  return { tools: 'Bash,Read', allow: ['Read', ...READ_BASH.flatMap(both)], deny: DENY_ALWAYS.flatMap(both) };
}

// A readable line per stream event, for the log tail in alarms.
function describe(e) {
  if (e.type === 'assistant') {
    return (e.message?.content || [])
      .map((c) => (c.type === 'tool_use' ? `tool ${c.name}: ${(c.input?.command || c.input?.file_path || JSON.stringify(c.input || {})).slice(0, 200)}` : c.type === 'text' ? `text: ${c.text.slice(0, 200)}` : null))
      .filter(Boolean);
  }
  if (e.type === 'user') return (e.message?.content || []).filter((c) => c.type === 'tool_result').map((c) => `result${c.is_error ? ' (error)' : ''}: ${String(typeof c.content === 'string' ? c.content : JSON.stringify(c.content)).slice(0, 200)}`);
  if (e.type === 'result') return [`end: ${e.subtype}${e.is_error ? ' (error)' : ''}`];
  if (e.type === 'rate_limit_event' && e.rate_limit_info?.status === 'rejected') return ['rate limited'];
  if (e.type === 'system' && /retry|error/i.test(e.subtype || '')) return [`system: ${e.subtype}`];
  return [];
}

const API_RETRYABLE = (r, stderr) => [429, 500, 502, 503, 504, 529].includes(Number(r?.api_error_status)) || /rate.?limit|overloaded|ECONNRESET|ETIMEDOUT|socket hang up|5\d\d /i.test(`${r?.result || ''} ${stderr}`);

export class Agents {
  constructor(ctx) {
    this.ctx = ctx;
    this.running = new Map();
  }

  // { role, issue, step, model, effort, cwd, env, system, prompt, mcpConfig }
  async run(spec) {
    const st = this.ctx.store.state;
    const n = st.agents.length + 1;
    const id = `${String(n).padStart(3, '0')}-${spec.role}-${spec.issue ?? 'batch'}`;
    const log = path.join(this.ctx.runDir, 'logs', 'agents', `${id}.jsonl`);
    fs.mkdirSync(path.dirname(log), { recursive: true });
    const rec = { id, role: spec.role, issue: spec.issue ?? null, step: spec.step, model: spec.model, effort: spec.effort || null, start: now(), end: null, ms: 0, cost: 0, ok: null, log: path.relative(this.ctx.runDir, log), attempts: 0 };
    st.agents.push(rec);
    this.ctx.store.save();
    let out;
    for (let attempt = 1; ; attempt++) {
      rec.attempts = attempt;
      out = await this.once(spec, rec, log);
      rec.cost += out.cost;
      if (out.ok || !out.retryable || attempt >= 6) break;
      const wait = out.resetsAt ? Math.max(5000, out.resetsAt * 1000 - Date.now() + 5000) : Math.min(30000 * 2 ** (attempt - 1), 600000);
      const ms = Number(process.env.NF_API_RETRY_MS || wait);
      this.ctx.alarm?.({ issue: spec.issue, step: spec.step, agent: id, reason: 'api-error', handled: `API error or rate limit; waiting ${Math.round(ms / 1000)}s, then retry ${attempt + 1}`, tail: out.tail });
      await sleep(ms);
    }
    rec.end = now();
    rec.ms = Date.parse(rec.end) - Date.parse(rec.start);
    rec.ok = out.ok;
    this.ctx.store.save();
    return { ...out, id };
  }

  once(spec, rec, log) {
    const perm = permissions(spec.role, spec.cwd);
    const args = ['-p', '--model', spec.model, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'dontAsk', '--permission-prompts', 'none', '--no-session-persistence', '--strict-mcp-config', '--append-system-prompt', spec.system, '--json-schema', JSON.stringify(SCHEMAS[spec.role]), '--tools', perm.tools, '--allowedTools', ...perm.allow];
    if (perm.deny.length) args.push('--disallowedTools', ...perm.deny);
    if (spec.effort) args.push('--effort', spec.effort);
    if (spec.mcpConfig) args.push('--mcp-config', JSON.stringify(spec.mcpConfig));
    return new Promise((resolve) => {
      const child = spawn(bin.claude(), args, { cwd: spec.cwd, env: { ...process.env, ...(spec.env || {}) }, stdio: ['pipe', 'pipe', 'pipe'] });
      const file = fs.createWriteStream(log, { flags: 'a' });
      const live = { id: rec.id, pid: child.pid, issue: spec.issue, role: spec.role, step: spec.step, start: Date.now(), lastProgressAt: Date.now(), pending: new Map(), sigs: [], tail: [], rateLimited: null, apiError: null, alarmed: false };
      this.running.set(rec.id, live);
      rec.pid = child.pid;
      this.ctx.store.save();
      let buf = '';
      let stderr = '';
      let result = null;
      const onLine = (line) => {
        if (!line.trim()) return;
        let e;
        try {
          e = JSON.parse(line);
        } catch {
          return;
        }
        for (const d of describe(e)) {
          live.tail.push(d);
          if (live.tail.length > 20) live.tail.shift();
        }
        if (e.type === 'assistant') {
          for (const c of e.message?.content || []) {
            if (c.type === 'tool_use') {
              live.pending.set(c.id, { name: c.name, command: c.input?.command || '', at: Date.now() });
              const sig = `${c.name}:${JSON.stringify(c.input)}`;
              if (!live.sigs.includes(sig)) this.progress(live);
              live.sigs.push(sig);
              if (live.sigs.length > 12) live.sigs.shift();
            } else if (c.type === 'text' && c.text.trim()) this.progress(live);
          }
        } else if (e.type === 'user') {
          for (const c of e.message?.content || []) if (c.type === 'tool_result') live.pending.delete(c.tool_use_id);
          this.progress(live);
        } else if (e.type === 'rate_limit_event' && e.rate_limit_info?.status === 'rejected') live.rateLimited = { resetsAt: e.rate_limit_info.resetsAt };
        else if (e.type === 'system' && /retry|error/i.test(e.subtype || '')) live.apiError = e.subtype;
        else if (e.type === 'result') result = e;
      };
      child.stdout.on('data', (d) => {
        file.write(d);
        buf += d;
        const lines = buf.split('\n');
        buf = lines.pop();
        lines.forEach(onLine);
      });
      child.stderr.on('data', (d) => (stderr += d));
      child.on('error', (err) => (stderr += String(err)));
      child.on('close', (code) => {
        onLine(buf);
        file.end();
        this.running.delete(rec.id);
        const ok = code === 0 && result && !result.is_error;
        resolve({
          ok: Boolean(ok),
          code,
          structured: result?.structured_output ?? null,
          text: result?.result ?? '',
          cost: Number(result?.total_cost_usd || 0),
          retryable: !ok && (API_RETRYABLE(result, stderr) || Boolean(live.rateLimited) || (!result && /API|network|fetch/i.test(stderr))),
          resetsAt: live.rateLimited?.resetsAt,
          error: ok ? null : (result?.result || stderr || `exit ${code}`).slice(-2000),
          tail: live.tail.slice(),
        });
      });
      child.stdin.end(spec.prompt);
      if (process.env.NF_CRASH_AT === `agent:${spec.role}:${spec.issue}`) setTimeout(() => this.ctx.crashPoint?.(`agent:${spec.role}:${spec.issue}`), 300);
    });
  }

  progress(live) {
    live.lastProgressAt = Date.now();
    live.alarmed = false;
  }
}
