export type PrototypeScreen = {
  id: string;
  title: string;
  criteria: string[];
  shows?: string;
};

export type PrototypeNotShown = {
  criterion: string;
  why: string;
};

export type PrototypeDrawnFrom = {
  commit?: string;
  files?: string[];
  unbuilt?: string[];
};

export type PrototypeManifest = {
  title?: string;
  binding?: "flow" | "look";
  kind?: "first_screen" | "ticket" | "whole_flow" | "existing";
  issueKeys?: string[];
  themes?: string[];
  screens: PrototypeScreen[];
  notShown?: PrototypeNotShown[];
  drawnFrom?: PrototypeDrawnFrom;
  source?: string;
  htmlPath?: string;
};

export type ParsedChatPrototype = {
  slug: string;
  title: string;
  kind: "first_screen" | "ticket" | "whole_flow" | "existing";
  binding: "flow" | "look";
  issueKeys: string[];
  themes: string[];
  screens: PrototypeScreen[];
  notShown: PrototypeNotShown[];
  drawnFrom?: PrototypeDrawnFrom;
  source?: string;
  htmlPath?: string;
  htmlContent?: string;
  rawMetaJson: string;
};

export type SerializedPrototype = {
  id: string;
  projectId: string;
  runId: string | null;
  slug: string;
  title: string;
  kind: "first_screen" | "ticket" | "whole_flow" | "existing";
  binding: "flow" | "look";
  status: "draft" | "approved" | "superseded";
  issueKeys: string[];
  htmlContent: string;
  manifest: PrototypeManifest;
  localPath: string | null;
  branchName: string | null;
  commitSha: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type SplitPrototypeBlocksResult = {
  prose: string;
  prototypes: ParsedChatPrototype[];
  prototypeStreaming: boolean;
  streamingTitle: string | null;
};

/**
 * Prompt contract appended to interactive BA & Clarify sessions so agents produce
 * clickable, multi-state HTML prototypes that Software Factory renders live in chat,
 * Kanban sheets, and the Project Prototype Studio (works identically on localhost & Vercel).
 */
export const SF_PROTOTYPE_PROMPT_CONTRACT = [
  "Interactive HTML Prototype Contract (BA → Prototype Flow):",
  "- Whenever a ticket creates a new screen, changes a layout, adds a new control type, or introduces states with their own look (empty, loading, error, no permission), produce a clickable self-contained HTML prototype so the user can test the UX before any production code is written.",
  "- If the product has NO existing UI look yet, first ask a brief Design Brief via `sf-questions` (Vibe, Theme: light/dark/both, Colours & Type, Motion) and draw ONE primary screen (`kind: \"first_screen\"`) for the user to approve or steer before drawing the remaining screens.",
  "- Prototype rules:",
  "  1. Completely self-contained HTML (inline `<style>` and `<script>`, zero external network requests, zero external CDN URLs, realistic sample data, works at both `1440px` desktop and `390px` mobile, respects light/dark via CSS variables or `[data-theme=\"dark\"]` / `.dark`).",
  "  2. Every criterion state (normal, empty, loading, error, permission, dialog) is a separate `<section data-screen=\"<id>\" data-title=\"<Label>\">` element shown ONE AT A TIME via `location.hash` (`#<id>`), plus working in-memory interactions (filters filter, forms validate, modals open/close, tabs switch).",
  "  3. Mark elements added/changed by the ticket with `data-change` and include a subtle prototype bar noting sample data.",
  "  4. When 2+ tickets form a sequential user journey, also produce a combined whole-flow demo (`kind: \"whole_flow\"`) so the user can click through the end-to-end flow without dead ends.",
  "- Delivery format (choose the cleanest option):",
  "  - **Preferred**: Write the HTML file to `.factory/prototypes/<slug>/index.html` (and optionally `.factory/prototypes/<slug>/prototype.json`), then emit a compact fenced `sf-prototype` JSON metadata block referencing `\"htmlPath\": \".factory/prototypes/<slug>/index.html\"` (the local runner automatically uploads the full HTML to Software Factory so even remote/Vercel users can click it immediately!).",
  "  - **Inline alternative**: Emit a fenced `sf-prototype` JSON metadata block immediately followed by a fenced `sf-prototype-html` block containing the full HTML.",
  "```sf-prototype",
  "{",
  '  "slug": "orders-export",',
  '  "title": "Orders Export & Filters",',
  '  "kind": "ticket",',
  '  "binding": "flow",',
  '  "issueKeys": ["I1"],',
  '  "themes": ["light", "dark"],',
  '  "htmlPath": ".factory/prototypes/orders-export/index.html",',
  '  "screens": [',
  '    { "id": "orders-list", "title": "Orders list (Normal)", "criteria": ["C1"], "shows": "Filter bar, table rows, Export CSV button" },',
  '    { "id": "orders-empty", "title": "Empty state", "criteria": ["C2"], "shows": "No orders match filters + Clear filters button" }',
  "  ],",
  '  "notShown": [',
  '    { "criterion": "C5", "why": "Server-side rate limit; no UI change" }',
  "  ]",
  "}",
  "```",
  "- Never put raw HTML inside JSON strings if you can use `htmlPath` or a separate ```sf-prototype-html block.",
].join("\n");

export function slugifyPrototype(raw: string): string {
  const clean = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return clean || "prototype";
}

function normalizeKind(raw: unknown): "first_screen" | "ticket" | "whole_flow" | "existing" {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (v === "first_screen" || v === "first-screen" || v === "direction") return "first_screen";
  if (v === "whole_flow" || v === "whole-flow" || v === "demo" || v === "flow_demo") {
    return "whole_flow";
  }
  if (v === "existing" || v === "imported") return "existing";
  return "ticket";
}

function normalizeBinding(raw: unknown): "flow" | "look" {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return v === "look" ? "look" : "flow";
}

function normalizeScreens(raw: unknown): PrototypeScreen[] {
  if (!Array.isArray(raw)) return [];
  const out: PrototypeScreen[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.length; i += 1) {
    const item = raw[i];
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const obj = item as Record<string, unknown>;
    const id =
      typeof obj.id === "string" && obj.id.trim()
        ? obj.id.trim().replace(/^#/, "")
        : `screen-${i + 1}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const title =
      typeof obj.title === "string" && obj.title.trim() ? obj.title.trim() : id;
    const rawCriteria = Array.isArray(obj.criteria)
      ? obj.criteria
      : typeof obj.criterion === "string"
        ? [obj.criterion]
        : [];
    const criteria = rawCriteria
      .map((c) => (typeof c === "string" ? c.trim() : ""))
      .filter(Boolean);
    const shows =
      typeof obj.shows === "string" && obj.shows.trim() ? obj.shows.trim() : undefined;
    out.push({ id, title, criteria, ...(shows ? { shows } : {}) });
  }
  return out;
}

function normalizeNotShown(raw: unknown): PrototypeNotShown[] {
  if (!Array.isArray(raw)) return [];
  const out: PrototypeNotShown[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const obj = item as Record<string, unknown>;
    const criterion =
      typeof obj.criterion === "string"
        ? obj.criterion.trim()
        : typeof obj.id === "string"
          ? obj.id.trim()
          : "";
    const why =
      typeof obj.why === "string"
        ? obj.why.trim()
        : typeof obj.reason === "string"
          ? obj.reason.trim()
          : "";
    if (criterion && why) {
      out.push({ criterion, why });
    }
  }
  return out;
}

/**
 * Fallback screen extractor when HTML has `data-screen="<id>"` elements
 * even if the manifest omitted `screens`.
 */
export function extractScreensFromHtml(html: string): PrototypeScreen[] {
  if (!html) return [];
  const out: PrototypeScreen[] = [];
  const seen = new Set<string>();
  const tagRe = /<([a-z0-9-]+)\b([^>]*\bdata-screen\s*=\s*["']([^"']+)["'][^>]*)>/gi;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html)) !== null) {
    const attrs = match[2] || "";
    const id = (match[3] || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const titleAttr =
      /\bdata-title\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] ||
      /\baria-label\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] ||
      id
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, (ch) => ch.toUpperCase());
    const critAttr = /\bdata-criteria\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] || "";
    const criteria = critAttr
      .split(/[,\s]+/)
      .map((c) => c.trim())
      .filter(Boolean);
    out.push({ id, title: titleAttr.trim(), criteria });
  }
  return out;
}

export function normalizePrototypeManifest(
  raw: unknown,
  htmlContent?: string,
): PrototypeManifest {
  const obj =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const explicitScreens = normalizeScreens(obj.screens);
  const screens =
    explicitScreens.length > 0
      ? explicitScreens
      : htmlContent
        ? extractScreensFromHtml(htmlContent)
        : [];
  const notShown = normalizeNotShown(obj.notShown);
  const issueKeys = Array.isArray(obj.issueKeys)
    ? obj.issueKeys
        .map((k) => (typeof k === "string" ? k.trim() : ""))
        .filter(Boolean)
    : typeof obj.issueKey === "string" && obj.issueKey.trim()
      ? [obj.issueKey.trim()]
      : [];
  const themes = Array.isArray(obj.themes)
    ? obj.themes
        .map((t) => (typeof t === "string" ? t.trim().toLowerCase() : ""))
        .filter((t) => t === "light" || t === "dark")
    : [];
  const drawnFromRaw =
    obj.drawnFrom && typeof obj.drawnFrom === "object" && !Array.isArray(obj.drawnFrom)
      ? (obj.drawnFrom as Record<string, unknown>)
      : null;

  return {
    ...(typeof obj.title === "string" && obj.title.trim() ? { title: obj.title.trim() } : {}),
    binding: normalizeBinding(obj.binding),
    kind: normalizeKind(obj.kind),
    issueKeys,
    themes: themes.length > 0 ? themes : ["light", "dark"],
    screens,
    ...(notShown.length > 0 ? { notShown } : {}),
    ...(drawnFromRaw
      ? {
          drawnFrom: {
            ...(typeof drawnFromRaw.commit === "string" ? { commit: drawnFromRaw.commit } : {}),
            ...(Array.isArray(drawnFromRaw.files)
              ? { files: drawnFromRaw.files.map(String) }
              : {}),
            ...(Array.isArray(drawnFromRaw.unbuilt)
              ? { unbuilt: drawnFromRaw.unbuilt.map(String) }
              : {}),
          },
        }
      : {}),
    ...(typeof obj.source === "string" && obj.source.trim() ? { source: obj.source.trim() } : {}),
    ...(typeof obj.htmlPath === "string" && obj.htmlPath.trim()
      ? { htmlPath: obj.htmlPath.trim() }
      : {}),
  };
}

/**
 * Strips ```sf-prototype and ```sf-prototype-html blocks from assistant text
 * (while parsing all completed prototypes and detecting in-flight streaming blocks).
 */
export function splitAssistantPrototypeBlocks(rawText: string): SplitPrototypeBlocksResult {
  if (!rawText) {
    return {
      prose: "",
      prototypes: [],
      prototypeStreaming: false,
      streamingTitle: null,
    };
  }

  type Span = {
    kind: "meta" | "html";
    start: number;
    end: number;
    body: string;
  };

  const fenceRe = /```(sf-prototype-html|sf-prototype)\s*\r?\n([\s\S]*?)```/gi;
  const spans: Span[] = [];
  let match: RegExpExecArray | null;
  while ((match = fenceRe.exec(rawText)) !== null) {
    const tag = match[1].toLowerCase();
    spans.push({
      kind: tag === "sf-prototype-html" ? "html" : "meta",
      start: match.index,
      end: match.index + match[0].length,
      body: match[2].trim(),
    });
  }

  // Check for unclosed trailing fence while streaming
  let prototypeStreaming = false;
  let streamingTitle: string | null = null;
  let openStart = -1;
  const tailFrom = spans.length > 0 ? spans[spans.length - 1].end : 0;
  const tail = rawText.slice(tailFrom);
  const openMatch = /```(sf-prototype-html|sf-prototype)\b([\s\S]*)$/i.exec(tail);
  if (openMatch) {
    prototypeStreaming = true;
    openStart = tailFrom + openMatch.index;
    const titleMatch = /"title"\s*:\s*"([^"]+)"/.exec(openMatch[2]);
    if (titleMatch?.[1]) streamingTitle = titleMatch[1];
  }

  // Build stripped prose
  let prose = "";
  let cursor = 0;
  for (const sp of spans) {
    prose += rawText.slice(cursor, sp.start);
    cursor = sp.end;
  }
  if (openStart >= 0) {
    prose += rawText.slice(cursor, openStart);
  } else {
    prose += rawText.slice(cursor);
  }

  // Pair metadata blocks with optional immediately-following sf-prototype-html blocks
  const prototypes: ParsedChatPrototype[] = [];
  for (let i = 0; i < spans.length; i += 1) {
    const sp = spans[i];
    if (sp.kind === "html") {
      // Standalone sf-prototype-html without preceding metadata block
      const titleMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(sp.body);
      const title = titleMatch?.[1]?.trim() || `Interactive Prototype ${prototypes.length + 1}`;
      const screens = extractScreensFromHtml(sp.body);
      prototypes.push({
        slug: slugifyPrototype(title),
        title,
        kind: "ticket",
        binding: "flow",
        issueKeys: [],
        themes: ["light", "dark"],
        screens,
        notShown: [],
        htmlContent: sp.body,
        rawMetaJson: "{}",
      });
      continue;
    }

    // sp.kind === "meta"
    let parsedObj: Record<string, unknown> | null = null;
    try {
      const val = JSON.parse(sp.body) as unknown;
      if (val && typeof val === "object" && !Array.isArray(val)) {
        parsedObj = val as Record<string, unknown>;
      }
    } catch {
      continue;
    }
    if (!parsedObj) continue;

    let htmlContent =
      typeof parsedObj.html === "string" && parsedObj.html.trim()
        ? parsedObj.html.trim()
        : undefined;

    // Pair with next span if it's an `sf-prototype-html` block
    if (!htmlContent && spans[i + 1]?.kind === "html") {
      htmlContent = spans[i + 1].body;
      i += 1;
    }

    const htmlPath =
      typeof parsedObj.htmlPath === "string" && parsedObj.htmlPath.trim()
        ? parsedObj.htmlPath.trim()
        : typeof parsedObj.file === "string" && parsedObj.file.trim()
          ? parsedObj.file.trim()
          : typeof parsedObj.path === "string" && parsedObj.path.trim()
            ? parsedObj.path.trim()
            : undefined;

    const manifest = normalizePrototypeManifest(parsedObj, htmlContent);
    const title = manifest.title || "Interactive Prototype";
    const slug = slugifyPrototype(
      (typeof parsedObj.slug === "string" && parsedObj.slug.trim()) ||
        (manifest.issueKeys?.length === 1 ? `${manifest.issueKeys[0]}-${title}` : title),
    );

    prototypes.push({
      slug,
      title,
      kind: manifest.kind || "ticket",
      binding: manifest.binding || "flow",
      issueKeys: manifest.issueKeys || [],
      themes: manifest.themes || ["light", "dark"],
      screens: manifest.screens,
      notShown: manifest.notShown || [],
      drawnFrom: manifest.drawnFrom,
      source: manifest.source,
      htmlPath,
      htmlContent,
      rawMetaJson: sp.body,
    });
  }

  return {
    prose: prose.replace(/\n{3,}/g, "\n\n").trim(),
    prototypes,
    prototypeStreaming,
    streamingTitle,
  };
}

/**
 * Wraps a self-contained HTML prototype (either a full document or a `ba-ticket` fragment)
 * for safe, origin-isolated `<iframe sandbox="allow-scripts allow-forms allow-modals" srcDoc={...}>`
 * rendering with two-way screen (`#hash`) & theme sync via `postMessage`.
 */
export function buildSandboxedPrototypeDocument(
  rawHtml: string,
  options?: { initialScreenId?: string | null; theme?: "light" | "dark" | null },
): string {
  const initialScreen = (options?.initialScreenId || "").replace(/^#/, "").trim();
  const initialTheme = options?.theme === "dark" ? "dark" : "light";

  const bridgeScript = `<script data-sf-proto-bridge>
(function(){
  var INITIAL_SCREEN = ${JSON.stringify(initialScreen)};
  var INITIAL_THEME = ${JSON.stringify(initialTheme)};

  function applyTheme(t) {
    var dark = t === "dark";
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    if (dark) { document.documentElement.classList.add("dark"); }
    else { document.documentElement.classList.remove("dark"); }
  }

  function syncDataScreens(targetId) {
    var nodes = document.querySelectorAll("[data-screen]");
    if (!nodes.length) return;
    var resolved = targetId;
    var found = false;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute("data-screen") === resolved) { found = true; break; }
    }
    if (!found) {
      resolved = nodes[0].getAttribute("data-screen") || "";
    }
    for (var j = 0; j < nodes.length; j++) {
      var el = nodes[j];
      var match = el.getAttribute("data-screen") === resolved;
      el.hidden = !match;
      if (match) {
        if (el.style.display === "none") el.style.display = "";
      } else {
        el.style.display = "none";
      }
    }
    try {
      window.parent.postMessage({ type: "sf-proto:screen-changed", screenId: resolved }, "*");
    } catch (e) {}
  }

  function navigateToScreen(id) {
    if (!id) return;
    var clean = String(id).replace(/^#/, "");
    try {
      if (window.location.hash !== "#" + clean) {
        window.location.hash = "#" + clean;
      }
    } catch (e) {}
    syncDataScreens(clean);
  }

  applyTheme(INITIAL_THEME);

  window.addEventListener("message", function(ev) {
    var d = ev && ev.data;
    if (!d || typeof d !== "object") return;
    if (d.type === "sf-proto:set-screen" && typeof d.screenId === "string") {
      navigateToScreen(d.screenId);
    } else if (d.type === "sf-proto:set-theme" && (d.theme === "light" || d.theme === "dark")) {
      applyTheme(d.theme);
    }
  });

  window.addEventListener("hashchange", function() {
    var cur = (window.location.hash || "").replace(/^#/, "");
    syncDataScreens(cur);
  });

  // Prevent external anchor navigation from breaking out of the prototype sandbox
  document.addEventListener("click", function(ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest("a[href]") : null;
    if (!a) return;
    var href = a.getAttribute("href") || "";
    if (/^https?:\\/\\//i.test(href)) {
      ev.preventDefault();
    }
  });

  function boot() {
    var hashId = (window.location.hash || "").replace(/^#/, "");
    var first = hashId || INITIAL_SCREEN;
    if (first) {
      navigateToScreen(first);
    } else {
      syncDataScreens("");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
</script>`;

  const trimmed = (rawHtml || "").trim();
  const hasHtmlTag = /<html[\s>]/i.test(trimmed);

  if (hasHtmlTag) {
    if (/<\/body>/i.test(trimmed)) {
      return trimmed.replace(/<\/body>/i, `${bridgeScript}\n</body>`);
    }
    if (/<\/html>/i.test(trimmed)) {
      return trimmed.replace(/<\/html>/i, `${bridgeScript}\n</html>`);
    }
    return `${trimmed}\n${bridgeScript}`;
  }

  // `ba-ticket` fragment format (no <!doctype>, <html>, or <body>)
  return `<!doctype html>
<html lang="en" data-theme="${initialTheme}" class="${initialTheme === "dark" ? "dark" : ""}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
</style>
</head>
<body>
${trimmed}
${bridgeScript}
</body>
</html>`;
}
