import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest, resolveUserProject } from "@/lib/api-auth";
import { dispatchReadyIssuesForProject, getProjectAutoApprove } from "@/lib/auto-dispatch";
import { emitFactoryEvent } from "@/lib/events";
import { prisma } from "@/lib/prisma";
import { serializeProjectIssue } from "@/lib/project-stats";
import {
  classifyIssueTriage,
  normalizeCriteria,
  normalizeDependsOn,
} from "@/lib/triage";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const isObj = typeof rawBody === "object" && rawBody !== null && !Array.isArray(rawBody);
  const body = isObj ? (rawBody as Record<string, unknown>) : {};
  const rawIssues = Array.isArray(rawBody)
    ? rawBody
    : Array.isArray(body.issues)
      ? body.issues
      : null;

  if (!rawIssues || rawIssues.length === 0) {
    return NextResponse.json(
      { error: "Provide a non-empty issues array (either top-level or under `issues`)" },
      { status: 400 },
    );
  }

  const project = await resolveUserProject(auth.user.id, {
    projectId: str(body.projectId) || undefined,
    project: str(body.project) || undefined,
    localPath: str(body.repo || body.localPath) || undefined,
  });
  if (!project) {
    return NextResponse.json(
      {
        error:
          "Project not found. Pass --project <slug|owner/repo> or --repo <path> matching a project in Software Factory.",
      },
      { status: 404 },
    );
  }

  const autoApprove = await getProjectAutoApprove(project.id);
  const rawDefaultStatus = str(body.defaultStatus) || undefined;
  const defaultStatus =
    project.autoDispatch && autoApprove && rawDefaultStatus === "backlog"
      ? "ready"
      : rawDefaultStatus;
  const requestedMissionId = str(body.missionId) || null;
  let validMissionId: string | null = null;
  if (requestedMissionId) {
    const m = await prisma.mission.findFirst({
      where: { id: requestedMissionId, projectId: project.id },
      select: { id: true },
    });
    if (m) validMissionId = m.id;
  }

  const saved = [];
  for (let i = 0; i < rawIssues.length; i += 1) {
    const item = rawIssues[i];
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const title = str(rec.title || rec.name);
    if (!title) continue;

    const issueKey = (str(rec.issueKey || rec.key || rec.id) || `I${i + 1}`).slice(0, 64);
    const goal = str(rec.goal || rec.objective) || title;
    const issueBody = str(rec.body || rec.description || rec.details);
    const criteria = normalizeCriteria(rec.criteria || rec.acceptanceCriteria);
    const dependsOn = normalizeDependsOn(rec.dependsOn || rec.depends_on || rec.dependencies);
    const thinking = str(rec.thinking || rec.reasoning || rec.notes) || null;
    const summary = str(rec.summary) || null;
    const currentPhase = str(rec.currentPhase || rec.phase) || null;
    const runKey = str(rec.runKey || rec.run) || null;

    const triage = classifyIssueTriage({
      title,
      goal,
      body: issueBody,
      criteriaCount: criteria.length,
      priority: rec.priority,
      complexity: rec.complexity || rec.size,
      tier: rec.tier,
      autonomy: rec.autonomy,
      status: rec.status ?? defaultStatus,
      engine: project.engine || "antigravity",
    });

    const modelPlan =
      typeof rec.modelPlan === "object" && rec.modelPlan !== null && !Array.isArray(rec.modelPlan)
        ? (rec.modelPlan as Record<string, string>)
        : triage.modelPlan;

    const row = await prisma.projectIssue.upsert({
      where: { projectId_issueKey: { projectId: project.id, issueKey } },
      update: {
        title: title.slice(0, 240),
        goal: goal.slice(0, 500),
        body: issueBody,
        criteriaJson: JSON.stringify(criteria),
        dependsOnJson: JSON.stringify(dependsOn),
        priority: triage.priority,
        complexity: triage.complexity,
        tier: triage.tier,
        tierScore: triage.tierScore,
        autonomy: triage.autonomy,
        modelPlanJson: JSON.stringify(modelPlan),
        status: triage.status,
        currentPhase: currentPhase ?? undefined,
        runKey: runKey ?? undefined,
        summary: summary ?? undefined,
        thinking: thinking ?? undefined,
        ...(validMissionId ? { missionId: validMissionId } : {}),
      },
      create: {
        projectId: project.id,
        missionId: validMissionId,
        issueKey,
        title: title.slice(0, 240),
        goal: goal.slice(0, 500),
        body: issueBody,
        criteriaJson: JSON.stringify(criteria),
        dependsOnJson: JSON.stringify(dependsOn),
        priority: triage.priority,
        complexity: triage.complexity,
        tier: triage.tier,
        tierScore: triage.tierScore,
        autonomy: triage.autonomy,
        modelPlanJson: JSON.stringify(modelPlan),
        status: triage.status,
        currentPhase,
        runKey,
        summary,
        thinking,
      },
    });
    saved.push(serializeProjectIssue(row));
  }

  emitFactoryEvent({
    type: "issue:updated",
    userId: auth.user.id,
    projectId: project.id,
    payload: { count: saved.length },
  });

  if (project.autoDispatch && autoApprove && saved.length > 0) {
    await dispatchReadyIssuesForProject({
      projectId: project.id,
      actorUserId: auth.user.id,
      actorGithubLogin: auth.user.githubLogin,
    }).catch(() => {});
  }

  return NextResponse.json({
    ok: true,
    project: { id: project.id, slug: project.slug, name: project.name },
    count: saved.length,
    issues: saved,
  });
}
