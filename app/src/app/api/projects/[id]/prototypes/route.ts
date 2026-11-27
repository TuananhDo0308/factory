import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { serializePrototype, upsertProjectPrototype } from "@/lib/prototype-server";
import { getProjectAccess } from "@/lib/team-access";

export const dynamic = "force-dynamic";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const access = await getProjectAccess(auth.user, id);
  if (!access) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const rows = await prisma.projectPrototype.findMany({
    where: { projectId: access.project.id },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({
    ok: true,
    prototypes: rows.map(serializePrototype),
  });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const access = await getProjectAccess(auth.user, id);
  if (!access) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (!access.canWrite) {
    return NextResponse.json({ error: "Viewer role cannot upload prototypes" }, { status: 403 });
  }

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
    return NextResponse.json({ error: "HTML content is required" }, { status: 400 });
  }

  const issueKeys = Array.isArray(body.issueKeys)
    ? body.issueKeys.map((k) => str(k)).filter(Boolean)
    : [];

  const saved = await upsertProjectPrototype({
    projectId: access.project.id,
    userId: auth.user.id,
    runId: str(body.runId) || null,
    slug: str(body.slug) || undefined,
    title: str(body.title) || "Imported Prototype",
    kind: str(body.kind) || "existing",
    binding: str(body.binding) || "flow",
    status: str(body.status) || "draft",
    issueKeys,
    htmlContent,
    manifest:
      body.manifest && typeof body.manifest === "object" && !Array.isArray(body.manifest)
        ? (body.manifest as Record<string, unknown>)
        : undefined,
    localPath: str(body.localPath) || undefined,
  });

  return NextResponse.json({ ok: true, prototype: saved }, { status: 201 });
}
