export type IncomingAttachmentInput = {
  name: string;
  mimeType: string;
  size?: number;
  dataBase64: string;
};

export type StoredAttachmentRef = {
  artifactId: string;
  name: string;
  mimeType: string;
  size: number;
};

export const MAX_ATTACHMENTS_PER_MESSAGE = 5;
export const MAX_ATTACHMENT_BYTES = 2_500_000; // 2.5 MB per file
export const MAX_TOTAL_ATTACHMENT_BYTES = 3_000_000; // 3.0 MB total binary (~4.0 MB base64 JSON, safe under Vercel 4.5 MB limit)

export const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".avif",
  ".bmp",
  ".svg",
  ".ico",
]);

export const SUPPORTED_FILE_EXTENSIONS = new Set([
  ...SUPPORTED_IMAGE_EXTENSIONS,
  ".pdf",
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".csv",
  ".tsv",
  ".yaml",
  ".yml",
  ".xml",
  ".log",
  ".html",
  ".htm",
  ".css",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".sql",
  ".sh",
  ".go",
  ".rs",
  ".java",
  ".rb",
  ".php",
  ".toml",
  ".ini",
  ".env",
]);

export const ATTACHMENT_ACCEPT_ATTR = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/bmp",
  "image/svg+xml",
  "image/x-icon",
  "application/pdf",
  "application/json",
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "text/css",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".avif",
  ".bmp",
  ".svg",
  ".ico",
  ".pdf",
  ".txt",
  ".md",
  ".json",
  ".csv",
  ".yaml",
  ".yml",
  ".xml",
  ".log",
  ".html",
  ".css",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".sql",
].join(",");

const EXT_TO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".markdown": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".tsv": "text/tab-separated-values; charset=utf-8",
  ".yaml": "application/yaml; charset=utf-8",
  ".yml": "application/yaml; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".jsx": "text/javascript; charset=utf-8",
  ".ts": "text/plain; charset=utf-8",
  ".tsx": "text/plain; charset=utf-8",
  ".py": "text/plain; charset=utf-8",
  ".sql": "text/plain; charset=utf-8",
  ".sh": "text/plain; charset=utf-8",
  ".go": "text/plain; charset=utf-8",
  ".rs": "text/plain; charset=utf-8",
  ".java": "text/plain; charset=utf-8",
  ".rb": "text/plain; charset=utf-8",
  ".php": "text/plain; charset=utf-8",
  ".toml": "text/plain; charset=utf-8",
  ".ini": "text/plain; charset=utf-8",
  ".env": "text/plain; charset=utf-8",
};

const MIME_TO_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/avif": ".avif",
  "image/bmp": ".bmp",
  "image/svg+xml": ".svg",
  "image/x-icon": ".ico",
  "image/vnd.microsoft.icon": ".ico",
  "application/pdf": ".pdf",
  "application/json": ".json",
  "text/plain": ".txt",
  "text/markdown": ".md",
  "text/csv": ".csv",
  "text/html": ".html",
  "text/css": ".css",
};

export function isImageMime(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith("image/");
}

export function isTextAttachmentMime(mimeType: string): boolean {
  const m = mimeType.toLowerCase().split(";")[0].trim();
  return (
    m.startsWith("text/") ||
    m === "application/json" ||
    m === "application/yaml" ||
    m === "application/xml" ||
    m === "application/javascript"
  );
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function sanitizeAttachmentFilename(rawName: string, mimeType = ""): string {
  const base = rawName.split(/[\\/]/).pop()?.trim() || "attachment";
  const cleaned = base
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/\.{2,}/g, ".")
    .slice(0, 90);
  const dotIdx = cleaned.lastIndexOf(".");
  const hasExt = dotIdx > 0 && dotIdx < cleaned.length - 1;
  if (hasExt) return cleaned;
  const fallbackExt = MIME_TO_EXT[mimeType.toLowerCase().split(";")[0].trim()] || ".bin";
  return `${cleaned || "attachment"}${fallbackExt}`;
}

export function resolveAttachmentMime(filename: string, rawMime = ""): string {
  const normalizedMime = rawMime.trim().toLowerCase().split(";")[0].trim();
  const dotIdx = filename.lastIndexOf(".");
  const ext = dotIdx >= 0 ? filename.slice(dotIdx).toLowerCase() : "";
  if (normalizedMime && normalizedMime !== "application/octet-stream") {
    return normalizedMime;
  }
  return EXT_TO_MIME[ext] || "application/octet-stream";
}

export function isSupportedAttachment(filename: string, mimeType: string): boolean {
  const mime = mimeType.toLowerCase().split(";")[0].trim();
  if (mime.startsWith("image/") || mime.startsWith("text/") || mime === "application/pdf" || mime === "application/json") {
    return true;
  }
  const dotIdx = filename.lastIndexOf(".");
  const ext = dotIdx >= 0 ? filename.slice(dotIdx).toLowerCase() : "";
  return SUPPORTED_FILE_EXTENSIONS.has(ext);
}

export type ValidatedAttachment = {
  name: string;
  mimeType: string;
  bytes: number;
  base64: string;
  isText: boolean;
  textContent: string | null;
};

export function validateIncomingAttachments(raw: unknown): {
  attachments: ValidatedAttachment[];
  error?: string;
} {
  if (raw === undefined || raw === null) return { attachments: [] };
  if (!Array.isArray(raw)) {
    return { attachments: [], error: "attachments must be an array" };
  }
  if (raw.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    return {
      attachments: [],
      error: `At most ${MAX_ATTACHMENTS_PER_MESSAGE} files can be attached per message.`,
    };
  }

  const out: ValidatedAttachment[] = [];
  let totalBytes = 0;

  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const rawName = typeof rec.name === "string" ? rec.name.trim() : "";
    const rawMime = typeof rec.mimeType === "string" ? rec.mimeType.trim() : "";
    const rawB64 = typeof rec.dataBase64 === "string" ? rec.dataBase64.trim() : "";
    if (!rawB64) continue;

    // Strip optional data URL prefix if caller passed data:...;base64,...
    const commaIdx = rawB64.indexOf("base64,");
    const pureB64 = commaIdx >= 0 ? rawB64.slice(commaIdx + 7).replace(/\s+/g, "") : rawB64.replace(/\s+/g, "");
    if (!pureB64 || !/^[A-Za-z0-9+/=]+$/.test(pureB64)) {
      return { attachments: [], error: `Invalid base64 encoding for "${rawName || "attachment"}"` };
    }

    const buf = Buffer.from(pureB64, "base64");
    if (buf.length === 0) continue;
    if (buf.length > MAX_ATTACHMENT_BYTES) {
      return {
        attachments: [],
        error: `File "${rawName || "attachment"}" exceeds the ${formatFileSize(MAX_ATTACHMENT_BYTES)} limit.`,
      };
    }

    totalBytes += buf.length;
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      return {
        attachments: [],
        error: `Total attachments exceed the ${formatFileSize(MAX_TOTAL_ATTACHMENT_BYTES)} limit per message.`,
      };
    }

    const safeName = sanitizeAttachmentFilename(rawName || "attachment", rawMime);
    const mimeType = resolveAttachmentMime(safeName, rawMime);
    if (!isSupportedAttachment(safeName, mimeType)) {
      return {
        attachments: [],
        error: `Unsupported file type for "${safeName}". Supported: images (PNG, JPG, WEBP, GIF, AVIF, BMP, SVG, ICO), PDF, and text/code/data files.`,
      };
    }

    const isText = isTextAttachmentMime(mimeType) && !isImageMime(mimeType);
    const textContent = isText ? buf.toString("utf8").slice(0, 1_500_000) : null;

    out.push({
      name: safeName,
      mimeType,
      bytes: buf.length,
      base64: pureB64,
      isText,
      textContent,
    });
  }

  return { attachments: out };
}

export function extractStepAttachments(data: unknown): StoredAttachmentRef[] {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const raw = (data as Record<string, unknown>).attachments;
  if (!Array.isArray(raw)) return [];
  const out: StoredAttachmentRef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const artifactId = typeof rec.artifactId === "string" ? rec.artifactId.trim() : "";
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    const mimeType = typeof rec.mimeType === "string" ? rec.mimeType.trim() : "application/octet-stream";
    const size = typeof rec.size === "number" && Number.isFinite(rec.size) ? rec.size : 0;
    if (artifactId && name) {
      out.push({ artifactId, name, mimeType, size });
    }
  }
  return out;
}
