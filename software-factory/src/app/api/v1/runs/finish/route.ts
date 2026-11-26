import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest, resolveUserProject } from "@/lib/api-auth";
import {
  dispatchReadyIssuesForProject,
  getProjectAutoApprove,
  isUnattendedFactoryMode,
} from "@/lib/auto-dispatch";
import { emitFactoryEvent } from "@/lib/events";
import { isProjectFactoryInitCompleteOnDisk } from "@/lib/init-issue";
import { prisma } from "@/lib/prisma";
import { safeJsonParse } from "@/lib/workspace-data";

const VALID_OUTCOMES = new Set(["passed", "failed", "blocked"]);
const VALID_RISKS = new Set(["low", "medium", "high"]);
const VALID_MERGE = new Set(["auto", "person"]);

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function intOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.round(n);
  }
  return null;
}

export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const runKey = str(body.run || body.runKey);
  const outcomeRaw = str(body.outcome || body.status);
  if (!runKey) return NextResponse.json({ error: "run is required" }, { status: 400 });
  if (!VALID_OUTCOMES.has(outcomeRaw)) {
    return NextResponse.json(
      { error: "outcome must be one of passed, failed, blocked" },
      { status: 400 },
    );
  }

  const project = await resolveUserProject(auth.user.id, {
    projectId: str(body.projectId) || undefined,
    project: str(body.project) || undefined,
    localPath: str(body.repo || body.localPath) || undefined,
    runKey,
  });
  if (!project) {
    return NextResponse.json(
      { error: "Project not found for this user. Pass --project or --repo." },
      { status: 404 },
    );
  }

  const summary = str(body.summary || body.reason).slice(0, 200_000) || null;
  const skipVerdictStep = body.skipVerdictStep === true;
  const respectPendingInteraction = body.respectPendingInteraction === true;
  const workflowOutcomeRaw = str(body.workflowOutcome);
  const workflowConfirmed =
    typeof body.workflowConfirmed === "boolean" ? body.workflowConfirmed : undefined;
  const riskRaw = str(body.risk);
  const risk = VALID_RISKS.has(riskRaw) ? riskRaw : undefined;
  const mergeRaw = str(body.merge || body.mergeDecision);
  const mergeDecision = VALID_MERGE.has(mergeRaw) ? mergeRaw : undefined;
  const mergedCommit = str(body.merged || body.mergedCommit) || undefined;
  const durationMs = intOrNull(body.durationMs);
  const prNumber = intOrNull(body.prNumber);
  const prUrl = str(body.prUrl) || undefined;
  const now = new Date();

  const autoApprove = await getProjectAutoApprove(project.id);

  const updated = await prisma.$transaction(async (tx) => {
    let run = await tx.factoryRun.findUnique({
      where: { projectId_runKey: { projectId: project.id, runKey } },
    });
    if (!run) {
      run = await tx.factoryRun.create({
        data: {
          projectId: project.id,
          userId: auth.user.id,
          runKey: runKey.slice(0, 120),
          title: str(body.title) || runKey,
          engine: project.engine || "antigravity",
          status: outcomeRaw,
          currentPhase: "Verdict",
          startedAt: now,
          finishedAt: now,
        },
      });
    }

    const computedDuration = durationMs ?? Math.max(0, now.getTime() - run.startedAt.getTime());
    const checkpoint = safeJsonParse<{
      outcome?: string;
      questions?: Array<{ question: string; criteria?: string[] }>;
    } | null>(run.checkpointJson, null);
    const hasOpenQuestions = Boolean(
      Array.isArray(checkpoint?.questions) && checkpoint.questions.length > 0,
    );
    const formattedQuestions = hasOpenQuestions
      ? checkpoint!.questions!
          .map((q, idx) => {
            const crits =
              Array.isArray(q.criteria) && q.criteria.length > 0
                ? ` [${q.criteria.join(", ")}]`
                : "";
            return `Q${idx + 1}: ${q.question}${crits}`;
          })
          .join("\n")
      : "";

    const unattendedFactory = isUnattendedFactoryMode(run.mode);
    let effectiveOutcome = outcomeRaw;
    let effectiveSummary = summary ?? run.summary;
    let initCompletedOnDisk = false;

    if (run.mode === "init" && outcomeRaw === "passed") {
      // Stage 1 (Once per project, interactive): stay in `awaiting_input` across discussion turns
      // until `.factory/init.json` + `.factory/project.json` are completed on disk.
      initCompletedOnDisk = isProjectFactoryInitCompleteOnDisk(project.localPath);
      if (!initCompletedOnDisk) {
        effectiveOutcome = "awaiting_input";
      }
    } else if (run.mode === "clarify" && outcomeRaw === "passed") {
      // Stage 2 (Per feature, interactive): stay in `awaiting_input` across grill & mockup turns
      // until the human approves the ticket to `ready` (or closes the clarify session).
      const linkedIssue = run.issueId
        ? await tx.projectIssue.findUnique({
            where: { id: run.issueId },
            select: { status: true },
          })
        : null;
      if (!linkedIssue || linkedIssue.status === "backlog" || linkedIssue.status === "needs_human") {
        effectiveOutcome = "awaiting_input";
      }
    } else if (unattendedFactory) {
      // Stage 3 (Unattended Factory Build Loop):
      // 1. NEVER suspend in `awaiting_input`.
      // 2. NEVER let a CLI exit code 0 falsely mark a ticket `passed` if `live.js` recorded
      //    `blocked`/`failed` or if the workflow never completed with `passed` (e.g. premature question).
      const recordedWorkflowOutcome = VALID_OUTCOMES.has(workflowOutcomeRaw)
        ? workflowOutcomeRaw
        : checkpoint?.outcome && VALID_OUTCOMES.has(checkpoint.outcome)
          ? checkpoint.outcome
          : null;

      if (recordedWorkflowOutcome === "blocked" || recordedWorkflowOutcome === "failed") {
        effectiveOutcome = recordedWorkflowOutcome;
        if (hasOpenQuestions && !effectiveSummary) {
          effectiveSummary = formattedQuestions;
        }
      } else if (
        effectiveOutcome === "passed" &&
        workflowConfirmed === false &&
        recordedWorkflowOutcome !== "passed"
      ) {
        effectiveOutcome = "blocked";
        effectiveSummary =
          "Factory session exited without completing the workflow pipeline (no `passed` verdict in live.js — agent may have stopped early or tried to ask a question). Clarify the ticket or retry." +
          (summary ? `\n\nLast output:\n${summary.slice(0, 1500)}` : "");
      }
    } else if (respectPendingInteraction && outcomeRaw === "passed") {
      const pendingCount = await tx.runInteraction.count({
        where: { runId: run.id, status: "pending" },
      });
      if (pendingCount > 0) {
        effectiveOutcome = "awaiting_input";
      }
    }

    if (initCompletedOnDisk) {
      await tx.project
        .update({
          where: { id: project.id },
          data: { initStatus: "complete" },
        })
        .catch(() => {});
    }

    const effectiveMergeDecision = mergeDecision ?? run.mergeDecision ?? undefined;

    const finalRun = await tx.factoryRun.update({
      where: { id: run.id },
      data: {
        status: effectiveOutcome,
        currentPhase: effectiveOutcome === "awaiting_input" ? run.currentPhase : "Verdict",
        summary: effectiveSummary,
        risk: risk ?? run.risk,
        mergeDecision: effectiveMergeDecision,
        mergedCommit: mergedCommit ?? run.mergedCommit,
        prNumber: prNumber ?? run.prNumber,
        prUrl: prUrl ?? run.prUrl,
        durationMs: computedDuration,
        lastHeartbeatAt: now,
        finishedAt: effectiveOutcome === "awaiting_input" ? null : now,
      },
    });

    await tx.runAgent.updateMany({
      where:
        effectiveOutcome === "passed"
          ? { runId: run.id, status: { in: ["working", "failed", "idle", "waiting_on_you"] } }
          : { runId: run.id, status: "working" },
      data: {
        status:
          effectiveOutcome === "passed"
            ? "passed"
            : effectiveOutcome === "failed"
              ? "failed"
              : effectiveOutcome === "awaiting_input"
                ? "waiting_on_you"
                : "idle",
        finishedAt: effectiveOutcome === "awaiting_input" ? null : now,
      },
    });

    // Only Factory build runs update the Kanban ticket's build outcome (Clarify leaves it until human approves).
    if (run.issueId && effectiveOutcome !== "awaiting_input" && run.mode !== "clarify") {
      const nextIssueStatus =
        effectiveOutcome === "passed"
          ? effectiveMergeDecision === "person" && !autoApprove
            ? "in_review"
            : "passed"
          : effectiveOutcome === "blocked" && hasOpenQuestions
            ? "needs_human"
            : effectiveOutcome;
      const issueSummary =
        hasOpenQuestions && formattedQuestions
          ? formattedQuestions.slice(0, 1500)
          : effectiveSummary
            ? effectiveSummary.slice(0, 500)
            : undefined;
      await tx.projectIssue
        .update({
          where: { id: run.issueId },
          data: {
            status: nextIssueStatus,
            currentPhase:
              effectiveOutcome === "blocked" && hasOpenQuestions ? "Needs Info" : "Verdict",
            summary: issueSummary,
          },
        })
        .catch(() => {});
    }

    if (!skipVerdictStep && effectiveOutcome !== "awaiting_input") {
      const last = await tx.runStep.findFirst({
        where: { runId: run.id },
        orderBy: { seq: "desc" },
        select: { seq: true },
      });

      await tx.runStep.create({
        data: {
          runId: run.id,
          seq: (last?.seq ?? 0) + 1,
          step: "verdict",
          phase: "Verdict",
          status: effectiveOutcome,
          durationMs: computedDuration,
          summary: effectiveSummary || `Run finished with outcome: ${effectiveOutcome}`,
          dataJson: JSON.stringify({ kind: "verdict", outcome: effectiveOutcome }),
        },
      });
    }

    return finalRun;
  });

  if (updated.issueId) {
    emitFactoryEvent({
      type: "issue:updated",
      userId: auth.user.id,
      projectId: project.id,
      runId: updated.id,
      payload: { issueId: updated.issueId, status: updated.status },
    });
  }

  emitFactoryEvent({
    type: "run:updated",
    userId: auth.user.id,
    projectId: project.id,
    runId: updated.id,
    payload: { status: updated.status, durationMs: updated.durationMs },
  });

  // Auto-advance the Kanban board: if this project has Auto-Dispatch enabled, launch next eligible ready issue!
  if (updated.issueId && updated.status !== "awaiting_input") {
    await dispatchReadyIssuesForProject({
      projectId: project.id,
      actorUserId: auth.user.id,
      actorGithubLogin: auth.user.githubLogin,
    }).catch(() => {});
  }

  return NextResponse.json({
    ok: true,
    run: {
      id: updated.id,
      runKey: updated.runKey,
      status: updated.status,
      durationMs: updated.durationMs,
    },
  });
}
