import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { DispatchError, startEpicRun } from "@/lib/dispatch";
import { getProjectAccess } from "@/lib/team-access";

/**
 * Starts a new-factory run of one epic on the project's daemon.
 * Body (all optional): { createStaging?: boolean, retry?: number[], note?: string, runnerId?: string }
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string; number: string }> },
) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, number } = await context.params;
  const epic = Number(number);
  if (!Number.isInteger(epic) || epic <= 0) {
    return NextResponse.json({ error: "Invalid epic number" }, { status: 400 });
  }

  const access = await getProjectAccess(auth.user, id);
  if (!access) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (!access.canWrite) {
    return NextResponse.json({ error: "Viewer role cannot run epics on this project" }, { status: 403 });
  }

  let body: Record<string, unknown> = {};
  try {
    const parsed = await request.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    // An empty body runs the whole epic.
  }
  const retry = Array.isArray(body.retry)
    ? body.retry.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0)
    : [];
  const note = typeof body.note === "string" ? body.note : "";
  const runnerId = typeof body.runnerId === "string" ? body.runnerId.trim() || null : null;

  try {
    const { run, runner, repo } = await startEpicRun({
      user: auth.user,
      project: access.project,
      epic,
      retry,
      note,
      createStaging: body.createStaging === true,
      runnerId,
    });
    return NextResponse.json(
      {
        ok: true,
        run: { id: run.id, runKey: run.runKey, status: run.status, title: run.title },
        repo,
        dispatchedToRunner: runner.name,
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof DispatchError) {
      return NextResponse.json(
        { error: err.message, code: err.code, ...(err.extra ?? {}) },
        { status: err.status },
      );
    }
    throw err;
  }
}
