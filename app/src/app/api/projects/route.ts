import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { type NextRequest, NextResponse } from "next/server";
import { ensureFactoryBotCollaborator, getFactoryBotUsername } from "@/lib/bot-access";
import { slugify } from "@/lib/crypto";
import { emitFactoryEvent } from "@/lib/events";
import { createGitHubRepo } from "@/lib/github";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/session";
import { getAccessibleRunners } from "@/lib/team-access";
import { isRunnerOnline } from "@/lib/workspace-data";
import { isServerManagedPath } from "@/lib/server-paths";


function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function allocateUniqueSlug(userId: string, base: string): Promise<string> {
  const root = slugify(base);
  const existing = await prisma.project.findMany({
    where: { userId, slug: { startsWith: root } },
    select: { slug: true },
  });
  const taken = new Set(existing.map((p) => p.slug));
  if (!taken.has(root)) return root;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${root}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

export async function GET() {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [projects, githubRepos] = await Promise.all([
    prisma.project.findMany({
      where: { userId: session.user.id },
      orderBy: [{ updatedAt: "desc" }],
    }),
    prisma.githubRepo.findMany({
      where: { userId: session.user.id },
      orderBy: [{ pushedAt: "desc" }, { fullName: "asc" }],
    }),
  ]);

  const lastSyncedAt = githubRepos[0]?.syncedAt.toISOString() ?? null;
  return NextResponse.json({
    projects,
    githubRepos,
    lastSyncedAt,
    factoryBotUsername: getFactoryBotUsername(),
  });
}

export async function POST(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) {
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

  const mode = body.mode === "github" ? "github" : body.mode === "new" ? "new" : null;
  if (!mode) {
    return NextResponse.json({ error: 'mode must be "github" or "new"' }, { status: 400 });
  }

  const engine = "claude";
  const localPath = str(body.localPath) || null;

  if (mode === "github") {
    const githubRepoId = Number(body.githubRepoId);
    if (!Number.isInteger(githubRepoId) || githubRepoId <= 0) {
      return NextResponse.json({ error: "Please select a GitHub repository" }, { status: 400 });
    }

    const repo = await prisma.githubRepo.findUnique({
      where: {
        userId_githubRepoId: { userId: session.user.id, githubRepoId },
      },
    });
    if (!repo) {
      return NextResponse.json(
        { error: "Selected GitHub repository was not found in your synced repos" },
        { status: 404 },
      );
    }

    const already = await prisma.project.findUnique({
      where: {
        userId_githubRepoId: { userId: session.user.id, githubRepoId },
      },
    });
    if (already) {
      return NextResponse.json(
        { error: `${repo.fullName} is already linked as "${already.name}"` },
        { status: 409 },
      );
    }

    const name = str(body.name) || repo.name;
    const description = str(body.description) || repo.description;
    const slug = await allocateUniqueSlug(session.user.id, name);

    const botAccess = await ensureFactoryBotCollaborator({
      userAccessToken: session.githubAccessToken,
      owner: repo.owner,
      repo: repo.name,
    });

    const project = await prisma.project.create({
      data: {
        userId: session.user.id,
        name: name.slice(0, 120),
        slug,
        description: description ? description.slice(0, 500) : null,
        source: "github",
        engine,
        localPath: localPath ? localPath.slice(0, 1024) : null,
        githubRepoId: repo.githubRepoId,
        githubFullName: repo.fullName,
        githubOwner: repo.owner,
        githubUrl: repo.htmlUrl,
        defaultBranch: repo.defaultBranch || "main",
        isPrivate: repo.isPrivate,
        botGithubUsername: botAccess.botGithubUsername,
        botAccessStatus: botAccess.botAccessStatus,
        botAccessError: botAccess.botAccessError,
        botInvitationId: botAccess.botInvitationId,
      },
    });

    return NextResponse.json({ project }, { status: 201 });
  }

  // mode === "new"
  const name = str(body.name);
  if (!name) {
    return NextResponse.json({ error: "Project name is required" }, { status: 400 });
  }
  const description = str(body.description) || null;
  const createOnGitHub = body.createGitHubRepo === true;
  const isPrivate = body.isPrivate !== false;
  const slug = await allocateUniqueSlug(session.user.id, name);

  let createdRepo: {
    githubRepoId: number;
    fullName: string;
    name: string;
    owner: string;
    htmlUrl: string;
    defaultBranch: string | null;
    isPrivate: boolean;
  } | null = null;

  if (createOnGitHub) {
    if (!session.githubAccessToken) {
      return NextResponse.json(
        { error: "GitHub session token unavailable — please sign in again" },
        { status: 401 },
      );
    }
    try {
      const ghRepo = await createGitHubRepo(session.githubAccessToken, {
        name: slug,
        description: description ?? undefined,
        isPrivate,
      });
      await prisma.githubRepo.upsert({
        where: {
          userId_githubRepoId: { userId: session.user.id, githubRepoId: ghRepo.githubRepoId },
        },
        update: {
          fullName: ghRepo.fullName,
          name: ghRepo.name,
          owner: ghRepo.owner,
          isPrivate: ghRepo.isPrivate,
          htmlUrl: ghRepo.htmlUrl,
          cloneUrl: ghRepo.cloneUrl,
          description: ghRepo.description,
          defaultBranch: ghRepo.defaultBranch,
          language: ghRepo.language,
          pushedAt: ghRepo.pushedAt,
          syncedAt: new Date(),
        },
        create: {
          userId: session.user.id,
          githubRepoId: ghRepo.githubRepoId,
          fullName: ghRepo.fullName,
          name: ghRepo.name,
          owner: ghRepo.owner,
          isPrivate: ghRepo.isPrivate,
          htmlUrl: ghRepo.htmlUrl,
          cloneUrl: ghRepo.cloneUrl,
          description: ghRepo.description,
          defaultBranch: ghRepo.defaultBranch,
          language: ghRepo.language,
          pushedAt: ghRepo.pushedAt,
        },
      });
      createdRepo = ghRepo;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create GitHub repo";
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  const botAccess = createdRepo
    ? await ensureFactoryBotCollaborator({
        userAccessToken: session.githubAccessToken,
        owner: createdRepo.owner,
        repo: createdRepo.name,
      })
    : {
        botGithubUsername: getFactoryBotUsername(),
        botAccessStatus: "none" as const,
        botAccessError: null,
        botInvitationId: null,
      };

  const requestedBranch = str(body.defaultBranch) || "main";
  const requestedRunnerId = str(body.runnerId) || "";

  // Resolve target folder inside the daemon's default `workspaceDir`
  const accessibleRunners = await getAccessibleRunners(session.user.id, {
    githubLogin: session.user.githubLogin,
  });
  const targetRunner =
    (requestedRunnerId && accessibleRunners.find((r) => r.id === requestedRunnerId)) ||
    accessibleRunners.find(
      (r) => r.userId === session.user.id && isRunnerOnline(r.status, r.lastHeartbeatAt) && r.workspaceDir,
    ) ||
    accessibleRunners.find((r) => isRunnerOnline(r.status, r.lastHeartbeatAt) && r.workspaceDir) ||
    accessibleRunners.find((r) => r.workspaceDir) ||
    null;

  const workspaceDir =
    targetRunner?.workspaceDir ||
    (process.env.SF_PROJECTS_DIR || path.join(homedir(), "factory-projects")).trim();
  const resolvedLocalPath = localPath || path.join(/* turbopackIgnore: true */ workspaceDir, slug);

  // Initialize folder immediately when running locally (non-Vercel).
  // Do NOT write a stub `.factory/` here — new-ba and new-factory own it.
  // The path may come from the client; the server only touches its own projects folders.
  if (!process.env.VERCEL && resolvedLocalPath && isServerManagedPath(resolvedLocalPath)) {
    try {
      mkdirSync(/* turbopackIgnore: true */ resolvedLocalPath, { recursive: true });
      const readmePath = path.join(/* turbopackIgnore: true */ resolvedLocalPath, "README.md");
      if (!existsSync(/* turbopackIgnore: true */ readmePath)) {
        writeFileSync(
          /* turbopackIgnore: true */ readmePath,
          `# ${name}\n${description ? `\n${description}\n` : ""}`,
        );
      }
      if (!existsSync(/* turbopackIgnore: true */ path.join(resolvedLocalPath, ".git"))) {
        execFileSync("git", ["init", "-b", requestedBranch, resolvedLocalPath], {
          stdio: "ignore",
          timeout: 10000,
        });
        execFileSync("git", ["-C", resolvedLocalPath, "add", "."], {
          stdio: "ignore",
          timeout: 10000,
        });
        try {
          execFileSync(
            "git",
            ["-C", resolvedLocalPath, "commit", "-m", "chore: initialize Factory project"],
            { stdio: "ignore", timeout: 10000 },
          );
        } catch {
          // Ignore if git identity isn't set globally.
        }
      }
    } catch {
      // Remote daemon will still create the folder via `create_project` command below.
    }
  }

  const project = await prisma.project.create({
    data: {
      userId: session.user.id,
      name: name.slice(0, 120),
      slug,
      description: description ? description.slice(0, 500) : null,
      source: createdRepo ? "github" : "new",
      engine,
      localPath: resolvedLocalPath ? resolvedLocalPath.slice(0, 1024) : null,
      githubRepoId: createdRepo?.githubRepoId ?? null,
      githubFullName: createdRepo?.fullName ?? null,
      githubOwner: createdRepo?.owner ?? null,
      githubUrl: createdRepo?.htmlUrl ?? null,
      defaultBranch: createdRepo?.defaultBranch ?? requestedBranch,
      isPrivate: createdRepo?.isPrivate ?? isPrivate,
      botGithubUsername: botAccess.botGithubUsername,
      botAccessStatus: botAccess.botAccessStatus,
      botAccessError: botAccess.botAccessError,
      botInvitationId: botAccess.botInvitationId,
    },
  });

  // Also dispatch `create_project` to online daemon so Vercel-hosted deployments scaffold the folder on the local machine!
  if (targetRunner && isRunnerOnline(targetRunner.status, targetRunner.lastHeartbeatAt)) {
    await prisma.runnerCommand.create({
      data: {
        userId: targetRunner.userId,
        runnerMachineId: targetRunner.id,
        projectId: project.id,
        type: "create_project",
        payloadJson: JSON.stringify({
          slug,
          name: project.name,
          description: project.description || "",
          defaultBranch: project.defaultBranch || "main",
        }),
        status: "pending",
      },
    });
  }

  emitFactoryEvent({ type: "project:updated", userId: session.user.id, projectId: project.id });

  return NextResponse.json(
    {
      project,
      workspaceDir,
      createdPath: resolvedLocalPath,
      dispatchedToRunner: targetRunner?.name ?? null,
    },
    { status: 201 },
  );
}
