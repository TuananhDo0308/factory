// Unified pluggable engine adapter facade (claude | antigravity | mock).
import { runAntigravityAgent } from "./antigravity.mjs";
import { runClaudeAgent } from "./claude.mjs";
import { runMockAgent } from "./mock.mjs";

const MODEL_MATRIX = {
  claude: {
    builder: { S: "sonnet", M: "sonnet", L: "opus" },
    reviewer: { S: "sonnet", M: "sonnet", L: "opus" },
    evaluator: { S: "sonnet", M: "sonnet", L: "sonnet" },
  },
  antigravity: {
    builder: { S: "gemini-4-carbon-medium", M: "gemini-4-carbon-high", L: "gemini-4-neon-high" },
    reviewer: { S: "gemini-4-carbon-high", M: "gemini-4-neon-high", L: "gemini-4-neon-xhigh" },
    evaluator: { S: "gemini-4-neon-high", M: "gemini-4-neon-high", L: "gemini-4-neon-high" },
  },
  mock: {
    builder: { S: "mock", M: "mock", L: "mock" },
    reviewer: { S: "mock", M: "mock", L: "mock" },
    evaluator: { S: "mock", M: "mock", L: "mock" },
  },
};

export function resolveModel(engine, role, size = "M", override = null) {
  if (override) return override;
  const eng = MODEL_MATRIX[engine] || MODEL_MATRIX.claude;
  const byRole = eng[role] || eng.builder;
  return byRole[size] || byRole.M;
}

export async function runAgent(params) {
  const engine = params.engine || "claude";
  const model = resolveModel(engine, params.role, params.size, params.model);
  const full = { ...params, engine, model };
  if (engine === "claude") return runClaudeAgent(full);
  if (engine === "antigravity") return runAntigravityAgent(full);
  if (engine === "mock") return runMockAgent(full);
  throw new Error(`Unsupported engine adapter: "${engine}". Use claude, antigravity, or mock.`);
}
