import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import {
  validateIncomingAttachments,
  type StoredAttachmentRef,
} from "@/lib/attachments";
import { isUnattendedFactoryMode } from "@/lib/auto-dispatch";
import { emitFactoryEvent } from "@/lib/events";
import { prisma } from "@/lib/prisma";
import { findAccessibleRun, getAccessibleRunners } from "@/lib/team-access";

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

  // Upstream sangtruong-rgb/factory invariant:
  // The unattended Factory build loop cannot be chatted with or steered mid-run.
  if (isUnattendedFactoryMode(run.mode)) {
    return NextResponse.json(
      {
        error:
          "Factory build runs are strictly unattended and cannot be steered or resumed with chat input. Clarify the ticket or start a fresh Retry run instead.",
      },
      { status: 409 },
    );
  }

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

  if (!message && !interactionId) {
    return NextResponse.json(
      { error: "Provide a message, attachment, or interactionId" },
      { status: 400 },
    );
  }

  const now = new Date();
  const needsDaemon = decision !== "dismissed" || Boolean(message);
  let targetRunner:
    | Awaited<ReturnType<typeof getAccessibleRunners>>[number]
    | null = null;
  if (needsDaemon) {
    const cutoffMs = Date.now() - 65_000;
    const onlineRunners = (
      await getAccessibleRunners(auth.user.id, {
        projectId: run.projectId,
        githubLogin: auth.user.githubLogin,
      })
    ).filter((r) => r.status === "online" && r.lastHeartbeatAt.getTime() > cutoffMs);

    targetRunner =
      (run.runnerMachineId
        ? onlineRunners.find((r) => r.id === run.runnerMachineId) ?? null
        : null) ??
      onlineRunners
        .filter((r) => r.userId === auth.user.id)
        .sort((a, b) => a.activeRuns - b.activeRuns)[0] ??
      onlineRunners
        .filter((r) => r.visibility === "team")
        .sort((a, b) => a.activeRuns - b.activeRuns)[0] ??
      null;

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
      // When the user replies in chat to refine a BA plan (or steer past a plan_approval),
      // supersede pending plan_approval interactions so the run resumes cleanly.
      await tx.runInteraction.updateMany({
        where: { runId: run.id, status: "pending", type: "plan_approval" },
        data: {
          status: "resolved",
          responseJson: JSON.stringify({ decision: "steered", message, by: auth.user.githubLogin }),
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
            engine: run.engine,
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
