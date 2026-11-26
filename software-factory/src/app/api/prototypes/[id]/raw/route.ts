import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { buildSandboxedPrototypeDocument } from "@/lib/prototypes";
import { accessibleProjectsWhere } from "@/lib/team-access";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const proto = await prisma.projectPrototype.findFirst({
    where: {
      id,
      project: accessibleProjectsWhere(auth.user.id, auth.user.githubLogin),
    },
  });
  if (!proto) return NextResponse.json({ error: "Prototype not found" }, { status: 404 });

  const screen = request.nextUrl.searchParams.get("screen");
  const themeParam = request.nextUrl.searchParams.get("theme");
  const theme = themeParam === "dark" ? "dark" : "light";

  const doc = buildSandboxedPrototypeDocument(proto.htmlContent, {
    initialScreenId: screen,
    theme,
  });

  return new NextResponse(doc, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, max-age=15",
      "x-content-type-options": "nosniff",
      "content-security-policy":
        "sandbox allow-scripts allow-forms allow-modals; default-src 'self' data: blob: 'unsafe-inline' 'unsafe-eval'; connect-src 'none';",
    },
  });
}
