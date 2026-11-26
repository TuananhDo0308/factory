import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest, resolveUserProject } from "@/lib/api-auth";
import { getProjectAutoApprove, isUnattendedFactoryMode } from "@/lib/auto-dispatch";
import { emitFactoryEvent } from "@/lib/events";
import { prisma } from "@/lib/prisma";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const interaction = await prisma.runInteraction.findFirst({
    where: { id, run: { userId: auth.user.id } },
  });
  if (!interaction) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    ok: true,
    interaction: {
      id: interaction.id,
      status: interaction.status,
      response: interaction.responseJson ? JSON.parse(interaction.responseJson) : null,
      resolvedAt: interaction.resolvedAt?.toISOString() ?? null,
    },
  });
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
  const title = str(body.title);
  if (!runKey || !title) {
    return NextResponse.json({ error: "run and title are required" }, { status: 400 });
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

  // Upstream sangtruong-rgb/factory invariant:
  // Questions belong in `/factory init` or `/factory clarify`, NEVER inside the Factory build loop.
  if (isUnattendedFactoryMode(run.mode)) {
    return NextResponse.json(
      {
        error:
          "Factory build runs are strictly unattended and cannot pause for human input. Terminate with outcome 'blocked' so the ticket returns to Clarify instead.",
      },
      { status: 409 },
    );
  }

  const agentKey = str(body.agentKey);
  const agent = agentKey
    ? await prisma.runAgent.findUnique({
        where: { runId_agentKey: { runId: run.id, agentKey } },
      })
    : null;

  const interactionType = str(body.type) || "question";
  const autoApprove = await getProjectAutoApprove(project.id);
  const shouldAutoApprove =
    autoApprove &&
    (interactionType === "merge_approval" ||
      interactionType === "mockup_approval" ||
      (interactionType === "plan_approval" && project.autoDispatch));

  const interaction = await prisma.runInteraction.create({
    data: {
      runId: run.id,
      runAgentId: agent?.id ?? null,
      type: interactionType,
      title: title.slice(0, 240),
      prompt: str(body.prompt) || null,
      payloadJson: body.payload !== undefined ? JSON.stringify(body.payload) : null,
      status: shouldAutoApprove ? "resolved" : "pending",
      responseJson: shouldAutoApprove
        ? JSON.stringify({ decision: "approved", autoApproved: true })
        : null,
      resolvedAt: shouldAutoApprove ? new Date() : null,
    },
  });

  if (!shouldAutoApprove) {
    await prisma.factoryRun.update({
      where: { id: run.id },
      data: { status: "awaiting_input", lastHeartbeatAt: new Date() },
    });

    if (agent) {
      await prisma.runAgent.update({
        where: { id: agent.id },
        data: { status: "waiting_on_you", activity: title.slice(0, 140) },
      });
    }
  }

  emitFactoryEvent({
    type: "interaction:updated",
    userId: auth.user.id,
    projectId: project.id,
    runId: run.id,
    payload: {
      interactionId: interaction.id,
      status: shouldAutoApprove ? "resolved" : "pending",
      autoApproved: shouldAutoApprove,
    },
  });

  return NextResponse.json(
    { ok: true, interaction, autoApproved: shouldAutoApprove },
    { status: 201 },
  );
}
