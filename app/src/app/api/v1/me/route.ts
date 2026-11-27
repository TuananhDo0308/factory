import { type NextRequest, NextResponse } from "next/server";
import { authenticateBearer } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const auth = await authenticateBearer(request);
  if (!auth) {
    return NextResponse.json({ error: "Invalid or missing Bearer token" }, { status: 401 });
  }

  return NextResponse.json({
    user: {
      id: auth.user.id,
      githubLogin: auth.user.githubLogin,
      name: auth.user.name,
    },
    tokenLabel: auth.token.label,
  });
}
