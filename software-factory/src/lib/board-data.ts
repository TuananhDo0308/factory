import { getProjectAutoApprove } from "@/lib/auto-dispatch";
import { syncProjectInitStatus } from "@/lib/init-issue";
import type { LiveJsSpec } from "@/lib/live-sync";
import { prisma } from "@/lib/prisma";
import { serializeProjectIssue, type SerializedProjectIssue } from "@/lib/project-stats";
import { serializePrototype } from "@/lib/prototype-server";
import type { SerializedPrototype } from "@/lib/prototypes";
import { getAccessibleRunners } from "@/lib/team-access";
import { isRunnerOnline, safeJsonParse } from "@/lib/workspace-data";

export type BoardIssueRunSummary = {
  runId: string;
  runKey: string;
  mode: string;
  status: string;
  currentPhase: string;
  specLine: string | null;
  specs: LiveJsSpec[];
  criteriaStatus: Array<{ id: string; text: string; status?: string }>;
  risk: string | null;
  mergeDecision: string | null;
  summary: string | null;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number | null;
  startedAt: string;
  updatedAt: string;
  triggeredBy: string | null;
  pendingInteractionsCount: number;
  agents: Array<{
    id: string;
    agentKey: string;
    name: string;
    role: string;
    specId: string | null;
    status: string;
    activity: string | null;
    model: string | null;
    updatedAt: string;
  }>;
  recentSteps: Array<{
    id: string;
    seq: number;
    step: string;
    phase: string;
    status: string;
    label: string | null;
    summary: string | null;
    createdAt: string;
  }>;
  pullRequests: Array<{
    id: string;
    number: number;
    title: string;
    url: string | null;
    state: string;
    ciStatus: string;
    judgeVerdict: string | null;
  }>;
};

export type EnrichedBoardIssue = SerializedProjectIssue & {
  latestRun: BoardIssueRunSummary | null;
  prototypes: SerializedPrototype[];
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
  initStatus: string;
  autoDispatch: boolean;
  autoApprove: boolean;
  maxConcurrency: number;
  issues: EnrichedBoardIssue[];
  prototypes: SerializedPrototype[];
  activeRunByIssueId: Record<string, { runId: string; triggeredBy: string }>;
  activeInitRun: ActiveBaRunSummary | null;
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
    engines: string[];
  }>;
  runs: Array<{
    id: string;
    runKey: string;
    title: string;
    mode: string;
    status: string;
    currentPhase: string;
    risk: string | null;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    durationMs: number | null;
    workMs: number;
    waitMs: number;
    humanInterventions: number;
    interactionsCount: number;
    criteriaMet: number;
    criteriaTotal: number;
    repairRounds: number;
    failureCount: number;
    checksPassed: boolean | null;
    reviewsPassed: number;
    reviewsTotal: number;
    triggeredBy: string | null;
    startedAt: string;
    finishedAt: string | null;
    updatedAt: string;
  }>;
};

export async function getProjectBoardSnapshot(params: {
  projectId: string;
  viewerUserId: string;
  viewerGithubLogin?: string | null;
}): Promise<ProjectBoardSnapshot | null> {
  const [project, accessibleRunners] = await Promise.all([
    prisma.project.findUnique({
      where: { id: params.projectId },
      include: {
        issues: {
          orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
          include: {
            runs: {
              orderBy: { startedAt: "desc" },
              take: 1,
              include: {
                triggeredBy: { select: { githubLogin: true } },
                user: { select: { githubLogin: true } },
                agents: {
                  orderBy: [{ level: "asc" }, { startedAt: "asc" }],
                },
                steps: {
                  orderBy: { seq: "desc" },
                  take: 8,
                },
                pullRequests: {
                  orderBy: { updatedAt: "desc" },
                  take: 3,
                },
                _count: {
                  select: { interactions: { where: { status: "pending" } } },
                },
              },
            },
          },
        },
        runs: {
          orderBy: { startedAt: "desc" },
          take: 30,
          include: {
            triggeredBy: { select: { githubLogin: true, name: true } },
            user: { select: { githubLogin: true, name: true } },
            agents: {
              where: { role: "orchestrator" },
              take: 1,
              select: { activity: true },
            },
            interactions: {
              select: { status: true },
            },
          },
        },
        prototypes: {
          orderBy: { updatedAt: "desc" },
          take: 50,
        },
      },
    }),
    getAccessibleRunners(params.viewerUserId, {
      projectId: params.projectId,
      githubLogin: params.viewerGithubLogin ?? undefined,
    }),
  ]);

  if (!project) return null;

  const serializedPrototypes = project.prototypes.map(serializePrototype);

  const activeRunByIssueId: Record<string, { runId: string; triggeredBy: string }> = {};

  const enrichedIssues: EnrichedBoardIssue[] = project.issues.map((iss) => {
    const base = serializeProjectIssue(iss);
    const issueKeyUpper = iss.issueKey.toUpperCase();
    const issuePrototypes = serializedPrototypes.filter((p) =>
      p.issueKeys.some((k) => k.toUpperCase() === issueKeyUpper),
    );
    const latest = iss.runs[0] ?? null;

    if (
      latest &&
      (latest.status === "running" ||
        latest.status === "queued" ||
        latest.status === "awaiting_input")
    ) {
      activeRunByIssueId[iss.id] = {
        runId: latest.id,
        triggeredBy: latest.triggeredBy?.githubLogin || latest.user?.githubLogin || "member",
      };
    }

    let latestRun: BoardIssueRunSummary | null = null;
    if (latest) {
      const storedSpecs = safeJsonParse<LiveJsSpec[]>(latest.specsJson, []);
      // Synthesize specs from RunAgents if specsJson hasn't been populated yet
      const specs: LiveJsSpec[] =
        storedSpecs.length > 0
          ? storedSpecs
          : (() => {
              const bySpec = new Map<string, LiveJsSpec>();
              for (const ag of latest.agents) {
                if (!ag.specId) continue;
                const entry = bySpec.get(ag.specId) ?? {
                  id: ag.specId,
                  title: ag.name.replace(new RegExp(`^${ag.specId}[:\\s-]+`, "i"), "") || ag.specId,
                };
                const mapped =
                  ag.status === "passed"
                    ? "ok"
                    : ag.status === "working"
                      ? "run"
                      : ag.status === "failed"
                        ? "fail"
                        : "wait";
                if (ag.role === "implementer") {
                  entry.impl = mapped;
                  entry.implNote = ag.activity || undefined;
                } else if (ag.role === "qa") {
                  entry.test = mapped;
                  entry.testNote = ag.activity || undefined;
                }
                bySpec.set(ag.specId, entry);
              }
              return Array.from(bySpec.values());
            })();

      latestRun = {
        runId: latest.id,
        runKey: latest.runKey,
        mode: latest.mode,
        status: latest.status,
        currentPhase: latest.currentPhase,
        specLine: latest.specLine,
        specs,
        criteriaStatus: safeJsonParse<Array<{ id: string; text: string; status?: string }>>(
          latest.criteriaJson,
          [],
        ),
        risk: latest.risk,
        mergeDecision: latest.mergeDecision,
        summary: latest.summary,
        costUsd: latest.costUsd,
        inputTokens: latest.inputTokens,
        outputTokens: latest.outputTokens,
        durationMs: latest.durationMs,
        startedAt: latest.startedAt.toISOString(),
        updatedAt: latest.updatedAt.toISOString(),
        triggeredBy: latest.triggeredBy?.githubLogin || latest.user?.githubLogin || null,
        pendingInteractionsCount: latest._count.interactions,
        agents: latest.agents.map((a) => ({
          id: a.id,
          agentKey: a.agentKey,
          name: a.name,
          role: a.role,
          specId: a.specId,
          status: a.status,
          activity: a.activity,
          model: a.model,
          updatedAt: a.updatedAt.toISOString(),
        })),
        recentSteps: [...latest.steps].reverse().map((s) => ({
          id: s.id,
          seq: s.seq,
          step: s.step,
          phase: s.phase,
          status: s.status,
          label: s.label,
          summary: s.summary,
          createdAt: s.createdAt.toISOString(),
        })),
        pullRequests: latest.pullRequests.map((pr) => ({
          id: pr.id,
          number: pr.number,
          title: pr.title,
          url: pr.url,
          state: pr.state,
          ciStatus: pr.ciStatus,
          judgeVerdict: pr.judgeVerdict,
        })),
      };
    }

    return { ...base, latestRun, prototypes: issuePrototypes };
  });

  // Find latest active/pending Init & BA sessions for banner visibility on the Kanban board
  const initRun = project.runs.find((r) => {
    const pendingInteractions = r.interactions.filter((i) => i.status === "pending").length;
    return (
      r.mode === "init" &&
      (r.status === "running" ||
        r.status === "queued" ||
        r.status === "awaiting_input" ||
        pendingInteractions > 0)
    );
  });
  const activeInitRun: ActiveBaRunSummary | null = initRun
    ? {
        id: initRun.id,
        runKey: initRun.runKey,
        title: initRun.title,
        status: initRun.status,
        currentPhase: initRun.currentPhase,
        activity: initRun.agents[0]?.activity ?? null,
        pendingInteractionsCount: initRun.interactions.filter((i) => i.status === "pending").length,
        startedAt: initRun.startedAt.toISOString(),
        updatedAt: initRun.updatedAt.toISOString(),
      }
    : null;

  const baRun = project.runs.find((r) => {
    const pendingInteractions = r.interactions.filter((i) => i.status === "pending").length;
    return (
      r.mode === "ba" &&
      (r.status === "running" ||
        r.status === "queued" ||
        r.status === "awaiting_input" ||
        pendingInteractions > 0)
    );
  });
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

  const [autoApprove, initComplete] = await Promise.all([
    getProjectAutoApprove(project.id),
    syncProjectInitStatus(project),
  ]);
  const initStatus = initComplete ? "complete" : project.initStatus;

  return {
    initStatus,
    autoDispatch: project.autoDispatch,
    autoApprove,
    maxConcurrency: project.maxConcurrency,
    issues: enrichedIssues,
    prototypes: serializedPrototypes,
    activeRunByIssueId,
    activeInitRun,
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
      engines: safeJsonParse<string[]>(r.enginesJson, ["antigravity", "claude"]),
    })),
    runs: project.runs.map((r) => {
      const criteria = safeJsonParse<Array<{ id: string; text: string; status?: string }>>(
        r.criteriaJson,
        [],
      );
      const criteriaMet = criteria.filter((c) => c.status === "met").length;
      const failureLog = safeJsonParse<Array<unknown>>(r.failureLogJson, []);
      const checkpoint = safeJsonParse<{
        repairRounds?: number;
        repairs?: Array<unknown>;
        check?: { state?: string } | null;
        review?: Array<{ state?: string }>;
      } | null>(r.checkpointJson, null);

      const repairRounds =
        typeof checkpoint?.repairRounds === "number"
          ? checkpoint.repairRounds
          : Array.isArray(checkpoint?.repairs)
            ? checkpoint.repairs.length
            : 0;

      const checkState = checkpoint?.check?.state?.toLowerCase();
      const checksPassed =
        checkState === "ok" || checkState === "pass" || checkState === "passed"
          ? true
          : checkState === "fail" || checkState === "failed"
            ? false
            : null;

      const reviews = Array.isArray(checkpoint?.review) ? checkpoint.review : [];
      const reviewsPassed = reviews.filter((rv) => {
        const st = rv.state?.toLowerCase();
        return st === "ok" || st === "pass" || st === "passed";
      }).length;

      return {
        id: r.id,
        runKey: r.runKey,
        title: r.title,
        mode: r.mode,
        status: r.status,
        currentPhase: r.currentPhase,
        risk: r.risk,
        costUsd: r.costUsd,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        cacheReadTokens: r.cacheReadTokens,
        durationMs: r.durationMs,
        workMs: r.workMs,
        waitMs: r.waitMs,
        humanInterventions: r.humanInterventions,
        interactionsCount: r.interactions.length,
        criteriaMet,
        criteriaTotal: criteria.length,
        repairRounds,
        failureCount: failureLog.length,
        checksPassed,
        reviewsPassed,
        reviewsTotal: reviews.length,
        triggeredBy: r.triggeredBy?.githubLogin || r.user?.githubLogin || null,
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt?.toISOString() ?? null,
        updatedAt: r.updatedAt.toISOString(),
      };
    }),
  };
}
