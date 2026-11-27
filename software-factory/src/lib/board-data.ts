import { ACTIVE_RUN_STATUSES } from "@/lib/dispatch";
import { repoFullName, ticketOfAgent } from "@/lib/epics";
import { prisma } from "@/lib/prisma";
import { serializeProjectIssue, type SerializedProjectIssue } from "@/lib/project-stats";
import { serializePrototype } from "@/lib/prototype-server";
import type { SerializedPrototype } from "@/lib/prototypes";
import { getAccessibleRunners } from "@/lib/team-access";
import { isRunnerOnline, safeJsonParse } from "@/lib/workspace-data";

export type BoardAgent = {
  id: string;
  agentKey: string;
  name: string;
  role: string;
  status: string;
  activity: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  updatedAt: string;
};

export type BoardRunSummary = {
  id: string;
  runKey: string;
  title: string;
  mode: string;
  status: string;
  currentPhase: string;
  epicNumber: number | null;
  summary: string | null;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  durationMs: number | null;
  triggeredBy: string | null;
  pendingInteractionsCount: number;
  startedAt: string;
  finishedAt: string | null;
  updatedAt: string;
};

export type BoardDecision = {
  interactionId: string;
  runId: string;
  question: string;
  reason: string;
  createdAt: string;
};

export type EnrichedBoardIssue = SerializedProjectIssue & {
  prototypes: SerializedPrototype[];
  /** Agents of the latest run of this ticket's epic that worked on this ticket. */
  agents: BoardAgent[];
  /** The pending decision for this ticket, when it needs one. */
  decision: BoardDecision | null;
};

export type BoardEpic = {
  id: string;
  number: number;
  title: string;
  url: string | null;
  status: string;
  summary: string | null;
  ticketCount: number;
  mergedCount: number;
  latestRun: BoardRunSummary | null;
  activeRunId: string | null;
};

export type ActiveBaRunSummary = {
  id: string;
  runKey: string;
  title: string;
  status: string;
  currentPhase: string;
  activity: string | null;
  pendingInteractionsCount: number;
  startedAt: string;
  updatedAt: string;
};

export type ProjectBoardSnapshot = {
  maxConcurrency: number;
  repo: string | null;
  epics: BoardEpic[];
  /** Tickets (every issue but the epic rows). */
  issues: EnrichedBoardIssue[];
  prototypes: SerializedPrototype[];
  activeBaRun: ActiveBaRunSummary | null;
  runners: Array<{
    id: string;
    name: string;
    hostname: string;
    os: string;
    visibility: "personal" | "team";
    isOwn: boolean;
    ownerLogin: string;
    status: string;
    activeRuns: number;
    maxConcurrency: number;
  }>;
  /** The 30 latest runs (BA sessions and epic runs). */
  runs: BoardRunSummary[];
  /** Exact totals over every run of the project (summed server-side from the runs' recorded usage). */
  totals: {
    runs: number;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    durationMs: number;
  };
};

type RunRow = {
  id: string;
  runKey: string;
  title: string;
  mode: string;
  status: string;
  currentPhase: string;
  epicNumber: number | null;
  summary: string | null;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  durationMs: number | null;
  startedAt: Date;
  finishedAt: Date | null;
  updatedAt: Date;
  triggeredBy: { githubLogin: string } | null;
  user: { githubLogin: string } | null;
  interactions: Array<{ status: string }>;
};

function summarizeRun(r: RunRow): BoardRunSummary {
  return {
    id: r.id,
    runKey: r.runKey,
    title: r.title,
    mode: r.mode,
    status: r.status,
    currentPhase: r.currentPhase,
    epicNumber: r.epicNumber,
    summary: r.summary,
    costUsd: r.costUsd,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    cacheReadTokens: r.cacheReadTokens,
    durationMs: r.durationMs,
    triggeredBy: r.triggeredBy?.githubLogin || r.user?.githubLogin || null,
    pendingInteractionsCount: r.interactions.filter((i) => i.status === "pending").length,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function getProjectBoardSnapshot(params: {
  projectId: string;
  viewerUserId: string;
  viewerGithubLogin?: string | null;
}): Promise<ProjectBoardSnapshot | null> {
  const runInclude = {
    triggeredBy: { select: { githubLogin: true } },
    user: { select: { githubLogin: true } },
    interactions: { select: { status: true } },
  } as const;

  const [project, accessibleRunners, totals, epicRuns, pendingDecisions] = await Promise.all([
    prisma.project.findUnique({
      where: { id: params.projectId },
      include: {
        issues: {
          orderBy: [{ epicNumber: "desc" }, { wave: "asc" }, { githubIssueNumber: "asc" }, { createdAt: "asc" }],
        },
        runs: {
          orderBy: { startedAt: "desc" },
          take: 30,
          include: {
            ...runInclude,
            agents: { where: { role: "orchestrator" }, take: 1, select: { activity: true } },
          },
        },
        prototypes: { orderBy: { updatedAt: "desc" }, take: 50 },
      },
    }),
    getAccessibleRunners(params.viewerUserId, {
      projectId: params.projectId,
      githubLogin: params.viewerGithubLogin ?? undefined,
    }),
    prisma.factoryRun.aggregate({
      where: { projectId: params.projectId },
      _count: { _all: true },
      _sum: {
        costUsd: true,
        inputTokens: true,
        outputTokens: true,
        cacheReadTokens: true,
        durationMs: true,
      },
    }),
    // The latest run of each epic, with its agents (one query; small per project).
    prisma.factoryRun.findMany({
      where: { projectId: params.projectId, mode: "epic", epicNumber: { not: null } },
      orderBy: { startedAt: "desc" },
      take: 60,
      include: {
        ...runInclude,
        agents: { orderBy: { startedAt: "asc" } },
      },
    }),
    prisma.runInteraction.findMany({
      where: { type: "decision", status: "pending", run: { projectId: params.projectId } },
      orderBy: { createdAt: "desc" },
      select: { id: true, runId: true, payloadJson: true, prompt: true, createdAt: true },
    }),
  ]);

  if (!project) return null;

  const serializedPrototypes = project.prototypes.map(serializePrototype);

  const latestRunByEpic = new Map<number, (typeof epicRuns)[number]>();
  const activeRunByEpic = new Map<number, string>();
  for (const r of epicRuns) {
    const n = r.epicNumber as number;
    if (!latestRunByEpic.has(n)) latestRunByEpic.set(n, r);
    if (ACTIVE_RUN_STATUSES.includes(r.status) && !activeRunByEpic.has(n)) activeRunByEpic.set(n, r.id);
  }

  const decisionByIssue = new Map<number, BoardDecision>();
  for (const d of pendingDecisions) {
    const payload = safeJsonParse<{ issue?: unknown; question?: unknown; reason?: unknown }>(d.payloadJson, {});
    const issue = Number(payload.issue);
    if (!Number.isInteger(issue) || decisionByIssue.has(issue)) continue;
    decisionByIssue.set(issue, {
      interactionId: d.id,
      runId: d.runId,
      question: typeof payload.question === "string" ? payload.question : d.prompt || "",
      reason: typeof payload.reason === "string" ? payload.reason : "",
      createdAt: d.createdAt.toISOString(),
    });
  }

  const epicRows = project.issues.filter((i) => i.tier === "epic");
  const ticketRows = project.issues.filter((i) => i.tier !== "epic");

  const issues: EnrichedBoardIssue[] = ticketRows.map((iss) => {
    const keys = [iss.issueKey.toUpperCase(), iss.ticketKey?.toUpperCase()].filter(Boolean);
    const latest = iss.epicNumber ? latestRunByEpic.get(iss.epicNumber) : undefined;
    const agents: BoardAgent[] = (latest?.agents ?? [])
      .filter((a) => iss.githubIssueNumber && ticketOfAgent(a.agentKey, a.name) === iss.githubIssueNumber)
      .map((a) => ({
        id: a.id,
        agentKey: a.agentKey,
        name: a.name,
        role: a.role,
        status: a.status,
        activity: a.activity,
        model: a.model,
        inputTokens: a.inputTokens,
        outputTokens: a.outputTokens,
        cacheReadTokens: a.cacheReadTokens,
        costUsd: a.costUsd,
        updatedAt: a.updatedAt.toISOString(),
      }));
    return {
      ...serializeProjectIssue(iss),
      prototypes: serializedPrototypes.filter((p) => p.issueKeys.some((k) => keys.includes(k.toUpperCase()))),
      agents,
      decision: iss.githubIssueNumber ? (decisionByIssue.get(iss.githubIssueNumber) ?? null) : null,
    };
  });

  const epics: BoardEpic[] = epicRows
    .map((e) => {
      const number = e.epicNumber ?? e.githubIssueNumber ?? 0;
      const tickets = ticketRows.filter((t) => t.epicNumber === number);
      const latest = latestRunByEpic.get(number);
      return {
        id: e.id,
        number,
        title: e.title,
        url: e.githubIssueUrl,
        status: e.status,
        summary: e.summary,
        ticketCount: tickets.length,
        mergedCount: tickets.filter((t) => t.status === "passed").length,
        latestRun: latest ? summarizeRun(latest) : null,
        activeRunId: activeRunByEpic.get(number) ?? null,
      };
    })
    .filter((e) => e.number > 0);

  const baRun = project.runs.find(
    (r) =>
      r.mode === "ba" &&
      (ACTIVE_RUN_STATUSES.includes(r.status) || r.interactions.some((i) => i.status === "pending")),
  );
  const activeBaRun: ActiveBaRunSummary | null = baRun
    ? {
        id: baRun.id,
        runKey: baRun.runKey,
        title: baRun.title,
        status: baRun.status,
        currentPhase: baRun.currentPhase,
        activity: baRun.agents[0]?.activity ?? null,
        pendingInteractionsCount: baRun.interactions.filter((i) => i.status === "pending").length,
        startedAt: baRun.startedAt.toISOString(),
        updatedAt: baRun.updatedAt.toISOString(),
      }
    : null;

  const repo = repoFullName(project);

  return {
    maxConcurrency: project.maxConcurrency,
    repo,
    epics,
    issues,
    prototypes: serializedPrototypes,
    activeBaRun,
    runners: accessibleRunners.map((r) => ({
      id: r.id,
      name: r.name,
      hostname: r.hostname,
      os: r.os,
      visibility: r.visibility === "team" ? "team" : "personal",
      isOwn: r.userId === params.viewerUserId,
      ownerLogin: r.user?.githubLogin ?? "local",
      status: isRunnerOnline(r.status, r.lastHeartbeatAt) ? "online" : "offline",
      activeRuns: r.activeRuns,
      maxConcurrency: r.maxConcurrency,
    })),
    runs: project.runs.map(summarizeRun),
    totals: {
      runs: totals._count._all,
      costUsd: totals._sum.costUsd ?? 0,
      inputTokens: totals._sum.inputTokens ?? 0,
      outputTokens: totals._sum.outputTokens ?? 0,
      cacheReadTokens: totals._sum.cacheReadTokens ?? 0,
      durationMs: totals._sum.durationMs ?? 0,
    },
  };
}
