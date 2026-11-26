import { EventEmitter } from "node:events";

export type FactoryStreamEvent = {
  type:
    | "run:updated"
    | "agent:updated"
    | "step:created"
    | "live:chunk"
    | "interaction:updated"
    | "artifact:created"
    | "prototype:updated"
    | "context:updated"
    | "issue:updated"
    | "project:updated"
    | "pr:updated"
    | "runner:updated"
    | "lesson:updated"
    | "command:created";
  userId: string;
  projectId?: string | null;
  runId?: string | null;
  payload?: Record<string, unknown>;
  ts: string;
};

const globalForBus = globalThis as unknown as {
  sfEventBus?: EventEmitter;
};

export const sfEventBus: EventEmitter =
  globalForBus.sfEventBus ??
  (() => {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(200);
    return emitter;
  })();

if (process.env.NODE_ENV !== "production") {
  globalForBus.sfEventBus = sfEventBus;
}

export function emitFactoryEvent(event: Omit<FactoryStreamEvent, "ts">): void {
  const full: FactoryStreamEvent = {
    ...event,
    ts: new Date().toISOString(),
  };
  sfEventBus.emit("factory-event", full);
}
