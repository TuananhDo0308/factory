import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { accessibleProjectsWhere } from "@/lib/team-access";

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
};

function buildSafeHeaders(contentType: string): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": contentType,
    "cache-control": "private, max-age=30",
    "x-content-type-options": "nosniff",
  };
  if (contentType.startsWith("text/html") || contentType.startsWith("image/svg")) {
    headers["content-security-policy"] =
      "sandbox allow-scripts allow-forms allow-modals; default-src 'self' data: blob: 'unsafe-inline' 'unsafe-eval'; connect-src 'none';";
  }
  return headers;
}

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const artifactId = request.nextUrl.searchParams.get("id");
  if (!artifactId) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const artifact = await prisma.runArtifact.findFirst({
    where: {
      id: artifactId,
      run: {
        project: accessibleProjectsWhere(auth.user.id, auth.user.githubLogin),
      },
    },
  });
  if (!artifact) {
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  }

  const ext = path.extname(artifact.pathOrUrl || "").toLowerCase();
  const contentType = artifact.mimeType || MIME_MAP[ext] || "application/octet-stream";

  // 1. DB-stored text content (works on Vercel Serverless & remote viewers!)
  if (artifact.contentText !== null && artifact.contentText !== undefined) {
    const resolvedType =
      artifact.mimeType ||
      MIME_MAP[ext] ||
      (artifact.kind === "prototype" || artifact.kind === "mockup"
        ? "text/html; charset=utf-8"
        : "text/plain; charset=utf-8");
    return new NextResponse(artifact.contentText, {
      headers: buildSafeHeaders(resolvedType),
    });
  }

  // 2. DB-stored binary content (PNG/JPG/WEBP screenshots uploaded by `sf daemon` / `sf artifact`)
  if (artifact.contentBase64) {
    const bytes = Buffer.from(artifact.contentBase64, "base64");
    return new NextResponse(bytes, {
      headers: buildSafeHeaders(contentType),
    });
  }

  // 3. External URL
  if (/^https?:\/\//i.test(artifact.pathOrUrl)) {
    return NextResponse.redirect(artifact.pathOrUrl);
  }

  // 4. Local disk fallback (localhost)
  const abs = path.resolve(/* turbopackIgnore: true */ artifact.pathOrUrl);
  if (!existsSync(/* turbopackIgnore: true */ abs)) {
    return NextResponse.json(
      { error: "Artifact file missing on this host (not uploaded to DB)" },
      { status: 404 },
    );
  }

  const bytes = readFileSync(/* turbopackIgnore: true */ abs);
  return new NextResponse(bytes, {
    headers: buildSafeHeaders(contentType),
  });
}
