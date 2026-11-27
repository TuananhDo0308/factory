import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { getSidebarData, runStallWatchdog } from "@/lib/workspace-data";

export async function GET() {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await runStallWatchdog(session.user.id).catch(() => {});
  const data = await getSidebarData(session.user.id);
  return NextResponse.json({ ...data, isLocalMode: session.isLocalMode });
}
