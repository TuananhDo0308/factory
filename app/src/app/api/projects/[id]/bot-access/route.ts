import { NextResponse } from "next/server";
import { ensureFactoryBotCollaborator } from "@/lib/bot-access";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/session";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const project = await prisma.project.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (!project.githubFullName || !project.githubOwner) {
    return NextResponse.json(
      { error: "This project is not connected to a GitHub repository" },
      { status: 400 },
    );
  }

  const parts = project.githubFullName.split("/");
  const owner = parts[0] || project.githubOwner;
  const repo = parts[1];
  if (!repo) {
    return NextResponse.json({ error: "Invalid GitHub repository name" }, { status: 400 });
  }

  const botAccess = await ensureFactoryBotCollaborator({
    userAccessToken: session.githubAccessToken,
    owner,
    repo,
    existingInvitationId: project.botInvitationId,
  });

  const updated = await prisma.project.update({
    where: { id: project.id },
    data: {
      botGithubUsername: botAccess.botGithubUsername,
      botAccessStatus: botAccess.botAccessStatus,
      botAccessError: botAccess.botAccessError,
      botInvitationId: botAccess.botInvitationId,
    },
  });

  return NextResponse.json({ project: updated });
}
