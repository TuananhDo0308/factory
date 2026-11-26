import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectId = request.nextUrl.searchParams.get("projectId") || undefined;
  const missions = await prisma.mission.findMany({
    where: { userId: auth.user.id, ...(projectId ? { projectId } : {}) },
    orderBy: { updatedAt: "desc" },
    include: {
      project: { select: { id: true, name: true, slug: true } },
      issues: { orderBy: [{ priority: "asc" }, { createdAt: "asc" }] },
      runs: { orderBy: { startedAt: "desc" }, take: 5 },
    },
  });

  return NextResponse.json({ ok: true, missions });
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
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!projectId || !title) {
    return NextResponse.json({ error: "projectId and title are required" }, { status: 400 });
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: auth.user.id },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const mission = await prisma.mission.create({
    data: {
      projectId: project.id,
      userId: auth.user.id,
      title: title.slice(0, 180),
      goal: typeof body.goal === "string" ? body.goal.trim().slice(0, 4000) : "",
      validationContractMd:
        typeof body.validationContractMd === "string"
          ? body.validationContractMd.trim().slice(0, 20_000)
          : "",
      autonomy: typeof body.autonomy === "string" ? body.autonomy.trim() : "medium",
      status: "planning",
    },
  });

  return NextResponse.json({ ok: true, mission }, { status: 201 });
}
