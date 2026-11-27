import { after, type NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/github-sync";
import { handleWebhookEvent, webhookSecretOf } from "@/lib/github-tracking";
import { prisma } from "@/lib/prisma";

export const maxDuration = 300;

/** GitHub deliveries for a tracked repository (installed by POST /api/projects/[id]/github). */
export async function POST(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("project") || "";
  const raw = await request.text();
  const project = projectId
    ? await prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, userId: true, githubFullName: true, githubSyncToken: true, githubWebhookSecret: true },
      })
    : null;
  const secret = project ? webhookSecretOf(project) : null;
  // Same answer for an unknown project and a bad signature, so neither can be probed.
  if (!project || !secret || !verifyWebhookSignature(secret, raw, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = request.headers.get("x-github-event") || "";
  if (event === "ping") return NextResponse.json({ ok: true, pong: true });

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // GitHub gives a delivery 10 seconds; the sync runs after the answer.
  after(async () => {
    try {
      await handleWebhookEvent(project, event, payload);
    } catch (e) {
      await prisma.project
        .update({ where: { id: project.id }, data: { githubSyncError: (e as Error).message.slice(0, 500) } })
        .catch(() => {});
    }
  });
  return NextResponse.json({ ok: true, accepted: event }, { status: 202 });
}
