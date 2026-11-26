export type IssuePriority = "P0" | "P1" | "P2" | "P3";
export type IssueComplexity = "XS" | "S" | "M" | "L";
export type IssueTier = "low" | "medium" | "high";
export type IssueAutonomy = "full_auto" | "auto_build_human_merge" | "human_required";
export type IssueStatus =
  | "backlog"
  | "ready"
  | "needs_human"
  | "in_progress"
  | "in_review"
  | "passed"
  | "failed"
  | "blocked";

export type IssueCriterion = { id: string; text: string };

const PRIORITIES = new Set<string>(["P0", "P1", "P2", "P3"]);
const COMPLEXITIES = new Set<string>(["XS", "S", "M", "L"]);
const TIERS = new Set<string>(["low", "medium", "high"]);
const AUTONOMIES = new Set<string>(["full_auto", "auto_build_human_merge", "human_required"]);
const STATUSES = new Set<string>([
  "backlog",
  "ready",
  "needs_human",
  "in_progress",
  "in_review",
  "passed",
  "failed",
  "blocked",
]);

const SENSITIVE_RE =
  /\b(auth|oauth|login|password|session|rbac|permission|payment|billing|stripe|invoice|checkout|migration|schema\.prisma|security)\b/i;

export function defaultModelPlanForTier(
  tier: IssueTier,
  engine: string,
): Record<string, string> {
  if (engine === "claude") {
    if (tier === "low") {
      return { planner: "sonnet", implementer: "sonnet", qa: "haiku", reviewer: "sonnet", qc: "sonnet" };
    }
    if (tier === "high") {
      return { planner: "fable", implementer: "opus", qa: "opus", reviewer: "opus", qc: "sonnet" };
    }
    return { planner: "fable", implementer: "sonnet", qa: "sonnet", reviewer: "opus", qc: "sonnet" };
  }
  // Antigravity latest Gemini 4 models
  if (tier === "low") {
    return {
      planner: "gemini-4-carbon-high",
      implementer: "gemini-4-carbon-medium",
      qa: "gemini-4-hydrogen-medium",
      reviewer: "gemini-4-carbon-medium",
      qc: "gemini-4-hydrogen-medium",
    };
  }
  if (tier === "high") {
    return {
      planner: "gemini-4-neon-xhigh",
      implementer: "gemini-4-neon-high",
      qa: "gemini-4-neon-high",
      reviewer: "gemini-4-neon-xhigh",
      qc: "gemini-4-carbon-high",
    };
  }
  return {
    planner: "gemini-4-neon-xhigh",
    implementer: "gemini-4-carbon-medium",
    qa: "gemini-4-carbon-medium",
    reviewer: "gemini-4-neon-high",
    qc: "gemini-4-hydrogen-medium",
  };
}

export function normalizePriority(raw: unknown): IssuePriority {
  const s = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  if (PRIORITIES.has(s)) return s as IssuePriority;
  if (s === "CRITICAL" || s === "URGENT") return "P0";
  if (s === "HIGH") return "P1";
  if (s === "LOW") return "P3";
  return "P2";
}

export function normalizeComplexity(raw: unknown, criteriaCount: number): IssueComplexity {
  const s = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  if (COMPLEXITIES.has(s)) return s as IssueComplexity;
  if (criteriaCount <= 2) return "S";
  if (criteriaCount <= 5) return "M";
  return "L";
}

export function normalizeCriteria(raw: unknown): IssueCriterion[] {
  if (typeof raw === "string") {
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, idx) => {
        const m = /^(C\d+)\s*[:.\-–]\s*(.+)$/i.exec(line);
        if (m) return { id: m[1].toUpperCase(), text: m[2].trim() };
        return { id: `C${idx + 1}`, text: line };
      });
  }
  if (!Array.isArray(raw)) return [];
  const out: IssueCriterion[] = [];
  raw.forEach((item, idx) => {
    if (typeof item === "string") {
      const trimmed = item.trim();
      if (!trimmed) return;
      const m = /^(C\d+)\s*[:.\-–]\s*(.+)$/i.exec(trimmed);
      out.push(
        m
          ? { id: m[1].toUpperCase(), text: m[2].trim() }
          : { id: `C${idx + 1}`, text: trimmed },
      );
      return;
    }
    if (typeof item === "object" && item !== null) {
      const obj = item as { id?: unknown; text?: unknown; criterion?: unknown; description?: unknown };
      const text =
        typeof obj.text === "string"
          ? obj.text.trim()
          : typeof obj.criterion === "string"
            ? obj.criterion.trim()
            : typeof obj.description === "string"
              ? obj.description.trim()
              : "";
      if (!text) return;
      const id =
        typeof obj.id === "string" && obj.id.trim() ? obj.id.trim().toUpperCase() : `C${out.length + 1}`;
      out.push({ id, text });
    }
  });
  return out;
}

export function normalizeDependsOn(raw: unknown): string[] {
  if (typeof raw === "string") {
    return raw
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean);
}

export function normalizeStatus(raw: unknown): IssueStatus | null {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return STATUSES.has(s) ? (s as IssueStatus) : null;
}

export function normalizeTier(raw: unknown): IssueTier | null {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return TIERS.has(s) ? (s as IssueTier) : null;
}

export function normalizeAutonomy(raw: unknown): IssueAutonomy | null {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return AUTONOMIES.has(s) ? (s as IssueAutonomy) : null;
}

export function classifyIssueTriage(input: {
  title: string;
  goal: string;
  body: string;
  criteriaCount: number;
  priority?: unknown;
  complexity?: unknown;
  tier?: unknown;
  autonomy?: unknown;
  status?: unknown;
  engine: string;
}): {
  priority: IssuePriority;
  complexity: IssueComplexity;
  tier: IssueTier;
  tierScore: number;
  autonomy: IssueAutonomy;
  status: IssueStatus;
  modelPlan: Record<string, string>;
} {
  const priority = normalizePriority(input.priority);
  const complexity = normalizeComplexity(input.complexity, input.criteriaCount);
  const combinedText = `${input.title}\n${input.goal}\n${input.body}`;
  const isSensitive = SENSITIVE_RE.test(combinedText);

  let score = 0;
  if (input.criteriaCount >= 6) score += 2;
  else if (input.criteriaCount >= 3) score += 1;

  if (complexity === "L") score += 4;
  else if (complexity === "M") score += 2;
  else if (complexity === "S") score += 1;

  if (isSensitive) score += 4;

  let tier: IssueTier = score >= 6 || isSensitive ? "high" : score >= 3 ? "medium" : "low";
  const rawTier = typeof input.tier === "string" ? input.tier.trim().toLowerCase() : "";
  if (TIERS.has(rawTier)) {
    // Code only elevates tier, never lowers a sensitive high-risk ticket.
    const order: IssueTier[] = ["low", "medium", "high"];
    if (order.indexOf(rawTier as IssueTier) > order.indexOf(tier)) {
      tier = rawTier as IssueTier;
    }
  }

  let autonomy: IssueAutonomy =
    tier === "high" || complexity === "L"
      ? "human_required"
      : tier === "low" && !isSensitive
        ? "full_auto"
        : "auto_build_human_merge";

  const rawAutonomy = typeof input.autonomy === "string" ? input.autonomy.trim().toLowerCase() : "";
  if (AUTONOMIES.has(rawAutonomy)) {
    const order: IssueAutonomy[] = ["full_auto", "auto_build_human_merge", "human_required"];
    if (order.indexOf(rawAutonomy as IssueAutonomy) > order.indexOf(autonomy)) {
      autonomy = rawAutonomy as IssueAutonomy;
    }
  }

  const rawStatus = typeof input.status === "string" ? input.status.trim().toLowerCase() : "";
  const status: IssueStatus = STATUSES.has(rawStatus)
    ? (rawStatus as IssueStatus)
    : autonomy === "human_required"
      ? "needs_human"
      : "ready";

  return {
    priority,
    complexity,
    tier,
    tierScore: Math.min(score, 10),
    autonomy,
    status,
    modelPlan: defaultModelPlanForTier(tier, input.engine),
  };
}
