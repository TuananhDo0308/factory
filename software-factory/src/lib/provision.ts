import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { ensureFactoryBotCollaborator, getFactoryBotUsername } from "@/lib/bot-access";
import { slugify } from "@/lib/crypto";
import { createGitHubRepo } from "@/lib/github";
import { prisma } from "@/lib/prisma";

const execFileAsync = promisify(execFile);

export type ProvisionProgressEvent =
  | { type: "step"; index: number; detail?: string }
  | { type: "done"; project: Record<string, unknown> }
  | { type: "error"; index: number; message: string };

export function getWorkspacesRoot(): string {
  const configured = (process.env.FACTORY_WORKSPACES_DIR || "").trim();
  if (configured) {
    return path.resolve(/* turbopackIgnore: true */ configured);
  }
  return path.join(homedir(), "software-factory-workspaces");
}

function scrubToken(text: string, token?: string | null): string {
  if (!token) return text;
  return text.split(token).join("[redacted]");
}

async function runGit(
  args: string[],
  cwd: string,
  options?: { githubToken?: string | null },
): Promise<string> {
  const gitArgs = [...args];
  if (options?.githubToken) {
    const basic = Buffer.from(`x-access-token:${options.githubToken}`, "utf8").toString("base64");
    gitArgs.unshift("-c", `http.https://github.com/.extraheader=AUTHORIZATION: basic ${basic}`);
  }
  try {
    const { stdout } = await execFileAsync("git", gitArgs, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (error) {
    const err = error as { stderr?: string; stdout?: string; message?: string };
    const detail = scrubToken(
      (err.stderr || err.stdout || err.message || "git command failed").trim(),
      options?.githubToken,
    );
    throw new Error(detail.slice(0, 400));
  }
}

function writeIfMissing(root: string, relPath: string, content: string, written: string[]) {
  const full = path.join(root, relPath);
  if (existsSync(full)) return;
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content, "utf8");
  written.push(relPath);
}

function scaffoldFactoryContext(
  projectDir: string,
  input: {
    name: string;
    slug: string;
    description: string | null;
    engine: "antigravity" | "claude";
    defaultBranch: string;
    botGithubUsername: string | null;
    isNewRepo: boolean;
  },
): string[] {
  // Do NOT pre-create placeholder `.factory/project.json` or `.factory/init.json` stubs:
  // `/factory init` (Stage 1) owns `.factory/`, `CODING_STANDARDS.md`, and stack skills so
  // `init-status.mjs` accurately reports `none` until interactive setup completes.
  const written: string[] = [];
  if (input.isNewRepo) {
    writeIfMissing(
      projectDir,
      "README.md",
      `# ${input.name}\n\n${input.description || "Managed by Software Factory."}\n`,
      written,
    );
    writeIfMissing(
      projectDir,
      ".gitignore",
      "node_modules/\n.env\n.env.local\n.DS_Store\n.factory/runs/\n",
      written,
    );
  }
  return written;
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

function resolveTargetDirectory(slug: string, customLocalPath: string | null): string {
  if (customLocalPath) {
    const expanded = customLocalPath.startsWith("~/")
      ? path.join(homedir(), customLocalPath.slice(2))
      : customLocalPath;
    return path.resolve(/* turbopackIgnore: true */ expanded);
  }
  const root = getWorkspacesRoot();
  mkdirSync(root, { recursive: true });
  return path.join(root, slug);
}

export type ProvisionInput = {
  user: {
    id: string;
    githubLogin: string;
    name: string | null;
    email: string | null;
  };
  userAccessToken: string | null;
  mode: "new" | "github";
  name?: string;
  description?: string | null;
  engine: "antigravity" | "claude";
  localPath?: string | null;
  githubRepoId?: number;
  createGitHubRepo?: boolean;
  isPrivate?: boolean;
};

export async function provisionProject(
  input: ProvisionInput,
  emit: (event: ProvisionProgressEvent) => void,
) {
  let activeStep = 0;
  const botUsername = getFactoryBotUsername();
  const gitAuthorName = input.user.name || input.user.githubLogin || "Software Factory";
  const gitAuthorEmail =
    input.user.email || `${input.user.githubLogin}@users.noreply.github.com`;

  try {
    if (input.mode === "new") {
      const name = (input.name || "").trim();
      if (!name) throw new Error("Project name is required");
      const description = (input.description || "").trim() || null;
      const createOnGitHub = input.createGitHubRepo !== false;
      const isPrivate = input.isPrivate !== false;
      const slug = await allocateUniqueSlug(input.user.id, name);

      // Step 0: Create workspace folder on host
      activeStep = 0;
      const projectDir = resolveTargetDirectory(slug, input.localPath ?? null);
      emit({ type: "step", index: 0, detail: projectDir });

      if (existsSync(projectDir) && readdirSync(projectDir).length > 0) {
        throw new Error(`Target directory is not empty: ${projectDir}`);
      }
      mkdirSync(projectDir, { recursive: true });

      // Step 1: Initialize git + Factory context folder structure
      activeStep = 1;
      emit({ type: "step", index: 1, detail: "Creating .factory/, CODING_STANDARDS.md & agent docs" });
      await runGit(["init", "-b", "main"], projectDir);
      await runGit(["config", "user.name", gitAuthorName], projectDir);
      await runGit(["config", "user.email", gitAuthorEmail], projectDir);
      const writtenFiles = scaffoldFactoryContext(projectDir, {
        name,
        slug,
        description,
        engine: input.engine,
        defaultBranch: "main",
        botGithubUsername: botUsername,
        isNewRepo: true,
      });

      // Step 2: Create GitHub repo under user's account
      activeStep = 2;
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
        if (!input.userAccessToken) {
          throw new Error("GitHub session token unavailable — please sign in again");
        }
        emit({ type: "step", index: 2, detail: `Creating ${input.user.githubLogin}/${slug} on GitHub` });
        const ghRepo = await createGitHubRepo(input.userAccessToken, {
          name: slug,
          description: description ?? undefined,
          isPrivate,
          autoInit: false,
        });
        await prisma.githubRepo.upsert({
          where: {
            userId_githubRepoId: { userId: input.user.id, githubRepoId: ghRepo.githubRepoId },
          },
          update: {
            fullName: ghRepo.fullName,
            name: ghRepo.name,
            owner: ghRepo.owner,
            isPrivate: ghRepo.isPrivate,
            htmlUrl: ghRepo.htmlUrl,
            cloneUrl: ghRepo.cloneUrl,
            description: ghRepo.description,
            defaultBranch: ghRepo.defaultBranch || "main",
            language: ghRepo.language,
            pushedAt: ghRepo.pushedAt,
            syncedAt: new Date(),
          },
          create: {
            userId: input.user.id,
            githubRepoId: ghRepo.githubRepoId,
            fullName: ghRepo.fullName,
            name: ghRepo.name,
            owner: ghRepo.owner,
            isPrivate: ghRepo.isPrivate,
            htmlUrl: ghRepo.htmlUrl,
            cloneUrl: ghRepo.cloneUrl,
            description: ghRepo.description,
            defaultBranch: ghRepo.defaultBranch || "main",
            language: ghRepo.language,
            pushedAt: ghRepo.pushedAt,
          },
        });
        createdRepo = ghRepo;
      } else {
        emit({ type: "step", index: 2, detail: "Skipped GitHub repo (local-only project)" });
      }

      // Step 3: Add AI Server GitHub account as collaborator with push access
      activeStep = 3;
      const botAccess = createdRepo
        ? await (async () => {
            emit({
              type: "step",
              index: 3,
              detail: botUsername
                ? `Granting push access to @${botUsername} on ${createdRepo.fullName}`
                : "No AI server bot username configured",
            });
            return ensureFactoryBotCollaborator({
              userAccessToken: input.userAccessToken,
              owner: createdRepo.owner,
              repo: createdRepo.name,
            });
          })()
        : {
            botGithubUsername: botUsername,
            botAccessStatus: "none" as const,
            botAccessError: null,
            botInvitationId: null,
          };

      if (!createdRepo) {
        emit({ type: "step", index: 3, detail: "Local-only workspace (no GitHub collaborator needed)" });
      }

      // Step 4: Commit Factory context & push initial commit to GitHub
      activeStep = 4;
      emit({
        type: "step",
        index: 4,
        detail: createdRepo
          ? `Committing ${writtenFiles.length} files & pushing to ${createdRepo.fullName}`
          : `Committing ${writtenFiles.length} Factory context files locally`,
      });
      await runGit(["add", "-A"], projectDir);
      await runGit(
        ["commit", "-m", "chore: initialize Software Factory project context"],
        projectDir,
      );

      if (createdRepo && input.userAccessToken) {
        const cleanRemoteUrl = `https://github.com/${createdRepo.fullName}.git`;
        await runGit(["remote", "add", "origin", cleanRemoteUrl], projectDir);
        await runGit(["push", "-u", "origin", "main"], projectDir, {
          githubToken: input.userAccessToken,
        });
      }

      // Step 5: Save project record in SQLite
      activeStep = 5;
      emit({ type: "step", index: 5, detail: "Registering project in Software Factory" });
      const project = await prisma.project.create({
        data: {
          userId: input.user.id,
          name: name.slice(0, 120),
          slug,
          description: description ? description.slice(0, 500) : null,
          source: createdRepo ? "github" : "new",
          engine: input.engine,
          localPath: projectDir,
          githubRepoId: createdRepo?.githubRepoId ?? null,
          githubFullName: createdRepo?.fullName ?? null,
          githubOwner: createdRepo?.owner ?? null,
          githubUrl: createdRepo?.htmlUrl ?? null,
          defaultBranch: createdRepo?.defaultBranch || "main",
          isPrivate: createdRepo?.isPrivate ?? isPrivate,
          botGithubUsername: botAccess.botGithubUsername,
          botAccessStatus: botAccess.botAccessStatus,
          botAccessError: botAccess.botAccessError,
          botInvitationId: botAccess.botInvitationId,
        },
      });

      emit({
        type: "done",
        project: {
          ...project,
          createdAt: project.createdAt.toISOString(),
          updatedAt: project.updatedAt.toISOString(),
        },
      });
      return;
    }

    // --- mode === "github" (Link existing GitHub repository) ---
    const githubRepoId = Number(input.githubRepoId);
    if (!Number.isInteger(githubRepoId) || githubRepoId <= 0) {
      throw new Error("Please select a GitHub repository");
    }

    const repo = await prisma.githubRepo.findUnique({
      where: {
        userId_githubRepoId: { userId: input.user.id, githubRepoId },
      },
    });
    if (!repo) {
      throw new Error("Selected GitHub repository was not found in your synced repos");
    }

    const already = await prisma.project.findUnique({
      where: {
        userId_githubRepoId: { userId: input.user.id, githubRepoId },
      },
    });
    if (already) {
      throw new Error(`${repo.fullName} is already linked as "${already.name}"`);
    }

    const name = (input.name || "").trim() || repo.name;
    const description = (input.description || "").trim() || repo.description;
    const slug = await allocateUniqueSlug(input.user.id, name);
    const defaultBranch = repo.defaultBranch || "main";
    const projectDir = resolveTargetDirectory(slug, input.localPath ?? null);

    // Step 0: Clone repo to host workspace
    activeStep = 0;
    emit({ type: "step", index: 0, detail: `Cloning ${repo.fullName} into ${projectDir}` });

    if (existsSync(path.join(projectDir, ".git"))) {
      await runGit(["fetch", "origin"], projectDir, { githubToken: input.userAccessToken });
    } else {
      if (existsSync(projectDir) && readdirSync(projectDir).length > 0) {
        throw new Error(`Target directory is not empty: ${projectDir}`);
      }
      mkdirSync(path.dirname(projectDir), { recursive: true });
      const cleanRemoteUrl = `https://github.com/${repo.fullName}.git`;
      await runGit(["clone", cleanRemoteUrl, projectDir], path.dirname(projectDir), {
        githubToken: input.userAccessToken,
      });
    }

    await runGit(["config", "user.name", gitAuthorName], projectDir);
    await runGit(["config", "user.email", gitAuthorEmail], projectDir);

    // Step 1: Scaffold missing Factory context structure
    activeStep = 1;
    emit({ type: "step", index: 1, detail: "Initializing missing .factory/ context & standards" });
    const writtenFiles = scaffoldFactoryContext(projectDir, {
      name,
      slug,
      description,
      engine: input.engine,
      defaultBranch,
      botGithubUsername: botUsername,
      isNewRepo: false,
    });

    // Step 2: Grant AI server collaborator push access
    activeStep = 2;
    emit({
      type: "step",
      index: 2,
      detail: botUsername
        ? `Granting push access to @${botUsername} on ${repo.fullName}`
        : "No AI server bot username configured",
    });
    const botAccess = await ensureFactoryBotCollaborator({
      userAccessToken: input.userAccessToken,
      owner: repo.owner,
      repo: repo.name,
    });

    // Step 3: Commit & push newly created Factory context files (if any)
    activeStep = 3;
    if (writtenFiles.length > 0) {
      emit({
        type: "step",
        index: 3,
        detail: `Committing ${writtenFiles.length} context files & pushing to ${defaultBranch}`,
      });
      await runGit(["add", "--", ...writtenFiles], projectDir);
      const staged = await runGit(["diff", "--cached", "--name-only"], projectDir);
      if (staged) {
        await runGit(
          ["commit", "-m", "chore: initialize Software Factory context"],
          projectDir,
        );
        if (input.userAccessToken) {
          const branch = (await runGit(["branch", "--show-current"], projectDir)) || defaultBranch;
          await runGit(["push", "origin", branch], projectDir, {
            githubToken: input.userAccessToken,
          });
        }
      }
    } else {
      emit({ type: "step", index: 3, detail: ".factory/ context already present — nothing to push" });
    }

    // Step 4: Save project in SQLite
    activeStep = 4;
    emit({ type: "step", index: 4, detail: "Registering project in Software Factory" });
    const project = await prisma.project.create({
      data: {
        userId: input.user.id,
        name: name.slice(0, 120),
        slug,
        description: description ? description.slice(0, 500) : null,
        source: "github",
        engine: input.engine,
        localPath: projectDir,
        githubRepoId: repo.githubRepoId,
        githubFullName: repo.fullName,
        githubOwner: repo.owner,
        githubUrl: repo.htmlUrl,
        defaultBranch,
        isPrivate: repo.isPrivate,
        botGithubUsername: botAccess.botGithubUsername,
        botAccessStatus: botAccess.botAccessStatus,
        botAccessError: botAccess.botAccessError,
        botInvitationId: botAccess.botInvitationId,
      },
    });

    emit({
      type: "done",
      project: {
        ...project,
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Project provisioning failed";
    emit({ type: "error", index: activeStep, message });
  }
}
