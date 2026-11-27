"use client";

import * as React from "react";
import { CheckIcon, ChevronRightIcon, CodeIcon, CopyIcon, Link2Icon } from "lucide-react";
import { cn } from "@/lib/utils";

export type ParsedChatTicket = {
  issueKey: string;
  title: string;
  goal: string;
  body: string;
  criteria: Array<{ id: string; text: string }>;
  dependsOn: string[];
  priority: string;
  complexity: string;
};

export function parseTicketsJson(lang: string, code: string): ParsedChatTicket[] | null {
  const l = lang.toLowerCase();
  if (l !== "sf-tickets" && l !== "json") return null;
  if (l === "json" && !/"tickets"\s*:|"issueKey"\s*:/.test(code)) return null;
  try {
    const parsed = JSON.parse(code) as unknown;
    const arr = Array.isArray(parsed)
      ? parsed
      : typeof parsed === "object" && parsed !== null
        ? Array.isArray((parsed as { tickets?: unknown }).tickets)
          ? (parsed as { tickets: unknown[] }).tickets
          : Array.isArray((parsed as { issues?: unknown }).issues)
            ? (parsed as { issues: unknown[] }).issues
            : null
        : null;
    if (!arr || arr.length === 0) return null;
    const out: ParsedChatTicket[] = [];
    arr.forEach((raw, idx) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
      const obj = raw as Record<string, unknown>;
      const title = typeof obj.title === "string" ? obj.title.trim() : "";
      if (!title) return;
      const issueKey =
        typeof obj.issueKey === "string" && obj.issueKey.trim()
          ? obj.issueKey.trim()
          : typeof obj.key === "string" && obj.key.trim()
            ? obj.key.trim()
            : `I${idx + 1}`;
      const goal =
        typeof obj.goal === "string"
          ? obj.goal.trim()
          : typeof obj.objective === "string"
            ? obj.objective.trim()
            : "";
      const body =
        typeof obj.body === "string"
          ? obj.body.trim()
          : typeof obj.description === "string"
            ? obj.description.trim()
            : "";
      const rawCrit = Array.isArray(obj.criteria)
        ? obj.criteria
        : Array.isArray(obj.acceptanceCriteria)
          ? obj.acceptanceCriteria
          : [];
      const criteria: Array<{ id: string; text: string }> = [];
      rawCrit.forEach((c, ci) => {
        if (typeof c === "string" && c.trim()) {
          criteria.push({ id: `C${ci + 1}`, text: c.trim() });
        } else if (c && typeof c === "object") {
          const co = c as Record<string, unknown>;
          const text = typeof co.text === "string" ? co.text.trim() : "";
          if (text) {
            criteria.push({
              id: typeof co.id === "string" && co.id.trim() ? co.id.trim() : `C${ci + 1}`,
              text,
            });
          }
        }
      });
      const rawDeps = Array.isArray(obj.dependsOn)
        ? obj.dependsOn
        : Array.isArray(obj.depends_on)
          ? obj.depends_on
          : [];
      const dependsOn = rawDeps
        .map((d) => (typeof d === "string" ? d.trim() : ""))
        .filter(Boolean);
      const priority =
        typeof obj.priority === "string" && obj.priority.trim()
          ? obj.priority.trim().toUpperCase()
          : "P2";
      const complexity =
        typeof obj.complexity === "string" && obj.complexity.trim()
          ? obj.complexity.trim().toUpperCase()
          : "M";
      out.push({ issueKey, title, goal, body, criteria, dependsOn, priority, complexity });
    });
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "code"; lang: string; code: string }
  | { type: "hr" }
  | { type: "blockquote"; lines: string[] }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "paragraph"; lines: string[] };

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return false;
  const cells = trimmed
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
  return cells.length >= 2 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cur = "";
  let inCode = false;
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === "`") {
      inCode = !inCode;
      cur += ch;
      continue;
    }
    if (ch === "\\" && trimmed[i + 1] === "|") {
      cur += "|";
      i += 1;
      continue;
    }
    if (ch === "|" && !inCode) {
      cells.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // Fenced code block
    const fence = /^```([a-zA-Z0-9_+-]*)\s*$/.exec(trimmed);
    if (fence) {
      const lang = fence[1] || "";
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({ type: "code", lang, code: codeLines.join("\n") });
      continue;
    }

    // Horizontal rule
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: "hr" });
      i += 1;
      continue;
    }

    // Heading
    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2].trim() });
      i += 1;
      continue;
    }

    // GFM Table
    if (trimmed.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headers = splitTableRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().includes("|")) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      blocks.push({ type: "table", headers, rows });
      continue;
    }

    // Blockquote
    if (trimmed.startsWith(">")) {
      const qLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        qLines.push(lines[i].trim().replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push({ type: "blockquote", lines: qLines });
      continue;
    }

    // Unordered list
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*•]\s+/, ""));
        i += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    // Ordered list
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        i += 1;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    // Paragraph (stop at next block start)
    const pLines: string[] = [];
    while (i < lines.length) {
      const cur = lines[i];
      const t = cur.trim();
      if (
        !t ||
        /^```/.test(t) ||
        /^(?:-{3,}|\*{3,}|_{3,})$/.test(t) ||
        /^#{1,6}\s+/.test(t) ||
        t.startsWith(">") ||
        /^\s*[-*•]\s+/.test(cur) ||
        /^\s*\d+[.)]\s+/.test(cur) ||
        (t.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1]))
      ) {
        break;
      }
      pLines.push(cur);
      i += 1;
    }
    if (pLines.length > 0) {
      blocks.push({ type: "paragraph", lines: pLines });
    } else {
      i += 1;
    }
  }

  return blocks;
}

function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Matches: `code`, **bold**, __bold__, *italic*, ~~strike~~, [label](https?://... | file://...)
  const pattern =
    /(`[^`\n]+`|\*\*[^*\n]+?\*\*|__[^_\n]+?__|~~[^~\n]+?~~|\[[^\]\n]+\]\((?:https?:\/\/|file:\/\/)[^\s)]+\)|\*[^*\n]+?\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        <code
          key={key++}
          className="rounded bg-muted/80 px-1.5 py-0.5 font-mono text-xs text-foreground/90"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (
      (token.startsWith("**") && token.endsWith("**")) ||
      (token.startsWith("__") && token.endsWith("__"))
    ) {
      nodes.push(
        <strong key={key++} className="font-semibold text-foreground">
          {renderInline(token.slice(2, -2))}
        </strong>,
      );
    } else if (token.startsWith("~~") && token.endsWith("~~")) {
      nodes.push(
        <del key={key++} className="text-muted-foreground">
          {token.slice(2, -2)}
        </del>,
      );
    } else if (token.startsWith("[")) {
      const httpMatch = /^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(token);
      const fileMatch = /^\[([^\]\n]+)\]\((file:\/\/[^\s)]+)\)$/.exec(token);
      if (httpMatch) {
        nodes.push(
          <a
            key={key++}
            href={httpMatch[2]}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
          >
            {httpMatch[1]}
          </a>,
        );
      } else if (fileMatch) {
        const cleanPath = fileMatch[2].replace(/^file:\/\//, "");
        nodes.push(
          <code
            key={key++}
            title={cleanPath}
            className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-primary"
          >
            {fileMatch[1]}
          </code>,
        );
      } else {
        nodes.push(token);
      }
    } else if (token.startsWith("*") && token.endsWith("*")) {
      nodes.push(
        <em key={key++} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    } else {
      nodes.push(token);
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = React.useState(false);

  function copy() {
    void navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="my-2 overflow-hidden rounded-[4px] border bg-background">
      <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-1 font-mono text-2xs uppercase tracking-wider text-muted-foreground">
        <span>{lang || "code"}</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 text-2xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {copied ? <CheckIcon className="size-3 text-success" /> : <CopyIcon className="size-3" />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed text-foreground">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function formatTicketStatusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

function ticketStatusTone(status: string): string {
  if (status === "passed" || status === "done") {
    return "text-primary bg-primary/10";
  }
  if (status === "in_progress") {
    return "text-amber-600 bg-amber-500/10 dark:text-amber-400";
  }
  if (status === "blocked" || status === "failed") {
    return "text-destructive bg-destructive/10";
  }
  return "text-muted-foreground bg-muted";
}

export function TicketsBlockCard({
  tickets,
  rawCode,
  selectedTicketKey,
  ticketStatusByKey,
  onSelectTicket,
}: {
  tickets: ParsedChatTicket[];
  rawCode: string;
  selectedTicketKey?: string | null;
  ticketStatusByKey?: Record<string, string>;
  onSelectTicket?: (ticket: ParsedChatTicket) => void;
}) {
  const [showRaw, setShowRaw] = React.useState(false);

  return (
    <div className="my-2 flex flex-col overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
        <span className="text-xs font-medium text-foreground">
          Drafted tickets
          <span className="ml-1.5 font-mono text-muted-foreground tabular-nums">
            {tickets.length}
          </span>
        </span>
        <button
          type="button"
          onClick={() => setShowRaw((v) => !v)}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <CodeIcon className="size-3.5" />
          <span>{showRaw ? "Hide JSON" : "JSON"}</span>
        </button>
      </div>

      <div className="flex flex-col divide-y divide-border/60">
        {tickets.map((t) => {
          const isSelected =
            selectedTicketKey?.toUpperCase() === t.issueKey.toUpperCase();
          const liveStatus = ticketStatusByKey?.[t.issueKey.toUpperCase()];
          const isUrgent = t.priority === "P0" || t.priority === "P1";
          return (
            <button
              key={t.issueKey}
              type="button"
              onClick={() => onSelectTicket?.(t)}
              className={cn(
                "group flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-muted/40",
                isSelected && "bg-primary/[0.06]",
              )}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "shrink-0 font-mono text-xs font-medium",
                      isSelected ? "text-primary" : "text-muted-foreground",
                    )}
                  >
                    {t.issueKey}
                  </span>
                  <span className="truncate text-sm font-medium text-foreground">
                    {t.title}
                  </span>
                </div>
                {t.goal && t.goal !== t.title && (
                  <p className="line-clamp-1 text-xs leading-relaxed text-muted-foreground">
                    {t.goal}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground/85">
                  <span className={cn("font-medium", isUrgent && "text-foreground")}>
                    {t.priority}
                  </span>
                  <span>·</span>
                  <span>{t.complexity}</span>
                  <span>·</span>
                  <span>{t.criteria.length} criteria</span>
                  {t.dependsOn.length > 0 && (
                    <>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1">
                        <Link2Icon className="size-3" />
                        {t.dependsOn.join(", ")}
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {liveStatus && (
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-medium capitalize",
                      ticketStatusTone(liveStatus),
                    )}
                  >
                    {formatTicketStatusLabel(liveStatus)}
                  </span>
                )}
                <ChevronRightIcon
                  className={cn(
                    "size-4 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground",
                    isSelected && "text-primary",
                  )}
                />
              </div>
            </button>
          );
        })}
      </div>

      {showRaw && (
        <pre className="max-h-72 overflow-auto border-t bg-muted/20 p-3.5 font-mono text-xs leading-relaxed text-muted-foreground">
          <code>{rawCode}</code>
        </pre>
      )}
    </div>
  );
}

export function MarkdownContent({
  content,
  className,
  variant = "chat",
  selectedTicketKey,
  ticketStatusByKey,
  onSelectTicket,
}: {
  content: string;
  className?: string;
  variant?: "chat" | "document";
  selectedTicketKey?: string | null;
  ticketStatusByKey?: Record<string, string>;
  onSelectTicket?: (ticket: ParsedChatTicket) => void;
}) {
  const blocks = React.useMemo(() => parseBlocks(content), [content]);
  const isDoc = variant === "document";

  return (
    <div
      className={cn(
        isDoc
          ? "flex flex-col gap-3.5 text-sm leading-6.5 text-foreground/90"
          : "flex flex-col gap-2.5 text-sm leading-6 text-foreground/95",
        className,
      )}
    >
      {blocks.map((block, idx) => {
        if (block.type === "heading") {
          const headingCls = isDoc
            ? block.level === 1
              ? "mt-2 border-b border-border/70 pb-2 text-xl font-semibold tracking-tight text-foreground first:mt-0"
              : block.level === 2
                ? "mt-5 border-b border-border/50 pb-1.5 text-lg font-semibold tracking-tight text-foreground first:mt-0"
                : block.level === 3
                  ? "mt-3 text-sm font-semibold tracking-tight text-foreground"
                  : "mt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            : block.level === 1
              ? "mt-1 text-lg font-semibold tracking-tight text-foreground"
              : block.level === 2
                ? "mt-1 text-base font-semibold tracking-tight text-foreground"
                : "mt-0.5 text-sm font-semibold text-foreground";
          return (
            <div key={idx} className={headingCls}>
              {renderInline(block.text)}
            </div>
          );
        }

        if (block.type === "code") {
          const tickets = parseTicketsJson(block.lang, block.code);
          if (tickets) {
            return (
              <TicketsBlockCard
                key={idx}
                tickets={tickets}
                rawCode={block.code}
                selectedTicketKey={selectedTicketKey}
                ticketStatusByKey={ticketStatusByKey}
                onSelectTicket={onSelectTicket}
              />
            );
          }
          return <CodeBlock key={idx} lang={block.lang} code={block.code} />;
        }

        if (block.type === "hr") {
          return <hr key={idx} className="my-1 border-border/70" />;
        }

        if (block.type === "blockquote") {
          return (
            <blockquote
              key={idx}
              className="border-l-2 border-primary/60 pl-3 text-sm text-muted-foreground"
            >
              {block.lines.map((l, li) => (
                <p key={li}>{renderInline(l)}</p>
              ))}
            </blockquote>
          );
        }

        if (block.type === "ul") {
          return (
            <ul key={idx} className="flex flex-col gap-1.5 pl-4">
              {block.items.map((item, ii) => (
                <li
                  key={ii}
                  className="list-disc marker:text-muted-foreground/70"
                >
                  {renderInline(item)}
                </li>
              ))}
            </ul>
          );
        }

        if (block.type === "ol") {
          return (
            <ol key={idx} className="flex flex-col gap-1.5 pl-5">
              {block.items.map((item, ii) => (
                <li
                  key={ii}
                  className="list-decimal marker:font-mono marker:text-xs marker:text-muted-foreground"
                >
                  {renderInline(item)}
                </li>
              ))}
            </ol>
          );
        }

        if (block.type === "table") {
          return (
            <div
              key={idx}
              className={cn(
                "my-1 overflow-x-auto border bg-card",
                isDoc ? "rounded-md" : "rounded-[4px]",
              )}
            >
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b bg-muted/45">
                    {block.headers.map((h, hi) => (
                      <th
                        key={hi}
                        className={cn(
                          "whitespace-nowrap font-medium text-foreground",
                          isDoc ? "px-3 py-2 font-mono text-xs uppercase tracking-wider text-muted-foreground" : "px-2.5 py-1.5",
                        )}
                      >
                        {renderInline(h)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, ri) => (
                    <tr
                      key={ri}
                      className="border-b transition-colors last:border-b-0 hover:bg-muted/25"
                    >
                      {row.map((cell, ci) => {
                        const trimmedCell = cell.trim();
                        const isCompactToken =
                          isDoc &&
                          trimmedCell.length > 0 &&
                          trimmedCell.length <= 24 &&
                          !/\s{2,}/.test(trimmedCell) &&
                          (ci === 0 ||
                            trimmedCell === "blocking" ||
                            trimmedCell === "minor" ||
                            trimmedCell === "review" ||
                            trimmedCell.startsWith("check:"));
                        const isBlocking = isDoc && trimmedCell === "blocking";
                        const isMinor = isDoc && trimmedCell === "minor";
                        return (
                          <td
                            key={ci}
                            className={cn(
                              "align-top leading-relaxed text-foreground/90",
                              isDoc ? "px-3 py-2.5" : "px-2.5 py-1.5",
                              isCompactToken && "whitespace-nowrap font-mono text-xs",
                            )}
                          >
                            {isBlocking ? (
                              <span className="inline-flex items-center rounded-full border border-destructive/35 bg-destructive/10 px-2 py-0.5 font-mono text-2xs font-medium text-destructive">
                                blocking
                              </span>
                            ) : isMinor ? (
                              <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 font-mono text-2xs font-medium text-muted-foreground">
                                minor
                              </span>
                            ) : (
                              renderInline(cell)
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        return (
          <p key={idx} className="whitespace-pre-wrap">
            {block.lines.map((line, li) => (
              <React.Fragment key={li}>
                {li > 0 && "\n"}
                {renderInline(line)}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
