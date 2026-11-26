import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest, resolveUserProject } from "@/lib/api-auth";
import { emitFactoryEvent } from "@/lib/events";
import { prisma } from "@/lib/prisma";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const runKey = str(body.run || body.runKey);
  const agentKey = str(body.agentKey || body.agent);
  if (!runKey || !agentKey) {
    return NextResponse.json({ error: "run and agentKey are required" }, { status: 400 });
  }

  const project = await resolveUserProject(auth.user.id, {
    projectId: str(body.projectId) || undefined,
    project: str(body.project) || undefined,
    localPath: str(body.repo || body.localPath) || undefined,
    runKey,
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const run = await prisma.factoryRun.findUnique({
    where: { projectId_runKey: { projectId: project.id, runKey } },
  });
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const status = str(body.status) || "working";
  const isDone = status === "passed" || status === "failed" || status === "idle";
  const preserveExistingName = body.preserveExistingName === true;
  const now = new Date();
  const rawStartedAt = str(body.startedAt);
  const parsedStartedAt = rawStartedAt ? new Date(rawStartedAt) : null;
  const explicitStartedAt =
    parsedStartedAt && Number.isFinite(parsedStartedAt.getTime()) ? parsedStartedAt : null;
  const rawFinishedAt = str(body.finishedAt);
  const parsedFinishedAt = rawFinishedAt ? new Date(rawFinishedAt) : null;
  const explicitFinishedAt =
    parsedFinishedAt && Number.isFinite(parsedFinishedAt.getTime()) ? parsedFinishedAt : null;

  const existingAgent = await prisma.runAgent.findUnique({
    where: { runId_agentKey: { runId: run.id, agentKey } },
    select: { status: true, startedAt: true, finishedAt: true },
  });

  // Preserve original completion timestamp when re-syncing an already-finished agent
  const nextFinishedAt = explicitFinishedAt
    ? explicitFinishedAt
    : isDone
      ? existingAgent?.finishedAt ?? now
      : null;
  const nextStartedAt = explicitStartedAt
    ? explicitStartedAt
    : existingAgent?.status === "idle" && status === "working"
      ? now
      : undefined;

  const agent = await prisma.runAgent.upsert({
    where: { runId_agentKey: { runId: run.id, agentKey } },
    update: {
      name: preserveExistingName ? undefined : str(body.name) || undefined,
      role: str(body.role) || undefined,
      specId: str(body.specId || body.spec) || undefined,
      level:
        body.level !== undefined && Number.isFinite(Number(body.level))
          ? Math.round(Number(body.level))
          : undefined,
      model: str(body.model) || undefined,
      status,
      activity: str(body.activity) || undefined,
      summary: str(body.summary) || undefined,
      inputTokens: body.inputTokens !== undefined ? Math.round(num(body.inputTokens)) : undefined,
      outputTokens: body.outputTokens !== undefined ? Math.round(num(body.outputTokens)) : undefined,
      cacheReadTokens:
        body.cacheReadTokens !== undefined ? Math.round(num(body.cacheReadTokens)) : undefined,
      costUsd: body.costUsd !== undefined ? num(body.costUsd) : undefined,
      startedAt: nextStartedAt,
      finishedAt: nextFinishedAt,
    },
    create: {
      runId: run.id,
      agentKey: agentKey.slice(0, 80),
      name: (str(body.name) || agentKey).slice(0, 140),
      role: str(body.role) || "worker",
      specId: str(body.specId || body.spec) || null,
      level: Number.isFinite(Number(body.level)) ? Math.round(Number(body.level)) : null,
      model: str(body.model) || null,
      status,
      activity: str(body.activity) || null,
      summary: str(body.summary) || null,
      inputTokens: Math.round(num(body.inputTokens)),
      outputTokens: Math.round(num(body.outputTokens)),
      cacheReadTokens: Math.round(num(body.cacheReadTokens)),
      costUsd: num(body.costUsd),
      ...(explicitStartedAt ? { startedAt: explicitStartedAt } : {}),
      finishedAt: explicitFinishedAt ?? (isDone ? now : null),
    },
  });

  const clearWatchdogSummary =
    status === "working" &&
    Boolean(run.summary?.startsWith("No agent activity received for "));

  await prisma.factoryRun.update({
    where: { id: run.id },
    data: {
      lastHeartbeatAt: now,
      status: run.status === "stalled" && status === "working" ? "running" : undefined,
      ...(clearWatchdogSummary ? { summary: null } : {}),
    },
  });

  emitFactoryEvent({
    type: "agent:updated",
    userId: auth.user.id,
    projectId: project.id,
    runId: run.id,
    payload: { agentId: agent.id, agentKey: agent.agentKey, status: agent.status },
  });

  return NextResponse.json({ ok: true, agent });
}
