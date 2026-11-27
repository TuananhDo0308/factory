import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import {
  validateIncomingAttachments,
  type StoredAttachmentRef,
} from "@/lib/attachments";
import { DispatchError, pickOnlineRunner, startEpicRun } from "@/lib/dispatch";
import { emitFactoryEvent } from "@/lib/events";
import { prisma } from "@/lib/prisma";
import { findAccessibleRun } from "@/lib/team-access";

type DecisionPayload = { epic?: unknown; issue?: unknown; question?: unknown; reason?: unknown };

/**
 * Answers a `decision` interaction of an epic run: resolves it and enqueues `run_epic` again with
 * `retry: [issue]` and `note: <answer>` as a new run of the same epic.
 */
async function answerDecision(params: {
  auth: { user: { id: string; githubLogin: string } };
  run: NonNullable<Awaited<ReturnType<typeof findAccessibleRun>>>["run"];
  interactionId: string;
  decision: string;
  message: string;
}) {
  const { auth, run, interactionId, decision, message } = params;
  const interaction = await prisma.runInteraction.findFirst({
    where: { id: interactionId, runId: run.id },
  });
  if (!interaction) return NextResponse.json({ error: "Interaction not found" }, { status: 404 });
  if (interaction.status !== "pending") {
    return NextResponse.json({ error: "This decision was already answered" }, { status: 409 });
  }
  let payload: DecisionPayload = {};
  try {
    payload = JSON.parse(interaction.payloadJson || "{}") as DecisionPayload;
  } catch {
    payload = {};
  }
  const epic = Number(payload.epic ?? run.epicNumber);
  const issue = Number(payload.issue);
  const now = new Date();
  const resolve = (extra: Record<string, unknown>) =>
    prisma.runInteraction.update({
      where: { id: interaction.id },
      data: {
        status: decision === "dismissed" ? "dismissed" : "resolved",
        responseJson: JSON.stringify({ decision, message, by: auth.user.githubLogin, ...extra }),
        resolvedAt: now,
      },
    });

  if (decision === "dismissed") {
    await resolve({});
  } else {
    if (!message) {
      return NextResponse.json({ error: "Write the answer to the question" }, { status: 400 });
    }
    if (!Number.isInteger(epic) || epic <= 0 || !Number.isInteger(issue) || issue <= 0) {
      return NextResponse.json({ error: "Decision payload has no epic or issue" }, { status: 422 });
    }
    try {
      const started = await startEpicRun({
        user: auth.user,
        project: run.project,
        epic,
        retry: [issue],
        note: message,
        preferredRunnerId: run.runnerMachineId,
      });
      await resolve({ retryRunId: started.run.id });
      await prisma.factoryRun.update({
        where: { id: run.id },
        data: { humanInterventions: { increment: 1 } },
      });
      emitFactoryEvent({
        type: "interaction:updated",
        userId: auth.user.id,
        projectId: run.projectId,
        runId: run.id,
        payload: { interactionId, decision, retryRunId: started.run.id },
      });
      return NextResponse.json({
        ok: true,
        run: { id: run.id, status: run.status },
        retryRun: { id: started.run.id, runKey: started.run.runKey, status: started.run.status },
      });
    } catch (err) {
      if (err instanceof DispatchError) {
        return NextResponse.json(
          {
            error:
              err.code === "EPIC_RUNNING"
                ? `Epic #${epic} is still running. Answer once that run ends, so the retry starts from its state.`
                : err.message,
            code: err.code,
            ...(err.extra ?? {}),
          },
          { status: err.status },
        );
      }
      throw err;
    }
  }

  emitFactoryEvent({
    type: "interaction:updated",
    userId: auth.user.id,
    projectId: run.projectId,
    runId: run.id,
    payload: { interactionId, decision },
  });
  return NextResponse.json({ ok: true, run: { id: run.id, status: run.status } });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const found = await findAccessibleRun(auth.user, id);
  if (!found) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  if (!found.canWrite) {
    return NextResponse.json({ error: "Viewer role cannot steer sessions" }, { status: 403 });
  }
  const run = found.run;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rawMessage = typeof body.message === "string" ? body.message.trim() : "";
  const interactionId =
    typeof body.interactionId === "string" ? body.interactionId.trim() : "";
  const decision = typeof body.decision === "string" ? body.decision.trim() : "approved";
  const agentKey = typeof body.agentKey === "string" ? body.agentKey.trim() : "";
  const { attachments: validatedAttachments, error: attachmentError } = validateIncomingAttachments(
    body.attachments,
  );
  if (attachmentError) {
    return NextResponse.json({ error: attachmentError }, { status: 400 });
  }
  const message =
    rawMessage ||
    (validatedAttachments.length > 0
      ? `See attached file${validatedAttachments.length === 1 ? "" : "s"} (${validatedAttachments.map((a) => a.name).join(", ")}).`
      : "");

  if (run.mode === "epic") {
    // An epic run is unattended: the only input it takes is the answer to a ticket's decision.
    if (!interactionId) {
      return NextResponse.json(
        {
          error:
            "An epic run cannot be chatted with. Answer a ticket's decision, or run the epic again from the board.",
        },
        { status: 409 },
      );
    }
    return answerDecision({ auth, run, interactionId, decision, message: rawMessage });
  }

  if (!message && !interactionId) {
    return NextResponse.json(
      { error: "Provide a message, attachment, or interactionId" },
      { status: 400 },
    );
  }

  const now = new Date();
  const needsDaemon = decision !== "dismissed" || Boolean(message);
  let targetRunner: Awaited<ReturnType<typeof pickOnlineRunner>> = null;
  if (needsDaemon) {
    targetRunner = await pickOnlineRunner({
      user: auth.user,
      projectId: run.projectId,
      preferredRunnerId: run.runnerMachineId,
    });

    if (!targetRunner && body.allowOfflineQueue !== true) {
      return NextResponse.json(
        {
          error:
            "No local daemon is connected. Start `sf daemon` on your machine before sending a message.",
          code: "NO_RUNNER_ONLINE",
        },
        { status: 503 },
      );
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    let waitAddedMs = 0;

    if (interactionId) {
      const existingInt = await tx.runInteraction.findFirst({
        where: { id: interactionId, runId: run.id },
      });
      if (existingInt) {
        waitAddedMs = Math.max(0, now.getTime() - existingInt.createdAt.getTime());
        await tx.runInteraction.update({
          where: { id: existingInt.id },
          data: {
            status: decision === "dismissed" ? "dismissed" : "resolved",
            responseJson: JSON.stringify({
              decision,
              message,
              by: auth.user.githubLogin,
            }),
            resolvedAt: now,
          },
        });

        if (existingInt.runAgentId) {
          await tx.runAgent
            .update({
              where: { id: existingInt.runAgentId },
              data: { status: "working", activity: "Resumed with human input" },
            })
            .catch(() => {});
        }
      }
    } else {
      await tx.runInteraction.create({
        data: {
          runId: run.id,
          type: "steer",
          title: agentKey ? `Direct steer to ${agentKey}` : "Steer orchestrator",
          prompt: message,
          status: "resolved",
          responseJson: JSON.stringify({ message, agentKey, by: auth.user.githubLogin }),
          resolvedAt: now,
        },
      });
    }

    const storedAttachments: StoredAttachmentRef[] = [];
    for (let idx = 0; idx < validatedAttachments.length; idx += 1) {
      const att = validatedAttachments[idx];
      const artifact = await tx.runArtifact.create({
        data: {
          runId: run.id,
          kind: "attachment",
          title: att.name.slice(0, 180),
          pathOrUrl: `.factory/attachments/${run.runKey}/${now.getTime()}-${idx + 1}-${att.name}`,
          mimeType: att.mimeType,
          contentText: att.isText ? att.textContent : null,
          contentBase64: att.isText ? null : att.base64,
          metaJson: JSON.stringify({ size: att.bytes, source: "human_steer" }),
        },
      });
      storedAttachments.push({
        artifactId: artifact.id,
        name: att.name,
        mimeType: att.mimeType,
        size: att.bytes,
      });
    }

    const lastStep = await tx.runStep.findFirst({
      where: { runId: run.id },
      orderBy: { seq: "desc" },
      select: { seq: true },
    });

    await tx.runStep.create({
      data: {
        runId: run.id,
        seq: (lastStep?.seq ?? 0) + 1,
        step: interactionId ? "human-response" : "human-steer",
        phase: run.currentPhase,
        status: "info",
        role: "human",
        agentId: agentKey || null,
        label: interactionId ? `Interaction ${decision}` : "Operator steer",
        summary: (message || `Decision: ${decision}`).slice(0, 8_000),
        dataJson:
          storedAttachments.length > 0
            ? JSON.stringify({ kind: "human_steer", attachments: storedAttachments })
            : null,
      },
    });

    const pendingLeft = await tx.runInteraction.count({
      where: { runId: run.id, status: "pending" },
    });

    const shouldResumeRunning =
      (pendingLeft === 0 || Boolean(message)) &&
      (run.status === "awaiting_input" ||
        run.status === "blocked" ||
        run.status === "passed" ||
        run.status === "failed");

    if (shouldResumeRunning) {
      await tx.runAgent.updateMany({
        where: { runId: run.id, agentKey: agentKey || "orchestrator" },
        data: {
          status: "working",
          activity: "Resuming with operator feedback…",
          finishedAt: null,
        },
      });
    }

    const updatedRun = await tx.factoryRun.update({
      where: { id: run.id },
      data: {
        status: shouldResumeRunning ? "running" : run.status,
        runnerMachineId: targetRunner?.id ?? run.runnerMachineId,
        finishedAt: shouldResumeRunning ? null : run.finishedAt,
        durationMs: shouldResumeRunning ? null : run.durationMs,
        waitMs: { increment: waitAddedMs },
        humanInterventions: { increment: 1 },
        lastHeartbeatAt: now,
      },
    });

    if (needsDaemon) {
      await tx.runnerCommand.create({
        data: {
          userId: targetRunner?.userId ?? run.runner?.userId ?? run.project.userId,
          runnerMachineId: targetRunner?.id ?? run.runnerMachineId,
          projectId: run.projectId,
          runId: run.id,
          type: interactionId ? "answer_interaction" : "resume_run",
          payloadJson: JSON.stringify({
            runKey: run.runKey,
            projectId: run.projectId,
            interactionId: interactionId || null,
            decision,
            message,
            ...(storedAttachments.length > 0 ? { attachments: storedAttachments } : {}),
            agentKey: agentKey || null,
            engine: "claude",
            model: run.model,
            autonomy: run.autonomy,
            mode: run.mode,
            localPath: run.project.localPath,
          }),
          status: "pending",
        },
      });
    }

    return updatedRun;
  });

  emitFactoryEvent({
    type: "interaction:updated",
    userId: auth.user.id,
    projectId: run.projectId,
    runId: run.id,
    payload: { interactionId, decision },
  });

  return NextResponse.json({ ok: true, run: { id: result.id, status: result.status } });
}
