import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import type { IssueCriterion } from "@/lib/triage";

export type SerializedRunStep = {
  id: string;
  seq: number;
  step: string;
  phase: string;
  status: string;
  round: number | null;
  spec: string | null;
  role: string | null;
  agentId: string | null;
  label: string | null;
  model: string | null;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  summary: string | null;
  dataJson: string | null;
  createdAt: string;
};

export type SerializedFactoryRun = {
  id: string;
  runKey: string;
  title: string;
  engine: string;
  status: string;
  currentPhase: string;
  baseCommit: string | null;
  targetBranch: string | null;
  mergedCommit: string | null;
  model: string | null;
  risk: string | null;
  mergeDecision: string | null;
  summary: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  durationMs: number | null;
  startedAt: string;
  finishedAt: string | null;
  updatedAt: string;
  steps: SerializedRunStep[];
};

export type SerializedProjectIssue = {
  id: string;
  issueKey: string;
  title: string;
  goal: string;
  body: string;
  criteria: IssueCriterion[];
  dependsOn: string[];
  priority: string;
  complexity: string;
  tier: string;
  tierScore: number | null;
  autonomy: string;
  modelPlan: Record<string, string> | null;
  status: string;
  currentPhase: string | null;
  runKey: string | null;
  summary: string | null;
  thinking: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ContextFilePreview = {
  path: string;
  exists: boolean;
  content: string;
  bytes: number;
};

export type ProjectDashboardStats = {
  totalRuns: number;
  runningRuns: number;
  passedRuns: number;
  failedRuns: number;
  blockedRuns: number;
  passRate: number | null;
  totalSteps: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  avgDurationMs: number | null;
  phaseCounts: Array<{ phase: string; count: number; failed: number }>;
  issues: {
    total: number;
    ready: number;
    needsHuman: number;
    inProgress: number;
    passed: number;
    failed: number;
    fullAuto: number;
    humanRequired: number;
  };
};

function safeParseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const CONTEXT_PATHS = [
  ".factory/product.md",
  ".factory/project.json",
  ".factory/decisions.md",
  ".factory/design/DESIGN.md",
  "CODING_STANDARDS.md",
  "GEMINI.md",
  "CLAUDE.md",
];

function readHostContextFiles(localPath: string | null): ContextFilePreview[] {
  if (!localPath) return [];
  const root = path.resolve(/* turbopackIgnore: true */ localPath);
  if (!existsSync(/* turbopackIgnore: true */ root)) return [];

  const out: ContextFilePreview[] = [];
  for (const rel of CONTEXT_PATHS) {
    const abs = path.join(/* turbopackIgnore: true */ root, rel);
    if (!existsSync(/* turbopackIgnore: true */ abs)) continue;
    try {
      const content = readFileSync(/* turbopackIgnore: true */ abs, "utf8");
      out.push({
        path: rel,
        exists: true,
        content: content.slice(0, 24_000),
        bytes: Buffer.byteLength(content, "utf8"),
      });
    } catch {
      // Skip unreadable file.
    }
  }
  return out;
}

export function serializeProjectIssue(issue: {
  id: string;
  issueKey: string;
  title: string;
  goal: string;
  body: string;
  criteriaJson: string;
  dependsOnJson: string;
  priority: string;
  complexity: string;
  tier: string;
  tierScore: number | null;
  autonomy: string;
  modelPlanJson: string | null;
  status: string;
  currentPhase: string | null;
  runKey: string | null;
  summary: string | null;
  thinking: string | null;
  createdAt: Date;
  updatedAt: Date;
}): SerializedProjectIssue {
  return {
    id: issue.id,
    issueKey: issue.issueKey,
    title: issue.title,
    goal: issue.goal,
    body: issue.body,
    criteria: safeParseJson<IssueCriterion[]>(issue.criteriaJson, []),
    dependsOn: safeParseJson<string[]>(issue.dependsOnJson, []),
    priority: issue.priority,
    complexity: issue.complexity,
    tier: issue.tier,
    tierScore: issue.tierScore,
    autonomy: issue.autonomy,
    modelPlan: safeParseJson<Record<string, string> | null>(issue.modelPlanJson, null),
    status: issue.status,
    currentPhase: issue.currentPhase,
    runKey: issue.runKey,
    summary: issue.summary,
    thinking: issue.thinking,
    createdAt: issue.createdAt.toISOString(),
    updatedAt: issue.updatedAt.toISOString(),
  };
}

export async function getProjectDashboardData(userId: string, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
  });
  if (!project) return null;

  const [runs, issues, tokens, allProjects] = await Promise.all([
    prisma.factoryRun.findMany({
      where: { projectId: project.id, userId },
      orderBy: { startedAt: "desc" },
      take: 50,
      include: {
        steps: {
          orderBy: { seq: "asc" },
        },
      },
    }),
    prisma.projectIssue.findMany({
      where: { projectId: project.id },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    }),
    prisma.apiToken.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        label: true,
        prefix: true,
        lastUsedAt: true,
        createdAt: true,
      },
    }),
    prisma.project.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        slug: true,
        engine: true,
      },
    }),
  ]);

  let runningRuns = 0;
  let passedRuns = 0;
  let failedRuns = 0;
  let blockedRuns = 0;
  let totalSteps = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;
  let durationSum = 0;
  let durationCount = 0;
  const phaseMap = new Map<string, { count: number; failed: number }>();

  const serializedRuns: SerializedFactoryRun[] = runs.map((run) => {
    if (run.status === "running") runningRuns += 1;
    else if (run.status === "passed") passedRuns += 1;
    else if (run.status === "failed") failedRuns += 1;
    else if (run.status === "blocked") blockedRuns += 1;

    totalSteps += run.steps.length;
    totalInputTokens += run.inputTokens;
    totalOutputTokens += run.outputTokens;
    totalCostUsd += run.costUsd;

    const computedDuration =
      run.durationMs ??
      (run.finishedAt ? Math.max(0, run.finishedAt.getTime() - run.startedAt.getTime()) : null);
    if (computedDuration !== null && computedDuration > 0) {
      durationSum += computedDuration;
      durationCount += 1;
    }

    for (const s of run.steps) {
      const cur = phaseMap.get(s.phase) ?? { count: 0, failed: 0 };
      cur.count += 1;
      if (s.status === "failed" || s.status === "blocked") cur.failed += 1;
      phaseMap.set(s.phase, cur);
    }

    return {
      id: run.id,
      runKey: run.runKey,
      title: run.title,
      engine: run.engine,
      status: run.status,
      currentPhase: run.currentPhase,
      baseCommit: run.baseCommit,
      targetBranch: run.targetBranch,
      mergedCommit: run.mergedCommit,
      model: run.model,
      risk: run.risk,
      mergeDecision: run.mergeDecision,
      summary: run.summary,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      cacheReadTokens: run.cacheReadTokens,
      costUsd: run.costUsd,
      durationMs: computedDuration,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      updatedAt: run.updatedAt.toISOString(),
      steps: run.steps.map((s) => ({
        id: s.id,
        seq: s.seq,
        step: s.step,
        phase: s.phase,
        status: s.status,
        round: s.round,
        spec: s.spec,
        role: s.role,
        agentId: s.agentId,
        label: s.label,
        model: s.model,
        durationMs: s.durationMs,
        inputTokens: s.inputTokens,
        outputTokens: s.outputTokens,
        costUsd: s.costUsd,
        summary: s.summary,
        dataJson: s.dataJson,
        createdAt: s.createdAt.toISOString(),
      })),
    };
  });

  const serializedIssues = issues.map(serializeProjectIssue);
  const issueStats = {
    total: serializedIssues.length,
    ready: serializedIssues.filter((i) => i.status === "ready").length,
    needsHuman: serializedIssues.filter(
      (i) => i.status === "needs_human" || i.status === "blocked",
    ).length,
    inProgress: serializedIssues.filter(
      (i) => i.status === "in_progress" || i.status === "in_review",
    ).length,
    passed: serializedIssues.filter((i) => i.status === "passed").length,
    failed: serializedIssues.filter((i) => i.status === "failed").length,
    fullAuto: serializedIssues.filter((i) => i.autonomy === "full_auto").length,
    humanRequired: serializedIssues.filter((i) => i.autonomy === "human_required").length,
  };

  const finishedCount = passedRuns + failedRuns + blockedRuns;
  const stats: ProjectDashboardStats = {
    totalRuns: runs.length,
    runningRuns,
    passedRuns,
    failedRuns,
    blockedRuns,
    passRate: finishedCount > 0 ? Math.round((passedRuns / finishedCount) * 100) : null,
    totalSteps,
    totalInputTokens,
    totalOutputTokens,
    totalCostUsd,
    avgDurationMs: durationCount > 0 ? Math.round(durationSum / durationCount) : null,
    phaseCounts: [...phaseMap.entries()].map(([phase, v]) => ({ phase, ...v })),
    issues: issueStats,
  };

  const contextFiles = readHostContextFiles(project.localPath);

  return {
    project: {
      ...project,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    },
    stats,
    runs: serializedRuns,
    issues: serializedIssues,
    contextFiles,
    allProjects,
    tokens: tokens.map((t) => ({
      ...t,
      lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
    })),
  };
}
