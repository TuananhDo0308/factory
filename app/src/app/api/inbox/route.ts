import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { getInboxData, runStallWatchdog } from "@/lib/workspace-data";

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await runStallWatchdog(auth.user.id).catch(() => {});
  const data = await getInboxData(auth.user.id);
  return NextResponse.json({ ok: true, ...data });
}
