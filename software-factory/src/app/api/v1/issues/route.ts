import { type NextRequest, NextResponse } from "next/server";
import { authenticateBearer, resolveUserProject } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { serializeProjectIssue } from "@/lib/project-stats";

export async function GET(request: NextRequest) {
  const auth = await authenticateBearer(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const project = await resolveUserProject(auth.user.id, {
    projectId: sp.get("projectId") || undefined,
    project: sp.get("project") || undefined,
    localPath: sp.get("repo") || sp.get("localPath") || undefined,
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

  const issues = await prisma.projectIssue.findMany({
    where: { projectId: project.id },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });

  return NextResponse.json({
    ok: true,
    project: { id: project.id, slug: project.slug, name: project.name },
    issues: issues.map(serializeProjectIssue),
  });
}
