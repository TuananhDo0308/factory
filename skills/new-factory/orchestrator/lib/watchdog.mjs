// 4e: no timeouts. An agent with no progress for STALL_MS gets an alarm with its
// cause. A command that does not exit (dev server in the foreground, watch mode,
// a prompt waiting for y/n) is killed, by PID, inside that agent's own process
// tree; the agent gets the error back and goes on. The agent itself is never killed.
import { killTree, run, sleep } from './sh.mjs';
import { alarm } from './notify.mjs';

export const STALL_MS = () => Number(process.env.NF_STALL_MS || 30 * 60 * 1000);
const EVERY_MS = () => Number(process.env.NF_WATCH_INTERVAL_MS || 60 * 1000);

export async function processTable() {
  const r = await run('ps', ['-A', '-o', 'pid=,ppid=,command='], { allowFail: true });
  return r.stdout
    .split('\n')
    .map((l) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l))
    .filter(Boolean)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), command: m[3] }));
}

export function descendants(table, root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const p = stack.pop();
    for (const c of table.filter((x) => x.ppid === p)) {
      out.push(c);
      stack.push(c.pid);
    }
  }
  return out;
}

const WATCH = /\b(?:vite(?!\s+build)(?:\s|$)|vitest(?!\s+run)(?:\s|$)|--watch\b|\bwatch\b|next\s+dev|nodemon|webpack\s+serve|--ui\b|npm\s+(?:run\s+)?(?:dev|start)\b|serve\b|http-server|tail\s+-f)/;
const NOISE = new Set(['npx', 'npm', 'pnpm', 'yarn', 'run', 'node', 'sh', 'bash', 'zsh', 'cd', 'exec', 'env', 'eval', 'then', 'echo', 'true', 'test', 'source']);

// The significant words of the stuck command: what its processes will show.
export function commandWords(command) {
  return [...new Set(command.split(/[\s;&|()'"`]+/).filter((w) => w.length >= 3 && !w.startsWith('-') && !NOISE.has(w) && !/^[A-Z_]+=/.test(w)))];
}

// Pure. live: the agent's live record; table: ps output. Returns
// { reason, kind?, targets: [pid] } — targets only when the cause is known.
export function classifyStall(live, table) {
  const pendingBash = [...live.pending.values()].filter((p) => p.name === 'Bash').sort((a, b) => a.at - b.at)[0];
  if (live.rateLimited || live.apiError) return { reason: 'api-error', targets: [] };
  if (pendingBash) {
    const words = commandWords(pendingBash.command);
    const tree = descendants(table, live.pid).filter((p) => !/mcp|claude/i.test(p.command.split(/\s+/)[0]));
    const hit = tree.filter((p) => words.some((w) => p.command.includes(w)));
    const ids = new Set(hit.map((p) => p.pid));
    const tops = hit.filter((p) => !ids.has(p.ppid));
    if (tops.length) {
      const kind = WATCH.test(pendingBash.command) ? 'watch or server' : /\b(?:y\/n|\[Y\/n\]|Ok to proceed|\(y\))/i.test(live.tail.join('\n')) || /^npx\b/.test(pendingBash.command) ? 'waiting for input' : 'command did not exit';
      return { reason: 'command-not-exiting', kind, command: pendingBash.command, targets: tops.map((p) => p.pid) };
    }
  }
  const recent = live.sigs.slice(-6);
  if (recent.length >= 6 && new Set(recent).size <= 2) return { reason: 'loop', targets: [] };
  if (/EADDRINUSE|address already in use|\.lock\b|database is locked|resource busy/i.test(live.tail.join('\n'))) return { reason: 'resource-locked', targets: [] };
  return { reason: 'unknown', targets: [] };
}

const REASONS = {
  'command-not-exiting': 'a command the agent started does not exit',
  'api-error': 'API error or rate limit',
  loop: 'the agent repeats the same steps',
  'resource-locked': 'a port or resource is locked',
  unknown: 'no progress, cause unknown',
};

export async function checkOnce(ctx) {
  const stall = STALL_MS();
  const stuck = [...ctx.agents.running.values()].filter((l) => !l.alarmed && Date.now() - l.lastProgressAt > stall);
  if (!stuck.length) return [];
  const table = await processTable();
  const done = [];
  for (const live of stuck) {
    live.alarmed = true;
    const c = classifyStall(live, table);
    let handled = 'alarm only';
    let all = [];
    if (c.targets.length) {
      all = c.targets.flatMap((pid) => [pid, ...descendants(table, pid).map((p) => p.pid)]).filter((pid) => pid !== live.pid);
      for (const pid of [...all].reverse()) killTree(pid);
      handled = `killed the stuck process (PID ${c.targets.join(', ')}: \`${c.command.slice(0, 120)}\`, ${c.kind}); the agent gets the error and goes on`;
    } else if (c.reason === 'api-error') handled = 'waiting: Claude Code retries by itself, and the orchestrator retries the agent if it stops';
    const elapsedMs = Date.now() - live.start;
    done.push({ ...c, agent: live.id });
    await alarm(ctx, { issue: live.issue, step: live.step, agent: live.id, elapsedMs, reason: REASONS[c.reason], cause: c.reason, handled, tail: live.tail });
    if (all.length) {
      await sleep(3000);
      for (const pid of all) killTree(pid, 'SIGKILL');
    }
  }
  return done;
}

export function startWatchdog(ctx) {
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await checkOnce(ctx);
    } catch (e) {
      ctx.log(`watchdog: ${e.message}`);
    } finally {
      busy = false;
    }
  }, EVERY_MS());
  timer.unref();
  return () => clearInterval(timer);
}
