import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest, resolveUserProject } from "@/lib/api-auth";
import { ticketIssueKey } from "@/lib/epics";
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

  const project = await resolveUserProject(
    auth.user.id,
    {
      projectId: str(body.projectId) || undefined,
      project: str(body.project) || undefined,
      localPath: str(body.repo || body.localPath) || undefined,
      runKey,
    },
    { write: true },
  );
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const run = await prisma.factoryRun.findUnique({
    where: { projectId_runKey: { projectId: project.id, runKey } },
  });
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const agentKey = str(body.agentKey);
  const agent = agentKey
    ? await prisma.runAgent.findUnique({
        where: { runId_agentKey: { runId: run.id, agentKey } },
      })
    : null;

  const interactionType = str(body.type) || "question";
  if (run.mode === "epic" && interactionType !== "decision") {
    return NextResponse.json(
      { error: "An epic run only takes `decision` interactions (a ticket that needs a decision)." },
      { status: 409 },
    );
  }
  const payload =
    body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
      ? (body.payload as Record<string, unknown>)
      : body.payload;

  // One pending decision per ticket: the daemon may report the same needs-decision ticket again,
  // and /api/v1/epics/sync can create it too.
  if (interactionType === "decision") {
    const issue = Number((payload as Record<string, unknown> | undefined)?.issue);
    const pending = await prisma.runInteraction.findMany({
      where: { runId: run.id, type: "decision", status: "pending" },
    });
    const existing = pending.find((p) => {
      try {
        return Number((JSON.parse(p.payloadJson || "{}") as { issue?: unknown }).issue) === issue;
      } catch {
        return false;
      }
    });
    if (existing) {
      return NextResponse.json({ ok: true, interaction: existing, deduped: true });
    }
  }

  const interaction = await prisma.runInteraction.create({
    data: {
      runId: run.id,
      runAgentId: agent?.id ?? null,
      type: interactionType,
      title: title.slice(0, 240),
      prompt: str(body.prompt) || null,
      payloadJson: payload !== undefined ? JSON.stringify(payload) : null,
      status: "pending",
    },
  });

  if (interactionType === "decision") {
    const rec = (payload ?? {}) as Record<string, unknown>;
    const issue = Number(rec.issue);
    if (Number.isInteger(issue) && issue > 0) {
      const question = typeof rec.question === "string" ? rec.question : "";
      const reason = typeof rec.reason === "string" ? rec.reason : "";
      await prisma.projectIssue
        .update({
          where: { projectId_issueKey: { projectId: project.id, issueKey: ticketIssueKey(issue) } },
          data: {
            status: "needs_human",
            summary: [question, reason ? `Reason: ${reason}` : ""].filter(Boolean).join("\n\n").slice(0, 4000) || undefined,
          },
        })
        .catch(() => {});
      emitFactoryEvent({
        type: "issue:updated",
        userId: auth.user.id,
        projectId: project.id,
        runId: run.id,
        payload: { issue, status: "needs_human" },
      });
    }
  }

  // A BA question pauses the session; a decision does not stop the epic run (other tickets go on).
  if (interactionType !== "decision") {
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
    payload: { interactionId: interaction.id, status: "pending", type: interactionType },
  });

  return NextResponse.json({ ok: true, interaction }, { status: 201 });
}
