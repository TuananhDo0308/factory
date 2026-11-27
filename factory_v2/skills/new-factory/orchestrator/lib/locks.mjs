// 4d "ticket needs more room": the lock table. A file a ticket needs outside its
// Owns is free, held by a ticket that will only run after this one (hand it over),
// held by a ticket waiting on a decision (wait on that decision too), or held by
// another ticket (wait for it to merge, unless waiting would close a cycle).
import { effectiveOwns, owned } from './owns.mjs';

const DONE = new Set(['merged']);

// Does ticket a depend on ticket b, directly or through others?
export function dependsOn(tickets, a, b, seen = new Set()) {
  if (seen.has(a)) return false;
  seen.add(a);
  const t = tickets[a];
  return Boolean(t?.dependsOn.some((d) => d === b || dependsOn(tickets, d, b, seen)));
}

// Who holds a file now: an explicit lock, or a ticket not yet merged that owns it.
export function holderOf(file, tickets, locks, self) {
  if (locks[file] !== undefined && Number(locks[file]) !== self) return Number(locks[file]);
  if (locks[file] !== undefined) return null;
  const t = Object.values(tickets).find((x) => x.issue !== self && !DONE.has(x.status) && owned(file, effectiveOwns(x)));
  return t ? t.issue : null;
}

// Edges of "x waits for y": a waiting ticket on its holder, a ticket not merged on
// each dependency not merged. Is there a path from `from` to `to`?
export function waitsFor(tickets, from, to, extra = []) {
  const edges = new Map();
  const add = (x, y) => edges.set(x, [...(edges.get(x) || []), y]);
  for (const t of Object.values(tickets)) {
    if (DONE.has(t.status)) continue;
    if (t.status === 'waiting' && t.waitingFor) add(t.issue, t.waitingFor);
    for (const d of t.dependsOn) if (!DONE.has(tickets[d]?.status)) add(t.issue, d);
  }
  for (const [x, y] of extra) add(x, y);
  const seen = new Set();
  const stack = [from];
  while (stack.length) {
    const x = stack.pop();
    if (x === to) return true;
    if (seen.has(x)) continue;
    seen.add(x);
    stack.push(...(edges.get(x) || []));
  }
  return false;
}

// Pure decision for ticket `self` needing `files`. Does not change anything.
// { result: 'granted', transfers: [{ file, from }] } | { result: 'needs-decision', holder }
// | { result: 'wait', holder } | { result: 'cycle', holder }
export function request(tickets, locks, self, files) {
  const transfers = [];
  let wait = null;
  for (const file of files) {
    const h = holderOf(file, tickets, locks, self);
    if (h === null) continue;
    if (dependsOn(tickets, h, self)) {
      transfers.push({ file, from: h });
      continue;
    }
    if (tickets[h]?.status === 'needs-decision') return { result: 'needs-decision', holder: h, file };
    wait ||= { holder: h, file };
  }
  if (wait) {
    if (waitsFor(tickets, wait.holder, self, [[self, wait.holder]])) return { result: 'cycle', ...wait };
    return { result: 'wait', ...wait };
  }
  return { result: 'granted', transfers };
}

// Apply a grant: the files are locked to self.
export function grant(locks, self, files) {
  for (const f of files) locks[f] = self;
}

export function release(locks, self) {
  for (const [f, who] of Object.entries(locks)) if (Number(who) === self) delete locks[f];
}
