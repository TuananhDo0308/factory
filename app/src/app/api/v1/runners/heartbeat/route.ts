import { type NextRequest, NextResponse } from "next/server";
import { authenticateBearer } from "@/lib/api-auth";
import { emitFactoryEvent } from "@/lib/events";
import { prisma } from "@/lib/prisma";
import { safeJsonParse } from "@/lib/workspace-data";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function POST(request: NextRequest) {
  const auth = await authenticateBearer(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = str(body.name) || str(body.hostname) || "local-runner";
  const hostname = str(body.hostname) || name;
  const os = str(body.os) || "darwin";
  const engines = Array.isArray(body.engines) ? body.engines : ["claude"];
  const models = Array.isArray(body.models) ? body.models : undefined;
  const allowedRoots = Array.isArray(body.allowedRoots) ? body.allowedRoots : undefined;
  const workspaceDir = str(body.workspaceDir) || undefined;
  const discoveredProjects = Array.isArray(body.discoveredProjects)
    ? body.discoveredProjects
    : undefined;
  const cliVersion = str(body.cliVersion) || undefined;
  const visibility =
    body.visibility === "team" || body.shared === true
      ? "team"
      : body.visibility === "personal"
        ? "personal"
        : undefined;
  const worktrees = Array.isArray(body.worktrees) ? body.worktrees : [];
  const activeRunKeys = Array.isArray(body.activeRunKeys)
    ? body.activeRunKeys.map((k) => str(k)).filter(Boolean)
    : [];
  const maxConcurrency = Math.max(1, Math.min(10, Number(body.maxConcurrency) || 2));
  const activeRuns = Math.max(0, Number(body.activeRuns) || 0);
  const now = new Date();

  const runner = await prisma.runnerMachine.upsert({
    where: { userId_name: { userId: auth.user.id, name } },
    update: {
      hostname,
      os,
      enginesJson: JSON.stringify(engines),
      ...(models !== undefined ? { modelsJson: JSON.stringify(models) } : {}),
      ...(allowedRoots !== undefined ? { allowedRootsJson: JSON.stringify(allowedRoots) } : {}),
      ...(workspaceDir !== undefined ? { workspaceDir: workspaceDir.slice(0, 1024) } : {}),
      ...(discoveredProjects !== undefined
        ? { discoveredProjectsJson: JSON.stringify(discoveredProjects).slice(0, 64_000) }
        : {}),
      ...(cliVersion !== undefined ? { cliVersion } : {}),
      ...(visibility !== undefined ? { visibility } : {}),
      worktreesJson: JSON.stringify(worktrees),
      status: "online",
      maxConcurrency,
      activeRuns,
      lastHeartbeatAt: now,
    },
    create: {
      userId: auth.user.id,
      name: name.slice(0, 100),
      hostname: hostname.slice(0, 120),
      os: os.slice(0, 40),
      enginesJson: JSON.stringify(engines),
      modelsJson: models !== undefined ? JSON.stringify(models) : null,
      allowedRootsJson: allowedRoots !== undefined ? JSON.stringify(allowedRoots) : null,
      workspaceDir: workspaceDir ? workspaceDir.slice(0, 1024) : null,
      discoveredProjectsJson:
        discoveredProjects !== undefined
          ? JSON.stringify(discoveredProjects).slice(0, 64_000)
          : null,
      cliVersion: cliVersion ?? null,
      visibility: visibility ?? "personal",
      worktreesJson: JSON.stringify(worktrees),
      status: "online",
      maxConcurrency,
      activeRuns,
      lastHeartbeatAt: now,
    },
    select: { id: true, name: true, status: true },
  });

  // Keep live FactoryRun heartbeats fresh while this runner actively owns their OS child
  // process (works for both explicit `activeRunKeys` and older daemons via claimed commands).
  if (activeRuns > 0 || activeRunKeys.length > 0) {
    const claimedCmds =
      activeRuns > 0
        ? await prisma.runnerCommand.findMany({
            where: {
              status: "claimed",
              runId: { not: null },
              OR: [
                { runnerMachineId: runner.id },
                { userId: auth.user.id, runnerMachineId: null },
              ],
            },
            select: { runId: true },
          })
        : [];
    const claimedRunIds = claimedCmds
      .map((c) => c.runId)
      .filter((id): id is string => Boolean(id));

    const liveWhereOr: Array<Record<string, unknown>> = [];
    if (claimedRunIds.length > 0) liveWhereOr.push({ id: { in: claimedRunIds } });
    if (activeRunKeys.length > 0) liveWhereOr.push({ runKey: { in: activeRunKeys } });

    if (liveWhereOr.length > 0) {
      const liveRuns = await prisma.factoryRun.findMany({
        where: {
          status: { in: ["running", "stalled"] },
          OR: liveWhereOr,
        },
        select: { id: true, projectId: true, status: true, summary: true },
      });
      for (const liveRun of liveRuns) {
        const isWatchdogStall =
          liveRun.status === "stalled" ||
          Boolean(liveRun.summary?.startsWith("No agent activity received for "));
        await prisma.factoryRun
          .update({
            where: { id: liveRun.id },
            data: {
              lastHeartbeatAt: now,
              ...(isWatchdogStall ? { status: "running", summary: null } : {}),
            },
          })
          .catch(() => {});
        if (liveRun.status === "stalled") {
          emitFactoryEvent({
            type: "run:updated",
            userId: auth.user.id,
            projectId: liveRun.projectId,
            runId: liveRun.id,
            payload: { status: "running" },
          });
        }
      }
    }
  }

  // Always deliver control commands (pause/resume/steer) immediately, plus start commands up to capacity.
  // Match commands explicitly addressed to this runner (including shared team commands) OR unassigned commands owned by this user.
  const controlTypes = ["pause_run", "resume_run", "answer_interaction", "sync_context"];
  const runnerCmdFilter = {
    OR: [
      { runnerMachineId: runner.id },
      { userId: auth.user.id, runnerMachineId: null },
    ],
  };
  const [controlCommands, startCommands] = await Promise.all([
    prisma.runnerCommand.findMany({
      where: {
        ...runnerCmdFilter,
        status: "pending",
        type: { in: controlTypes },
      },
      orderBy: { createdAt: "asc" },
      take: 10,
    }),
    maxConcurrency - activeRuns > 0
      ? prisma.runnerCommand.findMany({
          where: {
            ...runnerCmdFilter,
            status: "pending",
            type: { notIn: controlTypes },
          },
          orderBy: { createdAt: "asc" },
          take: Math.max(1, maxConcurrency - activeRuns),
        })
      : Promise.resolve([]),
  ]);
  const commands = [...controlCommands, ...startCommands];

  emitFactoryEvent({
    type: "runner:updated",
    userId: auth.user.id,
    payload: { runnerId: runner.id, name: runner.name, status: "online", activeRuns },
  });

  return NextResponse.json({
    ok: true,
    runner: { id: runner.id, name: runner.name, status: runner.status },
    commands: commands.map((c) => ({
      id: c.id,
      type: c.type,
      projectId: c.projectId,
      runId: c.runId,
      payload: safeJsonParse<Record<string, unknown>>(c.payloadJson, {}),
      createdAt: c.createdAt.toISOString(),
    })),
  });
}
