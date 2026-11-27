import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest, resolveUserProject } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { issueRealtimePublishGrant } from "@/lib/realtime";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
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

  const runKey = str(body.run || body.runKey);
  if (!runKey) {
    return NextResponse.json({ error: "run is required" }, { status: 400 });
  }

  const project = await resolveUserProject(
    auth.user.id,
    {
      projectId: str(body.projectId) || undefined,
      project: str(body.project) || undefined,
      localPath: str(body.repo || body.localPath) || undefined,
      runKey,
    },
    { write: true },
  );
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const run = await prisma.factoryRun.findUnique({
    where: { projectId_runKey: { projectId: project.id, runKey } },
    select: { id: true },
  });
  if (!run) {
    return NextResponse.json(
      { error: "Run not found. Only sessions created on Software Factory Web can stream." },
      { status: 404 },
    );
  }

  const grant = await issueRealtimePublishGrant(run.id);
  return NextResponse.json({ ok: true, ...grant });
}
