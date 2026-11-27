import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { emitFactoryEvent } from "@/lib/events";
import { prisma } from "@/lib/prisma";
import { accessibleProjectsWhere } from "@/lib/team-access";

type DismissKind = "interaction" | "run" | "issue";
type DismissScope = "all" | "questions" | "runs" | "issues";

export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    kind?: DismissKind;
    id?: string;
    all?: boolean;
    scope?: DismissScope;
  } | null;

  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: auth.user.id },
    select: { githubLogin: true },
  });
  const projectFilter = accessibleProjectsWhere(auth.user.id, user?.githubLogin);
  const now = new Date();
  let dismissedCount = 0;

  if (body.all) {
    const scope: DismissScope = body.scope ?? "all";

    if (scope === "all" || scope === "questions") {
      const r = await prisma.runInteraction.updateMany({
        where: { status: "pending", run: { project: projectFilter } },
        data: { status: "dismissed", resolvedAt: now },
      });
      dismissedCount += r.count;
    }

    if (scope === "all" || scope === "runs") {
      const r = await prisma.factoryRun.updateMany({
        where: {
          project: projectFilter,
          status: { in: ["blocked", "stalled", "awaiting_input"] },
        },
        data: { status: "cancelled", finishedAt: now },
      });
      dismissedCount += r.count;
    }

    if (scope === "all" || scope === "issues") {
      const r = await prisma.projectIssue.updateMany({
        where: { status: "needs_human", project: projectFilter, tier: { not: "epic" } },
        data: { status: "blocked" },
      });
      dismissedCount += r.count;
    }
  } else if (body.kind && body.id) {
    switch (body.kind) {
      case "interaction": {
        const r = await prisma.runInteraction.updateMany({
          where: { id: body.id, status: "pending", run: { project: projectFilter } },
          data: { status: "dismissed", resolvedAt: now },
        });
        dismissedCount = r.count;
        break;
      }
      case "run": {
        const r = await prisma.factoryRun.updateMany({
          where: {
            id: body.id,
            project: projectFilter,
            status: { in: ["blocked", "stalled", "awaiting_input"] },
          },
          data: { status: "cancelled", finishedAt: now },
        });
        dismissedCount = r.count;
        break;
      }
      case "issue": {
        const r = await prisma.projectIssue.updateMany({
          where: { id: body.id, status: "needs_human", project: projectFilter },
          data: { status: "blocked" },
        });
        dismissedCount = r.count;
        break;
      }
    }
  } else {
    return NextResponse.json({ error: "Provide { kind, id } or { all: true }" }, { status: 400 });
  }

  emitFactoryEvent({
    type: "interaction:updated",
    userId: auth.user.id,
    payload: { dismissedCount },
  });

  return NextResponse.json({ ok: true, dismissedCount });
}
