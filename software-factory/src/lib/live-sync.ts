import { getProjectAutoApprove } from "@/lib/auto-dispatch";
import { emitFactoryEvent } from "@/lib/events";
import { prisma } from "@/lib/prisma";

export type LiveJsSpec = {
  id: string;
  title?: string;
  kind?: string;
  goal?: string;
  criteria?: string[];
  filesOwned?: string[];
  testFiles?: string[];
  impl?: string;
  test?: string;
  implNote?: string;
  testNote?: string;
  waitFor?: string;
};

export type LiveJsRecord = {
  id: string;
  title?: string;
  repo?: string;
  issueKey?: string;
  issueNumber?: number;
  sample?: boolean;
  outcome?: string;
  workflowOutcome?: string;
  reason?: string;
  phase?: string;
  seconds?: number;
  agents?: number;
  specLine?: string;
  specs?: LiveJsSpec[];
  check?: { text?: string; state?: string };
  review?: Array<{ tag?: string; text?: string; state?: string; label?: string }>;
  criteria?: Array<{ id: string; text: string; status?: string }>;
  risk?: { level?: string; surfaces?: string[]; raisedBy?: string[] } | null;
  merge?: { decision?: string; reasons?: string[] } | null;
  questions?: Array<{ question: string; criteria?: string[] }>;
  repairRounds?: number;
  maxRepairRounds?: number;
  repairs?: Array<{ round?: number; specs?: string[]; reason?: string }>;
  flaky?: string[];
  tddUnproven?: string[];
  failureLog?: Array<{
    stage?: string;
    round?: number;
    kind?: string;
    specs?: string[];
    file?: string;
    line?: number;
    problem?: string;
    sentBack?: boolean;
  }>;
};

function mapSpecAgentStatus(state?: string): string {
  if (state === "ok") return "passed";
  if (state === "run") return "working";
  if (state === "fail") return "failed";
  if (state === "wait") return "idle";
  return "idle";
}

function mapRunOutcome(outcome?: string): string {
  if (outcome === "passed" || outcome === "failed" || outcome === "blocked") {
    return outcome;
  }
  return "running";
}

async function resolveMatchingIssueId(
  projectId: string,
  record: LiveJsRecord,
): Promise<string | null> {
  const explicitKey = typeof record.issueKey === "string" ? record.issueKey.trim() : "";
  const explicitNum =
    typeof record.issueNumber === "number" && Number.isInteger(record.issueNumber)
      ? record.issueNumber
      : null;

  const candidateKeys = new Set<string>();
  const candidateNumbers = new Set<number>();

  if (explicitKey) {
    const hashNum = /^#(\d+)$/.exec(explicitKey);
    if (hashNum) {
      candidateNumbers.add(Number(hashNum[1]));
    } else {
      candidateKeys.add(explicitKey.toUpperCase());
    }
  }
  if (explicitNum !== null) {
    candidateNumbers.add(explicitNum);
  }

  const searchSources = [record.title || "", record.id || ""];
  for (const text of searchSources) {
    if (!text) continue;
    const localKeyMatch = /\b(I\d+)\b/i.exec(text);
    if (localKeyMatch?.[1]) {
      candidateKeys.add(localKeyMatch[1].toUpperCase());
    }
    const ghNumMatch = /(?:^|[\s([/-])#(\d+)\b/.exec(text);
    if (ghNumMatch?.[1]) {
      candidateNumbers.add(Number(ghNumMatch[1]));
    }
  }

  if (candidateKeys.size === 0 && candidateNumbers.size === 0) return null;

  const issues = await prisma.projectIssue.findMany({
    where: { projectId },
    select: { id: true, issueKey: true, githubIssueNumber: true },
  });

  for (const key of candidateKeys) {
    const hit = issues.find((i) => i.issueKey.toUpperCase() === key);
    if (hit) return hit.id;
  }
  for (const num of candidateNumbers) {
    const hit = issues.find((i) => i.githubIssueNumber === num);
    if (hit) return hit.id;
  }
  return null;
}

/**
 * Updates telemetry (specs, phases, agents, criteria, risk, merge decision) on an
 * EXISTING Web-created `FactoryRun`. Never auto-creates a run from local/personal IDE
 * runs — runs must originate from Software Factory Web.
 */
export async function syncLiveRecordToDb(params: {
  userId: string;
  projectId: string;
  engine: string;
  record: LiveJsRecord;
  targetRunKey?: string;
  isLiveSnapshot?: boolean;
}) {
  const { userId, projectId, engine, record, targetRunKey: explicitRunKey } = params;
  const runKey = (explicitRunKey || record.id || "").trim();
  if (!runKey || record.sample === true) return null;

  const hasQuestions = Array.isArray(record.questions) && record.questions.length > 0;
  // Unattended Factory Build invariant (upstream sangtruong-rgb/factory):
  // A factory build loop NEVER suspends in `awaiting_input` to ask a human mid-run.
  // If Planner stops with openQuestions, the run ends cleanly as `blocked` and the ticket
  // moves back to `needs_human` (Needs Info / Clarify) outside the build loop.
  const status = mapRunOutcome(record.outcome);
  const isDone = status === "passed" || status === "failed" || status === "blocked";
  const formattedQuestions = hasQuestions
    ? record.questions!
        .map((q, idx) => {
          const crits = Array.isArray(q.criteria) && q.criteria.length > 0 ? ` [${q.criteria.join(", ")}]` : "";
          return `Q${idx + 1}: ${q.question}${crits}`;
        })
        .join("\n")
    : "";
  const now = new Date();

  // Strict web-origin lookup: ONLY update an existing FactoryRun created on Web.
  // If no matching FactoryRun exists, ignore the record completely.
  const exactExisting = await prisma.factoryRun.findUnique({
    where: { projectId_runKey: { projectId, runKey } },
    select: { id: true, runKey: true, status: true, summary: true, issueId: true },
  });
  if (!exactExisting) {
    return null;
  }

  const existingSummary = exactExisting.summary ?? null;
  const existingIssueId = exactExisting.issueId ?? null;
  const linkedIssueId = existingIssueId ?? (await resolveMatchingIssueId(projectId, record));
  const clearStaleWatchdogSummary =
    status === "running" &&
    !record.reason &&
    Boolean(existingSummary?.startsWith("No agent activity received for "));

  const pipelineCheckpoint = JSON.stringify({
    phase: record.phase || "Spec",
    outcome: record.outcome || status,
    agentsCount: typeof record.agents === "number" ? record.agents : undefined,
    repairRounds: typeof record.repairRounds === "number" ? record.repairRounds : 0,
    maxRepairRounds: typeof record.maxRepairRounds === "number" ? record.maxRepairRounds : 2,
    check: record.check ?? null,
    review: Array.isArray(record.review) ? record.review : [],
    repairs: Array.isArray(record.repairs) ? record.repairs : [],
    flaky: Array.isArray(record.flaky) ? record.flaky : [],
    tddUnproven: Array.isArray(record.tddUnproven) ? record.tddUnproven : [],
    questions: Array.isArray(record.questions) ? record.questions : [],
    riskRaisedBy: record.risk?.raisedBy ?? [],
    seconds: typeof record.seconds === "number" ? record.seconds : undefined,
    updatedAt: now.toISOString(),
  });

  const run = await prisma.factoryRun.update({
    where: { id: exactExisting.id },
    data: {
      issueId: !existingIssueId && linkedIssueId ? linkedIssueId : undefined,
      engine,
      status,
      currentPhase: record.phase || "Spec",
      summary: record.reason
        ? record.reason.slice(0, 1000)
        : clearStaleWatchdogSummary
          ? null
          : undefined,
      specLine: record.specLine ?? undefined,
      specsJson: Array.isArray(record.specs) ? JSON.stringify(record.specs) : undefined,
      risk: record.risk?.level ?? undefined,
      surfacesJson: record.risk?.surfaces ? JSON.stringify(record.risk.surfaces) : undefined,
      mergeDecision: record.merge?.decision ?? undefined,
      mergeReasonsJson: record.merge?.reasons ? JSON.stringify(record.merge.reasons) : undefined,
      criteriaJson: record.criteria ? JSON.stringify(record.criteria) : undefined,
      failureLogJson: record.failureLog ? JSON.stringify(record.failureLog) : undefined,
      checkpointJson: pipelineCheckpoint,
      durationMs: typeof record.seconds === "number" ? Math.round(record.seconds * 1000) : undefined,
      lastHeartbeatAt: now,
      finishedAt: isDone ? now : null,
    },
  });

  // Snapshot existing agent timestamps so sync ticks never clobber `startedAt` / `finishedAt`
  const existingAgents = await prisma.runAgent.findMany({
    where: { runId: run.id },
    select: {
      agentKey: true,
      name: true,
      status: true,
      activity: true,
      summary: true,
      finishedAt: true,
    },
  });
  const existingByKey = new Map(existingAgents.map((a) => [a.agentKey, a]));

  async function syncManagedAgent(input: {
    agentKey: string;
    name: string;
    role: string;
    specId?: string;
    level: number;
    model: string;
    status: string;
    activity: string | null;
    summary?: string | null;
    updateName?: boolean;
  }) {
    const prev = existingByKey.get(input.agentKey);
    const terminal = input.status === "passed" || input.status === "failed";
    if (prev) {
      const nameChanged = Boolean(input.updateName && prev.name !== input.name);
      const statusChanged = prev.status !== input.status;
      const activityChanged = (prev.activity ?? null) !== (input.activity ?? null);
      const summaryChanged =
        input.summary !== undefined && (prev.summary ?? null) !== (input.summary ?? null);
      const needsFinishedAt = terminal && !prev.finishedAt;
      if (!nameChanged && !statusChanged && !activityChanged && !summaryChanged && !needsFinishedAt) {
        return;
      }
      await prisma.runAgent.update({
        where: { runId_agentKey: { runId: run.id, agentKey: input.agentKey } },
        data: {
          name: input.updateName ? input.name : undefined,
          status: input.status,
          activity: input.activity ?? undefined,
          summary: input.summary !== undefined ? input.summary : undefined,
          startedAt: prev.status === "idle" && input.status === "working" ? now : undefined,
          finishedAt: terminal ? prev.finishedAt ?? now : input.status === "working" ? null : undefined,
        },
      });
      return;
    }

    await prisma.runAgent.create({
      data: {
        runId: run.id,
        agentKey: input.agentKey,
        name: input.name,
        role: input.role,
        specId: input.specId ?? null,
        level: input.level,
        model: input.model,
        status: input.status,
        activity: input.activity,
        summary: input.summary ?? null,
        finishedAt: terminal ? now : null,
      },
    });
  }

  // Upsert Planner agent
  await syncManagedAgent({
    agentKey: "planner",
    name: "Planner",
    role: "planner",
    level: 0,
    model: engine === "claude" ? "opus" : "gemini-4-neon-xhigh",
    status: hasQuestions
      ? "failed"
      : record.specs && record.specs.length > 0
        ? "passed"
        : record.phase === "Spec"
          ? "working"
          : "idle",
    activity: hasQuestions
      ? `Stopped: ${record.questions?.length} open question(s) -> Needs Info`
      : record.specLine || "Planning specs",
    summary: hasQuestions ? formattedQuestions : undefined,
  });

  // Upsert per-spec Implementer & QA agents
  if (Array.isArray(record.specs)) {
    for (let idx = 0; idx < record.specs.length; idx += 1) {
      const sp = record.specs[idx];
      const level = sp.waitFor ? 2 : 1;
      await syncManagedAgent({
        agentKey: `${sp.id}-impl`,
        name: `${sp.id}: ${sp.title || "Implementer"}`,
        updateName: true,
        role: "implementer",
        specId: sp.id,
        level,
        model: engine === "claude" ? "sonnet" : "gemini-4-carbon-medium",
        status: mapSpecAgentStatus(sp.impl),
        activity: sp.implNote || (sp.impl === "run" ? "Writing tests & code" : "Test-first implementation"),
        summary: sp.implNote || null,
      });

      if (sp.test && sp.test !== "none") {
        await syncManagedAgent({
          agentKey: `${sp.id}-qa`,
          name: `${sp.id} QA`,
          role: "qa",
          specId: sp.id,
          level,
          model: engine === "claude" ? "sonnet" : "gemini-4-carbon-medium",
          status: mapSpecAgentStatus(sp.test),
          activity: sp.testNote || "Verifying test gaps",
          summary: sp.testNote || null,
        });
      }
    }
  }

  // Upsert Checker agent
  if (record.check?.text) {
    await syncManagedAgent({
      agentKey: "checker",
      name: "Checker",
      role: "checker",
      level: 3,
      model: engine === "claude" ? "sonnet" : "gemini-4-hydrogen-low",
      status: mapSpecAgentStatus(record.check.state),
      activity: record.check.text,
      summary: record.check.text,
    });
  }

  // Upsert Reviewers & QC
  if (Array.isArray(record.review)) {
    const riskLevel = record.risk?.level;
    for (let i = 0; i < record.review.length; i += 1) {
      const rev = record.review[i];
      const tag = rev.tag || `reviewer-${i + 1}`;
      const isQc = tag === "qc";
      const isWholeChange = tag === "whole change" || i === 0;
      const agyReviewModel = isQc
        ? "gemini-4-hydrogen-medium"
        : riskLevel === "high"
          ? isWholeChange
            ? "gemini-4-neon-xhigh"
            : "gemini-4-neon-high"
          : riskLevel === "low"
            ? "gemini-4-carbon-medium"
            : isWholeChange
              ? "gemini-4-neon-high"
              : "gemini-4-carbon-medium";
      await syncManagedAgent({
        agentKey: tag,
        name: rev.label || (isQc ? "QC (Playwright)" : `Reviewer (${tag})`),
        role: isQc ? "qc" : "reviewer",
        level: 4,
        model: isQc ? (engine === "claude" ? "sonnet" : agyReviewModel) : engine === "claude" ? "opus" : agyReviewModel,
        status: mapSpecAgentStatus(rev.state),
        activity: rev.text || (isQc ? "Testing live app" : "Reviewing diff"),
        summary: rev.text || null,
      });
    }
  }

  // When live.js reports a terminal run outcome, close any remaining ad-hoc subagents
  // (e.g. research/review helpers) still stuck in "working".
  if (isDone) {
    await prisma.runAgent.updateMany({
      where: { runId: run.id, status: "working" },
      data: {
        status: status === "passed" ? "passed" : status === "failed" ? "failed" : "idle",
        finishedAt: now,
      },
    });
  }

  // Record a checkpoint step if none exists for the current phase+status
  const lastStep = await prisma.runStep.findFirst({
    where: { runId: run.id },
    orderBy: { seq: "desc" },
  });
  const nextStepSummary = record.reason || `${record.phase || "Run"}: ${status}`;
  if (!lastStep || lastStep.phase !== (record.phase || "Spec") || lastStep.summary !== nextStepSummary.slice(0, 500)) {
    await prisma.runStep.create({
      data: {
        runId: run.id,
        seq: (lastStep?.seq ?? 0) + 1,
        step: `sync-${(record.phase || "run").toLowerCase()}`,
        phase: record.phase || "Spec",
        status: status === "running" ? "started" : status,
        label: record.specLine || record.phase || "Sync",
        summary: nextStepSummary.slice(0, 500),
      },
    });
  }

  // Keep linked ProjectIssue phase & Kanban column synced live
  if (run.issueId) {
    const autoApprove = status === "passed" ? await getProjectAutoApprove(projectId) : false;
    const nextIssueStatus =
      status === "passed"
        ? record.merge?.decision === "person" && !autoApprove
          ? "in_review"
          : "passed"
        : status === "failed"
          ? "failed"
          : status === "blocked"
            ? hasQuestions
              ? "needs_human"
              : "blocked"
            : "in_progress";
    const issueSummary = hasQuestions
      ? formattedQuestions
      : record.reason
        ? record.reason
        : undefined;
    await prisma.projectIssue
      .update({
        where: { id: run.issueId },
        data: {
          status: nextIssueStatus,
          currentPhase: hasQuestions ? "Needs Info" : record.phase || "Spec",
          runKey: run.runKey,
          summary: issueSummary ? issueSummary.slice(0, 1500) : undefined,
        },
      })
      .catch(() => {});

    emitFactoryEvent({
      type: "issue:updated",
      userId,
      projectId,
      runId: run.id,
      payload: {
        issueId: run.issueId,
        status: nextIssueStatus,
        phase: record.phase || "Spec",
      },
    });
  }

  emitFactoryEvent({
    type: "run:updated",
    userId,
    projectId,
    runId: run.id,
    payload: { status, phase: record.phase },
  });

  return run;
}
