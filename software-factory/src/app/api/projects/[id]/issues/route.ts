import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeProjectIssue } from "@/lib/project-stats";
import { getCurrentSession } from "@/lib/session";
import { getProjectAccess } from "@/lib/team-access";

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
    orderBy: [{ epicNumber: "desc" }, { wave: "asc" }, { githubIssueNumber: "asc" }, { createdAt: "asc" }],
  });

  return NextResponse.json({ issues: issues.map(serializeProjectIssue) });
}
