"use client";

import * as React from "react";
import {
  ExternalLinkIcon,
  FileCodeIcon,
  FileIcon,
  FileTextIcon,
  ImageIcon,
  XIcon,
} from "lucide-react";
import {
  formatFileSize,
  isImageMime,
  isSupportedAttachment,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_TOTAL_ATTACHMENT_BYTES,
  resolveAttachmentMime,
  sanitizeAttachmentFilename,
  type IncomingAttachmentInput,
  type StoredAttachmentRef,
} from "@/lib/attachments";

export type PendingAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  dataBase64: string;
  previewUrl: string | null;
};

function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode image"));
    img.src = src;
  });
}

/**
 * Downscales oversized raster images (>1.6 MB or >2048px) client-side via Canvas
 * so large macOS Retina screenshots stay crisp and well under Vercel's 4.5 MB request limit.
 */
async function maybeCompressRasterImage(
  file: File,
  mimeType: string,
): Promise<{ blob: Blob; mimeType: string; name: string }> {
  const compressible =
    mimeType === "image/png" ||
    mimeType === "image/jpeg" ||
    mimeType === "image/webp" ||
    mimeType === "image/bmp";
  if (!compressible || file.size <= 1_600_000) {
    return { blob: file, mimeType, name: file.name };
  }
  try {
    const dataUrl = await readFileAsDataUrl(file);
    const img = await loadImageElement(dataUrl);
    const maxDim = 2048;
    const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
    const targetW = Math.max(1, Math.round(img.width * scale));
    const targetH = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { blob: file, mimeType, name: file.name };
    ctx.drawImage(img, 0, 0, targetW, targetH);

    const outMime = "image/webp";
    const compressed = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), outMime, 0.86),
    );
    if (!compressed || compressed.size >= file.size) {
      return { blob: file, mimeType, name: file.name };
    }
    const baseName = file.name.replace(/\.[^.]+$/, "");
    return { blob: compressed, mimeType: outMime, name: `${baseName || "image"}.webp` };
  } catch {
    return { blob: file, mimeType, name: file.name };
  }
}

export async function prepareFilesForAttachment(
  fileList: FileList | File[],
  existing: PendingAttachment[],
): Promise<{ added: PendingAttachment[]; errors: string[] }> {
  const incoming = Array.from(fileList);
  const added: PendingAttachment[] = [];
  const errors: string[] = [];
  let runningBytes = existing.reduce((s, a) => s + a.size, 0);
  let remainingSlots = Math.max(0, MAX_ATTACHMENTS_PER_MESSAGE - existing.length);

  for (const file of incoming) {
    if (remainingSlots <= 0) {
      errors.push(`Max ${MAX_ATTACHMENTS_PER_MESSAGE} files per message.`);
      break;
    }
    const initialName = file.name || `pasted-${Date.now()}`;
    const initialMime = resolveAttachmentMime(initialName, file.type);
    if (!isSupportedAttachment(initialName, initialMime)) {
      errors.push(
        `"${initialName}" is not supported (allowed: PNG, JPG, WEBP, GIF, AVIF, BMP, SVG, ICO, PDF, text/code/JSON/CSV).`,
      );
      continue;
    }

    const processed = await maybeCompressRasterImage(file, initialMime);
    if (processed.blob.size > MAX_ATTACHMENT_BYTES) {
      errors.push(
        `"${initialName}" is too large (${formatFileSize(processed.blob.size)} > ${formatFileSize(MAX_ATTACHMENT_BYTES)}).`,
      );
      continue;
    }
    if (runningBytes + processed.blob.size > MAX_TOTAL_ATTACHMENT_BYTES) {
      errors.push(
        `Total attachments exceed ${formatFileSize(MAX_TOTAL_ATTACHMENT_BYTES)} limit.`,
      );
      continue;
    }

    try {
      const dataUrl = await readFileAsDataUrl(processed.blob);
      const commaIdx = dataUrl.indexOf("base64,");
      const dataBase64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 7) : "";
      if (!dataBase64) continue;
      const safeName = sanitizeAttachmentFilename(processed.name, processed.mimeType);
      const isImg = isImageMime(processed.mimeType);
      added.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: safeName,
        mimeType: processed.mimeType,
        size: processed.blob.size,
        dataBase64,
        previewUrl: isImg ? dataUrl : null,
      });
      runningBytes += processed.blob.size;
      remainingSlots -= 1;
    } catch {
      errors.push(`Could not read "${initialName}".`);
    }
  }

  return { added, errors };
}

export function toAttachmentPayload(items: PendingAttachment[]): IncomingAttachmentInput[] {
  return items.map((a) => ({
    name: a.name,
    mimeType: a.mimeType,
    size: a.size,
    dataBase64: a.dataBase64,
  }));
}

function AttachmentIcon({ mimeType, name }: { mimeType: string; name: string }) {
  if (isImageMime(mimeType)) {
    return <ImageIcon className="size-3.5 shrink-0 text-primary" aria-hidden="true" />;
  }
  const lower = name.toLowerCase();
  if (
    lower.endsWith(".ts") ||
    lower.endsWith(".tsx") ||
    lower.endsWith(".js") ||
    lower.endsWith(".jsx") ||
    lower.endsWith(".py") ||
    lower.endsWith(".json") ||
    lower.endsWith(".sql") ||
    lower.endsWith(".html") ||
    lower.endsWith(".css")
  ) {
    return <FileCodeIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />;
  }
  if (mimeType === "application/pdf" || lower.endsWith(".md") || lower.endsWith(".txt")) {
    return <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />;
  }
  return <FileIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />;
}

export function AttachmentPreviewStrip({
  attachments,
  onRemove,
  className = "",
}: {
  attachments: PendingAttachment[];
  onRemove: (id: string) => void;
  className?: string;
}) {
  if (attachments.length === 0) return null;

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {attachments.map((att) =>
        att.previewUrl ? (
          <div
            key={att.id}
            className="group relative flex items-center gap-2 rounded-lg border border-border/80 bg-muted/40 p-1 pr-2.5"
            title={`${att.name} (${formatFileSize(att.size)})`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={att.previewUrl}
              alt={att.name}
              className="size-10 rounded-md object-cover"
            />
            <div className="flex max-w-[140px] flex-col">
              <span className="truncate text-xs font-medium text-foreground">{att.name}</span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {formatFileSize(att.size)}
              </span>
            </div>
            <button
              type="button"
              onClick={() => onRemove(att.id)}
              aria-label={`Remove ${att.name}`}
              className="ml-0.5 inline-flex size-5 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <XIcon className="size-3" />
            </button>
          </div>
        ) : (
          <div
            key={att.id}
            className="inline-flex max-w-[220px] items-center gap-1.5 rounded-lg border border-border/80 bg-muted/40 px-2.5 py-1.5 text-xs"
            title={`${att.name} (${formatFileSize(att.size)})`}
          >
            <AttachmentIcon mimeType={att.mimeType} name={att.name} />
            <span className="truncate font-medium text-foreground">{att.name}</span>
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              {formatFileSize(att.size)}
            </span>
            <button
              type="button"
              onClick={() => onRemove(att.id)}
              aria-label={`Remove ${att.name}`}
              className="ml-0.5 inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <XIcon className="size-3" />
            </button>
          </div>
        ),
      )}
    </div>
  );
}

export function MessageAttachments({ attachments }: { attachments: StoredAttachmentRef[] }) {
  if (!attachments || attachments.length === 0) return null;

  const images = attachments.filter((a) => isImageMime(a.mimeType));
  const files = attachments.filter((a) => !isImageMime(a.mimeType));

  return (
    <div className="mt-2 flex flex-col gap-2">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((img) => {
            const url = `/api/artifacts/file?id=${encodeURIComponent(img.artifactId)}`;
            return (
              <a
                key={img.artifactId}
                href={url}
                target="_blank"
                rel="noreferrer"
                title={`${img.name} (${formatFileSize(img.size)}) — click to open full size`}
                className="group relative overflow-hidden rounded-lg border border-border/80 bg-background transition-colors hover:border-primary/50"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={img.name}
                  className="max-h-40 max-w-[220px] object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                />
                <span className="block max-w-[220px] truncate border-t border-border/60 bg-card/90 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {img.name}
                </span>
              </a>
            );
          })}
        </div>
      )}

      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {files.map((f) => {
            const url = `/api/artifacts/file?id=${encodeURIComponent(f.artifactId)}`;
            return (
              <a
                key={f.artifactId}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex max-w-[240px] items-center gap-1.5 rounded-md border border-border/80 bg-background px-2.5 py-1 text-xs text-foreground transition-colors hover:border-primary/45 hover:text-primary"
              >
                <AttachmentIcon mimeType={f.mimeType} name={f.name} />
                <span className="truncate font-medium">{f.name}</span>
                {f.size > 0 && (
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {formatFileSize(f.size)}
                  </span>
                )}
                <ExternalLinkIcon className="size-3 shrink-0 opacity-60" aria-hidden="true" />
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
