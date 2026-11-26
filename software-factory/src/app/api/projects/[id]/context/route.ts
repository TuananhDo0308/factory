import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import {
  fetchGitHubContextFiles,
  getProjectContextLake,
  scanLocalContextFiles,
  upsertProjectContextFiles,
} from "@/lib/context-lake";
import { emitFactoryEvent } from "@/lib/events";
import { prisma } from "@/lib/prisma";
import { getAccessibleRunners, getProjectAccess } from "@/lib/team-access";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const access = await getProjectAccess(auth.user, id);
  if (!access) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const commandId = request.nextUrl.searchParams.get("commandId")?.trim() || "";
  const [lake, cmd] = await Promise.all([
    getProjectContextLake({
      project: access.project,
      githubAccessToken: auth.githubAccessToken,
    }),
    commandId
      ? prisma.runnerCommand.findFirst({
          where: { id: commandId, projectId: access.project.id, type: "sync_context" },
          select: { id: true, status: true, error: true, updatedAt: true },
        })
      : Promise.resolve(null),
  ]);

  return NextResponse.json({
    ok: true,
    ...lake,
    ...(cmd
      ? {
          commandStatus: cmd.status,
          commandError: cmd.error,
        }
      : {}),
  });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const access = await getProjectAccess(auth.user, id);
  if (!access) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (!access.canWrite) {
    return NextResponse.json({ error: "Viewer role cannot sync context" }, { status: 403 });
  }

  const project = access.project;
  let body: Record<string, unknown> = {};
  try {
    const parsed = await request.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    // Empty body is fine.
  }

  const preferredSource = typeof body.source === "string" ? body.source : "auto";
  const requestedRunnerId = typeof body.runnerId === "string" ? body.runnerId.trim() : "";

  // 1. If local disk is reachable on this server host (localhost), scan directly and persist to DB.
  if (preferredSource !== "github" && preferredSource !== "daemon" && project.localPath) {
    const localFiles = scanLocalContextFiles(project.localPath);
    if (localFiles.length > 0) {
      const saved = await upsertProjectContextFiles({
        projectId: project.id,
        files: localFiles,
        source: "local",
        replaceAll: true,
      });
      emitFactoryEvent({
        type: "context:updated",
        userId: auth.user.id,
        projectId: project.id,
        payload: { count: saved.savedCount, source: "local" },
      });
      return NextResponse.json({
        ok: true,
        source: "local",
        savedCount: saved.savedCount,
        initComplete: saved.initComplete,
        files: localFiles,
        syncedAt: new Date().toISOString(),
      });
    }
  }

  // 2. Ask an online `sf daemon` runner to push the latest local `.factory/` files (works on Vercel!).
  // Prefer explicit runnerId -> project.defaultRunnerId -> user's own runner -> shared team runner.
  let queuedRunnerName: string | null = null;
  let commandId: string | null = null;
  if (preferredSource !== "github") {
    const cutoffMs = Date.now() - 65_000;
    const runners = (
      await getAccessibleRunners(auth.user.id, {
        projectId: project.id,
        githubLogin: auth.user.githubLogin,
      })
    ).filter((r) => r.status === "online" && r.lastHeartbeatAt.getTime() > cutoffMs);
    const preferredId = requestedRunnerId || project.defaultRunnerId || "";
    const runner =
      (preferredId ? runners.find((r) => r.id === preferredId) : null) ??
      runners.find((r) => r.userId === auth.user.id) ??
      runners[0] ??
      null;
    if (runner) {
      const createdCmd = await prisma.runnerCommand.create({
        data: {
          userId: runner.userId,
          runnerMachineId: runner.id,
          projectId: project.id,
          type: "sync_context",
          payloadJson: JSON.stringify({
            projectId: project.id,
            projectSlug: project.slug,
            projectName: project.name,
            localPath: project.localPath,
          }),
          status: "pending",
        },
        select: { id: true },
      });
      queuedRunnerName = runner.name;
      commandId = createdCmd.id;
    }
  }

  // 3. If an online daemon was queued, let it push complete local `.factory/` files without
  // overwriting existing daemon-synced files with a partial GitHub snapshot (where `.factory/` is often gitignored).
  if (queuedRunnerName) {
    let lake = await getProjectContextLake({
      project,
      githubAccessToken: auth.githubAccessToken,
    });
    // If DB is still empty and GitHub is connected, hydrate immediately (non-destructive) while daemon pushes.
    if (lake.files.length === 0 && project.githubFullName && preferredSource !== "daemon") {
      const gh = await fetchGitHubContextFiles({
        fullName: project.githubFullName,
        branch: project.defaultBranch,
        accessToken: auth.githubAccessToken,
      });
      if (gh.ok && gh.files.length > 0) {
        await upsertProjectContextFiles({
          projectId: project.id,
          files: gh.files,
          source: "github",
          replaceAll: false,
        }).catch(() => {});
        lake = {
          files: gh.files,
          source: "github",
          syncedAt: new Date().toISOString(),
        };
      }
    }
    return NextResponse.json({
      ok: true,
      queuedRunnerName,
      commandId,
      message: `Requested context sync from online runner "${queuedRunnerName}"`,
      ...lake,
    });
  }

  // 4. Fallback when no daemon is online: pull directly from GitHub API if connected.
  if (project.githubFullName && preferredSource !== "daemon") {
    const gh = await fetchGitHubContextFiles({
      fullName: project.githubFullName,
      branch: project.defaultBranch,
      accessToken: auth.githubAccessToken,
    });
    if (gh.ok) {
      const saved = await upsertProjectContextFiles({
        projectId: project.id,
        files: gh.files,
        source: "github",
        replaceAll: gh.files.length > 0,
      });
      emitFactoryEvent({
        type: "context:updated",
        userId: auth.user.id,
        projectId: project.id,
        payload: { count: saved.savedCount, source: "github" },
      });
      return NextResponse.json({
        ok: true,
        source: "github",
        savedCount: saved.savedCount,
        initComplete: saved.initComplete,
        files: gh.files,
        syncedAt: new Date().toISOString(),
      });
    }

    return NextResponse.json(
      {
        error: `${gh.error}. Connect a local \`sf daemon\` runner to push local .factory/ files automatically.`,
      },
      { status: 502 },
    );
  }

  return NextResponse.json(
    {
      error:
        "No local disk path on this server, no online `sf daemon` runner, and no connected GitHub repository found to sync Context Lake.",
    },
    { status: 400 },
  );
}
