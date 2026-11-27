import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { slugify } from "@/lib/crypto";
import { emitFactoryEvent } from "@/lib/events";
import { prisma } from "@/lib/prisma";
import { isServerManagedPath } from "@/lib/server-paths";

export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const localPathRaw = typeof body.localPath === "string" ? body.localPath.trim() : "";
  const explicitName = typeof body.name === "string" ? body.name.trim() : "";
  const engine = "claude";

  if (!localPathRaw && !explicitName) {
    return NextResponse.json(
      { error: "Provide a project name or local repository path" },
      { status: 400 },
    );
  }

  const absPath = localPathRaw ? path.resolve(/* turbopackIgnore: true */ localPathRaw) : null;
  let stackJson: string | null = null;
  let description = typeof body.description === "string" ? body.description.trim() : "";
  const githubFullName =
    typeof body.githubFullName === "string" && body.githubFullName.trim()
      ? body.githubFullName.trim()
      : null;
  let defaultBranch = typeof body.defaultBranch === "string" && body.defaultBranch.trim()
    ? body.defaultBranch.trim()
    : "main";
  let derivedName = explicitName || (absPath ? path.basename(absPath) : "project");

  if (absPath && isServerManagedPath(absPath) && existsSync(/* turbopackIgnore: true */ absPath)) {
    const profilePath = path.join(/* turbopackIgnore: true */ absPath, ".factory", "project.json");
    if (existsSync(/* turbopackIgnore: true */ profilePath)) {
      try {
        const parsed = JSON.parse(readFileSync(/* turbopackIgnore: true */ profilePath, "utf8")) as {
          name?: string;
          stack?: unknown;
          description?: string;
          defaultBranch?: string;
        };
        if (!explicitName && parsed.name) derivedName = parsed.name;
        if (!description && parsed.description) description = parsed.description;
        if (parsed.stack) stackJson = JSON.stringify(parsed.stack);
        if (parsed.defaultBranch) defaultBranch = parsed.defaultBranch;
      } catch {
        // Ignore malformed profile.
      }
    }
  }

  if (absPath) {
    const existingByPath = await prisma.project.findFirst({
      where: { userId: auth.user.id, localPath: absPath },
    });
    if (existingByPath) {
      const updated = await prisma.project.update({
        where: { id: existingByPath.id },
        data: {
          name: explicitName ? explicitName.slice(0, 120) : existingByPath.name,
          description: description ? description.slice(0, 500) : existingByPath.description,
          engine,
          defaultBranch,
          ...(githubFullName ? { githubFullName } : {}),
          stackJson: stackJson ?? existingByPath.stackJson,
        },
      });
      emitFactoryEvent({ type: "project:updated", userId: auth.user.id, projectId: updated.id });
      return NextResponse.json({ ok: true, project: updated, reused: true });
    }
  }

  const baseSlug = slugify(derivedName);
  const existing = await prisma.project.findMany({
    where: { userId: auth.user.id, slug: { startsWith: baseSlug } },
    select: { slug: true },
  });
  const taken = new Set(existing.map((e) => e.slug));
  let slug = baseSlug;
  for (let i = 2; taken.has(slug) && i < 200; i += 1) {
    slug = `${baseSlug}-${i}`;
  }

  const project = await prisma.project.create({
    data: {
      userId: auth.user.id,
      name: derivedName.slice(0, 120),
      slug,
      description: description ? description.slice(0, 500) : null,
      source: "local",
      engine,
      localPath: absPath,
      githubFullName,
      defaultBranch,
      stackJson,
    },
  });

  emitFactoryEvent({ type: "project:updated", userId: auth.user.id, projectId: project.id });

  return NextResponse.json({ ok: true, project }, { status: 201 });
}
