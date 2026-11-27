import { NextResponse } from "next/server";
import { pollRepository } from "@/lib/github-tracking";
import { getCurrentSession } from "@/lib/session";
import { getProjectAccess } from "@/lib/team-access";

/** Polled by open project pages: applies new GitHub events when no webhook can reach the app. */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const access = await getProjectAccess(session.user, id);
  if (!access) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  try {
    return NextResponse.json({ ok: true, ...(await pollRepository(id)) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
