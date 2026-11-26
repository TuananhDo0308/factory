import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest, resolveUserProject } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { serializePrototype, upsertProjectPrototype } from "@/lib/prototype-server";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const project = await resolveUserProject(auth.user.id, {
    projectId: request.nextUrl.searchParams.get("projectId") || undefined,
    project: request.nextUrl.searchParams.get("project") || undefined,
    localPath: request.nextUrl.searchParams.get("repo") || undefined,
    runKey: request.nextUrl.searchParams.get("run") || undefined,
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const rows = await prisma.projectPrototype.findMany({
    where: { projectId: project.id },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({
    ok: true,
    prototypes: rows.map(serializePrototype),
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

  const htmlContent =
    typeof body.htmlContent === "string"
      ? body.htmlContent
      : typeof body.html === "string"
        ? body.html
        : "";
  if (!htmlContent.trim()) {
    return NextResponse.json({ error: "htmlContent (or html) is required" }, { status: 400 });
  }

  const runKey = str(body.run || body.runKey);
  const project = await resolveUserProject(auth.user.id, {
    projectId: str(body.projectId) || undefined,
    project: str(body.project) || undefined,
    localPath: str(body.repo || body.localPath) || undefined,
    runKey: runKey || undefined,
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  let runId: string | null = str(body.runId) || null;
  if (!runId && runKey) {
    const run = await prisma.factoryRun.findUnique({
      where: { projectId_runKey: { projectId: project.id, runKey } },
      select: { id: true },
    });
    runId = run?.id ?? null;
  }

  const issueKeys = Array.isArray(body.issueKeys)
    ? body.issueKeys.map((k) => str(k)).filter(Boolean)
    : str(body.issueKey)
      ? [str(body.issueKey)]
      : [];

  const manifest =
    body.manifest && typeof body.manifest === "object" && !Array.isArray(body.manifest)
      ? (body.manifest as Record<string, unknown>)
      : {
          ...(Array.isArray(body.screens) ? { screens: body.screens } : {}),
          ...(Array.isArray(body.notShown) ? { notShown: body.notShown } : {}),
          ...(Array.isArray(body.themes) ? { themes: body.themes } : {}),
          ...(body.drawnFrom ? { drawnFrom: body.drawnFrom } : {}),
          ...(str(body.source) ? { source: str(body.source) } : {}),
          ...(str(body.htmlPath) ? { htmlPath: str(body.htmlPath) } : {}),
        };

  const saved = await upsertProjectPrototype({
    projectId: project.id,
    userId: auth.user.id,
    runId,
    slug: str(body.slug) || undefined,
    title: str(body.title) || "Interactive Prototype",
    kind: str(body.kind) || undefined,
    binding: str(body.binding) || undefined,
    status: str(body.status) || undefined,
    issueKeys,
    htmlContent,
    manifest,
    localPath: str(body.htmlPath || body.filePath) || undefined,
    branchName: str(body.branchName) || undefined,
    commitSha: str(body.commitSha) || undefined,
  });

  return NextResponse.json({ ok: true, prototype: saved }, { status: 201 });
}
