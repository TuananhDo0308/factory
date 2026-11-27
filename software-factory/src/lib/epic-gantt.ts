/**
 * Layout of an epic run as a Gantt chart: one row per ticket, one bar per agent process,
 * placed on the run's own time axis. Pure, so the page and the tests share it.
 */

export type GanttAgentInput = {
  id: string;
  agentKey: string;
  name: string;
  role: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
};

export type GanttBar = {
  id: string;
  role: string;
  status: string;
  name: string;
  /** "implement", "fix 2", "review"… the part of the name after the role. */
  task: string;
  startMs: number;
  endMs: number;
  /** Percent of the axis. */
  left: number;
  width: number;
  lane: number;
  running: boolean;
};

export type GanttRow = {
  ticket: number | null;
  bars: GanttBar[];
  lanes: number;
  /** Percent of the axis where the ticket merged into staging, if it did. */
  mergedAt: number | null;
};

export type GanttLayout = {
  startMs: number;
  endMs: number;
  rows: GanttRow[];
  ticks: Array<{ left: number; label: string }>;
  /** Most agents working at the same moment (the orchestrator not counted). */
  peak: number;
};

const ticketOf = (a: GanttAgentInput): number | null => {
  const m = /^#(\d+)\b/.exec(a.name) ?? /-(\d+)$/.exec(a.agentKey);
  return m ? Number(m[1]) : null;
};

const taskOf = (a: GanttAgentInput): string => {
  const dot = a.name.split("·");
  return dot.length > 1 ? dot[dot.length - 1].trim() : a.role;
};

function tickStep(spanMs: number): number {
  const min = 60_000;
  for (const m of [1, 2, 5, 10, 15, 30, 60, 120, 240]) if (spanMs / (m * min) <= 8) return m * min;
  return 480 * min;
}

function tickLabel(offsetMs: number): string {
  const totalMin = Math.round(offsetMs / 60_000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

export function buildEpicGantt(input: {
  runStartedAt: string;
  runFinishedAt: string | null;
  nowMs: number;
  agents: GanttAgentInput[];
  /** Ticket → when it merged (ISO), from the run's ticket steps. */
  mergedAt?: Map<number, string>;
  /** Tickets to show even before an agent has started on them, in order. */
  tickets?: number[];
}): GanttLayout {
  const workers = input.agents.filter((a) => a.role !== "orchestrator");
  const startMs = Math.min(
    Date.parse(input.runStartedAt),
    ...workers.map((a) => Date.parse(a.startedAt)).filter(Number.isFinite),
  );
  const ends = workers.map((a) => (a.finishedAt ? Date.parse(a.finishedAt) : input.nowMs));
  const endMs = Math.max(
    input.runFinishedAt ? Date.parse(input.runFinishedAt) : input.nowMs,
    ...ends.filter(Number.isFinite),
    startMs + 60_000,
  );
  const span = endMs - startMs;
  const pct = (ms: number) => Math.min(100, Math.max(0, ((ms - startMs) / span) * 100));

  const byTicket = new Map<number | null, GanttAgentInput[]>();
  for (const t of input.tickets ?? []) byTicket.set(t, []);
  for (const a of workers) {
    const t = ticketOf(a);
    byTicket.set(t, [...(byTicket.get(t) ?? []), a]);
  }

  const rows: GanttRow[] = [...byTicket.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a - b))
    .map(([ticket, list]) => {
      const laneEnds: number[] = [];
      const bars = [...list]
        .sort((x, y) => Date.parse(x.startedAt) - Date.parse(y.startedAt))
        .map((a) => {
          const s = Date.parse(a.startedAt);
          const running = !a.finishedAt;
          const e = Math.max(s, running ? input.nowMs : Date.parse(a.finishedAt as string));
          let lane = laneEnds.findIndex((end) => end <= s);
          if (lane === -1) lane = laneEnds.length;
          laneEnds[lane] = e;
          const left = pct(s);
          return {
            id: a.id,
            role: a.role,
            status: a.status,
            name: a.name,
            task: taskOf(a),
            startMs: s,
            endMs: e,
            left,
            width: Math.max(0.4, pct(e) - left),
            lane,
            running,
          };
        });
      const merged = ticket !== null ? input.mergedAt?.get(ticket) : undefined;
      return { ticket, bars, lanes: Math.max(1, laneEnds.length), mergedAt: merged ? pct(Date.parse(merged)) : null };
    });

  const step = tickStep(span);
  const ticks: GanttLayout["ticks"] = [];
  for (let off = 0; off <= span; off += step) ticks.push({ left: (off / span) * 100, label: tickLabel(off) });

  const events = workers.flatMap((a) => {
    const s = Date.parse(a.startedAt);
    const e = a.finishedAt ? Date.parse(a.finishedAt) : input.nowMs;
    return [
      { t: s, d: 1 },
      { t: e, d: -1 },
    ];
  });
  events.sort((x, y) => x.t - y.t || x.d - y.d);
  let cur = 0;
  let peak = 0;
  for (const ev of events) {
    cur += ev.d;
    peak = Math.max(peak, cur);
  }

  return { startMs, endMs, rows, ticks, peak };
}
