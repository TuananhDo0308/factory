import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { emitFactoryEvent } from "@/lib/events";
import { prisma } from "@/lib/prisma";
import { getReviewsData } from "@/lib/workspace-data";

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const prs = await getReviewsData(auth.user.id);
  return NextResponse.json({ ok: true, pullRequests: prs });
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

  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  const number = Number(body.number);
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const headBranch = typeof body.headBranch === "string" ? body.headBranch.trim() : "";

  if (!projectId || !Number.isInteger(number) || !title || !headBranch) {
    return NextResponse.json(
      { error: "projectId, number, title, and headBranch are required" },
      { status: 400 },
    );
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: auth.user.id },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const pr = await prisma.pullRequest.upsert({
    where: { projectId_number: { projectId: project.id, number } },
    update: {
      title,
      url: typeof body.url === "string" ? body.url : undefined,
      headBranch,
      baseBranch: typeof body.baseBranch === "string" ? body.baseBranch : "main",
      state: typeof body.state === "string" ? body.state : "open",
      ciStatus: typeof body.ciStatus === "string" ? body.ciStatus : "pending",
      mergeDecision: typeof body.mergeDecision === "string" ? body.mergeDecision : "person",
      judgeVerdict: typeof body.judgeVerdict === "string" ? body.judgeVerdict : undefined,
      judgeReportJson:
        body.judgeReport !== undefined ? JSON.stringify(body.judgeReport) : undefined,
      walkthroughMd:
        typeof body.walkthroughMd === "string" ? body.walkthroughMd : undefined,
      diffSummary: typeof body.diffSummary === "string" ? body.diffSummary : undefined,
      additions: Number.isFinite(Number(body.additions)) ? Number(body.additions) : undefined,
      deletions: Number.isFinite(Number(body.deletions)) ? Number(body.deletions) : undefined,
      runId: typeof body.runId === "string" ? body.runId : undefined,
      issueId: typeof body.issueId === "string" ? body.issueId : undefined,
    },
    create: {
      projectId: project.id,
      number,
      title,
      url: typeof body.url === "string" ? body.url : null,
      headBranch,
      baseBranch: typeof body.baseBranch === "string" ? body.baseBranch : "main",
      state: typeof body.state === "string" ? body.state : "open",
      ciStatus: typeof body.ciStatus === "string" ? body.ciStatus : "pending",
      mergeDecision: typeof body.mergeDecision === "string" ? body.mergeDecision : "person",
      judgeVerdict: typeof body.judgeVerdict === "string" ? body.judgeVerdict : null,
      judgeReportJson:
        body.judgeReport !== undefined ? JSON.stringify(body.judgeReport) : null,
      walkthroughMd: typeof body.walkthroughMd === "string" ? body.walkthroughMd : null,
      diffSummary: typeof body.diffSummary === "string" ? body.diffSummary : null,
      additions: Number.isFinite(Number(body.additions)) ? Number(body.additions) : 0,
      deletions: Number.isFinite(Number(body.deletions)) ? Number(body.deletions) : 0,
      runId: typeof body.runId === "string" ? body.runId : null,
      issueId: typeof body.issueId === "string" ? body.issueId : null,
    },
  });

  emitFactoryEvent({
    type: "pr:updated",
    userId: auth.user.id,
    projectId: project.id,
    runId: pr.runId,
    payload: { prId: pr.id, number: pr.number, state: pr.state },
  });

  return NextResponse.json({ ok: true, pullRequest: pr }, { status: 201 });
}
