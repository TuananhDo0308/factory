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
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
};

/** Types served as-is without a sandbox: raster images and PDF never run script on this origin. */
const INERT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/bmp",
  "image/x-icon",
  "application/pdf",
]);

/** Every type this route will ever send. Anything else (XML, XHTML, JS, unknown) is sent as plain text. */
const ALLOWED_TYPES = new Set([
  ...INERT_TYPES,
  "image/svg+xml",
  "text/html",
  "text/markdown",
  "application/json",
  "text/csv",
  "text/plain",
]);

/**
 * The type to serve. The client's `mimeType` is only a hint: it is lower-cased, stripped of
 * parameters and must be on the allow-list, otherwise the extension decides, otherwise plain text.
 */
function resolveContentType(mimeHint: string | null, ext: string, fallback: string): string {
  const hint = (mimeHint || "").split(";")[0].trim().toLowerCase();
  const base = ALLOWED_TYPES.has(hint) ? hint : (MIME_MAP[ext] || fallback).split(";")[0];
  return base.startsWith("image/") || base === "application/pdf" ? base : `${base}; charset=utf-8`;
}

function buildSafeHeaders(contentType: string): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": contentType,
    "cache-control": "private, max-age=30",
    "x-content-type-options": "nosniff",
  };
  // Artifacts are written by runners and teammates, so anything a browser could execute is
  // rendered in an opaque origin: no cookies, no same-origin requests, no network.
  if (!INERT_TYPES.has(contentType.split(";")[0])) {
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

  // 1. DB-stored text content (works on Vercel Serverless & remote viewers!)
  if (artifact.contentText !== null && artifact.contentText !== undefined) {
    const resolvedType = resolveContentType(
      artifact.mimeType,
      ext,
      artifact.kind === "prototype" || artifact.kind === "mockup" ? "text/html" : "text/plain",
    );
    return new NextResponse(artifact.contentText, {
      headers: buildSafeHeaders(resolvedType),
    });
  }

  // 2. DB-stored binary content (PNG/JPG/WEBP screenshots uploaded by `sf daemon` / `sf artifact`)
  if (artifact.contentBase64) {
    const bytes = Buffer.from(artifact.contentBase64, "base64");
    return new NextResponse(bytes, {
      headers: buildSafeHeaders(resolveContentType(artifact.mimeType, ext, "application/octet-stream")),
    });
  }

  // 3. External URL
  if (/^https?:\/\//i.test(artifact.pathOrUrl)) {
    return NextResponse.redirect(artifact.pathOrUrl);
  }

  // Paths on the server's disk are never read: the path comes from the client.
  return NextResponse.json(
    { error: "Artifact content was not uploaded (only uploaded content is served)" },
    { status: 404 },
  );
}
