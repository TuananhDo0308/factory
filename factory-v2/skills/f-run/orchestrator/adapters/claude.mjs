// Claude Code CLI headless adapter (`claude -p --output-format json`).
import { readFileSync } from "node:fs";
import { runWithWatchdog } from "../watchdog.mjs";

export function parseStructuredOutput(rawStdout) {
  const trimmed = (rawStdout || "").trim();
  if (!trimmed) return { data: null, usage: null, raw: "" };

  let envelope = null;
  try {
    envelope = JSON.parse(trimmed);
  } catch {
    // Fallback: locate last JSON object in stdout
    const start = trimmed.lastIndexOf("\n{");
    if (start >= 0) {
      try {
        envelope = JSON.parse(trimmed.slice(start + 1));
      } catch {
        // fall through
      }
    }
  }

  if (envelope && typeof envelope === "object") {
    const usage = {
      costUsd: Number(envelope.total_cost_usd ?? envelope.cost_usd ?? 0),
      inputTokens: Number(envelope.usage?.input_tokens ?? 0),
      outputTokens: Number(envelope.usage?.output_tokens ?? 0),
    };
    if (envelope.structured_output && typeof envelope.structured_output === "object") {
      return { data: envelope.structured_output, usage, raw: trimmed };
    }
    if (typeof envelope.result === "string") {
      const extracted = extractJsonBlock(envelope.result);
      return { data: extracted, usage, raw: envelope.result };
    }
    if (envelope.result && typeof envelope.result === "object") {
      return { data: envelope.result, usage, raw: trimmed };
    }
    return { data: envelope, usage, raw: trimmed };
  }

  return { data: extractJsonBlock(trimmed), usage: null, raw: trimmed };
}

export function extractJsonBlock(text) {
  if (!text) return null;
  const s = text.trim();
  try {
    return JSON.parse(s);
  } catch {
    // try fenced block
  }
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // ignore
    }
  }
  const firstBrace = s.indexOf("{");
  const lastBrace = s.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      return JSON.parse(s.slice(firstBrace, lastBrace + 1));
    } catch {
      // ignore
    }
  }
  return null;
}

export async function runClaudeAgent({
  prompt,
  cwd,
  schemaPath,
  model = "sonnet",
  effort = "high",
  readOnly = false,
  maxBudgetUsd = 3.0,
  idleTimeoutMs = 8 * 60 * 1000,
  env = process.env,
}) {
  const args = [
    "-p",
    "--output-format",
    "json",
    "--dangerously-skip-permissions",
    "--no-session-persistence",
    "--model",
    model,
    "--effort",
    effort,
  ];

  if (maxBudgetUsd > 0) {
    args.push("--max-budget-usd", String(maxBudgetUsd));
  }
  if (readOnly) {
    args.push("--disallowedTools", "Edit,Write,NotebookEdit");
  }
  if (schemaPath) {
    const schemaStr = JSON.stringify(JSON.parse(readFileSync(schemaPath, "utf8")));
    args.push("--json-schema", schemaStr);
  }

  const res = await runWithWatchdog("claude", args, {
    cwd,
    env,
    stdinText: prompt,
    idleTimeoutMs,
  });

  const parsed = parseStructuredOutput(res.stdout);
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
        ? `claude exited ${res.exitCode}${res.timedOut ? ` (${res.timeoutCause})` : ""}:\n${res.lastLines}`
        : parsed.data === null
          ? `claude returned unparseable JSON:\n${res.lastLines}`
          : null,
  };
}
