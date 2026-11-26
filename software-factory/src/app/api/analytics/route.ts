import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { getAnalyticsData } from "@/lib/workspace-data";

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const data = await getAnalyticsData(auth.user.id);
  return NextResponse.json({ ok: true, ...data });
}
