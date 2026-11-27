import { NextResponse } from "next/server";
import { listGitHubRepos } from "@/lib/github";
import { prisma } from "@/lib/prisma";
import { getCurrentSession, syncUserGitHubRepos } from "@/lib/session";

export async function POST() {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.githubAccessToken) {
    return NextResponse.json(
      { error: "GitHub token unavailable — please sign in again" },
      { status: 401 },
    );
  }

  try {
    const repos = await listGitHubRepos(session.githubAccessToken);
    await syncUserGitHubRepos(session.user.id, repos);

    const githubRepos = await prisma.githubRepo.findMany({
      where: { userId: session.user.id },
      orderBy: [{ pushedAt: "desc" }, { fullName: "asc" }],
    });
    const lastSyncedAt = githubRepos[0]?.syncedAt.toISOString() ?? new Date().toISOString();
    return NextResponse.json({ githubRepos, lastSyncedAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to sync GitHub repos";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
