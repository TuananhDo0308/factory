// Captures the HTML a new-ba run draws (the batch prototype and its design directions)
// from the daemon's tool_call steps, so the app can show it live without the agent
// having to publish it. The daemon sends each Write/Edit/MultiEdit with its full input.

export type BaHtmlTarget = {
  kind: "prototype" | "direction";
  /** Name of the batch folder, e.g. "todo-batch". */
  batch: string;
  /** ProjectPrototype slug: unique per project, stable across edits. */
  slug: string;
  title: string;
};

export type PrototypeToolCall = {
  tool: "Write" | "Edit" | "MultiEdit";
  target: BaHtmlTarget;
  filePath: string;
  input: Record<string, unknown>;
};

const HTML_TOOLS = new Set(["Write", "Edit", "MultiEdit"]);

function slugPart(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * new-ba's batch layout: `<batch>/prototype/index.html` is the prototype of the whole flow,
 * `<batch>/directions/<name>.html` is one design direction to pick from. `compare.html`
 * (screenshots side by side) and `open-me.html` (a wrapper) are derived pages, not drawings.
 */
export function classifyBaHtmlPath(filePath: string): BaHtmlTarget | null {
  const parts = filePath.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length < 3) return null;
  const [batchDir, folder, file] = parts.slice(-3);
  // Kept short so "<batch>-direction-<name>" stays within the 64-character slug limit.
  const batch = slugPart(batchDir).slice(0, 40).replace(/-+$/, "");
  if (!batch) return null;

  if (folder === "prototype" && file === "index.html") {
    return { kind: "prototype", batch, slug: `${batch}-prototype`, title: `${batchDir} prototype` };
  }
  if (folder === "directions" && file.endsWith(".html") && file !== "compare.html") {
    const name = file.slice(0, -".html".length);
    const id = slugPart(name);
    if (!id) return null;
    return {
      kind: "direction",
      batch,
      slug: `${batch}-direction-${id}`,
      title: `Direction ${name.length <= 2 ? name.toUpperCase() : name}`,
    };
  }
  return null;
}

/** The prototype or direction a tool_call step writes, or null for any other step. */
export function readPrototypeToolCall(data: unknown): PrototypeToolCall | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  if (d.kind !== "tool_call" || typeof d.tool !== "string" || !HTML_TOOLS.has(d.tool)) return null;
  const input = d.input;
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const filePath = (input as Record<string, unknown>).file_path;
  if (typeof filePath !== "string") return null;
  const target = classifyBaHtmlPath(filePath);
  if (!target) return null;
  return {
    tool: d.tool as PrototypeToolCall["tool"],
    target,
    filePath,
    input: input as Record<string, unknown>,
  };
}

function applyOneEdit(html: string, edit: Record<string, unknown>): string | null {
  const oldStr = edit.old_string;
  const newStr = edit.new_string;
  if (typeof oldStr !== "string" || typeof newStr !== "string" || !oldStr) return null;
  if (!html.includes(oldStr)) return null;
  return edit.replace_all === true ? html.split(oldStr).join(newStr) : html.replace(oldStr, () => newStr);
}

/**
 * The file's content after the tool call, or null when it cannot be known: an edit with
 * no earlier content, or one whose old_string is gone (a replay of an applied edit).
 */
export function applyHtmlToolCall(
  previous: string | null,
  tool: string,
  input: Record<string, unknown>,
): string | null {
  if (tool === "Write") {
    return typeof input.content === "string" ? input.content : null;
  }
  if (previous === null) return null;
  if (tool === "Edit") return applyOneEdit(previous, input);
  if (tool === "MultiEdit") {
    if (!Array.isArray(input.edits) || input.edits.length === 0) return null;
    let html: string | null = previous;
    for (const edit of input.edits) {
      if (html === null || !edit || typeof edit !== "object") return null;
      html = applyOneEdit(html, edit as Record<string, unknown>);
    }
    return html;
  }
  return null;
}

/** What a tool_call step recorded when a new-ba run wrote its prototype or a direction. */
type StepPrototypeRef = {
  kind: "prototype" | "direction";
  batch: string;
  slug: string;
  title: string;
};

export type PrototypeActivity =
  | { type: "prototype"; key: string; slug: string; title: string; writes: number }
  | { type: "directions"; key: string; batch: string; slugs: string[]; writes: number };

function readRef(data: unknown): StepPrototypeRef | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const ref = (data as Record<string, unknown>).prototype;
  if (!ref || typeof ref !== "object") return null;
  const r = ref as Record<string, unknown>;
  if ((r.kind !== "prototype" && r.kind !== "direction") || typeof r.slug !== "string") return null;
  return {
    kind: r.kind,
    batch: typeof r.batch === "string" ? r.batch : "",
    slug: r.slug,
    title: typeof r.title === "string" ? r.title : r.slug,
  };
}

/** The prototypes and direction sets a run of timeline steps drew, in first-seen order. */
export function collectPrototypeActivity(steps: Array<{ data?: unknown }>): PrototypeActivity[] {
  const out: PrototypeActivity[] = [];
  for (const step of steps) {
    const ref = readRef(step.data);
    if (!ref) continue;
    if (ref.kind === "prototype") {
      const found = out.find((a) => a.type === "prototype" && a.slug === ref.slug);
      if (found) found.writes += 1;
      else out.push({ type: "prototype", key: `p:${ref.slug}`, slug: ref.slug, title: ref.title, writes: 1 });
    } else {
      const found = out.find(
        (a): a is Extract<PrototypeActivity, { type: "directions" }> =>
          a.type === "directions" && a.batch === ref.batch,
      );
      if (found) {
        found.writes += 1;
        if (!found.slugs.includes(ref.slug)) found.slugs.push(ref.slug);
      } else {
        out.push({ type: "directions", key: `d:${ref.batch}`, batch: ref.batch, slugs: [ref.slug], writes: 1 });
      }
    }
  }
  return out;
}
