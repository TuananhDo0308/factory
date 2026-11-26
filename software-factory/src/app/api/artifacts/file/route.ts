import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
};

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const artifactId = request.nextUrl.searchParams.get("id");
  if (!artifactId) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const artifact = await prisma.runArtifact.findFirst({
    where: { id: artifactId, run: { userId: auth.user.id } },
  });
  if (!artifact) {
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  }

  if (/^https?:\/\//i.test(artifact.pathOrUrl)) {
    return NextResponse.redirect(artifact.pathOrUrl);
  }

  const abs = path.resolve(/* turbopackIgnore: true */ artifact.pathOrUrl);
  if (!existsSync(/* turbopackIgnore: true */ abs)) {
    return NextResponse.json({ error: "Artifact file missing on disk" }, { status: 404 });
  }

  const ext = path.extname(abs).toLowerCase();
  const contentType = artifact.mimeType || MIME_MAP[ext] || "application/octet-stream";
  const bytes = readFileSync(/* turbopackIgnore: true */ abs);

  return new NextResponse(bytes, {
    headers: {
      "content-type": contentType,
      "cache-control": "private, max-age=30",
    },
  });
}
