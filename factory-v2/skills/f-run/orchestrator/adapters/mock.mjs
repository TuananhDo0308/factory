// Scriptable mock adapter for fast zero-API integration testing of the orchestrator.
// Tests can register a handler via setMockHandler(fn) or provide a JS module path via FACTORY_MOCK_HANDLER.

let activeHandler = null;

export function setMockHandler(fn) {
  activeHandler = fn;
}

export async function runMockAgent(params) {
  const startedAt = Date.now();
  let handler = activeHandler;
  if (!handler && process.env.FACTORY_MOCK_HANDLER) {
    const mod = await import(process.env.FACTORY_MOCK_HANDLER);
    handler = mod.default || mod.handle;
  }
  if (!handler) {
    throw new Error("Mock adapter invoked without a registered handler (setMockHandler or FACTORY_MOCK_HANDLER).");
  }
  const out = await handler(params);
  return {
    ok: out.ok ?? true,
    exitCode: out.exitCode ?? (out.ok === false ? 1 : 0),
    timedOut: Boolean(out.timedOut),
    timeoutCause: out.timeoutCause || null,
    data: out.data ?? {},
    usage: out.usage ?? { costUsd: 0.01, inputTokens: 1000, outputTokens: 200 },
    durationMs: Date.now() - startedAt,
    error: out.error || null,
  };
}
