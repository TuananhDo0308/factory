import { NextResponse } from "next/server";
import { fullSync, GithubTrackingError, trackRepository, untrackRepository } from "@/lib/github-tracking";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/session";
import { getProjectAccess } from "@/lib/team-access";

export const maxDuration = 300;

async function authorize(context: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const { id } = await context.params;
  const access = await getProjectAccess(session.user, id);
  if (!access) return { error: NextResponse.json({ error: "Project not found" }, { status: 404 }) };
  if (!access.canWrite) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { session, projectId: id };
}

function failure(e: unknown) {
  const message = e instanceof Error ? e.message : "GitHub sync failed";
  return NextResponse.json({ error: message }, { status: e instanceof GithubTrackingError ? 400 : 500 });
}

async function status(projectId: string) {
  const p = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { githubFullName: true, githubUrl: true, githubTrackedAt: true, githubSyncedAt: true, githubSyncError: true },
  });
  return { ...p, tracked: Boolean(p.githubTrackedAt) };
}

/** Tracking status of the project's repository. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorize(context);
  if (auth.error) return auth.error;
  return NextResponse.json(await status(auth.projectId));
}

/** Turns tracking on for a repository link: installs the webhook and imports everything. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorize(context);
  if (auth.error) return auth.error;
  const body = (await request.json().catch(() => null)) as { link?: unknown } | null;
  const link = typeof body?.link === "string" ? body.link : "";
  if (!auth.session.githubAccessToken) {
    return NextResponse.json({ error: "Sign in with GitHub again to grant access." }, { status: 400 });
  }
  try {
    const result = await trackRepository({ projectId: auth.projectId, link, token: auth.session.githubAccessToken });
    return NextResponse.json({ ok: true, ...result, status: await status(auth.projectId) });
  } catch (e) {
    return failure(e);
  }
}

/** Re-sync: imports everything again (after missed deliveries or a new tunnel URL). */
export async function PUT(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorize(context);
  if (auth.error) return auth.error;
  const project = await prisma.project.findUniqueOrThrow({ where: { id: auth.projectId } });
  try {
    const result = project.githubFullName && auth.session.githubAccessToken
      ? await trackRepository({ projectId: project.id, link: project.githubFullName, token: auth.session.githubAccessToken })
      : await fullSync(project);
    return NextResponse.json({ ok: true, ...result, status: await status(auth.projectId) });
  } catch (e) {
    return failure(e);
  }
}

/** Turns tracking off and removes the webhook. */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorize(context);
  if (auth.error) return auth.error;
  await untrackRepository(auth.projectId);
  return NextResponse.json({ ok: true, status: await status(auth.projectId) });
}
