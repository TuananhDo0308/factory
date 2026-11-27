import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest, resolveUserProject } from "@/lib/api-auth";
import { upsertProjectContextFiles } from "@/lib/context-lake";
import { emitFactoryEvent } from "@/lib/events";

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

  const rawFiles = Array.isArray(body.files) ? body.files : null;
  if (!rawFiles) {
    return NextResponse.json({ error: "files array is required" }, { status: 400 });
  }

  const project = await resolveUserProject(auth.user.id, {
    projectId: str(body.projectId) || undefined,
    project: str(body.project) || undefined,
    localPath: str(body.repo || body.localPath) || undefined,
  });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const parsedFiles = rawFiles
    .filter((f): f is Record<string, unknown> => Boolean(f && typeof f === "object" && !Array.isArray(f)))
    .map((f) => ({
      path: str(f.path),
      content: typeof f.content === "string" ? f.content : "",
      bytes: typeof f.bytes === "number" ? f.bytes : undefined,
      sha: str(f.sha) || undefined,
    }))
    .filter((f) => f.path.length > 0);

  const source =
    body.source === "github" || body.source === "local" ? body.source : "daemon";
  const result = await upsertProjectContextFiles({
    projectId: project.id,
    files: parsedFiles,
    source,
    replaceAll: body.replaceAll !== false,
  });

  emitFactoryEvent({
    type: "context:updated",
    userId: auth.user.id,
    projectId: project.id,
    payload: { count: result.savedCount, source },
  });

  return NextResponse.json({
    ok: true,
    projectId: project.id,
    savedCount: result.savedCount,
  });
}
