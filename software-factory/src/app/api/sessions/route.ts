import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import {
  validateIncomingAttachments,
  type StoredAttachmentRef,
} from "@/lib/attachments";
import {
  buildIssueFactoryPrompt,
  getProjectAutoApprove,
  isUnattendedFactoryMode,
} from "@/lib/auto-dispatch";
import { emitFactoryEvent } from "@/lib/events";
import { syncProjectInitStatus } from "@/lib/init-issue";
import { defaultModelForEngine } from "@/lib/models";
import { prisma } from "@/lib/prisma";
import { detectSkillFromPrompt } from "@/lib/skills";
import {
  accessibleProjectsWhere,
  getAccessibleRunners,
  getProjectAccess,
} from "@/lib/team-access";
import { safeJsonParse } from "@/lib/workspace-data";

const VALID_MODES = new Set([
  "ba",
  "init",
  "normal",
  "clarify",
  "factory",
  "mission",
  "ui-refine",
  "pr-judge",
]);
const VALID_AUTONOMIES = new Set(["off", "low", "medium", "high"]);

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectId = request.nextUrl.searchParams.get("projectId") || undefined;
  const status = request.nextUrl.searchParams.get("status") || undefined;

  const runs = await prisma.factoryRun.findMany({
    where: {
      project: accessibleProjectsWhere(auth.user.id, auth.user.githubLogin),
      ...(projectId ? { projectId } : {}),
      ...(status ? { status } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 60,
    include: {
      project: { select: { id: true, name: true, slug: true, engine: true } },
      agents: { select: { id: true, role: true, status: true } },
      _count: { select: { steps: true, interactions: { where: { status: "pending" } } } },
    },
  });

  return NextResponse.json({
    ok: true,
    runs: runs.map((r) => ({
      id: r.id,
      runKey: r.runKey,
      title: r.title,
      mode: r.mode,
      autonomy: r.autonomy,
      engine: r.engine,
      status: r.status,
      currentPhase: r.currentPhase,
      model: r.model,
      risk: r.risk,
      costUsd: r.costUsd,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      durationMs: r.durationMs,
      project: r.project,
      agentCount: r.agents.length,
      waitingCount: r._count.interactions,
      stepCount: r._count.steps,
      startedAt: r.startedAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
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

  const rawPrompt = str(body.prompt);
  const explicitTitle = str(body.title);
  const { attachments: validatedAttachments, error: attachmentError } = validateIncomingAttachments(
    body.attachments,
  );
  if (attachmentError) {
    return NextResponse.json({ error: attachmentError }, { status: 400 });
  }
  const prompt =
    rawPrompt ||
    (validatedAttachments.length > 0
      ? `Analyze the attached file${validatedAttachments.length === 1 ? "" : "s"} (${validatedAttachments.map((a) => a.name).join(", ")}).`
      : "");
  if (!prompt && !explicitTitle) {
    return NextResponse.json({ error: "Prompt, title, or attachment is required" }, { status: 400 });
  }

  let projectId = str(body.projectId);
  let project = null as Awaited<ReturnType<typeof prisma.project.findFirst>>;

  if (projectId) {
    const access = await getProjectAccess(auth.user, projectId);
    if (!access) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    if (!access.canWrite) {
      return NextResponse.json(
        { error: "Viewer role cannot launch sessions on this project" },
        { status: 403 },
      );
    }
    project = access.project;
  } else {
    project = await prisma.project.findFirst({
      where: accessibleProjectsWhere(auth.user.id, auth.user.githubLogin),
      orderBy: { updatedAt: "desc" },
    });
    if (project) {
      const access = await getProjectAccess(auth.user, project.id);
      if (access && !access.canWrite) {
        return NextResponse.json(
          { error: "Viewer role cannot launch sessions on this project" },
          { status: 403 },
        );
      }
    }
  }

  if (!project) {
    // Create a default workspace project on-the-fly if none exists yet.
    project = await prisma.project.create({
      data: {
        userId: auth.user.id,
        name: "Default Workspace",
        slug: "default-workspace",
        source: "local",
        engine: str(body.engine) === "claude" ? "claude" : "antigravity",
        defaultBranch: "main",
      },
    });
  }
  projectId = project.id;

  const detectedSkill = detectSkillFromPrompt(prompt);
  const modeRaw = detectedSkill?.skill.mode || str(body.mode) || "factory";
  const mode = VALID_MODES.has(modeRaw) ? modeRaw : "factory";
  const autonomyRaw = isUnattendedFactoryMode(mode) ? "high" : str(body.autonomy) || "high";
  const autonomy = VALID_AUTONOMIES.has(autonomyRaw) ? autonomyRaw : "high";
  const requestedEngine = str(body.engine);
  const engine =
    requestedEngine === "claude" || requestedEngine === "antigravity"
      ? requestedEngine
      : project.engine || "antigravity";
  const model = str(body.model) || defaultModelForEngine(engine);
  const targetBranch = str(body.branch) || project.defaultBranch || "main";
  const requestedWorktree = body.useWorktree !== false;
  const issueId = str(body.issueId) || null;
  const missionId = str(body.missionId) || null;
  const requestedRunnerId = str(body.runnerId) || null;

  // Load linked issue if provided (also enforces lock & pre-populates criteria + Factory prompt)
  let linkedIssue: Awaited<ReturnType<typeof prisma.projectIssue.findFirst>> = null;
  if (issueId) {
    linkedIssue = await prisma.projectIssue.findFirst({
      where: { id: issueId, projectId },
    });
    const activeIssueRun = await prisma.factoryRun.findFirst({
      where: {
        projectId,
        issueId,
        status: { in: ["running", "queued", "awaiting_input"] },
      },
      include: {
        triggeredBy: { select: { githubLogin: true } },
        user: { select: { githubLogin: true } },
      },
    });
    if (activeIssueRun) {
      const who =
        activeIssueRun.triggeredBy?.githubLogin || activeIssueRun.user?.githubLogin || "another member";
      return NextResponse.json(
        {
          error: `Issue is already being executed by @${who}. Watch live instead.`,
          activeRunId: activeIssueRun.id,
        },
        { status: 409 },
      );
    }
  }

  const titleBase =
    explicitTitle ||
    (detectedSkill?.body
      ? detectedSkill.skill.mode === "ba"
        ? `BA: ${detectedSkill.body.split(/\r?\n/)[0]}`
        : detectedSkill.body.split(/\r?\n/)[0]
      : prompt.split(/\r?\n/)[0]) ||
    "New Session";
  const title = titleBase.slice(0, 140);
  const runKey = linkedIssue
    ? `${new Date().toISOString().slice(0, 10)}-${linkedIssue.issueKey.toLowerCase().replace(/[^a-z0-9]+/g, "")}-${Math.random().toString(36).slice(2, 6)}`
    : `${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 8)}`;
  const autoApprove =
    mode === "factory" ? await getProjectAutoApprove(projectId) : false;
  if (linkedIssue && mode === "factory") {
    const initComplete = await syncProjectInitStatus(project);
    if (!initComplete) {
      return NextResponse.json(
        {
          error:
            "Project has not completed /factory init yet. Run Factory Init before starting unattended Factory builds.",
          code: "INIT_REQUIRED",
        },
        { status: 412 },
      );
    }
    if (linkedIssue.status === "backlog" || linkedIssue.status === "needs_human") {
      return NextResponse.json(
        {
          error: `Ticket ${linkedIssue.issueKey} must be clarified and approved to Ready before starting Factory build.`,
          code: "CLARIFY_REQUIRED",
        },
        { status: 412 },
      );
    }
  }
  const effectivePrompt =
    linkedIssue && mode === "factory"
      ? buildIssueFactoryPrompt(linkedIssue, runKey, { autoApprove, targetBranch })
      : prompt || title;

  // For quick `normal` chat sessions, attach a compact project snapshot (issues + recent runs)
  // in `contextNote` (kept out of the UI prompt) so the AI answers immediately without running
  // sqlite3 against dev.db, and knows to use the `software-factory` MCP tools for fresh details.
  let contextNote: string | undefined;
  if (mode === "normal" && !linkedIssue) {
    const [projectIssues, recentRuns] = await Promise.all([
      prisma.projectIssue.findMany({
        where: { projectId },
        orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
        take: 40,
        select: {
          issueKey: true,
          status: true,
          priority: true,
          tier: true,
          title: true,
          goal: true,
        },
      }),
      prisma.factoryRun.findMany({
        where: { projectId },
        orderBy: { updatedAt: "desc" },
        take: 8,
        select: {
          runKey: true,
          mode: true,
          status: true,
          currentPhase: true,
          title: true,
        },
      }),
    ]);
    const ctxLines: string[] = [
      `[Software Factory Project Context]`,
      `Project: ${project.name} (slug: "${project.slug}", branch: "${targetBranch}"${project.localPath ? `, path: ${project.localPath}` : ""})`,
      `To inspect live issues (including full body & criteria), runs, inbox, or lessons, ALWAYS use the \`software-factory\` MCP tools (\`sf_list_issues\`, \`sf_list_runs\`, \`sf_workspace_summary\`, \`sf_get_inbox\`, \`sf_get_lessons\`) or \`sf issues list --project ${project.slug} --json\`. NEVER open or query \`dev.db\` with \`sqlite3\`.`,
      `This chat runs headless over Software Factory (do NOT call interactive-only \`ask_question\` / \`AskUserQuestion\`). Whenever you need to ask the user multiple-choice questions, end your reply with a fenced \`\`\`sf-questions JSON block ({ "questions": [{ "id": "Q1", "header": "Topic", "question": "...", "multiSelect": false, "options": [{ "label": "...", "description": "...", "recommended": true }], "allowOther": true }] }) so the UI renders clickable options.`,
    ];
    if (projectIssues.length > 0) {
      ctxLines.push("Current Kanban issues:");
      for (const iss of projectIssues) {
        const goalShort = iss.goal && iss.goal !== iss.title ? ` — ${iss.goal.slice(0, 110)}` : "";
        ctxLines.push(`- ${iss.issueKey} [${iss.status}] (${iss.priority}/${iss.tier}) ${iss.title}${goalShort}`);
      }
    } else {
      ctxLines.push("Current Kanban issues: (none yet)");
    }
    if (recentRuns.length > 0) {
      ctxLines.push("Recent Factory runs:");
      for (const r of recentRuns) {
        ctxLines.push(`- ${r.runKey} [${r.status}/${r.currentPhase}] (${r.mode}) ${r.title}`);
      }
    }
    contextNote = ctxLines.join("\n");
  }
  const initialCriteriaJson = linkedIssue
    ? (() => {
        const list = safeJsonParse<Array<{ id: string; text: string }>>(linkedIssue.criteriaJson, []);
        return list.length > 0
          ? JSON.stringify(list.map((c) => ({ id: c.id, text: c.text, status: "" })))
          : null;
      })()
    : null;

  // Runner Selection: prefer explicit runnerId (if accessible & online), then own online runner,
  // then an online shared team runner on this project!
  const cutoffMs = Date.now() - 65_000;
  const candidateRunners = (
    await getAccessibleRunners(auth.user.id, {
      projectId,
      githubLogin: auth.user.githubLogin,
    })
  ).filter((r) => r.status === "online" && r.lastHeartbeatAt.getTime() > cutoffMs);

  let onlineRunner = requestedRunnerId
    ? candidateRunners.find((r) => r.id === requestedRunnerId) ?? null
    : null;
  if (!onlineRunner && project.defaultRunnerId) {
    onlineRunner = candidateRunners.find((r) => r.id === project.defaultRunnerId) ?? null;
  }
  if (!onlineRunner) {
    const ownOnline = candidateRunners
      .filter((r) => r.userId === auth.user.id)
      .sort((a, b) => a.activeRuns - b.activeRuns);
    const sharedOnline = candidateRunners
      .filter((r) => r.userId !== auth.user.id && r.visibility === "team")
      .sort((a, b) => a.activeRuns - b.activeRuns);
    onlineRunner = ownOnline[0] ?? sharedOnline[0] ?? null;
  }

  // Safety guardrail: require an online daemon unless the caller explicitly opts into offline queuing.
  const allowOfflineQueue = body.allowOfflineQueue === true;
  if (!onlineRunner && !allowOfflineQueue) {
    return NextResponse.json(
      {
        error:
          "No local daemon is connected. Start `sf daemon` on your machine (or connect a runner in Settings → Runners) before sending.",
        code: "NO_RUNNER_ONLINE",
      },
      { status: 503 },
    );
  }

  // Safety guardrail: always enforce isolated git worktree when dispatching onto a teammate's shared daemon!
  const isSharedDispatch = Boolean(onlineRunner && onlineRunner.userId !== auth.user.id);
  const useWorktree =
    mode === "ba" || mode === "init" ? false : isSharedDispatch ? true : requestedWorktree;

  const initialStatus = "queued";
  const initialPhase =
    mode === "ba"
      ? "BA Planning"
      : mode === "init"
        ? "Factory Init"
        : mode === "clarify"
          ? "Clarify"
          : mode === "ui-refine"
            ? "Refine"
            : mode === "pr-judge"
              ? "Judge"
              : "Spec";

  const created = await prisma.$transaction(async (tx) => {
    const run = await tx.factoryRun.create({
      data: {
        projectId,
        userId: project.userId,
        triggeredById: auth.user.id,
        issueId,
        missionId,
        runnerMachineId: onlineRunner?.id ?? null,
        runKey,
        title,
        prompt: effectivePrompt,
        mode,
        autonomy,
        engine,
        status: initialStatus,
        currentPhase: initialPhase,
        targetBranch,
        worktreePath: useWorktree
          ? `.agents/worktrees/${mode}-${runKey}`
          : project.localPath,
        model,
        criteriaJson: initialCriteriaJson,
        lastHeartbeatAt: new Date(),
      },
    });

    const orch = await tx.runAgent.create({
      data: {
        runId: run.id,
        agentKey: "orchestrator",
        name:
          mode === "ba"
            ? "BA Ticket Planner"
            : mode === "mission"
              ? "Mission Orchestrator"
              : "Session Orchestrator",
        role: "orchestrator",
        level: 0,
        model,
        status: onlineRunner ? "working" : "waiting_on_you",
        activity: onlineRunner
          ? `Dispatched to ${isSharedDispatch ? "shared " : ""}runner "${onlineRunner.name}" (${engine})`
          : "Waiting for local `sf daemon` or CLI session attachment",
      },
    });

    const storedAttachments: StoredAttachmentRef[] = [];
    for (let idx = 0; idx < validatedAttachments.length; idx += 1) {
      const att = validatedAttachments[idx];
      const artifact = await tx.runArtifact.create({
        data: {
          runId: run.id,
          kind: "attachment",
          title: att.name.slice(0, 180),
          pathOrUrl: `.factory/attachments/${runKey}/${idx + 1}-${att.name}`,
          mimeType: att.mimeType,
          contentText: att.isText ? att.textContent : null,
          contentBase64: att.isText ? null : att.base64,
          metaJson: JSON.stringify({ size: att.bytes, source: "session_prompt" }),
        },
      });
      storedAttachments.push({
        artifactId: artifact.id,
        name: att.name,
        mimeType: att.mimeType,
        size: att.bytes,
      });
    }

    await tx.runStep.create({
      data: {
        runId: run.id,
        runAgentId: orch.id,
        seq: 1,
        step: "session-created",
        phase: initialPhase,
        status: "started",
        role: "orchestrator",
        model,
        label: `${mode} · ${engine} · autonomy:${autonomy}`,
        summary: (prompt || title).slice(0, 500),
        dataJson:
          storedAttachments.length > 0
            ? JSON.stringify({ kind: "session_created", attachments: storedAttachments })
            : null,
      },
    });

    if (issueId) {
      await tx.projectIssue
        .update({
          where: { id: issueId },
          data: { status: "in_progress", currentPhase: initialPhase, runKey },
        })
        .catch(() => {});
    }

    const commandType =
      mode === "ba"
        ? "run_ba"
        : mode === "clarify"
          ? "run_clarify"
          : mode === "ui-refine"
            ? "run_ui_refine"
            : mode === "pr-judge"
              ? "run_pr_judge"
              : "start_run";

    await tx.runnerCommand.create({
      data: {
        userId: onlineRunner?.userId ?? project.userId,
        runnerMachineId: onlineRunner?.id ?? null,
        projectId,
        runId: run.id,
        type: commandType,
        payloadJson: JSON.stringify({
          runKey,
          projectId,
          projectSlug: project.slug,
          prompt: effectivePrompt,
          ...(contextNote ? { contextNote } : {}),
          ...(storedAttachments.length > 0 ? { attachments: storedAttachments } : {}),
          mode,
          autonomy,
          engine,
          model,
          branch: targetBranch,
          useWorktree,
          localPath: project.localPath,
          issueId,
          issueKey: linkedIssue?.issueKey ?? null,
          missionId,
        }),
        status: "pending",
      },
    });

    return run;
  });

  if (issueId) {
    emitFactoryEvent({
      type: "issue:updated",
      userId: auth.user.id,
      projectId,
      runId: created.id,
      payload: { issueId, status: "in_progress", phase: initialPhase },
    });
  }
  emitFactoryEvent({
    type: "run:updated",
    userId: auth.user.id,
    projectId,
    runId: created.id,
    payload: { status: created.status, mode },
  });

  return NextResponse.json(
    {
      ok: true,
      run: { id: created.id, runKey: created.runKey, status: created.status },
      dispatchedToRunner: onlineRunner?.name ?? null,
    },
    { status: 201 },
  );
}
