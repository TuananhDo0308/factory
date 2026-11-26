import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { getProjectBoardSnapshot } from "@/lib/board-data";
import { getProjectAccess } from "@/lib/team-access";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const access = await getProjectAccess(auth.user, id);
  if (!access) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const snapshot = await getProjectBoardSnapshot({
    projectId: access.project.id,
    viewerUserId: auth.user.id,
    viewerGithubLogin: auth.user.githubLogin,
  });
  if (!snapshot) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  return NextResponse.json({ ok: true, board: snapshot });
}
