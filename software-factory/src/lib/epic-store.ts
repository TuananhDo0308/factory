// Writes a factory v2 epic and its tickets to the Kanban board. Shared by the daemon's
// POST /api/v1/epics/sync and the GitHub tracking of a repository.
import { ACTIVE_RUN_STATUSES } from "@/lib/dispatch";
import { deriveEpicStatus, epicIssueKey, ticketIssueKey, type SyncTicket } from "@/lib/epics";
import { prisma } from "@/lib/prisma";

type RunRef = { id: string; mode: string; runKey: string; issueId: string | null } | null;

export async function upsertEpicWithTickets(params: {
  project: { id: string };
  epic: { number: number; title?: string; url?: string | null };
  tickets: SyncTicket[];
  run?: RunRef;
}) {
  const { project, tickets } = params;
  const run = params.run ?? null;
  const epicNumber = params.epic.number;
  const epicTitle = (params.epic.title || "").trim();
  const epicUrl = params.epic.url || null;
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


  return { epicRow, epicKey, epicStatus, saved, createdInteractions };
}
