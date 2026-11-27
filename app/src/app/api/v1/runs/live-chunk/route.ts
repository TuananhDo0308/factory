import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest, resolveUserProject } from "@/lib/api-auth";
import { emitFactoryEvent } from "@/lib/events";
import { prisma } from "@/lib/prisma";
import { coalesceLiveChunks, type LiveChunkEvent } from "@/lib/realtime";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

// Short-lived in-memory cache for run ownership checks so high-frequency local SSE chunks
// do zero Postgres queries per packet.
const runMetaCache = new Map<
  string,
  { runId: string; projectId: string; userId: string; expiresAt: number }
>();

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
  const rawChunks = Array.isArray(body.chunks)
    ? (body.chunks as LiveChunkEvent[])
    : body.chunk && typeof body.chunk === "object"
      ? [body.chunk as LiveChunkEvent]
      : [];
  if (!runKey || rawChunks.length === 0) {
    return NextResponse.json({ error: "run and chunks are required" }, { status: 400 });
  }

  const projectIdHint = str(body.projectId) || undefined;
  const cacheKey = `${auth.user.id}:${projectIdHint || ""}:${runKey}`;
  const now = Date.now();
  let meta = runMetaCache.get(cacheKey);
  if (!meta || meta.expiresAt < now) {
    const project = await resolveUserProject(
      auth.user.id,
      {
        projectId: projectIdHint,
        project: str(body.project) || undefined,
        localPath: str(body.repo || body.localPath) || undefined,
        runKey,
      },
      { write: true },
    );
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const run = await prisma.factoryRun.findUnique({
      where: { projectId_runKey: { projectId: project.id, runKey } },
      select: { id: true, projectId: true, userId: true },
    });
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

    meta = {
      runId: run.id,
      projectId: run.projectId,
      userId: run.userId,
      expiresAt: now + 5 * 60_000,
    };
    runMetaCache.set(cacheKey, meta);
    if (runMetaCache.size > 500) {
      const oldestKey = runMetaCache.keys().next().value;
      if (oldestKey) runMetaCache.delete(oldestKey);
    }
  }

  const chunks = coalesceLiveChunks(rawChunks.slice(0, 60));
  emitFactoryEvent({
    type: "live:chunk",
    userId: meta.userId,
    projectId: meta.projectId,
    runId: meta.runId,
    payload: { chunks },
  });

  return NextResponse.json({ ok: true, emitted: chunks.length });
}
