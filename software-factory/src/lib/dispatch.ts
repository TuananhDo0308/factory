import { epicIssueKey, repoFullName } from "@/lib/epics";
import { emitFactoryEvent } from "@/lib/events";
import { prisma } from "@/lib/prisma";
import { getAccessibleRunners } from "@/lib/team-access";

export const ACTIVE_RUN_STATUSES = ["queued", "running", "awaiting_input"];

const ONLINE_WINDOW_MS = 65_000;

type AccessibleRunner = Awaited<ReturnType<typeof getAccessibleRunners>>[number];

/**
 * Picks the daemon a command goes to: the requested runner (if accessible and online), then the
 * run's own runner, then the project's default runner, then the caller's least-busy online runner,
 * then a least-busy team runner shared on this project.
 */
export async function pickOnlineRunner(params: {
  user: { id: string; githubLogin?: string | null };
  projectId: string;
  requestedRunnerId?: string | null;
  preferredRunnerId?: string | null;
  projectDefaultRunnerId?: string | null;
}): Promise<AccessibleRunner | null> {
  const cutoffMs = Date.now() - ONLINE_WINDOW_MS;
  const candidates = (
    await getAccessibleRunners(params.user.id, {
      projectId: params.projectId,
      githubLogin: params.user.githubLogin ?? undefined,
    })
  ).filter((r) => r.status === "online" && r.lastHeartbeatAt.getTime() > cutoffMs);

  for (const id of [params.requestedRunnerId, params.preferredRunnerId, params.projectDefaultRunnerId]) {
    if (!id) continue;
    const found = candidates.find((r) => r.id === id);
    if (found) return found;
  }
  const own = candidates
    .filter((r) => r.userId === params.user.id)
    .sort((a, b) => a.activeRuns - b.activeRuns);
  const shared = candidates
    .filter((r) => r.userId !== params.user.id && r.visibility === "team")
    .sort((a, b) => a.activeRuns - b.activeRuns);
  return own[0] ?? shared[0] ?? null;
}

export function newRunKey(tag?: string): string {
  const day = new Date().toISOString().slice(0, 10);
  const rand = Math.random().toString(36).slice(2, 8);
  const cleanTag = (tag || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return cleanTag ? `${day}-${cleanTag}-${rand}` : `${day}-${rand}`;
}

export class DispatchError extends Error {
  status: number;
  code?: string;
  extra?: Record<string, unknown>;
  constructor(message: string, status: number, code?: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/**
 * Creates a `FactoryRun` (mode "epic") and the `run_epic` command for the project's daemon.
 * Throws a DispatchError (409) when a run of the same epic is still active, (503) without a daemon,
 * (400) when the project has no GitHub repository or local clone.
 */
export async function startEpicRun(params: {
  user: { id: string; githubLogin: string };
  project: {
    id: string;
    userId: string;
    slug: string;
    localPath: string | null;
    githubFullName: string | null;
    githubUrl: string | null;
    defaultRunnerId: string | null;
  };
  epic: number;
  retry?: number[];
  note?: string;
  createStaging?: boolean;
  runnerId?: string | null;
  preferredRunnerId?: string | null;
}) {
  const { user, project, epic } = params;
  const repo = repoFullName(project);
  if (!repo) {
    throw new DispatchError("This project has no GitHub repository (owner/name) to run an epic on.", 400, "NO_REPO");
  }
  if (!project.localPath) {
    throw new DispatchError("This project has no local clone path for the daemon to run in.", 400, "NO_LOCAL_PATH");
  }

  const active = await prisma.factoryRun.findFirst({
    where: {
      projectId: project.id,
      mode: "epic",
      epicNumber: epic,
      status: { in: ACTIVE_RUN_STATUSES },
    },
    select: { id: true },
  });
  if (active) {
    throw new DispatchError(`Epic #${epic} is already running.`, 409, "EPIC_RUNNING", { activeRunId: active.id });
  }

  const runner = await pickOnlineRunner({
    user,
    projectId: project.id,
    requestedRunnerId: params.runnerId,
    preferredRunnerId: params.preferredRunnerId,
    projectDefaultRunnerId: project.defaultRunnerId,
  });
  if (!runner) {
    throw new DispatchError(
      "No local daemon is connected. Start `sf daemon` on your machine (or connect a runner in Settings → Runners).",
      503,
      "NO_RUNNER_ONLINE",
    );
  }

  const epicIssue = await prisma.projectIssue.findUnique({
    where: { projectId_issueKey: { projectId: project.id, issueKey: epicIssueKey(epic) } },
    select: { id: true, title: true },
  });
  const epicTitle = epicIssue?.title || `Epic #${epic}`;
  const retry = (params.retry ?? []).filter((n) => Number.isInteger(n) && n > 0);
  const note = (params.note || "").trim();
  const runKey = newRunKey(`epic${epic}`);
  const title = `Epic #${epic}: ${epicTitle.replace(/^Epic #\d+:\s*/i, "")}`.slice(0, 140);
  const label = retry.length > 0 ? `retry ${retry.map((n) => `#${n}`).join(", ")}` : "run epic";

  const run = await prisma.$transaction(async (tx) => {
    const created = await tx.factoryRun.create({
      data: {
        projectId: project.id,
        userId: project.userId,
        triggeredById: user.id,
        issueId: epicIssue?.id ?? null,
        runnerMachineId: runner.id,
        runKey,
        title,
        prompt: note || null,
        mode: "epic",
        autonomy: "high",
        engine: "claude",
        status: "queued",
        currentPhase: "Plan",
        targetBranch: "staging",
        worktreePath: project.localPath,
        epicNumber: epic,
        lastHeartbeatAt: new Date(),
      },
    });
    await tx.runStep.create({
      data: {
        runId: created.id,
        seq: 1,
        step: "run-epic-queued",
        phase: "Plan",
        status: "info",
        role: "human",
        label: `Epic #${epic} · ${label}`,
        summary: note ? `Note: ${note.slice(0, 2000)}` : `Queued on runner "${runner.name}"`,
        dataJson: JSON.stringify({ kind: "epic", epic, repo }),
      },
    });
    await tx.runnerCommand.create({
      data: {
        userId: runner.userId,
        runnerMachineId: runner.id,
        projectId: project.id,
        runId: created.id,
        type: "run_epic",
        payloadJson: JSON.stringify({
          runKey,
          projectId: project.id,
          projectSlug: project.slug,
          mode: "epic",
          engine: "claude",
          repo,
          epic,
          localPath: project.localPath,
          ...(retry.length > 0 ? { retry } : {}),
          ...(note ? { note } : {}),
          ...(params.createStaging ? { createStaging: true } : {}),
        }),
        status: "pending",
      },
    });
    if (epicIssue) {
      await tx.projectIssue.update({
        where: { id: epicIssue.id },
        data: { status: "in_progress", runKey, currentPhase: "Plan" },
      });
    }
    return created;
  });

  emitFactoryEvent({
    type: "run:updated",
    userId: user.id,
    projectId: project.id,
    runId: run.id,
    payload: { status: run.status, mode: "epic", epic },
  });
  emitFactoryEvent({
    type: "issue:updated",
    userId: user.id,
    projectId: project.id,
    runId: run.id,
    payload: { epic, status: "in_progress" },
  });
  emitFactoryEvent({
    type: "command:created",
    userId: runner.userId,
    projectId: project.id,
    runId: run.id,
    payload: { type: "run_epic" },
  });

  return { run, runner, repo };
}
