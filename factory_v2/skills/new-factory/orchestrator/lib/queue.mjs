// Step 0: one batch at a time on staging. A batch started while another runs
// waits in line, and starts from the newest staging when its turn comes.
import fs from 'node:fs';
import { alive, sleep } from './sh.mjs';
import { writeAtomic } from './state.mjs';

// Pure: may `me` start now? Dead holders and dead waiters are dropped.
export function decide(queue, me, isAlive = alive) {
  let waiting = (queue.waiting || []).filter((w) => w.runId === me.runId || isAlive(w.pid));
  if (!waiting.some((w) => w.runId === me.runId)) waiting.push(me);
  waiting = waiting.map((w) => (w.runId === me.runId ? { ...w, pid: me.pid } : w));
  let active = queue.active || null;
  if (active && (active.runId === me.runId || !isAlive(active.pid))) active = null;
  if (!active && waiting[0].runId === me.runId) return { start: true, queue: { active: me, waiting: waiting.slice(1) } };
  return { start: false, queue: { active, waiting }, ahead: active ? active.runId : waiting[0].runId };
}

function withMutex(file, fn) {
  const lock = `${file}.lock`;
  for (let i = 0; ; i++) {
    try {
      fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const holder = Number(fs.readFileSync(lock, 'utf8') || 0);
      if (!alive(holder) || i > 200) fs.rmSync(lock, { force: true });
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

const read = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {});

// Waits for this run's turn. onWait(ahead) is called once when it has to wait.
export async function acquire(file, runId, { pollMs = Number(process.env.NF_QUEUE_POLL_MS || 30000), onWait } = {}) {
  const me = { runId, pid: process.pid, since: new Date().toISOString() };
  let told = false;
  for (;;) {
    const d = withMutex(file, () => {
      const r = decide(read(file), me);
      writeAtomic(file, JSON.stringify(r.queue, null, 2));
      return r;
    });
    if (d.start) return;
    if (!told) onWait?.(d.ahead);
    told = true;
    await sleep(pollMs);
  }
}

export function release(file, runId) {
  withMutex(file, () => {
    const q = read(file);
    if (q.active?.runId === runId) q.active = null;
    q.waiting = (q.waiting || []).filter((w) => w.runId !== runId);
    writeAtomic(file, JSON.stringify(q, null, 2));
  });
}
