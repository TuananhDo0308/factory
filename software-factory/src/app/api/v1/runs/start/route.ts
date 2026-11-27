import { type NextRequest, NextResponse } from "next/server";
import { authenticateBearer, resolveUserProject } from "@/lib/api-auth";
import { emitFactoryEvent } from "@/lib/events";
import { prisma } from "@/lib/prisma";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function POST(request: NextRequest) {
  const auth = await authenticateBearer(request);
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
  if (!runKey) {
    return NextResponse.json({ error: "run (runKey) is required" }, { status: 400 });
  }

  const project = await resolveUserProject(auth.user.id, {
    projectId: str(body.projectId) || undefined,
    project: str(body.project) || undefined,
    localPath: str(body.repo || body.localPath) || undefined,
  });
  if (!project) {
    return NextResponse.json(
      {
        error:
          "Project not found. Pass --project <slug|owner/repo> or --repo <path> matching a project in Software Factory.",
      },
      { status: 404 },
    );
  }

  const title = str(body.title);
  const baseCommit = str(body.base || body.baseCommit) || null;
  const targetBranch = str(body.target || body.targetBranch) || project.defaultBranch || null;
  const model = str(body.model) || null;
  const modeRaw = str(body.mode);
  const now = new Date();

  const existing = await prisma.factoryRun.findUnique({
    where: { projectId_runKey: { projectId: project.id, runKey } },
  });
  if (!existing) {
    return NextResponse.json(
      {
        error:
          "Run not found. Only sessions and runs created on Software Factory Web can be logged and tracked.",
      },
      { status: 404 },
    );
  }

  const mode = modeRaw === "ba" || modeRaw === "epic" ? modeRaw : existing.mode;
  const run = await prisma.factoryRun.update({
    where: { id: existing.id },
    data: {
      ...(title ? { title: title.slice(0, 240) } : {}),
      engine: "claude",
      mode,
      status: "running",
      baseCommit: baseCommit ?? undefined,
      targetBranch: targetBranch ?? undefined,
      model: model ?? undefined,
      lastHeartbeatAt: now,
      finishedAt: null,
    },
  });

  // An epic run's agents are the orchestrator's agent records; only a BA session has one Claude agent.
  if (mode !== "epic") await prisma.runAgent.upsert({
    where: { runId_agentKey: { runId: run.id, agentKey: "orchestrator" } },
    update: { status: "working", activity: "Run active", model: model ?? undefined },
    create: {
      runId: run.id,
      agentKey: "orchestrator",
      name: "Orchestrator",
      role: "orchestrator",
      level: 0,
      model,
      status: "working",
      activity: "Run started",
    },
  });

  const existingSteps = await prisma.runStep.count({ where: { runId: run.id } });
  if (existingSteps === 0) {
    await prisma.runStep.create({
      data: {
        runId: run.id,
        seq: 1,
        step: "start",
        phase: mode === "epic" ? "Plan" : "BA",
        status: "started",
        label: "run started",
        model,
        summary: (title || run.title).slice(0, 500),
      },
    });
  }

  emitFactoryEvent({
    type: "run:updated",
    userId: auth.user.id,
    projectId: project.id,
    runId: run.id,
    payload: { status: "running", runKey: run.runKey },
  });

  return NextResponse.json({
    ok: true,
    project: { id: project.id, slug: project.slug, name: project.name },
    run: { id: run.id, runKey: run.runKey, status: run.status },
  });
}
