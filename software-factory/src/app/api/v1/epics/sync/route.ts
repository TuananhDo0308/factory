import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest, resolveUserProject } from "@/lib/api-auth";
import { ACTIVE_RUN_STATUSES } from "@/lib/dispatch";
import {
  deriveEpicStatus,
  epicIssueKey,
  parseSyncTicket,
  ticketIssueKey,
  type SyncTicket,
} from "@/lib/epics";
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

  const epicTitle = str(epicRaw.title);
  const epicUrl = str(epicRaw.url) || null;
  const epicKey = epicIssueKey(epicNumber);

  const epicRow = await prisma.projectIssue.upsert({
    where: { projectId_issueKey: { projectId: project.id, issueKey: epicKey } },
    update: {
      ...(epicTitle ? { title: epicTitle.slice(0, 240), goal: epicTitle.slice(0, 500) } : {}),
      ...(epicUrl ? { githubIssueUrl: epicUrl } : {}),
      githubIssueNumber: epicNumber,
      epicNumber,
      tier: "epic",
      syncMode: "github",
    },
    create: {
      projectId: project.id,
      issueKey: epicKey,
      title: (epicTitle || `Epic #${epicNumber}`).slice(0, 240),
      goal: (epicTitle || "").slice(0, 500),
      tier: "epic",
      status: "ready",
      syncMode: "github",
      githubIssueNumber: epicNumber,
      githubIssueUrl: epicUrl,
      epicNumber,
    },
  });

  // The BA session that published this epic points at it (breadcrumb and board link).
  if (run && run.mode === "ba" && !run.issueId) {
    await prisma.factoryRun.update({ where: { id: run.id }, data: { issueId: epicRow.id } });
  }

  const saved: Array<{ id: string; issueKey: string; status: string }> = [];
  const decisions: SyncTicket[] = [];
  for (const t of tickets) {
    const issueKey = ticketIssueKey(t.number);
    const existing = await prisma.projectIssue.findUnique({
      where: { projectId_issueKey: { projectId: project.id, issueKey } },
      select: { id: true },
    });
    const decisionText = t.decision
      ? [t.decision.question, t.decision.reason ? `Reason: ${t.decision.reason}` : ""]
          .filter(Boolean)
          .join("\n\n")
      : null;
    const fields = {
      ...(t.title ? { title: t.title.slice(0, 240), goal: t.title.slice(0, 500) } : {}),
      ...(t.body !== undefined ? { body: t.body } : {}),
      ...(t.criteria !== undefined ? { criteriaJson: JSON.stringify(t.criteria) } : {}),
      ...(t.dependsOn !== undefined ? { dependsOnJson: JSON.stringify(t.dependsOn) } : {}),
      ...(t.size ? { complexity: t.size } : {}),
      ...(t.wave !== undefined ? { wave: t.wave } : {}),
      ...(t.rounds !== undefined ? { rounds: t.rounds } : {}),
      ...(t.url ? { githubIssueUrl: t.url } : {}),
      ...(t.key ? { ticketKey: t.key.slice(0, 32) } : {}),
      ...(decisionText ? { summary: decisionText.slice(0, 4000) } : {}),
      ...(run && run.mode === "epic" ? { runKey: run.runKey } : {}),
    };
    const row = existing
      ? await prisma.projectIssue.update({
          where: { id: existing.id },
          data: {
            ...fields,
            // A sync without a status (a text-only refresh) never moves a ticket back to Ready.
            ...(t.statusGiven ? { status: t.status } : {}),
            githubIssueNumber: t.number,
            syncMode: "github",
            epicNumber,
          },
        })
      : await prisma.projectIssue.create({
          data: {
            projectId: project.id,
            issueKey,
            title: (t.title || `Ticket #${t.number}`).slice(0, 240),
            ...fields,
            status: t.status,
            tier: "medium",
            githubIssueNumber: t.number,
            syncMode: "github",
            epicNumber,
          },
        });
    saved.push({ id: row.id, issueKey: row.issueKey, status: row.status });
    if (t.status === "needs_human" && t.decision) decisions.push(t);
  }

  // A needs-decision ticket reported with its question becomes a decision interaction on the run
  // (once: the daemon may also post it through /api/v1/runs/interaction).
  let createdInteractions = 0;
  if (run && run.mode === "epic" && decisions.length > 0) {
    const pending = await prisma.runInteraction.findMany({
      where: { runId: run.id, type: "decision", status: "pending" },
      select: { payloadJson: true },
    });
    const pendingIssues = new Set(
      pending.map((p) => {
        try {
          return Number((JSON.parse(p.payloadJson || "{}") as { issue?: unknown }).issue);
        } catch {
          return NaN;
        }
      }),
    );
    for (const t of decisions) {
      if (pendingIssues.has(t.number)) continue;
      await prisma.runInteraction.create({
        data: {
          runId: run.id,
          type: "decision",
          title: `#${t.number} needs a decision`,
          prompt: t.decision?.question || null,
          payloadJson: JSON.stringify({
            epic: epicNumber,
            issue: t.number,
            question: t.decision?.question ?? "",
            reason: t.decision?.reason ?? "",
          }),
          status: "pending",
        },
      });
      createdInteractions += 1;
    }
  }

  // The epic row follows its tickets.
  const [allTickets, activeRun] = await Promise.all([
    prisma.projectIssue.findMany({
      where: { projectId: project.id, epicNumber, NOT: { issueKey: epicKey } },
      select: { status: true },
    }),
    prisma.factoryRun.findFirst({
      where: { projectId: project.id, mode: "epic", epicNumber, status: { in: ACTIVE_RUN_STATUSES } },
      select: { id: true },
    }),
  ]);
  const epicStatus = deriveEpicStatus(
    allTickets.map((t) => t.status),
    Boolean(activeRun),
  );
  if (epicStatus !== epicRow.status) {
    await prisma.projectIssue.update({ where: { id: epicRow.id }, data: { status: epicStatus } });
  }

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
