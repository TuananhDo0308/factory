import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest, resolveUserProject } from "@/lib/api-auth";
import { upsertEpicWithTickets } from "@/lib/epic-store";
import { parseSyncTicket, type SyncTicket } from "@/lib/epics";
import { emitFactoryEvent } from "@/lib/events";
import { prisma } from "@/lib/prisma";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Upserts a factory v2 epic and its tickets on the Kanban board (contract: docs/factory-v2-contract.md).
 * Called by the daemon after new-ba publishes, and during an epic run with status-only updates.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  const epicRaw = (body.epic ?? {}) as Record<string, unknown>;
  const epicNumber =
    typeof epicRaw.number === "number" && Number.isInteger(epicRaw.number) && epicRaw.number > 0
      ? epicRaw.number
      : null;
  if (!epicNumber) {
    return NextResponse.json({ error: "epic.number is required" }, { status: 400 });
  }
  const tickets: SyncTicket[] = (Array.isArray(body.tickets) ? body.tickets : [])
    .map(parseSyncTicket)
    .filter((t): t is SyncTicket => t !== null);

  const runKey = str(body.run || body.runKey);
  const project = await resolveUserProject(auth.user.id, {
    projectId: str(body.projectId) || undefined,
    project: str(body.project) || str(epicRaw.repo) || undefined,
    localPath: str(body.repo || body.localPath) || undefined,
    runKey: runKey || undefined,
  });
  if (!project) {
    return NextResponse.json({ error: "Project not found for this user." }, { status: 404 });
  }

  const run = runKey
    ? await prisma.factoryRun.findUnique({
        where: { projectId_runKey: { projectId: project.id, runKey } },
      })
    : null;

  const { epicRow, epicKey, epicStatus, saved, createdInteractions } = await upsertEpicWithTickets({
    project,
    epic: { number: epicNumber, title: str(epicRaw.title), url: str(epicRaw.url) || null },
    tickets,
    run,
  });

  emitFactoryEvent({
    type: "issue:updated",
    userId: auth.user.id,
    projectId: project.id,
    runId: run?.id ?? null,
    payload: { epic: epicNumber, count: saved.length },
  });
  if (createdInteractions > 0 && run) {
    emitFactoryEvent({
      type: "interaction:updated",
      userId: auth.user.id,
      projectId: project.id,
      runId: run.id,
      payload: { type: "decision", count: createdInteractions },
    });
  }

  return NextResponse.json({
    ok: true,
    project: { id: project.id, slug: project.slug, name: project.name },
    epic: { id: epicRow.id, issueKey: epicKey, number: epicNumber, status: epicStatus },
    tickets: saved,
  });
}
