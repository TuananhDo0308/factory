import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest, resolveUserProject } from "@/lib/api-auth";
import { emitFactoryEvent } from "@/lib/events";
import { prisma } from "@/lib/prisma";

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
  const kind = str(body.kind) || "log";
  const title = str(body.title) || kind;
  const pathOrUrl = str(body.pathOrUrl || body.path || body.url);
  if (!runKey || !pathOrUrl) {
    return NextResponse.json({ error: "run and pathOrUrl are required" }, { status: 400 });
  }

  const project = await resolveUserProject(auth.user.id, {
    projectId: str(body.projectId) || undefined,
    project: str(body.project) || undefined,
    localPath: str(body.repo || body.localPath) || undefined,
    runKey,
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const run = await prisma.factoryRun.findUnique({
    where: { projectId_runKey: { projectId: project.id, runKey } },
  });
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const artifact = await prisma.runArtifact.create({
    data: {
      runId: run.id,
      kind: kind.slice(0, 40),
      title: title.slice(0, 180),
      pathOrUrl: pathOrUrl.slice(0, 2000),
      mimeType: str(body.mimeType) || null,
      metaJson: body.meta !== undefined ? JSON.stringify(body.meta) : null,
    },
  });

  emitFactoryEvent({
    type: "artifact:created",
    userId: auth.user.id,
    projectId: project.id,
    runId: run.id,
    payload: { artifactId: artifact.id, kind: artifact.kind },
  });

  return NextResponse.json({ ok: true, artifact }, { status: 201 });
}
