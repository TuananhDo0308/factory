import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { emitFactoryEvent } from "@/lib/events";
import type { LiveJsSpec } from "@/lib/live-sync";
import { prisma } from "@/lib/prisma";
import { serializeProjectIssue } from "@/lib/project-stats";
import { serializePrototype } from "@/lib/prototype-server";
import {
  accessibleProjectsWhere,
  getAccessibleRunners,
  linkPendingMemberships,
} from "@/lib/team-access";

export function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function isRunnerOnline(status: string, lastHeartbeatAt: Date): boolean {
  return status === "online" && Date.now() - lastHeartbeatAt.getTime() < 65_000;
}

export async function runStallWatchdog(userId: string): Promise<number> {
  const activeRuns = await prisma.factoryRun.findMany({
    where: { userId, status: "running" },
    include: {
      project: { select: { stallTimeoutMinutes: true } },
      runner: { select: { status: true, lastHeartbeatAt: true, activeRuns: true } },
      commands: {
        where: {
          status: "claimed",
        },
        take: 1,
        select: { id: true },
      },
    },
  });

  const now = Date.now();
  let stalledCount = 0;

  for (const run of activeRuns) {
    const baseTimeoutMin = Math.max(5, run.project.stallTimeoutMinutes || 15);
    const runnerActivelyExecuting = Boolean(
      run.commands.length > 0 &&
        run.runner &&
        isRunnerOnline(run.runner.status, run.runner.lastHeartbeatAt) &&
        run.runner.activeRuns > 0,
    );
    // When the local runner is online and actively holding a claimed execution command
    // for this run (e.g. long `run_workflow` subagent pipeline), avoid false 15m stalls.
    const effectiveTimeoutMin = runnerActivelyExecuting
      ? Math.max(baseTimeoutMin * 4, 90)
      : baseTimeoutMin;
    const refTime = (run.lastHeartbeatAt ?? run.updatedAt).getTime();
    if (now - refTime > effectiveTimeoutMin * 60_000) {
      await prisma.factoryRun.update({
        where: { id: run.id },
        data: {
          status: "stalled",
          summary: `No agent activity received for ${effectiveTimeoutMin}+ minutes in ${run.currentPhase} (flagged by Watchdog).`,
        },
      });
      emitFactoryEvent({
        type: "run:updated",
        userId,
        projectId: run.projectId,
        runId: run.id,
        payload: { status: "stalled" },
      });
      stalledCount += 1;
    }
  }

  // Mark stale runners offline (> 60s without heartbeat)
  const cutoff = new Date(now - 60_000);
  await prisma.runnerMachine.updateMany({
    where: { userId, status: "online", lastHeartbeatAt: { lt: cutoff } },
    data: { status: "offline" },
  });

  return stalledCount;
}

export async function getSidebarData(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, githubLogin: true, name: true, email: true, avatarUrl: true },
  });
  if (user) {
    await linkPendingMemberships(user);
  }
  const projectAccessFilter = accessibleProjectsWhere(userId, user?.githubLogin);

  const [
    projects,
    missions,
    runners,
    pendingInteractions,
    needsHumanIssues,
    blockedOrStalledRuns,
    personMergePrs,
    proposedLessons,
    openPrCount,
    latestInteractions,
    latestAttentionRuns,
  ] = await Promise.all([
    prisma.project.findMany({
      where: projectAccessFilter,
      orderBy: { updatedAt: "desc" },
      include: {
        user: { select: { id: true, githubLogin: true, name: true } },
        runs: {
          orderBy: { updatedAt: "desc" },
          take: 6,
          select: {
            id: true,
            runKey: true,
            title: true,
            mode: true,
            status: true,
            currentPhase: true,
            updatedAt: true,
            startedAt: true,
            agents: {
              where: { role: { not: "orchestrator" } },
              orderBy: [{ level: "asc" }, { startedAt: "asc" }],
              take: 14,
              select: {
                id: true,
                agentKey: true,
                name: true,
                role: true,
                specId: true,
                status: true,
              },
            },
          },
        },
        _count: {
          select: { issues: true, runs: true, pullRequests: true, members: true },
        },
      },
    }),
    prisma.mission.findMany({
      where: { project: projectAccessFilter },
      orderBy: { updatedAt: "desc" },
      take: 10,
      include: {
        project: { select: { id: true, name: true, slug: true } },
        issues: { select: { status: true } },
      },
    }),
    getAccessibleRunners(userId, { githubLogin: user?.githubLogin }),
    prisma.runInteraction.count({
      where: {
        status: "pending",
        run: { project: projectAccessFilter, mode: { notIn: ["factory", "mission"] } },
      },
    }),
    prisma.projectIssue.count({
      where: { status: "needs_human", project: projectAccessFilter },
    }),
    prisma.factoryRun.count({
      where: {
        project: projectAccessFilter,
        OR: [
          { status: { in: ["blocked", "stalled"] } },
          { status: "awaiting_input", mode: { notIn: ["factory", "mission"] } },
        ],
      },
    }),
    prisma.pullRequest.count({
      where: {
        state: "open",
        mergeDecision: "person",
        project: projectAccessFilter,
      },
    }),
    prisma.lesson.count({
      where: { OR: [{ userId }, { project: projectAccessFilter }], status: "proposed" },
    }),
    prisma.pullRequest.count({
      where: { state: { in: ["open", "draft"] }, project: projectAccessFilter },
    }),
    prisma.runInteraction.findMany({
      where: {
        status: "pending",
        run: { project: projectAccessFilter, mode: { notIn: ["factory", "mission"] } },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        title: true,
        type: true,
        runId: true,
        createdAt: true,
        run: { select: { title: true, project: { select: { name: true } } } },
      },
    }),
    prisma.factoryRun.findMany({
      where: {
        project: projectAccessFilter,
        OR: [
          { status: { in: ["blocked", "stalled"] } },
          { status: "awaiting_input", mode: { notIn: ["factory", "mission"] } },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: {
        id: true,
        title: true,
        status: true,
        currentPhase: true,
        updatedAt: true,
        project: { select: { name: true } },
      },
    }),
  ]);

  const now = Date.now();
  const normalizedRunners = runners.map((r) => {
    const online = r.status === "online" && now - r.lastHeartbeatAt.getTime() < 65_000;
    const isOwn = r.userId === userId;
    return {
      id: r.id,
      name: r.name,
      hostname: r.hostname,
      os: r.os,
      engines: safeJsonParse<string[]>(r.enginesJson, ["antigravity", "claude"]),
      models: safeJsonParse<Array<{ id: string; label: string; engine: string }>>(
        r.modelsJson,
        [],
      ),
      allowedRoots: safeJsonParse<string[]>(r.allowedRootsJson, []),
      cliVersion: r.cliVersion ?? null,
      visibility: r.visibility === "team" ? "team" : "personal",
      isOwn,
      ownerLogin: r.user?.githubLogin ?? "local",
      ownerName: r.user?.name ?? r.user?.githubLogin ?? "Local",
      status: online ? "online" : "offline",
      maxConcurrency: r.maxConcurrency,
      activeRuns: r.activeRuns,
      lastHeartbeatAt: r.lastHeartbeatAt.toISOString(),
    };
  });

  const inboxCount =
    pendingInteractions +
    needsHumanIssues +
    blockedOrStalledRuns +
    personMergePrs +
    proposedLessons;

  const inboxAlerts = [
    ...latestInteractions.map((i) => ({
      key: `interaction:${i.id}`,
      severity: "info" as const,
      title: i.title || "Agent question",
      subtitle: `${i.run.project.name} · ${i.run.title}`,
      href: `/sessions/${i.runId}`,
      ts: i.createdAt.toISOString(),
    })),
    ...latestAttentionRuns.map((r) => ({
      key: `run:${r.id}:${r.status}`,
      severity: r.status === "awaiting_input" ? ("info" as const) : ("warning" as const),
      title: r.title,
      subtitle: `${r.project.name} · ${r.status.replace("_", " ")} (${r.currentPhase})`,
      href: `/sessions/${r.id}`,
      ts: r.updatedAt.toISOString(),
    })),
  ].sort((a, b) => b.ts.localeCompare(a.ts));

  return {
    user,
    inboxCount,
    inboxAlerts,
    openPrCount,
    runners: normalizedRunners,
    missions: missions.map((m) => {
      const done = m.issues.filter((i) => i.status === "passed").length;
      return {
        id: m.id,
        projectId: m.projectId,
        projectName: m.project.name,
        title: m.title,
        status: m.status,
        completedIssues: done,
        totalIssues: m.issues.length,
        updatedAt: m.updatedAt.toISOString(),
      };
    }),
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      engine: p.engine,
      source: p.source,
      localPath: p.localPath,
      githubFullName: p.githubFullName,
      defaultBranch: p.defaultBranch || "main",
      initStatus: p.initStatus,
      readinessScore: p.readinessScore,
      isOwner: p.userId === userId,
      ownerLogin: p.user?.githubLogin ?? "local",
      memberCount: p._count.members + 1,
      issueCount: p._count.issues,
      runCount: p._count.runs,
      prCount: p._count.pullRequests,
      recentRuns: p.runs.map((r) => ({
        id: r.id,
        runKey: r.runKey,
        title: r.title,
        mode: r.mode,
        status: r.status,
        currentPhase: r.currentPhase,
        updatedAt: r.updatedAt.toISOString(),
        agents: r.agents.map((ag) => ({
          id: ag.id,
          agentKey: ag.agentKey,
          name: ag.name,
          role: ag.role,
          specId: ag.specId,
          status: ag.status,
        })),
      })),
    })),
  };
}

export type SidebarData = Awaited<ReturnType<typeof getSidebarData>>;

export async function getRunDetail(userId: string, runId: string) {
  const viewer = await prisma.user.findUnique({
    where: { id: userId },
    select: { githubLogin: true },
  });
  const run = await prisma.factoryRun.findFirst({
    where: {
      OR: [{ id: runId }, { runKey: runId }],
      project: accessibleProjectsWhere(userId, viewer?.githubLogin),
    },
    include: {
      project: true,
      user: { select: { id: true, githubLogin: true, name: true } },
      triggeredBy: { select: { id: true, githubLogin: true, name: true } },
      issue: true,
      mission: true,
      runner: {
        include: {
          user: { select: { id: true, githubLogin: true, name: true } },
        },
      },
      agents: { orderBy: [{ level: "asc" }, { startedAt: "asc" }] },
      steps: { orderBy: [{ createdAt: "asc" }, { seq: "asc" }] },
      interactions: { orderBy: { createdAt: "desc" } },
      artifacts: { orderBy: { createdAt: "desc" } },
      pullRequests: { orderBy: { updatedAt: "desc" } },
      prototypes: { orderBy: { updatedAt: "desc" } },
    },
  });

  if (!run) return null;

  const [projectDraftIssues, projectPrototypes] = await Promise.all([
    run.mode === "ba"
      ? prisma.projectIssue
          .findMany({
            where: { projectId: run.projectId },
            orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
          })
          .then((rows) => rows.map(serializeProjectIssue))
      : Promise.resolve([]),
    run.mode === "ba" || run.mode === "clarify" || run.issue
      ? prisma.projectPrototype
          .findMany({
            where: { projectId: run.projectId },
            orderBy: { updatedAt: "desc" },
            take: 30,
          })
          .then((rows) => rows.map(serializePrototype))
      : Promise.resolve([]),
  ]);

  const seenProtoIds = new Set<string>();
  const combinedPrototypes = [...run.prototypes.map(serializePrototype), ...projectPrototypes].filter(
    (p) => {
      if (seenProtoIds.has(p.id)) return false;
      if (
        run.mode !== "ba" &&
        p.runId !== run.id &&
        run.issue &&
        !p.issueKeys.some((k) => k.toUpperCase() === run.issue!.issueKey.toUpperCase())
      ) {
        return false;
      }
      seenProtoIds.add(p.id);
      return true;
    },
  );

  return {
    id: run.id,
    runKey: run.runKey,
    title: run.title,
    prompt: run.prompt,
    mode: run.mode,
    autonomy: run.autonomy,
    engine: run.engine,
    status: run.status,
    currentPhase: run.currentPhase,
    baseCommit: run.baseCommit,
    targetBranch: run.targetBranch,
    worktreePath: run.worktreePath,
    mergedCommit: run.mergedCommit,
    model: run.model,
    risk: run.risk,
    surfaces: safeJsonParse<string[]>(run.surfacesJson, []),
    mergeDecision: run.mergeDecision,
    mergeReasons: safeJsonParse<string[]>(run.mergeReasonsJson, []),
    summary: run.summary,
    specLine: run.specLine,
    specs: safeJsonParse<LiveJsSpec[]>(run.specsJson, []),
    projectDraftIssues,
    prototypes: combinedPrototypes,
    criteria: safeJsonParse<Array<{ id: string; text: string; status?: string }>>(
      run.criteriaJson,
      [],
    ),
    failureLog: safeJsonParse<
      Array<{
        stage?: string;
        round?: number;
        kind?: string;
        specs?: string[];
        file?: string;
        line?: number;
        problem: string;
        sentBack?: boolean;
      }>
    >(run.failureLogJson, []),
    checkpoint: safeJsonParse<Record<string, unknown> | null>(run.checkpointJson, null),
    prNumber: run.prNumber,
    prUrl: run.prUrl,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    cacheReadTokens: run.cacheReadTokens,
    costUsd: run.costUsd,
    durationMs: run.durationMs,
    workMs: run.workMs,
    waitMs: run.waitMs,
    humanInterventions: run.humanInterventions,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    updatedAt: run.updatedAt.toISOString(),
    project: {
      id: run.project.id,
      name: run.project.name,
      slug: run.project.slug,
      localPath: run.project.localPath,
      githubFullName: run.project.githubFullName,
      githubUrl: run.project.githubUrl,
      defaultBranch: run.project.defaultBranch || "main",
      engine: run.project.engine,
      initStatus: run.project.initStatus,
    },
    issue: run.issue ? serializeProjectIssue(run.issue) : null,
    mission: run.mission
      ? { id: run.mission.id, title: run.mission.title, status: run.mission.status }
      : null,
    runner: run.runner
      ? {
          id: run.runner.id,
          name: run.runner.name,
          hostname: run.runner.hostname,
          status: run.runner.status,
          visibility: run.runner.visibility,
          ownerLogin: run.runner.user?.githubLogin ?? null,
        }
      : null,
    triggeredBy: run.triggeredBy
      ? {
          id: run.triggeredBy.id,
          githubLogin: run.triggeredBy.githubLogin,
          name: run.triggeredBy.name,
        }
      : run.user
        ? {
            id: run.user.id,
            githubLogin: run.user.githubLogin,
            name: run.user.name,
          }
        : null,
    agents: run.agents.map((a) => ({
      id: a.id,
      agentKey: a.agentKey,
      name: a.name,
      role: a.role,
      specId: a.specId,
      level: a.level,
      model: a.model,
      status: a.status,
      activity: a.activity,
      summary: a.summary,
      inputTokens: a.inputTokens,
      outputTokens: a.outputTokens,
      cacheReadTokens: a.cacheReadTokens,
      costUsd: a.costUsd,
      startedAt: a.startedAt.toISOString(),
      finishedAt: a.finishedAt?.toISOString() ?? null,
      updatedAt: a.updatedAt.toISOString(),
    })),
    steps: run.steps.map((s) => ({
      id: s.id,
      seq: s.seq,
      runAgentId: s.runAgentId,
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
      cacheReadTokens: s.cacheReadTokens,
      costUsd: s.costUsd,
      summary: s.summary,
      data: safeJsonParse<unknown>(s.dataJson, null),
      createdAt: s.createdAt.toISOString(),
    })),
    interactions: run.interactions.map((i) => ({
      id: i.id,
      runAgentId: i.runAgentId,
      type: i.type,
      title: i.title,
      prompt: i.prompt,
      payload: safeJsonParse<Record<string, unknown>>(i.payloadJson, {}),
      status: i.status,
      response: safeJsonParse<Record<string, unknown> | null>(i.responseJson, null),
      createdAt: i.createdAt.toISOString(),
      resolvedAt: i.resolvedAt?.toISOString() ?? null,
    })),
    artifacts: run.artifacts.map((art) => ({
      id: art.id,
      kind: art.kind,
      title: art.title,
      pathOrUrl: art.pathOrUrl,
      mimeType: art.mimeType,
      meta: safeJsonParse<Record<string, unknown>>(art.metaJson, {}),
      createdAt: art.createdAt.toISOString(),
    })),
    pullRequests: run.pullRequests.map((pr) => ({
      id: pr.id,
      number: pr.number,
      title: pr.title,
      url: pr.url,
      headBranch: pr.headBranch,
      baseBranch: pr.baseBranch,
      state: pr.state,
      ciStatus: pr.ciStatus,
      mergeDecision: pr.mergeDecision,
      autoFix: pr.autoFix,
      queueStatus: pr.queueStatus,
      judgeVerdict: pr.judgeVerdict,
      additions: pr.additions,
      deletions: pr.deletions,
      commentsCount: pr.commentsCount,
      updatedAt: pr.updatedAt.toISOString(),
    })),
  };
}

export type RunDetailData = NonNullable<Awaited<ReturnType<typeof getRunDetail>>>;

export async function getInboxData(userId: string) {
  const viewer = await prisma.user.findUnique({
    where: { id: userId },
    select: { githubLogin: true },
  });
  const projectFilter = accessibleProjectsWhere(userId, viewer?.githubLogin);

  const [interactions, needsHumanIssues, attentionRuns, reviewPrs, proposedLessons] =
    await Promise.all([
      prisma.runInteraction.findMany({
        where: {
          status: "pending",
          run: { project: projectFilter, mode: { notIn: ["factory", "mission"] } },
        },
        orderBy: { createdAt: "desc" },
        include: {
          run: {
            select: {
              id: true,
              runKey: true,
              title: true,
              currentPhase: true,
              project: { select: { id: true, name: true, slug: true } },
            },
          },
          agent: { select: { id: true, name: true, role: true } },
        },
      }),
      prisma.projectIssue.findMany({
        where: { status: "needs_human", project: projectFilter },
        orderBy: [{ priority: "asc" }, { updatedAt: "desc" }],
        include: {
          project: { select: { id: true, name: true, slug: true, engine: true } },
        },
      }),
      prisma.factoryRun.findMany({
        where: {
          project: projectFilter,
          OR: [
            { status: { in: ["blocked", "stalled"] } },
            { status: "awaiting_input", mode: { notIn: ["factory", "mission"] } },
          ],
        },
        orderBy: { updatedAt: "desc" },
        include: {
          project: { select: { id: true, name: true, slug: true } },
        },
      }),
      prisma.pullRequest.findMany({
        where: { state: "open", mergeDecision: "person", project: projectFilter },
        orderBy: { updatedAt: "desc" },
        include: {
          project: { select: { id: true, name: true, slug: true } },
          run: { select: { id: true, runKey: true, risk: true } },
        },
      }),
      prisma.lesson.findMany({
        where: { OR: [{ userId }, { project: projectFilter }], status: "proposed" },
        orderBy: [{ occurrences: "desc" }, { updatedAt: "desc" }],
        include: {
          project: { select: { id: true, name: true } },
        },
      }),
    ]);

  return {
    interactions: interactions.map((i) => ({
      id: i.id,
      type: i.type,
      title: i.title,
      prompt: i.prompt,
      payload: safeJsonParse<Record<string, unknown>>(i.payloadJson, {}),
      createdAt: i.createdAt.toISOString(),
      runId: i.run.id,
      runKey: i.run.runKey,
      runTitle: i.run.title,
      phase: i.run.currentPhase,
      projectId: i.run.project.id,
      projectName: i.run.project.name,
      agentName: i.agent?.name ?? null,
    })),
    needsHumanIssues: needsHumanIssues.map((iss) => ({
      ...serializeProjectIssue(iss),
      projectId: iss.project.id,
      projectName: iss.project.name,
      engine: iss.project.engine,
    })),
    attentionRuns: attentionRuns.map((r) => ({
      id: r.id,
      runKey: r.runKey,
      title: r.title,
      mode: r.mode,
      issueId: r.issueId ?? null,
      status: r.status,
      currentPhase: r.currentPhase,
      summary: r.summary,
      risk: r.risk,
      updatedAt: r.updatedAt.toISOString(),
      projectId: r.project.id,
      projectName: r.project.name,
    })),
    reviewPrs: reviewPrs.map((pr) => ({
      id: pr.id,
      number: pr.number,
      title: pr.title,
      url: pr.url,
      headBranch: pr.headBranch,
      baseBranch: pr.baseBranch,
      ciStatus: pr.ciStatus,
      judgeVerdict: pr.judgeVerdict,
      additions: pr.additions,
      deletions: pr.deletions,
      projectId: pr.project.id,
      projectName: pr.project.name,
      runId: pr.run?.id ?? null,
      risk: pr.run?.risk ?? null,
      updatedAt: pr.updatedAt.toISOString(),
    })),
    proposedLessons: proposedLessons.map((l) => ({
      id: l.id,
      patternKey: l.patternKey,
      title: l.title,
      occurrences: l.occurrences,
      target: l.target,
      proposal: l.proposal,
      projectName: l.project?.name ?? "Global",
      createdAt: l.createdAt.toISOString(),
    })),
  };
}

export async function getReviewsData(userId: string) {
  const prs = await prisma.pullRequest.findMany({
    where: { project: { userId } },
    orderBy: { updatedAt: "desc" },
    include: {
      project: { select: { id: true, name: true, slug: true, githubFullName: true } },
      issue: { select: { id: true, issueKey: true, title: true } },
      run: {
        select: {
          id: true,
          runKey: true,
          risk: true,
          status: true,
          mergeDecision: true,
          mergeReasonsJson: true,
          artifacts: {
            where: { kind: { in: ["qc_shot", "baseline_diff", "axe", "pr_judge", "mockup"] } },
            orderBy: { createdAt: "desc" },
          },
        },
      },
    },
  });

  return prs.map((pr) => ({
    id: pr.id,
    projectId: pr.project.id,
    projectName: pr.project.name,
    projectSlug: pr.project.slug,
    githubFullName: pr.project.githubFullName,
    number: pr.number,
    title: pr.title,
    url: pr.url,
    headBranch: pr.headBranch,
    baseBranch: pr.baseBranch,
    state: pr.state,
    ciStatus: pr.ciStatus,
    mergeDecision: pr.mergeDecision,
    autoFix: pr.autoFix,
    queueStatus: pr.queueStatus,
    judgeVerdict: pr.judgeVerdict,
    judgeReport: safeJsonParse<Record<string, unknown> | null>(pr.judgeReportJson, null),
    walkthroughMd: pr.walkthroughMd,
    diffSummary: pr.diffSummary,
    additions: pr.additions,
    deletions: pr.deletions,
    commentsCount: pr.commentsCount,
    issueKey: pr.issue?.issueKey ?? null,
    issueTitle: pr.issue?.title ?? null,
    runId: pr.run?.id ?? null,
    runKey: pr.run?.runKey ?? null,
    risk: pr.run?.risk ?? null,
    mergeReasons: safeJsonParse<string[]>(pr.run?.mergeReasonsJson, []),
    artifacts: (pr.run?.artifacts ?? []).map((a) => ({
      id: a.id,
      kind: a.kind,
      title: a.title,
      pathOrUrl: a.pathOrUrl,
      mimeType: a.mimeType,
    })),
    createdAt: pr.createdAt.toISOString(),
    updatedAt: pr.updatedAt.toISOString(),
  }));
}

export async function getAnalyticsData(userId: string) {
  const [runs, agents, projects] = await Promise.all([
    prisma.factoryRun.findMany({
      where: { userId },
      orderBy: { startedAt: "asc" },
      include: { project: { select: { name: true, slug: true } } },
    }),
    prisma.runAgent.findMany({
      where: { run: { userId } },
      include: { run: { select: { engine: true } } },
    }),
    prisma.project.findMany({
      where: { userId },
      select: { id: true, name: true, slug: true },
    }),
  ]);

  let totalCostUsd = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalWorkMs = 0;
  let totalWaitMs = 0;
  let totalInterventions = 0;
  let passedRuns = 0;
  let finishedRuns = 0;

  const dailyMap = new Map<
    string,
    { date: string; cost: number; runs: number; passed: number; tokensK: number }
  >();
  const projectMap = new Map<
    string,
    { project: string; runs: number; cost: number; passed: number }
  >();

  for (const r of runs) {
    totalCostUsd += r.costUsd;
    totalInputTokens += r.inputTokens;
    totalOutputTokens += r.outputTokens;
    totalCacheReadTokens += r.cacheReadTokens;
    totalWorkMs += r.workMs || r.durationMs || 0;
    totalWaitMs += r.waitMs || 0;
    totalInterventions += r.humanInterventions || 0;

    if (r.status === "passed" || r.status === "failed" || r.status === "blocked") {
      finishedRuns += 1;
      if (r.status === "passed") passedRuns += 1;
    }

    const day = r.startedAt.toISOString().slice(0, 10);
    const d = dailyMap.get(day) ?? { date: day, cost: 0, runs: 0, passed: 0, tokensK: 0 };
    d.cost = Number((d.cost + r.costUsd).toFixed(4));
    d.runs += 1;
    if (r.status === "passed") d.passed += 1;
    d.tokensK += Math.round((r.inputTokens + r.outputTokens + r.cacheReadTokens) / 1000);
    dailyMap.set(day, d);

    const pKey = r.project.name;
    const p = projectMap.get(pKey) ?? { project: pKey, runs: 0, cost: 0, passed: 0 };
    p.runs += 1;
    p.cost = Number((p.cost + r.costUsd).toFixed(4));
    if (r.status === "passed") p.passed += 1;
    projectMap.set(pKey, p);
  }

  // Agent / Model Scorecard (Agent CV)
  const scoreMap = new Map<
    string,
    {
      role: string;
      model: string;
      engine: string;
      runs: number;
      passed: number;
      failed: number;
      costUsd: number;
      tokens: number;
    }
  >();

  for (const a of agents) {
    const model = a.model || "default";
    const key = `${a.role}|${model}|${a.run.engine}`;
    const entry = scoreMap.get(key) ?? {
      role: a.role,
      model,
      engine: a.run.engine,
      runs: 0,
      passed: 0,
      failed: 0,
      costUsd: 0,
      tokens: 0,
    };
    entry.runs += 1;
    if (a.status === "passed" || a.status === "idle") entry.passed += 1;
    if (a.status === "failed") entry.failed += 1;
    entry.costUsd = Number((entry.costUsd + a.costUsd).toFixed(4));
    entry.tokens += a.inputTokens + a.outputTokens;
    scoreMap.set(key, entry);
  }

  const totalInputAll = totalInputTokens + totalCacheReadTokens;
  const cacheHitRate =
    totalInputAll > 0 ? Math.round((totalCacheReadTokens / totalInputAll) * 100) : 0;

  return {
    summary: {
      totalRuns: runs.length,
      passedRuns,
      passRate: finishedRuns > 0 ? Math.round((passedRuns / finishedRuns) * 100) : null,
      totalCostUsd: Number(totalCostUsd.toFixed(4)),
      totalInputTokens,
      totalOutputTokens,
      totalCacheReadTokens,
      cacheHitRate,
      totalWorkMs,
      totalWaitMs,
      avgInterventions:
        runs.length > 0 ? Number((totalInterventions / runs.length).toFixed(2)) : 0,
      projectCount: projects.length,
    },
    dailySeries: Array.from(dailyMap.values()).slice(-30),
    projectBreakdown: Array.from(projectMap.values()).sort((a, b) => b.cost - a.cost),
    scorecard: Array.from(scoreMap.values())
      .map((s) => ({
        ...s,
        passRate: s.runs > 0 ? Math.round((s.passed / s.runs) * 100) : 0,
        avgCostUsd: s.runs > 0 ? Number((s.costUsd / s.runs).toFixed(4)) : 0,
      }))
      .sort((a, b) => b.runs - a.runs),
  };
}

const CONTEXT_PATHS = [
  ".factory/project.json",
  ".factory/init.json",
  ".factory/product.md",
  ".factory/decisions.md",
  ".factory/design/DESIGN.md",
  ".factory/design/tokens.json",
  ".factory/design/ui-store/catalog.md",
  "CODING_STANDARDS.md",
  "GEMINI.md",
  "CLAUDE.md",
  "AGENTS.md",
  "README.md",
];

export function readProjectContextFiles(localPath: string | null) {
  if (!localPath) return [];
  const root = path.resolve(/* turbopackIgnore: true */ localPath);
  if (!existsSync(/* turbopackIgnore: true */ root)) return [];

  const out: Array<{ path: string; content: string; bytes: number }> = [];
  for (const rel of CONTEXT_PATHS) {
    const abs = path.join(/* turbopackIgnore: true */ root, rel);
    if (!existsSync(/* turbopackIgnore: true */ abs)) continue;
    try {
      const content = readFileSync(/* turbopackIgnore: true */ abs, "utf8");
      out.push({
        path: rel,
        content: content.slice(0, 32_000),
        bytes: Buffer.byteLength(content, "utf8"),
      });
    } catch {
      // Skip unreadable file.
    }
  }
  return out;
}
