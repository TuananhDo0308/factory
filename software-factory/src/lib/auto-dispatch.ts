import { emitFactoryEvent } from "@/lib/events";
import {
  buildIssueClarifyPrompt,
  buildProjectInitPrompt,
  isFactoryInitIssue,
  syncProjectInitStatus,
} from "@/lib/init-issue";
import { defaultModelForEngine } from "@/lib/models";
import { prisma } from "@/lib/prisma";
import { getAccessibleRunners } from "@/lib/team-access";
import { safeJsonParse } from "@/lib/workspace-data";

export const UNATTENDED_FACTORY_MODES = new Set(["factory", "mission"]);

export function isUnattendedFactoryMode(mode: string | null | undefined): boolean {
  return UNATTENDED_FACTORY_MODES.has((mode || "").trim().toLowerCase());
}

type IssueLike = {
  id: string;
  issueKey: string;
  title: string;
  goal: string;
  body: string;
  criteriaJson: string;
  dependsOnJson: string;
  autonomy: string;
  syncMode: string;
  githubIssueNumber: number | null;
  missionId: string | null;
};

const PRIORITY_RANK: Record<string, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

export async function getProjectAutoApprove(projectId: string): Promise<boolean> {
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { autoApprove: true },
    });
    return project?.autoApprove === true;
  } catch {
    return false;
  }
}

export async function getProjectAutoApproveMap(projectIds: string[]): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>();
  if (projectIds.length === 0) return map;
  try {
    const rows = await prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, autoApprove: true },
    });
    for (const r of rows) {
      map.set(r.id, r.autoApprove === true);
    }
  } catch {
    // Fallback to false if query fails.
  }
  return map;
}

export async function setProjectDispatchPolicy(
  projectId: string,
  patch: { autoDispatch?: boolean; autoApprove?: boolean },
): Promise<void> {
  const data: { autoDispatch?: boolean; autoApprove?: boolean } = {};
  if (patch.autoDispatch !== undefined) data.autoDispatch = patch.autoDispatch;
  if (patch.autoApprove !== undefined) data.autoApprove = patch.autoApprove;
  if (Object.keys(data).length === 0) return;

  await prisma.project.update({
    where: { id: projectId },
    data,
  });
}

/**
 * Promotes any `in_review` issues (whose Factory run already passed) directly to `passed`
 * when Full-Auto (no approval) mode is turned on, unblocking dependent tickets immediately.
 */
export async function autoApproveInReviewIssues(projectId: string): Promise<number> {
  const res = await prisma.projectIssue.updateMany({
    where: { projectId, status: "in_review" },
    data: { status: "passed" },
  });
  return res.count;
}

/**
 * Builds a strict, unattended Factory Build contract prompt matching `sangtruong-rgb/factory`:
 * - Questions are NEVER asked during the build loop (every question belonged in `/factory init` or `/factory clarify`).
 * - Reuses `.factory/plans/<issueKey>.json` if present and unchanged.
 * - Executes the code-orchestrated workflow (`Spec -> Build (TDD + QA) -> Check -> Review & QC`) to completion.
 * - If anything is missing or the planner still returns `openQuestions`, stops cleanly as `blocked` without asking.
 */
export function buildIssueFactoryPrompt(
  issue: IssueLike,
  runKey: string,
  options?: {
    autoApprove?: boolean;
    targetBranch?: string;
    prototypes?: Array<{
      slug: string;
      title: string;
      binding: string;
      status: string;
      localPath: string | null;
      branchName: string | null;
      screens: Array<{ id: string; title: string; criteria: string[] }>;
    }>;
  },
): string {
  const criteria = safeJsonParse<Array<{ id: string; text: string }>>(issue.criteriaJson, []);
  const lines: string[] = [`Build ready ticket ${issue.issueKey}: ${issue.title}`];

  if (issue.goal && issue.goal.trim() && issue.goal.trim() !== issue.title.trim()) {
    lines.push(`Objective: ${issue.goal.trim()}`);
  }

  if (criteria.length > 0) {
    lines.push(
      `Acceptance Criteria:\n${criteria.map((c) => `- ${c.id}: ${c.text}`).join("\n")}`,
    );
  }

  if (issue.body && issue.body.trim()) {
    lines.push(`Ticket Specification & Scope:\n${issue.body.trim()}`);
  }

  if (options?.prototypes && options.prototypes.length > 0) {
    const protoLines: string[] = ["Approved UI Prototype(s) (build & judge screens against these):"];
    for (const p of options.prototypes) {
      const bindNote =
        p.binding === "look"
          ? "binding=look (match layout, colours, typography, elements, copy, and states)"
          : "binding=flow (match elements, order, copy, interactions, and states using the product's styling)";
      const loc = p.localPath || (p.branchName ? `branch ${p.branchName}` : `prototype://${p.slug}`);
      protoLines.push(`- ${p.title} [${p.status}, ${bindNote}] — ${loc}`);
      for (const sc of p.screens) {
        const critStr = sc.criteria.length > 0 ? ` (${sc.criteria.join(", ")})` : "";
        protoLines.push(`  - #${sc.id}: ${sc.title}${critStr}`);
      }
    }
    lines.push(protoLines.join("\n"));
  }

  const syncHint =
    issue.syncMode === "github" && issue.githubIssueNumber
      ? `Linked GitHub issue: #${issue.githubIssueNumber}.`
      : `Confirmed ready ticket (${issue.issueKey}). Check \`.factory/plans/${issue.issueKey}.json\` (or \`.factory/plans/${issue.issueKey.toLowerCase()}.json\`) and reuse its approved specs if the criteria and touched files are unchanged; otherwise let the workflow planner plan directly from this contract.`;

  const targetBranch = options?.targetBranch || "main";
  const mergeDirective = options?.autoApprove
    ? `- Merge policy (No-Approval / Full-Auto enabled): once the workflow returns \`passed\` and your own check rerun agrees, merge the run branch into "${targetBranch}" immediately without waiting for manual approval.`
    : `- Merge policy (upstream default): once the workflow returns \`passed\` and your own check rerun agrees, follow \`merge.decision\`: if \`auto\`, merge into "${targetBranch}" locally (or squash-merge PR for GitHub issues); if \`person\`, leave the branch/PR open for human review (label \`factory-review\`) with the escalation reasons and stop.`;

  lines.push(
    [
      "Software Factory Unattended Build Contract:",
      "- UNATTENDED FACTORY BUILD RUN — NOBODY CAN ANSWER QUESTIONS DURING THIS RUN.",
      "- Never call `ask_question` / `AskUserQuestion`, never pause waiting for user confirmation, and never switch to interactive `/factory init` or `/factory clarify`.",
      `- ${syncHint}`,
      `- Set workflow dashboard.id to exact run id "${runKey}", dashboard.issueKey to "${issue.issueKey}", and dashboard.title to "${issue.issueKey}: ${issue.title.replace(/"/g, "'")}" so live specs, agent phases, criteria, and final outcome stream to the Kanban board.`,
      "- Keep `PROTECTED` files protected (do NOT pass `allowProtected: true` unless this ticket explicitly modifies check/CI configuration).",
      "- If `.factory/project.json` or `project-check.mjs` fails, required skills or Playwright browser MCP are missing, or the planner returns `openQuestions`, STOP immediately with workflow outcome `blocked` (never guess and never exit with a prose question as if the run passed).",
      mergeDirective,
    ].join("\n"),
  );

  return lines.join("\n\n");
}

async function pickOnlineRunner(params: {
  triggeredByUserId: string;
  projectId: string;
  triggeredByGithubLogin?: string | null;
  runnerId?: string | null;
}) {
  const cutoffMs = Date.now() - 65_000;
  const candidateRunners = (
    await getAccessibleRunners(params.triggeredByUserId, {
      projectId: params.projectId,
      githubLogin: params.triggeredByGithubLogin ?? undefined,
    })
  ).filter((r) => r.status === "online" && r.lastHeartbeatAt.getTime() > cutoffMs);

  let onlineRunner = params.runnerId
    ? candidateRunners.find((r) => r.id === params.runnerId) ?? null
    : null;
  if (!onlineRunner) {
    const ownOnline = candidateRunners
      .filter((r) => r.userId === params.triggeredByUserId)
      .sort((a, b) => a.activeRuns - b.activeRuns);
    const sharedOnline = candidateRunners
      .filter((r) => r.userId !== params.triggeredByUserId && r.visibility === "team")
      .sort((a, b) => a.activeRuns - b.activeRuns);
    onlineRunner = ownOnline[0] ?? sharedOnline[0] ?? null;
  }
  return onlineRunner;
}

/**
 * Stage 1 (Once per project, interactive with a person): launches `/factory init` for a project.
 */
export async function launchProjectInitRun(params: {
  projectId: string;
  triggeredByUserId: string;
  triggeredByGithubLogin?: string | null;
  runnerId?: string | null;
  engine?: string | null;
  model?: string | null;
}) {
  const project = await prisma.project.findUnique({ where: { id: params.projectId } });
  if (!project) return { ok: false as const, error: "Project not found", status: 404 };

  const activeInit = await prisma.factoryRun.findFirst({
    where: {
      projectId: project.id,
      mode: "init",
      status: { in: ["running", "queued", "awaiting_input"] },
    },
    orderBy: { updatedAt: "desc" },
  });
  if (activeInit) {
    return { ok: true as const, run: activeInit, reused: true, dispatchedToRunner: null };
  }

  const engine =
    params.engine === "claude"
      ? "claude"
      : params.engine === "antigravity"
        ? "antigravity"
        : project.engine || "antigravity";
  const model = (params.model || "").trim() || defaultModelForEngine(engine);
  const targetBranch = project.defaultBranch || "main";
  const runKey = `${new Date().toISOString().slice(0, 10)}-init-${Math.random().toString(36).slice(2, 6)}`;
  const title = `Factory Init: ${project.name}`.slice(0, 140);
  const prompt = buildProjectInitPrompt({
    projectName: project.name,
    description: project.description,
  });

  const onlineRunner = await pickOnlineRunner({
    triggeredByUserId: params.triggeredByUserId,
    projectId: project.id,
    triggeredByGithubLogin: params.triggeredByGithubLogin,
    runnerId: params.runnerId,
  });
  const initialStatus = onlineRunner ? "queued" : "running";

  const run = await prisma.$transaction(async (tx) => {
    const createdRun = await tx.factoryRun.create({
      data: {
        projectId: project.id,
        userId: project.userId,
        triggeredById: params.triggeredByUserId,
        runnerMachineId: onlineRunner?.id ?? null,
        runKey,
        title,
        prompt,
        mode: "init",
        autonomy: "high",
        engine,
        status: initialStatus,
        currentPhase: "Factory Init",
        targetBranch,
        worktreePath: project.localPath,
        model,
        lastHeartbeatAt: new Date(),
      },
    });

    const orch = await tx.runAgent.create({
      data: {
        runId: createdRun.id,
        agentKey: "orchestrator",
        name: "Factory Init",
        role: "orchestrator",
        level: 0,
        model,
        status: onlineRunner ? "working" : "waiting_on_you",
        activity: onlineRunner
          ? `Starting interactive /factory init on "${onlineRunner.name}"`
          : "Waiting for local `sf daemon` runner",
      },
    });

    await tx.runStep.create({
      data: {
        runId: createdRun.id,
        runAgentId: orch.id,
        seq: 1,
        step: "session-created",
        phase: "Factory Init",
        status: "started",
        role: "orchestrator",
        model,
        label: `init · ${project.slug} · ${engine}`,
        summary: title,
      },
    });

    await tx.runnerCommand.create({
      data: {
        userId: onlineRunner?.userId ?? project.userId,
        runnerMachineId: onlineRunner?.id ?? null,
        projectId: project.id,
        runId: createdRun.id,
        type: "start_run",
        payloadJson: JSON.stringify({
          runKey,
          projectId: project.id,
          prompt,
          mode: "init",
          autonomy: "high",
          engine,
          model,
          branch: targetBranch,
          useWorktree: false,
          localPath: project.localPath,
        }),
        status: "pending",
      },
    });

    return createdRun;
  });

  emitFactoryEvent({
    type: "run:updated",
    userId: params.triggeredByUserId,
    projectId: project.id,
    runId: run.id,
    payload: { status: run.status, mode: "init" },
  });

  return {
    ok: true as const,
    run,
    reused: false,
    dispatchedToRunner: onlineRunner?.name ?? null,
  };
}

/**
 * Stage 2 (Per feature, interactive with a person): launches `/factory clarify` for an issue.
 */
export async function launchIssueClarifyRun(params: {
  projectId: string;
  issueId: string;
  triggeredByUserId: string;
  triggeredByGithubLogin?: string | null;
  runnerId?: string | null;
  engine?: string | null;
  model?: string | null;
}) {
  const [project, issue] = await Promise.all([
    prisma.project.findUnique({ where: { id: params.projectId } }),
    prisma.projectIssue.findFirst({
      where: { id: params.issueId, projectId: params.projectId },
    }),
  ]);
  if (!project) return { ok: false as const, error: "Project not found", status: 404 };
  if (!issue) return { ok: false as const, error: "Issue not found", status: 404 };

  const existingClarify = await prisma.factoryRun.findFirst({
    where: {
      projectId: project.id,
      issueId: issue.id,
      mode: "clarify",
      status: { in: ["running", "queued", "awaiting_input"] },
    },
    orderBy: { updatedAt: "desc" },
  });
  if (existingClarify) {
    return {
      ok: true as const,
      run: existingClarify,
      issueKey: issue.issueKey,
      reused: true,
      dispatchedToRunner: null,
    };
  }

  const engine =
    params.engine === "claude"
      ? "claude"
      : params.engine === "antigravity"
        ? "antigravity"
        : project.engine || "antigravity";
  const model = (params.model || "").trim() || defaultModelForEngine(engine);
  const targetBranch = project.defaultBranch || "main";
  const runKey = `${new Date().toISOString().slice(0, 10)}-clarify-${issue.issueKey.toLowerCase().replace(/[^a-z0-9]+/g, "")}-${Math.random().toString(36).slice(2, 6)}`;
  const title = `Clarify ${issue.issueKey}: ${issue.title}`.slice(0, 140);
  const prompt = buildIssueClarifyPrompt({
    projectName: project.name,
    issue,
  });

  const onlineRunner = await pickOnlineRunner({
    triggeredByUserId: params.triggeredByUserId,
    projectId: project.id,
    triggeredByGithubLogin: params.triggeredByGithubLogin,
    runnerId: params.runnerId,
  });
  const initialStatus = onlineRunner ? "queued" : "running";

  const parsedCriteria = safeJsonParse<Array<{ id: string; text: string }>>(issue.criteriaJson, []).map(
    (c) => ({ id: c.id, text: c.text, status: "" }),
  );

  const run = await prisma.$transaction(async (tx) => {
    const createdRun = await tx.factoryRun.create({
      data: {
        projectId: project.id,
        userId: project.userId,
        triggeredById: params.triggeredByUserId,
        issueId: issue.id,
        missionId: issue.missionId,
        runnerMachineId: onlineRunner?.id ?? null,
        runKey,
        title,
        prompt,
        mode: "clarify",
        autonomy: "high",
        engine,
        status: initialStatus,
        currentPhase: "Clarify",
        targetBranch,
        worktreePath: project.localPath,
        model,
        criteriaJson: parsedCriteria.length > 0 ? JSON.stringify(parsedCriteria) : null,
        lastHeartbeatAt: new Date(),
      },
    });

    const orch = await tx.runAgent.create({
      data: {
        runId: createdRun.id,
        agentKey: "orchestrator",
        name: "Factory Clarify",
        role: "orchestrator",
        level: 0,
        model,
        status: onlineRunner ? "working" : "waiting_on_you",
        activity: onlineRunner
          ? `Starting interactive /factory clarify for ${issue.issueKey} on "${onlineRunner.name}"`
          : "Waiting for local `sf daemon` runner",
      },
    });

    await tx.runStep.create({
      data: {
        runId: createdRun.id,
        runAgentId: orch.id,
        seq: 1,
        step: "session-created",
        phase: "Clarify",
        status: "started",
        role: "orchestrator",
        model,
        label: `clarify · ${issue.issueKey} · ${engine}`,
        summary: title,
      },
    });

    await tx.projectIssue.update({
      where: { id: issue.id },
      data: {
        currentPhase: "Clarify",
        runKey,
      },
    });

    await tx.runnerCommand.create({
      data: {
        userId: onlineRunner?.userId ?? project.userId,
        runnerMachineId: onlineRunner?.id ?? null,
        projectId: project.id,
        runId: createdRun.id,
        type: "run_clarify",
        payloadJson: JSON.stringify({
          runKey,
          projectId: project.id,
          prompt,
          mode: "clarify",
          autonomy: "high",
          engine,
          model,
          branch: targetBranch,
          useWorktree: false,
          localPath: project.localPath,
          issueId: issue.id,
          issueKey: issue.issueKey,
          missionId: issue.missionId,
        }),
        status: "pending",
      },
    });

    return createdRun;
  });

  emitFactoryEvent({
    type: "issue:updated",
    userId: params.triggeredByUserId,
    projectId: project.id,
    runId: run.id,
    payload: { issueId: issue.id, issueKey: issue.issueKey, phase: "Clarify" },
  });
  emitFactoryEvent({
    type: "run:updated",
    userId: params.triggeredByUserId,
    projectId: project.id,
    runId: run.id,
    payload: { status: run.status, mode: "clarify", issueId: issue.id },
  });

  return {
    ok: true as const,
    run,
    issueKey: issue.issueKey,
    reused: false,
    dispatchedToRunner: onlineRunner?.name ?? null,
  };
}

/**
 * Stage 3 (Unattended Build Loop — nobody asked): launches `/factory` on a ready issue.
 */
export async function launchIssueFactoryRun(params: {
  projectId: string;
  issueId: string;
  triggeredByUserId: string;
  triggeredByGithubLogin?: string | null;
  runnerId?: string | null;
  engine?: string | null;
  model?: string | null;
  useWorktree?: boolean;
}) {
  const [project, issue] = await Promise.all([
    prisma.project.findUnique({ where: { id: params.projectId } }),
    prisma.projectIssue.findFirst({
      where: { id: params.issueId, projectId: params.projectId },
    }),
  ]);
  if (!project) return { ok: false as const, error: "Project not found", status: 404 };
  if (!issue) return { ok: false as const, error: "Issue not found", status: 404 };

  // Legacy I0 tickets redirect cleanly to project-level `/factory init`.
  if (isFactoryInitIssue(issue)) {
    const initRes = await launchProjectInitRun({
      projectId: project.id,
      triggeredByUserId: params.triggeredByUserId,
      triggeredByGithubLogin: params.triggeredByGithubLogin,
      runnerId: params.runnerId,
      engine: params.engine,
      model: params.model,
    });
    if (!initRes.ok) return initRes;
    return {
      ok: true as const,
      run: initRes.run,
      issueKey: issue.issueKey,
      dispatchedToRunner: initRes.dispatchedToRunner,
    };
  }

  // Stage 1 Gate: project must complete `/factory init` before unattended Factory builds run.
  const initComplete = await syncProjectInitStatus(project);
  if (!initComplete) {
    return {
      ok: false as const,
      code: "INIT_REQUIRED" as const,
      error:
        "Project has not completed /factory init yet. Run Factory Init first so unattended builds have .factory/project.json, standards, and skills.",
      status: 412,
    };
  }

  // Stage 2 Gate: draft / needs_human tickets must be clarified & approved to Ready before entering Build.
  if (issue.status === "backlog" || issue.status === "needs_human") {
    return {
      ok: false as const,
      code: "CLARIFY_REQUIRED" as const,
      error: `Ticket ${issue.issueKey} must be clarified and approved to Ready before entering the unattended Factory build loop.`,
      status: 412,
    };
  }

  // Issue lock: avoid launching duplicate runs on an active ticket.
  const activeIssueRun = await prisma.factoryRun.findFirst({
    where: {
      projectId: project.id,
      issueId: issue.id,
      mode: "factory",
      status: { in: ["running", "queued"] },
    },
    include: {
      triggeredBy: { select: { githubLogin: true } },
      user: { select: { githubLogin: true } },
    },
  });
  if (activeIssueRun) {
    const who =
      activeIssueRun.triggeredBy?.githubLogin || activeIssueRun.user?.githubLogin || "member";
    return {
      ok: false as const,
      error: `Issue ${issue.issueKey} is already running (by @${who}).`,
      activeRunId: activeIssueRun.id,
      status: 409,
    };
  }

  const autoApprove = await getProjectAutoApprove(project.id);
  const projectPrototypes = await prisma.projectPrototype.findMany({
    where: { projectId: project.id, status: { not: "superseded" } },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });
  const issueKeyUpper = issue.issueKey.toUpperCase();
  const linkedPrototypes = projectPrototypes
    .filter((p) =>
      safeJsonParse<string[]>(p.issueKeysJson, []).some((k) => k.toUpperCase() === issueKeyUpper),
    )
    .map((p) => {
      const manifest = safeJsonParse<{
        screens?: Array<{ id: string; title: string; criteria?: string[] }>;
      }>(p.manifestJson, {});
      return {
        slug: p.slug,
        title: p.title,
        binding: p.binding,
        status: p.status,
        localPath: p.localPath,
        branchName: p.branchName,
        screens: (manifest.screens ?? []).map((sc) => ({
          id: sc.id,
          title: sc.title,
          criteria: Array.isArray(sc.criteria) ? sc.criteria : [],
        })),
      };
    });
  const engine =
    params.engine === "claude"
      ? "claude"
      : params.engine === "antigravity"
        ? "antigravity"
        : project.engine || "antigravity";
  const model = (params.model || "").trim() || defaultModelForEngine(engine);
  const autonomy = "high";
  const runMode = "factory";
  const initialPhase = "Spec";
  const targetBranch = project.defaultBranch || "main";
  const runKey = `${new Date().toISOString().slice(0, 10)}-${issue.issueKey.toLowerCase().replace(/[^a-z0-9]+/g, "")}-${Math.random().toString(36).slice(2, 6)}`;
  const title = `${issue.issueKey}: ${issue.title}`.slice(0, 140);
  const prompt = buildIssueFactoryPrompt(issue, runKey, {
    autoApprove,
    targetBranch,
    prototypes: linkedPrototypes,
  });

  const onlineRunner = await pickOnlineRunner({
    triggeredByUserId: params.triggeredByUserId,
    projectId: project.id,
    triggeredByGithubLogin: params.triggeredByGithubLogin,
    runnerId: params.runnerId,
  });

  const isSharedDispatch = Boolean(onlineRunner && onlineRunner.userId !== params.triggeredByUserId);
  const useWorktree = isSharedDispatch ? true : params.useWorktree !== false;
  const initialStatus = onlineRunner ? "queued" : "running";

  const parsedCriteria = safeJsonParse<Array<{ id: string; text: string }>>(issue.criteriaJson, []).map(
    (c) => ({ id: c.id, text: c.text, status: "" }),
  );

  const run = await prisma.$transaction(async (tx) => {
    const createdRun = await tx.factoryRun.create({
      data: {
        projectId: project.id,
        userId: project.userId,
        triggeredById: params.triggeredByUserId,
        issueId: issue.id,
        missionId: issue.missionId,
        runnerMachineId: onlineRunner?.id ?? null,
        runKey,
        title,
        prompt,
        mode: runMode,
        autonomy,
        engine,
        status: initialStatus,
        currentPhase: initialPhase,
        targetBranch,
        worktreePath: useWorktree
          ? `.agents/worktrees/factory-${runKey}`
          : project.localPath,
        model,
        criteriaJson: parsedCriteria.length > 0 ? JSON.stringify(parsedCriteria) : null,
        lastHeartbeatAt: new Date(),
      },
    });

    const orch = await tx.runAgent.create({
      data: {
        runId: createdRun.id,
        agentKey: "orchestrator",
        name: "Session Orchestrator",
        role: "orchestrator",
        level: 0,
        model,
        status: onlineRunner ? "working" : "idle",
        activity: onlineRunner
          ? `Dispatched unattended ${issue.issueKey} to "${onlineRunner.name}" (${engine})`
          : "Waiting for local `sf daemon` runner",
      },
    });

    await tx.runStep.create({
      data: {
        runId: createdRun.id,
        runAgentId: orch.id,
        seq: 1,
        step: "session-created",
        phase: initialPhase,
        status: "started",
        role: "orchestrator",
        model,
        label: `${runMode} · ${issue.issueKey} · ${engine}`,
        summary: title,
      },
    });

    await tx.projectIssue.update({
      where: { id: issue.id },
      data: {
        status: "in_progress",
        currentPhase: initialPhase,
        runKey,
      },
    });

    await tx.runnerCommand.create({
      data: {
        userId: onlineRunner?.userId ?? project.userId,
        runnerMachineId: onlineRunner?.id ?? null,
        projectId: project.id,
        runId: createdRun.id,
        type: "start_run",
        payloadJson: JSON.stringify({
          runKey,
          projectId: project.id,
          prompt,
          mode: runMode,
          autonomy,
          engine,
          model,
          branch: targetBranch,
          useWorktree,
          localPath: project.localPath,
          issueId: issue.id,
          issueKey: issue.issueKey,
          missionId: issue.missionId,
        }),
        status: "pending",
      },
    });

    return createdRun;
  });

  emitFactoryEvent({
    type: "issue:updated",
    userId: params.triggeredByUserId,
    projectId: project.id,
    runId: run.id,
    payload: {
      issueId: issue.id,
      issueKey: issue.issueKey,
      status: "in_progress",
      phase: initialPhase,
    },
  });
  emitFactoryEvent({
    type: "run:updated",
    userId: params.triggeredByUserId,
    projectId: project.id,
    runId: run.id,
    payload: { status: run.status, mode: runMode, issueId: issue.id },
  });

  return {
    ok: true as const,
    run,
    issueKey: issue.issueKey,
    dispatchedToRunner: onlineRunner?.name ?? null,
  };
}

/**
 * Returns `ready` issues whose `dependsOn` keys are all `passed` and which are not currently locked.
 */
export async function getEligibleReadyIssues(projectId: string) {
  const [issues, activeRuns] = await Promise.all([
    prisma.projectIssue.findMany({
      where: { projectId },
      orderBy: [{ createdAt: "asc" }],
    }),
    prisma.factoryRun.findMany({
      where: {
        projectId,
        issueId: { not: null },
        mode: "factory",
        status: { in: ["running", "queued"] },
      },
      select: { issueId: true },
    }),
  ]);

  const activeIssueIds = new Set(activeRuns.map((r) => r.issueId).filter(Boolean));
  const byKey = new Map(issues.map((i) => [i.issueKey.toUpperCase(), i]));

  const eligible = issues.filter((iss) => {
    if (iss.status !== "ready") return false;
    if (isFactoryInitIssue(iss)) return false;
    if (activeIssueIds.has(iss.id)) return false;
    const deps = safeJsonParse<string[]>(iss.dependsOnJson, []);
    for (const depKey of deps) {
      const target = byKey.get(depKey.trim().toUpperCase());
      if (target && !isFactoryInitIssue(target) && target.status !== "passed") {
        return false;
      }
    }
    return true;
  });

  eligible.sort((a, b) => {
    const pa = PRIORITY_RANK[a.priority] ?? 2;
    const pb = PRIORITY_RANK[b.priority] ?? 2;
    if (pa !== pb) return pa - pb;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  return eligible;
}

/**
 * Dispatches eligible `ready` issues for a project up to its concurrency & online runner slots.
 * Never starts builds before `/factory init` is complete.
 */
export async function dispatchReadyIssuesForProject(params: {
  projectId: string;
  actorUserId: string;
  actorGithubLogin?: string | null;
  force?: boolean;
  preferredRunnerId?: string | null;
  maxToDispatch?: number;
}) {
  const project = await prisma.project.findUnique({ where: { id: params.projectId } });
  if (!project) return { dispatched: [], skippedReason: "project_not_found" as const };
  if (!params.force && !project.autoDispatch) {
    return { dispatched: [], skippedReason: "auto_dispatch_off" as const };
  }

  const initComplete = await syncProjectInitStatus(project);
  if (!initComplete) {
    return { dispatched: [], skippedReason: "project_not_initialized" as const };
  }

  const activeProjectRuns = await prisma.factoryRun.count({
    where: {
      projectId: project.id,
      mode: { in: ["factory", "mission"] },
      status: { in: ["running", "queued"] },
    },
  });
  const projectSlots = Math.max(0, (project.maxConcurrency || 2) - activeProjectRuns);
  if (projectSlots <= 0) {
    return { dispatched: [], skippedReason: "project_at_capacity" as const };
  }

  const cutoffMs = Date.now() - 65_000;
  const runners = (
    await getAccessibleRunners(params.actorUserId, {
      projectId: project.id,
      githubLogin: params.actorGithubLogin ?? undefined,
    })
  ).filter((r) => r.status === "online" && r.lastHeartbeatAt.getTime() > cutoffMs);

  const pendingStartCmds = await prisma.runnerCommand.count({
    where: {
      projectId: project.id,
      status: { in: ["pending", "claimed"] },
      type: "start_run",
    },
  });

  const totalRunnerSlots = runners.reduce(
    (sum, r) => sum + Math.max(0, r.maxConcurrency - r.activeRuns),
    0,
  );
  const effectiveRunnerSlots = Math.max(0, totalRunnerSlots - pendingStartCmds);

  if (runners.length === 0) {
    return { dispatched: [], skippedReason: "no_online_runner" as const };
  }
  if (effectiveRunnerSlots <= 0) {
    return { dispatched: [], skippedReason: "runner_at_capacity" as const };
  }

  const limit = Math.min(
    projectSlots,
    effectiveRunnerSlots,
    params.maxToDispatch ?? projectSlots,
  );
  if (limit <= 0) {
    return { dispatched: [], skippedReason: "at_capacity" as const };
  }

  const eligible = await getEligibleReadyIssues(project.id);
  if (eligible.length === 0) {
    return { dispatched: [], skippedReason: "no_eligible_ready_issues" as const };
  }

  const dispatched: Array<{ issueId: string; issueKey: string; runId: string; runKey: string }> = [];
  for (const issue of eligible.slice(0, limit)) {
    const res = await launchIssueFactoryRun({
      projectId: project.id,
      issueId: issue.id,
      triggeredByUserId: params.actorUserId,
      triggeredByGithubLogin: params.actorGithubLogin,
      runnerId: params.preferredRunnerId,
    });
    if (res.ok) {
      dispatched.push({
        issueId: issue.id,
        issueKey: issue.issueKey,
        runId: res.run.id,
        runKey: res.run.runKey,
      });
    }
  }

  return { dispatched, skippedReason: null };
}

/**
 * Called during runner heartbeat: checks all projects with `autoDispatch: true` owned by
 * or shared with this runner's user and queues eligible ready issues.
 */
export async function dispatchAutoProjectsForRunner(params: {
  userId: string;
  runnerId: string;
  freeSlots: number;
}) {
  if (params.freeSlots <= 0) return [];
  const projects = await prisma.project.findMany({
    where: { userId: params.userId, autoDispatch: true },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  let remaining = params.freeSlots;
  const allDispatched: Array<{ projectId: string; issueKey: string; runId: string }> = [];
  for (const p of projects) {
    if (remaining <= 0) break;
    const res = await dispatchReadyIssuesForProject({
      projectId: p.id,
      actorUserId: params.userId,
      preferredRunnerId: params.runnerId,
      maxToDispatch: remaining,
    });
    for (const d of res.dispatched) {
      allDispatched.push({ projectId: p.id, issueKey: d.issueKey, runId: d.runId });
      remaining -= 1;
    }
  }
  return allDispatched;
}
