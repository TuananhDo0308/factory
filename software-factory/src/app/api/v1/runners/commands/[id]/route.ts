import { type NextRequest, NextResponse } from "next/server";
import { authenticateBearer } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

const VALID_STATUSES = new Set(["claimed", "done", "failed"]);

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateBearer(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const cmd = await prisma.runnerCommand.findFirst({
    where: {
      id,
      OR: [{ userId: auth.user.id }, { runner: { userId: auth.user.id } }],
    },
  });
  if (!cmd) return NextResponse.json({ error: "Command not found" }, { status: 404 });

  let body: { status?: unknown; error?: unknown };
  try {
    body = (await request.json()) as { status?: unknown; error?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const status =
    typeof body.status === "string" && VALID_STATUSES.has(body.status)
      ? body.status
      : "done";

  const updated = await prisma.runnerCommand.update({
    where: { id: cmd.id },
    data: {
      status,
      error: typeof body.error === "string" ? body.error.slice(0, 1000) : null,
    },
  });

  return NextResponse.json({ ok: true, command: updated });
}
