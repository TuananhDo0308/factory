// Gemini Antigravity CLI headless adapter (`agy --output-format stream-json -p <prompt>`).
// Streaming NDJSON keeps watchdog's idle timer alive during long multi-tool turns.
import { runWithWatchdog } from "../watchdog.mjs";
import { extractJsonBlock, parseStructuredOutput } from "./claude.mjs";

function parseAntigravityOutput(rawStdout) {
  const trimmed = (rawStdout || "").trim();
  if (!trimmed) return { data: null, usage: null, raw: "" };

  const lines = trimmed.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith("{")) continue;
    try {
      const obj = JSON.parse(line);
      const envelope = obj.event === "result" && obj.result ? obj.result : obj;
      if (envelope && typeof envelope === "object" && typeof envelope.response === "string") {
        const usage = {
          costUsd: Number(envelope.total_cost_usd ?? envelope.cost_usd ?? 0),
          inputTokens: Number(envelope.usage?.input_tokens ?? 0),
          outputTokens: Number(envelope.usage?.output_tokens ?? 0),
        };
        const data = extractJsonBlock(envelope.response);
        return { data, usage, raw: envelope.response };
      }
    } catch {
      // continue scanning backward
    }
  }

  return parseStructuredOutput(rawStdout);
}

export async function runAntigravityAgent({
  prompt,
  cwd,
  schemaPath,
  model = "gemini-4-carbon-high",
  idleTimeoutMs = 8 * 60 * 1000,
  env = process.env,
}) {
  const args = [
    "--output-format",
    "stream-json",
    "--dangerously-skip-permissions",
    "--disable-slash-commands",
    "--model",
    model,
  ];

  if (schemaPath) {
    args.push("--json-schema", schemaPath);
  }
  args.push("-p", prompt);

  const res = await runWithWatchdog("agy", args, {
    cwd,
    env,
    idleTimeoutMs,
  });

  const parsed = parseAntigravityOutput(res.stdout);
  return {
    ok: res.exitCode === 0 && parsed.data !== null,
    exitCode: res.exitCode,
    timedOut: res.timedOut,
    timeoutCause: res.timeoutCause,
    data: parsed.data,
    usage: parsed.usage,
    durationMs: res.durationMs,
    error:
      res.exitCode !== 0
        ? `agy exited ${res.exitCode}${res.timedOut ? ` (${res.timeoutCause})` : ""}:\n${res.lastLines}`
        : parsed.data === null
          ? `agy returned unparseable JSON:\n${res.lastLines}`
          : null,
  };
}
