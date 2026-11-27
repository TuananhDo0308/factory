import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { issueRealtimeSubscribeGrant } from "@/lib/realtime";
import { accessibleProjectsWhere } from "@/lib/team-access";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const run = await prisma.factoryRun.findFirst({
    where: {
      id,
      project: accessibleProjectsWhere(auth.user.id, auth.user.githubLogin),
    },
    select: { id: true },
  });
  if (!run) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  const grant = await issueRealtimeSubscribeGrant(run.id);
  return NextResponse.json({ ok: true, runId: run.id, ...grant });
}
