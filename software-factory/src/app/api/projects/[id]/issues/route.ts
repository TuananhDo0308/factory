import { type NextRequest, NextResponse } from "next/server";
import { emitFactoryEvent } from "@/lib/events";
import { prisma } from "@/lib/prisma";
import { serializeProjectIssue } from "@/lib/project-stats";
import { getCurrentSession } from "@/lib/session";
import { getProjectAccess } from "@/lib/team-access";
import {
  classifyIssueTriage,
  normalizeCriteria,
  normalizeDependsOn,
} from "@/lib/triage";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

async function nextIssueKey(projectId: string): Promise<string> {
  const existing = await prisma.projectIssue.findMany({
    where: { projectId },
    select: { issueKey: true },
  });
  let maxNum = 0;
  for (const row of existing) {
    const m = /^I(\d+)$/i.exec(row.issueKey.trim());
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > maxNum) maxNum = n;
    }
  }
  return `I${maxNum + 1}`;
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const access = await getProjectAccess(session.user, id);
  if (!access) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  const project = access.project;

  const issues = await prisma.projectIssue.findMany({
    where: { projectId: project.id },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });

  return NextResponse.json({ issues: issues.map(serializeProjectIssue) });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const access = await getProjectAccess(session.user, id);
  if (!access) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (!access.canWrite) {
    return NextResponse.json({ error: "Viewer role cannot create issues" }, { status: 403 });
  }
  const project = access.project;

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

  const title = str(body.title);
  if (!title) {
    return NextResponse.json({ error: "Issue title is required" }, { status: 400 });
  }

  const issueKey = str(body.issueKey || body.key) || (await nextIssueKey(project.id));
  const goal = str(body.goal) || title;
  const issueBody = str(body.body || body.description);
  const criteria = normalizeCriteria(body.criteria);
  const dependsOn = normalizeDependsOn(body.dependsOn);
  const thinking = str(body.thinking) || null;
  const summary = str(body.summary) || null;
  const requestedMissionId = str(body.missionId) || null;
  let validMissionId: string | null = null;
  if (requestedMissionId) {
    const mission = await prisma.mission.findFirst({
      where: { id: requestedMissionId, projectId: project.id },
      select: { id: true },
    });
    if (mission) validMissionId = mission.id;
  }

  const triage = classifyIssueTriage({
    title,
    goal,
    body: issueBody,
    criteriaCount: criteria.length,
    priority: body.priority,
    complexity: body.complexity,
    tier: body.tier,
    autonomy: body.autonomy,
    status: body.status,
    engine: project.engine || "antigravity",
  });

  const modelPlan =
    typeof body.modelPlan === "object" && body.modelPlan !== null && !Array.isArray(body.modelPlan)
      ? (body.modelPlan as Record<string, string>)
      : triage.modelPlan;

  const created = await prisma.projectIssue.upsert({
    where: { projectId_issueKey: { projectId: project.id, issueKey: issueKey.slice(0, 64) } },
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
      thinking,
      summary,
      ...(validMissionId ? { missionId: validMissionId } : {}),
    },
    create: {
      projectId: project.id,
      missionId: validMissionId,
      issueKey: issueKey.slice(0, 64),
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
      thinking,
      summary,
    },
  });

  emitFactoryEvent({ type: "issue:updated", userId: session.user.id, projectId: project.id });

  return NextResponse.json({ issue: serializeProjectIssue(created) }, { status: 201 });
}
