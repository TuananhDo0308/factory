// Step 3: by the dependency graph, not by wave. A ticket starts as soon as every
// ticket it depends on is merged, at most MAX at a time.
export const MAX_PARALLEL = Number(process.env.NF_MAX_PARALLEL || 4);

const merged = (t) => t?.status === 'merged';
const stopped = (t) => t?.status === 'needs-decision' || t?.status === 'blocked';

// Pure. tickets: { [issue]: ticket }. running: Set of issues being driven now.
// opts.hold: do not start tickets that depend on anything (staging is red).
// Returns { start: [issue], block: [issue] }: what to start now, what can never
// start in this run because a ticket it depends on (directly or not) is stopped.
export function next(tickets, running, { max = MAX_PARALLEL, hold = false } = {}) {
  const block = [];
  const isBlocked = (t, seen = new Set()) => {
    if (seen.has(t.issue)) return false;
    seen.add(t.issue);
    return t.dependsOn.some((d) => stopped(tickets[d]) || (tickets[d] && isBlocked(tickets[d], seen)));
  };
  for (const t of Object.values(tickets)) if (t.status === 'pending' && isBlocked(t)) block.push(t.issue);
  const ready = Object.values(tickets)
    .filter((t) => !running.has(t.issue) && !block.includes(t.issue))
    .filter((t) => t.status === 'reopened' || (t.status === 'pending' && t.dependsOn.every((d) => merged(tickets[d])) && !(hold && t.dependsOn.length)))
    .sort((a, b) => (a.status === 'reopened' ? -1 : 0) - (b.status === 'reopened' ? -1 : 0) || a.wave - b.wave || a.issue - b.issue);
  const room = Math.max(0, max - running.size);
  return { start: ready.slice(0, room).map((t) => t.issue), block };
}

// Tickets that wait on `issue` and could start the moment it merges.
export function waitingOn(tickets, issue) {
  return Object.values(tickets).filter((t) => t.status === 'pending' && t.dependsOn.includes(issue) && t.dependsOn.every((d) => d === issue || merged(tickets[d])));
}

// Every ticket that depends on `issue`, directly or not.
export function dependents(tickets, issue) {
  const out = new Set();
  const walk = (i) => {
    for (const t of Object.values(tickets)) if (t.dependsOn.includes(i) && !out.has(t.issue)) {
      out.add(t.issue);
      walk(t.issue);
    }
  };
  walk(issue);
  return [...out];
}

export const settled = (t) => ['merged', 'needs-decision', 'blocked'].includes(t.status);
