import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isFactoryInitCompleteFromFiles } from "@/lib/context-lake";
import { FACTORY_INIT_ISSUE_KEY, isFactoryInitIssue } from "@/lib/init-issue-shared";
import { prisma } from "@/lib/prisma";
import { SF_PROTOTYPE_PROMPT_CONTRACT } from "@/lib/prototypes";
import { SF_QUESTIONS_PROMPT_CONTRACT } from "@/lib/questions";
import { safeJsonParse } from "@/lib/workspace-data";

export { FACTORY_INIT_ISSUE_KEY, isFactoryInitIssue };

/**
 * Inspects a local repository path to determine whether `/factory init` has truly completed.
 * Ignores bare placeholder `.factory/project.json` stubs created without running `/factory init`.
 */
export function isProjectFactoryInitCompleteOnDisk(
  localPath: string | null | undefined,
): boolean {
  if (!localPath || !localPath.trim()) return false;
  const root = localPath.trim();
  const initJsonPath = join(root, ".factory", "init.json");
  const profilePath = join(root, ".factory", "project.json");
  if (!existsSync(/* turbopackIgnore: true */ initJsonPath)) return false;
  if (!existsSync(/* turbopackIgnore: true */ profilePath)) return false;

  try {
    const profile = JSON.parse(
      readFileSync(/* turbopackIgnore: true */ profilePath, "utf8"),
    ) as Record<string, unknown>;
    const stack = profile.stack as Record<string, unknown> | undefined;
    const commands = profile.commands as Record<string, unknown> | undefined;
    const hasLanguages =
      Array.isArray(stack?.languages) && stack.languages.length > 0;
    const hasCommands =
      Boolean(commands) &&
      typeof commands === "object" &&
      Object.values(commands as Record<string, unknown>).some(
        (v) => typeof v === "string" && v.trim().length > 0,
      );
    if (!hasLanguages && !hasCommands) return false;

    const initMeta = JSON.parse(
      readFileSync(/* turbopackIgnore: true */ initJsonPath, "utf8"),
    ) as Record<string, unknown>;
    const steps = initMeta.steps as Record<string, unknown> | undefined;
    if (steps && typeof steps === "object") {
      // `check` is the final step marked by `/factory init` step 5.
      if (steps.check) return true;
    }
    return hasLanguages && hasCommands;
  } catch {
    return false;
  }
}

/**
 * Checks whether a project has completed `/factory init` (in DB or on local disk),
 * syncing `Project.initStatus = "complete"` in SQLite when verified on disk.
 */
export async function syncProjectInitStatus(project: {
  id: string;
  initStatus: string;
  localPath?: string | null;
}): Promise<boolean> {
  if (project.initStatus === "complete") return true;
  if (isProjectFactoryInitCompleteOnDisk(project.localPath)) {
    await prisma.project
      .update({
        where: { id: project.id },
        data: { initStatus: "complete" },
      })
      .catch(() => {});
    return true;
  }

  // Fallback for remote serverless deployments (e.g. Vercel): verify from DB-synced Context Lake files.
  const syncedFiles = await prisma.projectContextFile.findMany({
    where: {
      projectId: project.id,
      path: { in: [".factory/init.json", ".factory/project.json"] },
    },
    select: { path: true, content: true },
  });
  if (syncedFiles.length >= 2 && isFactoryInitCompleteFromFiles(syncedFiles)) {
    await prisma.project
      .update({
        where: { id: project.id },
        data: { initStatus: "complete" },
      })
      .catch(() => {});
    return true;
  }

  return false;
}

/**
 * Builds the Stage 1 interactive `/factory init` prompt (Once per project, with a person).
 */
export function buildProjectInitPrompt(params: {
  projectName: string;
  description?: string | null;
}): string {
  const lines: string[] = [
    "/factory init",
    "",
    `Project: ${params.projectName}`,
    ...(params.description?.trim() ? [`Description: ${params.description.trim()}`] : []),
    "Follow the `factory-init` skill step by step (Stage 1: Once per project, interactive with the person).",
    "Complete `.factory/project.json`, `.factory/product.md`, `.factory/decisions.md`, `DESIGN.md`, `CODING_STANDARDS.md`, project agent instructions (`GEMINI.md` / `CLAUDE.md`), stack skills, and `.factory/init.json` verified by `project-check.mjs --run` and `init-status.mjs` (`complete`).",
    "",
    SF_QUESTIONS_PROMPT_CONTRACT,
  ];
  return lines.join("\n");
}

/**
 * Builds the Stage 2 interactive `/factory clarify` prompt (Per feature, with a person).
 * Every question, mockup, readiness check (`ready-check.mjs`), and planner dry-run
 * (`questionsOnly: true` -> `.factory/plans/<issueKey>.json`) is settled here before
 * the ticket enters the unattended Factory build loop.
 */
export function buildIssueClarifyPrompt(params: {
  projectName: string;
  issue: {
    issueKey: string;
    title: string;
    goal: string;
    body: string;
    criteriaJson: string;
    summary?: string | null;
  };
}): string {
  const criteria = safeJsonParse<Array<{ id: string; text: string }>>(params.issue.criteriaJson, []);
  const lines: string[] = [
    `/factory clarify ${params.issue.issueKey}: ${params.issue.title}`,
    "",
    `Project: ${params.projectName}`,
    "Follow the `factory-clarify` skill step by step (Stage 2: Per feature, interactive with the person).",
    "",
    "Current ticket draft:",
    `- Key: ${params.issue.issueKey}`,
    `- Title: ${params.issue.title}`,
    ...(params.issue.goal?.trim() ? [`- Goal: ${params.issue.goal.trim()}`] : []),
  ];

  if (criteria.length > 0) {
    lines.push(
      "- Acceptance Criteria:",
      ...criteria.map((c) => `  - ${c.id}: ${c.text}`),
    );
  }

  if (params.issue.body?.trim()) {
    lines.push("", "Current Specification:", params.issue.body.trim());
  }

  if (params.issue.summary?.trim()) {
    lines.push(
      "",
      "Open questions / blocker from previous run (resolve these first):",
      params.issue.summary.trim(),
    );
  }

  lines.push(
    "",
    "When grilling is complete:",
    "1. Finalize the ticket (`C1..Cn`, Data & API, Permissions, Copy, UI & states, Out of scope, Depends on) and build a clickable self-contained HTML prototype in `.factory/prototypes/<slug>/index.html` (referenced by an ```sf-prototype JSON block) whenever any screen is new or changes layout/states.",
    "2. Run `ready-check.mjs --body-file` (when present) and verify every state (`normal`, `empty`, `loading`, `error`, `no permission`) matches the criteria.",
    "3. Present the package (ticket, interactive prototype, plan summary) for the user to click through and approve. Once approved, include the updated ticket in an ```sf-tickets JSON block (keeping the exact issueKey `" +
      params.issue.issueKey +
      "`) so Software Factory updates the Kanban card, and tell the user to click **Approve → Ready** to hand it to the unattended Factory build loop.",
    "",
    SF_PROTOTYPE_PROMPT_CONTRACT,
    "",
    SF_QUESTIONS_PROMPT_CONTRACT,
  );

  return lines.join("\n");
}
