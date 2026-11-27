import { emitFactoryEvent } from "@/lib/events";
import { prisma } from "@/lib/prisma";
import {
  normalizePrototypeManifest,
  slugifyPrototype,
  type SerializedPrototype,
} from "@/lib/prototypes";
import { safeJsonParse } from "@/lib/workspace-data";

export function serializePrototype(row: {
  id: string;
  projectId: string;
  runId: string | null;
  slug: string;
  title: string;
  kind: string;
  binding: string;
  status: string;
  issueKeysJson: string;
  htmlContent: string;
  manifestJson: string;
  localPath: string | null;
  branchName: string | null;
  commitSha: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}): SerializedPrototype {
  const rawManifest = safeJsonParse<Record<string, unknown>>(row.manifestJson, {});
  const manifest = normalizePrototypeManifest(rawManifest, row.htmlContent);
  const issueKeys = safeJsonParse<string[]>(row.issueKeysJson, []);
  const kind =
    row.kind === "first_screen" ||
    row.kind === "whole_flow" ||
    row.kind === "existing"
      ? row.kind
      : "ticket";
  const binding = row.binding === "look" ? "look" : "flow";
  const status =
    row.status === "approved" || row.status === "superseded" ? row.status : "draft";

  return {
    id: row.id,
    projectId: row.projectId,
    runId: row.runId,
    slug: row.slug,
    title: row.title,
    kind,
    binding,
    status,
    issueKeys: issueKeys.length > 0 ? issueKeys : manifest.issueKeys ?? [],
    htmlContent: row.htmlContent,
    manifest,
    localPath: row.localPath,
    branchName: row.branchName,
    commitSha: row.commitSha,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function upsertProjectPrototype(params: {
  projectId: string;
  userId: string;
  runId?: string | null;
  slug?: string | null;
  title: string;
  kind?: string | null;
  binding?: string | null;
  status?: string | null;
  issueKeys?: string[];
  htmlContent: string;
  manifest?: Record<string, unknown> | null;
  localPath?: string | null;
  branchName?: string | null;
  commitSha?: string | null;
}): Promise<SerializedPrototype> {
  const htmlContent = params.htmlContent.slice(0, 1_500_000);
  const manifest = normalizePrototypeManifest(
    {
      ...(params.manifest ?? {}),
      title: params.title,
      ...(params.kind ? { kind: params.kind } : {}),
      ...(params.binding ? { binding: params.binding } : {}),
      ...(params.issueKeys && params.issueKeys.length > 0
        ? { issueKeys: params.issueKeys }
        : {}),
    },
    htmlContent,
  );

  const issueKeys = Array.from(
    new Set(
      (params.issueKeys && params.issueKeys.length > 0
        ? params.issueKeys
        : manifest.issueKeys ?? []
      )
        .map((k) => k.trim())
        .filter(Boolean),
    ),
  );
  const title = (params.title || manifest.title || "Interactive Prototype").trim().slice(0, 180);
  const slug = slugifyPrototype(
    params.slug?.trim() || (issueKeys.length === 1 ? `${issueKeys[0]}-${title}` : title),
  );
  const kind = manifest.kind || "ticket";
  const binding = manifest.binding || "flow";
  const status =
    params.status === "approved" || params.status === "superseded" ? params.status : "draft";

  const existing = await prisma.projectPrototype.findUnique({
    where: { projectId_slug: { projectId: params.projectId, slug } },
    select: { id: true, version: true },
  });

  const saved = existing
    ? await prisma.projectPrototype.update({
        where: { id: existing.id },
        data: {
          runId: params.runId ?? undefined,
          title,
          kind,
          binding,
          status,
          issueKeysJson: JSON.stringify(issueKeys),
          htmlContent,
          manifestJson: JSON.stringify(manifest),
          localPath: params.localPath ?? undefined,
          branchName: params.branchName ?? undefined,
          commitSha: params.commitSha ?? undefined,
          version: existing.version + 1,
        },
      })
    : await prisma.projectPrototype.create({
        data: {
          projectId: params.projectId,
          runId: params.runId ?? null,
          slug,
          title,
          kind,
          binding,
          status,
          issueKeysJson: JSON.stringify(issueKeys),
          htmlContent,
          manifestJson: JSON.stringify(manifest),
          localPath: params.localPath ?? null,
          branchName: params.branchName ?? null,
          commitSha: params.commitSha ?? null,
          version: 1,
        },
      });

  // Also register/refresh a RunArtifact so prototypes are visible in the Session Files tab too.
  if (params.runId) {
    const existingArtifact = await prisma.runArtifact.findFirst({
      where: {
        runId: params.runId,
        kind: "prototype",
        pathOrUrl: params.localPath || `prototype://${slug}`,
      },
      select: { id: true },
    });
    const artifactMeta = JSON.stringify({
      prototypeId: saved.id,
      slug: saved.slug,
      kind,
      binding,
      issueKeys,
      screenCount: manifest.screens.length,
      version: saved.version,
    });
    if (existingArtifact) {
      await prisma.runArtifact
        .update({
          where: { id: existingArtifact.id },
          data: {
            title,
            mimeType: "text/html; charset=utf-8",
            contentText: htmlContent,
            metaJson: artifactMeta,
          },
        })
        .catch(() => {});
    } else {
      await prisma.runArtifact
        .create({
          data: {
            runId: params.runId,
            kind: "prototype",
            title,
            pathOrUrl: params.localPath || `prototype://${slug}`,
            mimeType: "text/html; charset=utf-8",
            contentText: htmlContent,
            metaJson: artifactMeta,
          },
        })
        .catch(() => {});
    }
  }

  emitFactoryEvent({
    type: "prototype:updated",
    userId: params.userId,
    projectId: params.projectId,
    runId: params.runId ?? null,
    payload: {
      prototypeId: saved.id,
      slug: saved.slug,
      title: saved.title,
      kind: saved.kind,
      binding: saved.binding,
      status: saved.status,
      issueKeys,
      version: saved.version,
    },
  });

  return serializePrototype(saved);
}
