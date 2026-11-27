// Running commands. Every child is started by us, so we always know its PID:
// nothing is ever killed by name.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';

export const bin = {
  claude: () => process.env.NF_CLAUDE_BIN || 'claude',
  gh: () => process.env.NF_GH_BIN || 'gh',
};

// Run a program, collect its output. Rejects on a non-zero exit unless allowFail.
export function run(cmd, args = [], { cwd, env, input, allowFail = false, log, onSpawn, detached = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: env ? { ...process.env, ...env } : process.env, stdio: ['pipe', 'pipe', 'pipe'], detached });
    onSpawn?.(child);
    let stdout = '';
    let stderr = '';
    const out = log ? fs.createWriteStream(log, { flags: 'a' }) : null;
    child.stdout.on('data', (d) => {
      stdout += d;
      out?.write(d);
    });
    child.stderr.on('data', (d) => {
      stderr += d;
      out?.write(d);
    });
    child.on('error', (e) => {
      out?.end();
      reject(e);
    });
    child.on('close', (code, signal) => {
      out?.end();
      const r = { code: code ?? (signal ? 128 : 1), stdout, stderr, signal };
      if (r.code !== 0 && !allowFail) {
        const e = new Error(`${cmd} ${args.join(' ')} exited ${r.code}: ${(stderr || stdout).trim().split('\n').slice(-5).join('\n')}`);
        Object.assign(e, r);
        reject(e);
      } else resolve(r);
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

// A shell command line (project checks, dev servers). Own process group, so the
// whole tree started by that line can be stopped through the PID we recorded.
export function shell(line, opts = {}) {
  return run('/bin/sh', ['-c', line], { detached: true, ...opts });
}

export async function git(cwd, ...args) {
  const r = await run('git', args, { cwd });
  return r.stdout.trim();
}

export async function gitOk(cwd, ...args) {
  const r = await run('git', args, { cwd, allowFail: true });
  return r.code === 0;
}

export async function gh(...args) {
  const r = await run(bin.gh(), args);
  return r.stdout;
}

export const ghJson = async (...args) => JSON.parse(await gh(...args));

// Stop a process group we started (negative PID), then the process itself.
export function killTree(pid, signal = 'SIGTERM') {
  for (const target of [-pid, pid]) {
    try {
      process.kill(target, signal);
    } catch {}
  }
}

export const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A port nothing listens on now, not one handed out earlier in this run.
const given = new Set();
export async function freePort() {
  for (;;) {
    const port = await new Promise((resolve, reject) => {
      const s = net.createServer();
      s.unref();
      s.on('error', reject);
      s.listen(0, '127.0.0.1', () => {
        const p = s.address().port;
        s.close(() => resolve(p));
      });
    });
    if (!given.has(port)) {
      given.add(port);
      return port;
    }
  }
}

// Is something answering HTTP on this port?
export async function answers(port, path = '/') {
  try {
    const r = await fetch(`http://localhost:${port}${path}`, { signal: AbortSignal.timeout(3000) });
    return r.status < 500;
  } catch {
    return false;
  }
}
