import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { emitFactoryEvent } from "@/lib/events";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const runner = await prisma.runnerMachine.findFirst({
    where: { id, userId: auth.user.id },
  });
  if (!runner) return NextResponse.json({ error: "Runner not found" }, { status: 404 });

  let body: { visibility?: unknown; workspaceDir?: unknown };
  try {
    body = (await request.json()) as { visibility?: unknown; workspaceDir?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updateData: { visibility?: string; workspaceDir?: string | null } = {};
  if (body.visibility !== undefined) {
    updateData.visibility = body.visibility === "team" ? "team" : "personal";
  }
  if (typeof body.workspaceDir === "string") {
    const clean = body.workspaceDir.trim().slice(0, 1024);
    updateData.workspaceDir = clean || null;
  }

  const updated = await prisma.runnerMachine.update({
    where: { id: runner.id },
    data: updateData,
  });

  emitFactoryEvent({
    type: "runner:updated",
    userId: auth.user.id,
    payload: { runnerId: updated.id, visibility: updated.visibility },
  });

  return NextResponse.json({
    ok: true,
    runner: {
      id: updated.id,
      name: updated.name,
      visibility: updated.visibility,
      workspaceDir: updated.workspaceDir,
    },
  });
}
