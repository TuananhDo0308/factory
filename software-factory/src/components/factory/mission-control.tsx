"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ActivityIcon,
  AlertCircleIcon,
  AlertTriangleIcon,
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  BotIcon,
  CheckCircle2Icon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  Columns3Icon,
  CopyIcon,
  CpuIcon,
  ExternalLinkIcon,
  EyeIcon,
  FileCodeIcon,
  FileImageIcon,
  FileTextIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  LaptopIcon,
  Link2Icon,
  LockIcon,
  MessageSquareIcon,
  PanelRightIcon,
  PaperclipIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  SearchIcon,
  ShieldAlertIcon,
  SparklesIcon,
  TerminalIcon,
  Trash2Icon,
  UserIcon,
  WrenchIcon,
  XCircleIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Progress } from "@/components/ui/progress";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import {
  FactoryMark,
  formatClockDuration,
  formatCompactTokens,
  formatRelativeTime,
  formatUsd,
  MeterBars,
  StatusDot,
} from "@/components/factory/factory-primitives";
import { FactoryPipelineView } from "@/components/factory/factory-pipeline-view";
import {
  MarkdownContent,
  parseTicketsJson,
  TicketsBlockCard,
  type ParsedChatTicket,
} from "@/components/factory/markdown-content";
import {
  AskedQuestionsSummary,
  QuestionSelectorDock,
} from "@/components/factory/question-selector-dock";
import {
  PrototypeChatCard,
  PrototypeStudio,
  toPrototypeViewModel,
  type PrototypeViewModel,
} from "@/components/factory/prototype-viewer";
import {
  useFactoryStream,
  useLiveRunStream,
} from "@/components/factory/use-factory-stream";
import {
  AttachmentPreviewStrip,
  MessageAttachments,
  prepareFilesForAttachment,
  toAttachmentPayload,
  type PendingAttachment,
} from "@/components/factory/chat-attachments";
import {
  ATTACHMENT_ACCEPT_ATTR,
  extractStepAttachments,
  type StoredAttachmentRef,
} from "@/lib/attachments";
import type { LiveChunkEvent } from "@/lib/realtime";
import { effortBarsForModel, formatModelLabel } from "@/lib/models";
import { isFactoryInitIssue } from "@/lib/init-issue-shared";
import {
  splitAssistantPrototypeBlocks,
  type SerializedPrototype,
} from "@/lib/prototypes";
import {
  extractQuestionSetFromAssistantText,
  extractQuestionsFromInteractionPayload,
  parseQuestionsJson,
  splitAssistantQuestionsBlock,
  type ParsedQuestionSet,
} from "@/lib/questions";
import { detectSkillFromPrompt, findSkillByIdOrMode } from "@/lib/skills";
import type { RunDetailData } from "@/lib/workspace-data";

type TimelineStep = RunDetailData["steps"][number];

const TOOL_STEP_NAMES = new Set([
  "bash",
  "read",
  "edit",
  "write",
  "glob",
  "grep",
  "webfetch",
  "websearch",
  "notebookedit",
  "agent",
  "run_command",
  "read_file",
  "write_file",
  "edit_file",
  "grep_search",
  "find_by_name",
  "list_dir",
  "search_web",
]);

function getStepDataObj(step: TimelineStep): Record<string, unknown> | null {
  if (step.data && typeof step.data === "object" && !Array.isArray(step.data)) {
    return step.data as Record<string, unknown>;
  }
  return null;
}

function classifyStep(
  step: TimelineStep,
): "human" | "assistant" | "tool" | "lifecycle" {
  const data = getStepDataObj(step);
  const kind = typeof data?.kind === "string" ? data.kind : "";
  if (kind === "assistant_message") return "assistant";
  if (kind === "tool_call") return "tool";
  if (
    kind === "turn_metrics" ||
    kind === "thinking" ||
    kind === "verdict" ||
    kind === "lifecycle"
  ) {
    return "lifecycle";
  }

  const stepLower = step.step.toLowerCase();
  const labelLower = (step.label || "").toLowerCase();

  if (
    step.role === "human" ||
    stepLower === "human-steer" ||
    stepLower === "human-response"
  ) {
    return "human";
  }

  if (
    stepLower === "assistant-response" ||
    stepLower.startsWith("response-") ||
    labelLower === "assistant" ||
    labelLower === "claude response" ||
    labelLower === "agent response"
  ) {
    return "assistant";
  }

  if (
    stepLower === "turn-metrics" ||
    stepLower === "claude-usage" ||
    stepLower === "usage-summary" ||
    stepLower === "cli-complete" ||
    stepLower === "verdict" ||
    stepLower === "git-worktree" ||
    stepLower === "daemon-spawn" ||
    stepLower === "daemon-resume" ||
    stepLower === "session-start" ||
    stepLower === "thinking" ||
    stepLower.startsWith("think-") ||
    labelLower.startsWith("turn completed") ||
    labelLower.endsWith(" completed") ||
    labelLower === "usage summary"
  ) {
    return "lifecycle";
  }

  if (
    TOOL_STEP_NAMES.has(stepLower) ||
    (step.label?.includes(": ") && Boolean(step.summary?.trim().startsWith("{")))
  ) {
    return "tool";
  }

  return "lifecycle";
}

type TimelineGroup =
  | { type: "human"; key: string; step: TimelineStep }
  | { type: "assistant"; key: string; step: TimelineStep }
  | {
      type: "trace";
      key: string;
      items: Array<{ step: TimelineStep; kind: "tool" | "lifecycle"; afterAssistant: boolean }>;
    };

function isNoiseExitText(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  return /^(?:agy|claude)\s+exited\s+with\s+code\s+\S+$/i.test(t) ||
    /^Run finished with outcome:\s*\S+$/i.test(t);
}

function groupTimelineSteps(steps: TimelineStep[]): TimelineGroup[] {
  const groups: TimelineGroup[] = [];
  let sawAssistantSinceLastHuman = false;

  for (const step of steps) {
    const stepLower = step.step.toLowerCase();
    // Skip redundant internal `session-created` row (the User Prompt bubble already represents it).
    if (stepLower === "session-created") continue;

    const kind = classifyStep(step);
    if (kind === "human") {
      sawAssistantSinceLastHuman = false;
      groups.push({ type: "human", key: step.id, step });
      continue;
    }
    if (kind === "assistant") {
      sawAssistantSinceLastHuman = true;
      groups.push({ type: "assistant", key: step.id, step });
      continue;
    }

    // Legacy compatibility: if a completion/verdict step carries the ONLY real AI answer
    // in this turn (no `assistant-response` before it), promote it to an Assistant message
    // instead of burying the answer inside a collapsed Trace line.
    if (
      !sawAssistantSinceLastHuman &&
      (stepLower === "cli-complete" || stepLower === "verdict") &&
      step.status !== "failed" &&
      step.status !== "blocked" &&
      step.summary &&
      !isNoiseExitText(step.summary)
    ) {
      sawAssistantSinceLastHuman = true;
      groups.push({ type: "assistant", key: step.id, step });
      continue;
    }

    // Skip empty boilerplate `verdict` line ("agy exited with code 0") when run status is already in header.
    if (stepLower === "verdict" && step.status === "passed" && (!step.summary || isNoiseExitText(step.summary))) {
      continue;
    }

    const last = groups.at(-1);
    const entry = { step, kind, afterAssistant: sawAssistantSinceLastHuman };
    if (last && last.type === "trace") {
      last.items.push(entry);
    } else {
      groups.push({ type: "trace", key: `trace-${step.id}`, items: [entry] });
    }
  }
  return groups;
}

function findActiveQuestionTurn(
  mode: string,
  status: string,
  steps: TimelineStep[],
  selectedAgentId: string | null,
): { stepId: string; questionSet: ParsedQuestionSet } | null {
  if (mode === "factory" || mode === "mission" || selectedAgentId !== null) return null;
  if (status === "running" || status === "queued") return null;

  const groups = groupTimelineSteps(steps);
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    const grp = groups[i];
    if (grp.type === "human") break;
    if (grp.type !== "assistant") continue;
    const summary = grp.step.summary;
    if (!summary) continue;
    const qs = extractQuestionSetFromAssistantText(summary);
    if (qs && qs.questions.length > 0) {
      return { stepId: grp.step.id, questionSet: qs };
    }
  }
  return null;
}

function TraceActivityItem({
  step,
  kind,
  afterAssistant,
  runActive,
  showAgentBadge = false,
}: {
  step: TimelineStep;
  kind: "tool" | "lifecycle";
  afterAssistant: boolean;
  runActive: boolean;
  showAgentBadge?: boolean;
}) {
  const data = getStepDataObj(step);
  const stepLower = step.step.toLowerCase();
  const isError = step.status === "failed" || step.status === "blocked";
  const isRunning = runActive && step.status === "started";
  const isWorktree = stepLower === "git-worktree";
  const isThinking =
    stepLower === "thinking" || stepLower.startsWith("think-") || data?.kind === "thinking";
  const isSpawn = stepLower === "daemon-spawn" || stepLower === "daemon-resume";
  const isCompletion =
    stepLower === "turn-metrics" ||
    stepLower === "claude-usage" ||
    stepLower === "usage-summary" ||
    stepLower === "cli-complete" ||
    stepLower === "verdict";

  // Extract structured tool/lifecycle details for TraceCollapsibleContent
  const toolName = (typeof data?.tool === "string" ? data.tool : step.step) || "step";
  const toolLower = toolName.toLowerCase();
  let inputPayload: unknown = data?.input ?? data?.parameters ?? null;
  let outputText: string | null = typeof data?.output === "string" ? data.output : null;
  let extraDetails: Record<string, unknown> | null = null;

  if (kind === "tool" && !inputPayload && !outputText && step.summary) {
    const trimmed = step.summary.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        inputPayload = JSON.parse(trimmed);
      } catch {
        outputText = trimmed;
      }
    } else if (trimmed !== "Completed") {
      outputText = trimmed;
    }
  } else if (kind === "lifecycle" && data) {
    const rest: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (k === "kind" || v === undefined || v === null || v === "") continue;
      rest[k] = v;
    }
    if (Object.keys(rest).length > 0) extraDetails = rest;
  }

  // Suppress repeated assistant response text on trailing legacy completion rows
  const isDuplicateLegacyBody = afterAssistant && isCompletion && !isError;
  const summaryBody =
    kind === "lifecycle" && step.summary && !isDuplicateLegacyBody ? step.summary : null;

  const hasContent =
    inputPayload !== null || Boolean(outputText) || Boolean(summaryBody) || extraDetails !== null;

  const Icon = isError
    ? AlertCircleIcon
    : isWorktree
      ? GitBranchIcon
      : isThinking
        ? SparklesIcon
        : isSpawn
          ? CpuIcon
          : isCompletion
            ? CheckCircle2Icon
            : toolLower.includes("bash") || toolLower.includes("command")
              ? TerminalIcon
              : toolLower.includes("grep") ||
                  toolLower.includes("search") ||
                  toolLower.includes("glob") ||
                  toolLower.includes("find")
                ? SearchIcon
                : toolLower.includes("read") ||
                    toolLower.includes("edit") ||
                    toolLower.includes("write") ||
                    toolLower.includes("file")
                  ? FileCodeIcon
                  : kind === "tool"
                    ? WrenchIcon
                    : CheckCircle2Icon;

  const thinkingTok =
    typeof data?.thinkingTokens === "number" && data.thinkingTokens > 0
      ? data.thinkingTokens
      : null;

  const title = isThinking && thinkingTok
    ? `Thought (${thinkingTok.toLocaleString()} tokens)`
    : step.label || step.step;

  const metaParts: string[] = [];
  if (step.durationMs) metaParts.push(`${(step.durationMs / 1000).toFixed(1)}s`);
  if (step.costUsd) metaParts.push(formatUsd(step.costUsd));
  const description = metaParts.join(" · ");

  const traceStatus: "running" | "error" | "pending" | undefined = isError
    ? "error"
    : isRunning
      ? "running"
      : step.status === "skipped"
        ? "pending"
        : undefined;

  const agentTag =
    showAgentBadge && step.agentId && step.agentId !== "orchestrator"
      ? step.agentId
      : null;

  const line = (
    <TraceLine status={traceStatus}>
      <TraceIcon>
        {isRunning ? <Spinner /> : <Icon />}
      </TraceIcon>
      {agentTag && (
        <span className="shrink-0 rounded-[4px] border bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground">
          {agentTag}
        </span>
      )}
      <TraceTitle>{title}</TraceTitle>
      {description && <TraceDescription>{description}</TraceDescription>}
    </TraceLine>
  );

  if (!hasContent) {
    return line;
  }

  return (
    <TraceCollapsible defaultOpen={isError}>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <div className="flex flex-col gap-2 text-xs">
          {inputPayload !== null && (
            <div className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
                Input
              </span>
              <pre className="max-h-48 overflow-auto rounded-[4px] border bg-muted/40 p-2.5 font-mono text-[11px] leading-relaxed text-foreground/90">
                {typeof inputPayload === "string"
                  ? inputPayload
                  : JSON.stringify(inputPayload, null, 2)}
              </pre>
            </div>
          )}

          {outputText && (
            <div className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
                Output
              </span>
              <pre className="max-h-56 overflow-auto rounded-[4px] border bg-muted/40 p-2.5 font-mono text-[11px] leading-relaxed text-foreground/90">
                {outputText}
              </pre>
            </div>
          )}

          {summaryBody &&
            (isError ? (
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-[4px] border border-destructive/40 bg-destructive/5 p-2.5 font-mono text-[11px] text-destructive">
                {summaryBody}
              </pre>
            ) : (
              <p className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-muted-foreground">
                {summaryBody}
              </p>
            ))}

          {extraDetails && !inputPayload && !outputText && (
            <pre className="max-h-40 overflow-auto rounded-[4px] border bg-muted/40 p-2.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
              {JSON.stringify(extraDetails, null, 2)}
            </pre>
          )}
        </div>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

function cleanPromptDisplay(raw: string): string {
  // Hide internal boilerplate tracking / unattended build / interactive question contracts appended automatically
  const stripped = raw
    .replace(/\n*Software Factory (?:Tracking|Unattended Build) Contract:[\s\S]*$/i, "")
    .replace(/\n*Interactive Questions Contract:[\s\S]*$/i, "")
    .trim();
  return stripped || raw.trim();
}

function formatCleanAgentSummary(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      for (const key of ["overview", "summary", "headline", "verdict", "message"]) {
        const val = parsed?.[key];
        if (typeof val === "string" && val.trim()) {
          return val.trim();
        }
      }
      return null;
    } catch {
      // Partial / truncated raw JSON payload — hide raw braces from header
      const overviewMatch = /"overview"\s*:\s*"([^"]+)"/.exec(trimmed);
      if (overviewMatch?.[1]) return overviewMatch[1].trim();
      const summaryMatch = /"summary"\s*:\s*"([^"]+)"/.exec(trimmed);
      if (summaryMatch?.[1]) return summaryMatch[1].trim();
      return null;
    }
  }
  return trimmed;
}

function formatPlainExcerpt(raw: string | null | undefined, maxLen = 160): string {
  if (!raw) return "";
  const plain = raw
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= maxLen) return plain;
  return `${plain.slice(0, maxLen - 1).trimEnd()}…`;
}

function UserChatBubble({
  text,
  label = "You",
  timestamp,
  attachments,
}: {
  text: string;
  label?: string;
  timestamp: string;
  attachments?: StoredAttachmentRef[];
}) {
  const [expanded, setExpanded] = React.useState(false);
  const cleaned = React.useMemo(() => cleanPromptDisplay(text), [text]);
  const lineCount = cleaned.split("\n").length;
  const isLong = cleaned.length > 260 || lineCount > 5;
  const displayText =
    isLong && !expanded
      ? `${cleaned.split("\n").slice(0, 4).join("\n").slice(0, 260).trimEnd()}…`
      : cleaned;

  return (
    <div className="flex w-full justify-end">
      <div className="flex max-w-[82%] flex-col items-end gap-1">
        <div className="flex items-center gap-1.5 px-0.5 font-mono text-[10px] text-muted-foreground">
          <span>{label}</span>
          <span>·</span>
          <span suppressHydrationWarning>{formatRelativeTime(timestamp)}</span>
          <UserIcon className="size-3 text-muted-foreground" />
        </div>
        <div className="rounded-lg border border-border/80 bg-muted/40 px-3.5 py-2.5 text-sm leading-relaxed text-foreground">
          {displayText && <p className="whitespace-pre-wrap">{displayText}</p>}
          {isLong && (
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="mt-1.5 font-mono text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              {expanded ? "Collapse prompt" : "Show full prompt"}
            </button>
          )}
          {attachments && attachments.length > 0 && (
            <MessageAttachments attachments={attachments} />
          )}
        </div>
      </div>
    </div>
  );
}

function splitAssistantTicketsBlock(rawText: string): {
  prose: string;
  ticketsJson: string | null;
  ticketsStreaming: boolean;
  ticketKeys: string[];
  isTruncatedLegacy: boolean;
} {
  const closedRe = /```sf-tickets\s*([\s\S]*?)```/i;
  const closedMatch = closedRe.exec(rawText);
  if (closedMatch) {
    const jsonRaw = closedMatch[1].trim();
    const prose = (
      rawText.slice(0, closedMatch.index) +
      rawText.slice(closedMatch.index + closedMatch[0].length)
    ).trim();
    const keys = Array.from(jsonRaw.matchAll(/"issueKey"\s*:\s*"([^"]+)"/g)).map((m) => m[1]);
    return {
      prose,
      ticketsJson: jsonRaw,
      ticketsStreaming: false,
      ticketKeys: keys,
      isTruncatedLegacy: false,
    };
  }

  // Unclosed ```sf-tickets fence while live-streaming
  const openRe = /```sf-tickets\b([\s\S]*)$/i;
  const openMatch = openRe.exec(rawText);
  if (openMatch) {
    const partial = openMatch[1].trim();
    const prose = rawText.slice(0, openMatch.index).trim();
    const keys = Array.from(partial.matchAll(/"issueKey"\s*:\s*"([^"]+)"/g)).map((m) => m[1]);
    return {
      prose,
      ticketsJson: partial,
      ticketsStreaming: true,
      ticketKeys: keys,
      isTruncatedLegacy: false,
    };
  }

  // Graceful handling for older runs created before the 200k limit fix where the front of a
  // long `sf-tickets` response was truncated off.
  if (
    /"issueKey"\s*:/.test(rawText) &&
    /"criteria"\s*:/.test(rawText) &&
    /```\s*$/.test(rawText.trim())
  ) {
    const keys = Array.from(rawText.matchAll(/"issueKey"\s*:\s*"([^"]+)"/g)).map((m) => m[1]);
    return {
      prose: "",
      ticketsJson: rawText.replace(/```\s*$/, "").trim(),
      ticketsStreaming: false,
      ticketKeys: keys,
      isTruncatedLegacy: true,
    };
  }

  return {
    prose: rawText,
    ticketsJson: null,
    ticketsStreaming: false,
    ticketKeys: [],
    isTruncatedLegacy: false,
  };
}

function AssistantMessageCard({
  step,
  runActive,
  selectedTicketKey,
  ticketStatusByKey,
  onSelectTicket,
  fallbackTickets,
  isActiveQuestionStep = false,
  dbPrototypes = [],
  selectedPrototypeSlug = null,
  onSelectPrototype,
}: {
  step: TimelineStep;
  runActive: boolean;
  selectedTicketKey?: string | null;
  ticketStatusByKey?: Record<string, string>;
  onSelectTicket?: (ticket: ParsedChatTicket) => void;
  fallbackTickets?: ParsedChatTicket[];
  isActiveQuestionStep?: boolean;
  dbPrototypes?: SerializedPrototype[];
  selectedPrototypeSlug?: string | null;
  onSelectPrototype?: (vm: PrototypeViewModel) => void;
}) {
  const [copied, setCopied] = React.useState(false);
  const text = step.summary || "";
  const isStreaming = runActive && step.status === "started";
  const parsedQuestionsBlock = React.useMemo(() => splitAssistantQuestionsBlock(text), [text]);
  const parsedProtoBlocks = React.useMemo(
    () => splitAssistantPrototypeBlocks(parsedQuestionsBlock.prose),
    [parsedQuestionsBlock.prose],
  );
  const parsed = React.useMemo(
    () => splitAssistantTicketsBlock(parsedProtoBlocks.prose),
    [parsedProtoBlocks.prose],
  );
  const parsedQuestionSet = React.useMemo(() => {
    if (!parsedQuestionsBlock.questionsJson || parsedQuestionsBlock.questionsStreaming) return null;
    return parseQuestionsJson(parsedQuestionsBlock.questionsJson);
  }, [parsedQuestionsBlock.questionsJson, parsedQuestionsBlock.questionsStreaming]);
  const parsedTickets = React.useMemo(() => {
    if (!parsed.ticketsJson || parsed.ticketsStreaming) return null;
    const direct = parseTicketsJson("sf-tickets", parsed.ticketsJson);
    if (direct && direct.length > 0) return direct;
    if (parsed.isTruncatedLegacy && fallbackTickets && fallbackTickets.length > 0) {
      return fallbackTickets;
    }
    return null;
  }, [parsed.ticketsJson, parsed.ticketsStreaming, parsed.isTruncatedLegacy, fallbackTickets]);

  function copyResponse() {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("Copied response");
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="group/msg flex w-full justify-start">
      <div className="flex w-full items-start gap-3">
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border bg-muted/50 text-foreground/80">
          <FactoryMark className="size-3.5" />
        </span>

        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-semibold text-foreground">Assistant</span>
              {step.model && (
                <span className="text-muted-foreground">{formatModelLabel(step.model)}</span>
              )}
              {step.spec && (
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                  {step.spec}
                </span>
              )}
              {isStreaming && (
                <span className="inline-flex items-center gap-1 text-primary">
                  <Spinner className="size-3" />
                  Streaming
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground/80 tabular-nums">
              {step.durationMs ? <span>{(step.durationMs / 1000).toFixed(1)}s</span> : null}
              {step.costUsd ? <span>{formatUsd(step.costUsd)}</span> : null}
              {text && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  title="Copy Markdown"
                  className="opacity-0 transition-opacity group-hover/msg:opacity-100 focus-visible:opacity-100"
                  onClick={copyResponse}
                >
                  {copied ? <CheckIcon className="text-primary" /> : <CopyIcon />}
                </Button>
              )}
            </div>
          </div>

          {parsed.prose ? (
            <MarkdownContent
              content={parsed.prose}
              selectedTicketKey={selectedTicketKey}
              ticketStatusByKey={ticketStatusByKey}
              onSelectTicket={onSelectTicket}
            />
          ) : !parsed.ticketsJson &&
            !parsedQuestionsBlock.questionsJson &&
            parsedProtoBlocks.prototypes.length === 0 &&
            !parsedProtoBlocks.prototypeStreaming ? (
            <span className="text-xs italic text-muted-foreground">Empty response</span>
          ) : null}

          {parsedProtoBlocks.prototypeStreaming && (
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3.5 py-2.5 text-xs text-foreground">
              <Spinner className="size-3.5 text-primary" />
              <span>
                Building interactive HTML prototype
                {parsedProtoBlocks.streamingTitle
                  ? ` (${parsedProtoBlocks.streamingTitle})…`
                  : "…"}
              </span>
            </div>
          )}

          {parsedProtoBlocks.prototypes.map((proto, pIdx) => {
            const dbMatch =
              dbPrototypes.find(
                (d) =>
                  d.slug.toLowerCase() === proto.slug.toLowerCase() ||
                  (proto.htmlPath && d.localPath && d.localPath.endsWith(proto.htmlPath)) ||
                  d.title.toLowerCase() === proto.title.toLowerCase(),
              ) ?? null;
            return (
              <PrototypeChatCard
                key={`${proto.slug}-${pIdx}`}
                prototype={proto}
                resolvedDbPrototype={dbMatch}
                isSelected={
                  selectedPrototypeSlug?.toLowerCase() ===
                  (dbMatch?.slug ?? proto.slug).toLowerCase()
                }
                onOpen={(vm) => onSelectPrototype?.(vm)}
              />
            );
          })}

          {parsed.isTruncatedLegacy && !parsedTickets && (
            <p className="text-xs text-muted-foreground">
              The summary from this earlier run exceeded the old buffer cap, and all drafted tickets are synced to Kanban.
            </p>
          )}

          {parsedQuestionsBlock.questionsJson !== null &&
            (parsedQuestionsBlock.questionsStreaming ? (
              <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3.5 py-2.5 text-xs text-foreground">
                <Spinner className="size-3.5 text-primary" />
                <span>
                  Preparing interactive options
                  {parsedQuestionsBlock.questionCount > 0
                    ? ` (${parsedQuestionsBlock.questionCount})…`
                    : "…"}
                </span>
              </div>
            ) : parsedQuestionSet ? (
              <AskedQuestionsSummary
                questions={parsedQuestionSet.questions}
                isPendingBelow={isActiveQuestionStep}
              />
            ) : null)}

          {parsed.ticketsJson !== null &&
            (parsed.ticketsStreaming ? (
              <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3.5 py-2.5 text-xs text-foreground">
                <Spinner className="size-3.5 text-primary" />
                <span>
                  Drafting Kanban tickets
                  {parsed.ticketKeys.length > 0
                    ? ` (${parsed.ticketKeys.join(", ")})…`
                    : "…"}
                </span>
              </div>
            ) : parsedTickets ? (
              <TicketsBlockCard
                tickets={parsedTickets}
                rawCode={parsed.ticketsJson}
                selectedTicketKey={selectedTicketKey}
                ticketStatusByKey={ticketStatusByKey}
                onSelectTicket={onSelectTicket}
              />
            ) : (
              <Trace className="pt-0.5">
                <TraceCollapsible defaultOpen={false}>
                  <TraceCollapsibleTrigger>
                    <TraceLine>
                      <TraceIcon>
                        <FileCodeIcon />
                      </TraceIcon>
                      <TraceTitle>
                        Structured Kanban Tickets JSON
                        {parsed.ticketKeys.length > 0
                          ? ` (${parsed.ticketKeys.length}: ${parsed.ticketKeys.join(", ")})`
                          : ""}
                      </TraceTitle>
                      <TraceDescription>View raw payload</TraceDescription>
                    </TraceLine>
                  </TraceCollapsibleTrigger>
                  <TraceCollapsibleContent>
                    <pre className="max-h-72 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-relaxed text-foreground/90">
                      {parsed.ticketsJson}
                    </pre>
                  </TraceCollapsibleContent>
                </TraceCollapsible>
              </Trace>
            ))}
        </div>
      </div>
    </div>
  );
}

function effortForModel(model: string | null | undefined): number {
  return effortBarsForModel(model);
}

type TraceItemEntry = {
  step: TimelineStep;
  kind: "tool" | "lifecycle";
  afterAssistant: boolean;
};

type AgentTraceCluster = {
  key: string;
  agentKey: string;
  agentLabel: string;
  items: TraceItemEntry[];
  totalCost: number;
  totalDurationMs: number;
  hasError: boolean;
  summaryText: string;
};

function summarizeClusterActions(items: TraceItemEntry[]): string {
  let reads = 0;
  let writes = 0;
  let cmds = 0;
  let thoughts = 0;
  for (const { step } of items) {
    const s = `${step.step} ${step.label || ""}`.toLowerCase();
    if (s.includes("think")) thoughts++;
    else if (s.includes("bash") || s.includes("command")) cmds++;
    else if (s.includes("edit") || s.includes("write")) writes++;
    else if (s.includes("read") || s.includes("search") || s.includes("grep") || s.includes("glob")) {
      reads++;
    }
  }
  const parts: string[] = [];
  if (reads > 0) parts.push(`${reads} read${reads === 1 ? "" : "s"}`);
  if (writes > 0) parts.push(`${writes} edit${writes === 1 ? "" : "s"}`);
  if (cmds > 0) parts.push(`${cmds} cmd${cmds === 1 ? "" : "s"}`);
  if (thoughts > 0) parts.push(`${thoughts} thought${thoughts === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

function splitTraceIntoAgentClusters(
  items: TraceItemEntry[],
  agentNameById: Map<string, string>,
): AgentTraceCluster[] {
  const clusters: AgentTraceCluster[] = [];
  const byInvocationKey = new Map<string, AgentTraceCluster>();

  for (const entry of items) {
    const data = getStepDataObj(entry.step);
    const subagentConvId =
      typeof data?.subagentConvId === "string" && data.subagentConvId.trim()
        ? data.subagentConvId.trim()
        : null;
    const rawKey = entry.step.runAgentId || entry.step.agentId || "orchestrator";
    const invocationKey = subagentConvId ? `conv:${subagentConvId}` : null;

    let target: AgentTraceCluster | undefined;
    if (invocationKey) {
      // Group steps from the same subagent invocation together (in first-seen
      // chronological order) so parallel subagents don't fragment into interleaved rows.
      target = byInvocationKey.get(invocationKey);
    } else {
      const last = clusters.at(-1);
      if (last && !last.key.startsWith("conv:") && last.agentKey === rawKey) {
        target = last;
      }
    }

    if (target) {
      target.items.push(entry);
    } else {
      const label =
        (entry.step.runAgentId && agentNameById.get(entry.step.runAgentId)) ||
        (typeof data?.agentName === "string" && data.agentName.trim()) ||
        entry.step.agentId ||
        entry.step.spec ||
        "Session Orchestrator";
      const cluster: AgentTraceCluster = {
        key: invocationKey ? `${invocationKey}-${entry.step.id}` : `${rawKey}-${entry.step.id}`,
        agentKey: rawKey,
        agentLabel: label,
        items: [entry],
        totalCost: 0,
        totalDurationMs: 0,
        hasError: false,
        summaryText: "",
      };
      clusters.push(cluster);
      if (invocationKey) byInvocationKey.set(invocationKey, cluster);
    }
  }

  for (const c of clusters) {
    c.totalCost = c.items.reduce((sum, it) => sum + (it.step.costUsd ?? 0), 0);
    c.totalDurationMs = c.items.reduce((sum, it) => sum + (it.step.durationMs ?? 0), 0);
    c.hasError = c.items.some(
      (it) => it.step.status === "failed" || it.step.status === "blocked",
    );
    c.summaryText = summarizeClusterActions(c.items);
  }

  return clusters;
}

function CollapsibleTraceCluster({
  cluster,
  isCompleted,
  runActive,
  showAgentBadge,
  forceExpanded,
  onClearForce,
}: {
  cluster: AgentTraceCluster;
  isCompleted: boolean;
  runActive: boolean;
  showAgentBadge: boolean;
  forceExpanded: boolean | null;
  onClearForce: () => void;
}) {
  // Collapse completed multi-step groups (> 2 steps, no error) so long Factory chats stay compact
  const defaultOpen = !isCompleted || cluster.items.length <= 2 || cluster.hasError;
  const [manualOpen, setManualOpen] = React.useState<boolean | null>(null);
  const [showAllInActive, setShowAllInActive] = React.useState(false);

  const isOpen = forceExpanded !== null ? forceExpanded : (manualOpen ?? defaultOpen);

  // Render quiet 1-step completed lifecycle notes inline without accordion chrome
  if (
    cluster.items.length === 1 &&
    cluster.items[0].kind === "lifecycle" &&
    !cluster.hasError &&
    isCompleted
  ) {
    const only = cluster.items[0];
    return (
      <div className="flex w-full justify-start pl-9">
        <Trace className="w-full">
          <TraceActivityItem
            step={only.step}
            kind={only.kind}
            afterAssistant={only.afterAssistant}
            runActive={runActive}
            showAgentBadge={false}
          />
        </Trace>
      </div>
    );
  }

  // If this is a short 1-2 step active cluster, render plain without box chrome
  if (cluster.items.length <= 2 && !isCompleted) {
    return (
      <div className="flex w-full justify-start pl-9">
        <Trace className="w-full">
          {cluster.items.map((item) => (
            <TraceActivityItem
              key={item.step.id}
              step={item.step}
              kind={item.kind}
              afterAssistant={item.afterAssistant}
              runActive={runActive}
              showAgentBadge={showAgentBadge}
            />
          ))}
        </Trace>
      </div>
    );
  }

  // For active long groups (> 10 steps), keep latest 8 visible with an expand button for older steps
  const MAX_LIVE_VISIBLE = 8;
  const hideOlderCount =
    !isCompleted && !showAllInActive && cluster.items.length > MAX_LIVE_VISIBLE + 2
      ? cluster.items.length - MAX_LIVE_VISIBLE
      : 0;
  const visibleItems = hideOlderCount > 0 ? cluster.items.slice(-MAX_LIVE_VISIBLE) : cluster.items;
  const stepCountLabel = `${cluster.items.length} ${cluster.items.length === 1 ? "step" : "steps"}`;

  return (
    <div className="flex w-full flex-col">
      <button
        type="button"
        onClick={() => {
          onClearForce();
          setManualOpen(!isOpen);
        }}
        className="group/trace flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-muted/50"
      >
        <div className="flex min-w-0 items-center gap-2">
          <ChevronRightIcon
            className={`size-3.5 shrink-0 text-muted-foreground/70 transition-transform ${
              isOpen ? "rotate-90" : ""
            }`}
          />
          {cluster.hasError ? (
            <AlertCircleIcon className="size-3.5 shrink-0 text-destructive" />
          ) : isCompleted ? (
            <CheckCircle2Icon className="size-3.5 shrink-0 text-primary/80" />
          ) : (
            <Spinner className="size-3.5 shrink-0 text-primary" />
          )}
          <span className="truncate text-xs font-medium text-foreground">
            {cluster.agentLabel}
          </span>
          <span className="hidden truncate text-xs text-muted-foreground sm:inline">
            {cluster.summaryText ? `${stepCountLabel} · ${cluster.summaryText}` : stepCountLabel}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2.5 font-mono text-[11px] text-muted-foreground/80 tabular-nums">
          {cluster.totalDurationMs > 0 && (
            <span>{(cluster.totalDurationMs / 1000).toFixed(1)}s</span>
          )}
          {cluster.totalCost > 0 && <span>{formatUsd(cluster.totalCost)}</span>}
        </div>
      </button>

      {isOpen && (
        <div className="mt-1 ml-4 border-l border-border/70 py-1.5 pl-4">
          {hideOlderCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAllInActive(true)}
              className="mb-2 inline-flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Show {hideOlderCount} earlier step{hideOlderCount === 1 ? "" : "s"}
            </button>
          )}
          <Trace>
            {visibleItems.map((item) => (
              <TraceActivityItem
                key={item.step.id}
                step={item.step}
                kind={item.kind}
                afterAssistant={item.afterAssistant}
                runActive={runActive}
                showAgentBadge={false}
              />
            ))}
          </Trace>
        </div>
      )}
    </div>
  );
}

export function MissionControl({
  initialRun,
  initialAgentId = null,
}: {
  initialRun: RunDetailData;
  initialAgentId?: string | null;
}) {
  const router = useRouter();
  const [run, setRun] = React.useState<RunDetailData>(initialRun);
  const [selectedAgentId, setSelectedAgentId] = React.useState<string | null>(initialAgentId);
  const [agentQuery, setAgentQuery] = React.useState("");
  const [steerMessage, setSteerMessage] = React.useState("");
  const [answerDrafts, setAnswerDrafts] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [nowTick, setNowTick] = React.useState<number>(
    () => new Date(initialRun.updatedAt).getTime(),
  );
  // Factory mode defaults to Live view unless opened directly to a specific subagent (?agent=...)
  const [viewMode, setViewMode] = React.useState<"chat" | "pipeline">(() =>
    initialAgentId ? "chat" : initialRun.mode === "factory" ? "pipeline" : "chat",
  );
  const [expandAllGroups, setExpandAllGroups] = React.useState<boolean | null>(null);
  const [inspectorOpen, setInspectorOpen] = React.useState(false);
  const [showStatusDetails, setShowStatusDetails] = React.useState(false);
  const [prevInitialAgentId, setPrevInitialAgentId] = React.useState<string | null>(initialAgentId);

  // Sync if user clicks a different subagent in the sidebar while already on this session
  if (initialAgentId !== prevInitialAgentId) {
    setPrevInitialAgentId(initialAgentId);
    if (initialAgentId) {
      setSelectedAgentId(initialAgentId);
      setViewMode("chat");
    }
  }
  // BA / ticket selection -> reveals right-side Issue Detail inspector
  const [selectedTicket, setSelectedTicket] = React.useState<ParsedChatTicket | null>(null);
  const [selectedIssueId, setSelectedIssueId] = React.useState<string | null>(null);
  // Interactive Prototype preview -> reveals right-side Prototype Studio
  const [selectedPrototype, setSelectedPrototype] = React.useState<PrototypeViewModel | null>(null);

  const runPrototypes = React.useMemo(() => run.prototypes ?? [], [run.prototypes]);
  const activePrototype = React.useMemo<PrototypeViewModel | null>(() => {
    if (!selectedPrototype) return null;
    const freshDb = runPrototypes.find(
      (p) =>
        (selectedPrototype.id && p.id === selectedPrototype.id) ||
        p.slug.toLowerCase() === selectedPrototype.slug.toLowerCase(),
    );
    return freshDb ? toPrototypeViewModel(freshDb) : selectedPrototype;
  }, [selectedPrototype, runPrototypes]);

  // Sticky auto-scroll for Chat timeline
  const chatScrollContainerRef = React.useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = React.useRef(true);
  const [showJumpToBottom, setShowJumpToBottom] = React.useState(false);

  const getChatViewport = React.useCallback((): HTMLElement | null => {
    return (
      chatScrollContainerRef.current?.querySelector<HTMLElement>(
        '[data-slot="scroll-area-viewport"]',
      ) ?? null
    );
  }, []);

  const scrollChatToBottom = React.useCallback(
    (force = false) => {
      if (!force && !stickToBottomRef.current) return;
      requestAnimationFrame(() => {
        const vp = getChatViewport();
        if (!vp) return;
        vp.scrollTop = vp.scrollHeight;
        if (force) {
          stickToBottomRef.current = true;
          setShowJumpToBottom(false);
        }
      });
    },
    [getChatViewport],
  );

  React.useEffect(() => {
    const vp = getChatViewport();
    if (!vp) return;
    const onScroll = () => {
      const distFromBottom = vp.scrollHeight - vp.scrollTop - vp.clientHeight;
      const nearBottom = distFromBottom < 120;
      stickToBottomRef.current = nearBottom;
      setShowJumpToBottom(!nearBottom);
    };
    vp.addEventListener("scroll", onScroll, { passive: true });
    // Always snap to bottom on initial mount / switching back to chat view
    vp.scrollTop = vp.scrollHeight;
    const contentEl = vp.querySelector<HTMLElement>('[data-slot="chat-scroll-content"]');
    let ro: ResizeObserver | null = null;
    if (contentEl && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => {
        if (stickToBottomRef.current) {
          vp.scrollTop = vp.scrollHeight;
        }
      });
      ro.observe(contentEl);
    }
    return () => {
      vp.removeEventListener("scroll", onScroll);
      ro?.disconnect();
    };
  }, [getChatViewport, viewMode]);

  type LiveOverlayState = {
    streamingTextByStep: Record<
      string,
      { agentKey: string; agentName?: string; text: string; model?: string; ts: number }
    >;
    activeToolsByStep: Record<
      string,
      { agentKey: string; agentName?: string; tool: string; label: string; output?: string; ts: number }
    >;
    liveThinking: {
      stepKey: string;
      agentKey: string;
      agentName?: string;
      text: string;
      ts: number;
    } | null;
    liveActivityByAgent: Record<string, { activity: string; status: string; ts: number }>;
  };

  const [liveOverlay, setLiveOverlay] = React.useState<LiveOverlayState>({
    streamingTextByStep: {},
    activeToolsByStep: {},
    liveThinking: null,
    liveActivityByAgent: {},
  });

  const applyLiveChunks = React.useCallback((chunks: LiveChunkEvent[]) => {
    if (!chunks || chunks.length === 0) return;
    setLiveOverlay((prev) => {
      let nextTexts = prev.streamingTextByStep;
      let nextTools = prev.activeToolsByStep;
      let nextThinking = prev.liveThinking;
      let nextActivities = prev.liveActivityByAgent;
      let changed = false;

      for (const chunk of chunks) {
        if (chunk.kind === "text_delta" && chunk.delta) {
          if (nextTexts === prev.streamingTextByStep) nextTexts = { ...prev.streamingTextByStep };
          const cur = nextTexts[chunk.stepKey];
          const combined = `${cur?.text || ""}${chunk.delta}`;
          nextTexts[chunk.stepKey] = {
            agentKey: chunk.agentKey,
            agentName: chunk.agentName ?? cur?.agentName,
            text: combined.length > 200_000 ? combined.slice(0, 200_000) : combined,
            model: chunk.model ?? cur?.model,
            ts: chunk.ts,
          };
          changed = true;
        } else if (chunk.kind === "thinking" && chunk.text) {
          nextThinking = {
            stepKey: chunk.stepKey,
            agentKey: chunk.agentKey,
            agentName: chunk.agentName,
            text: chunk.text,
            ts: chunk.ts,
          };
          changed = true;
        } else if (chunk.kind === "tool_active") {
          if (nextTools === prev.activeToolsByStep) nextTools = { ...prev.activeToolsByStep };
          nextTools[chunk.stepKey] = {
            agentKey: chunk.agentKey,
            agentName: chunk.agentName,
            tool: chunk.tool,
            label: chunk.label,
            output: nextTools[chunk.stepKey]?.output,
            ts: chunk.ts,
          };
          if (nextActivities === prev.liveActivityByAgent) {
            nextActivities = { ...prev.liveActivityByAgent };
          }
          nextActivities[chunk.agentKey] = {
            activity: chunk.label,
            status: "working",
            ts: chunk.ts,
          };
          changed = true;
        } else if (chunk.kind === "tool_output") {
          if (nextTools === prev.activeToolsByStep) nextTools = { ...prev.activeToolsByStep };
          const cur = nextTools[chunk.stepKey];
          nextTools[chunk.stepKey] = {
            agentKey: chunk.agentKey,
            agentName: chunk.agentName ?? cur?.agentName,
            tool: chunk.tool,
            label: chunk.label || cur?.label || chunk.tool,
            output: chunk.output,
            ts: chunk.ts,
          };
          changed = true;
        } else if (chunk.kind === "tool_done") {
          if (nextTools[chunk.stepKey]) {
            if (nextTools === prev.activeToolsByStep) nextTools = { ...prev.activeToolsByStep };
            delete nextTools[chunk.stepKey];
            changed = true;
          }
        } else if (chunk.kind === "activity") {
          if (nextActivities === prev.liveActivityByAgent) {
            nextActivities = { ...prev.liveActivityByAgent };
          }
          nextActivities[chunk.agentKey] = {
            activity: chunk.activity,
            status: chunk.status,
            ts: chunk.ts,
          };
          changed = true;
        }
      }

      if (!changed) return prev;
      return {
        streamingTextByStep: nextTexts,
        activeToolsByStep: nextTools,
        liveThinking: nextThinking,
        liveActivityByAgent: nextActivities,
      };
    });
  }, []);

  const refreshRun = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/sessions/${run.id}`, { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { run?: RunDetailData };
        if (data.run) setRun(data.run);
      }
    } catch {
      // Ignore transient poll failure.
    }
  }, [run.id]);

  const runnerOnlineCount =
    run.runnerState?.onlineCount ?? (run.runner?.status === "online" ? 1 : 0);
  const hasLiveStreamActivity = Boolean(
    liveOverlay.liveThinking ||
      Object.keys(liveOverlay.activeToolsByStep).length > 0 ||
      Object.keys(liveOverlay.streamingTextByStep).length > 0,
  );
  const isWaitingForDaemon =
    (run.status === "running" || run.status === "queued") &&
    !hasLiveStreamActivity &&
    runnerOnlineCount === 0 &&
    (Boolean(run.runnerState?.hasPendingCommand) ||
      run.steps.length <= 1 ||
      run.agents.some(
        (a) =>
          a.status === "waiting_on_you" &&
          (a.activity || "").toLowerCase().includes("sf daemon"),
      ));

  const isActive =
    !isWaitingForDaemon &&
    (run.status === "running" || run.status === "queued" || run.status === "awaiting_input");

  const handleFactoryStreamEvent = React.useCallback(
    (eventType: string, payload: unknown) => {
      if (eventType === "live:chunk") {
        const raw =
          payload && typeof payload === "object"
            ? (payload as { payload?: { chunks?: LiveChunkEvent[] }; chunks?: LiveChunkEvent[] })
            : null;
        const chunks = raw?.payload?.chunks ?? raw?.chunks;
        if (Array.isArray(chunks) && chunks.length > 0) {
          applyLiveChunks(chunks);
        }
        return;
      }
      void refreshRun();
    },
    [applyLiveChunks, refreshRun],
  );

  useFactoryStream(handleFactoryStreamEvent, {
    runId: run.id,
    pollIntervalMs: isActive ? 1500 : isWaitingForDaemon ? 3000 : 4000,
  });

  const liveTransport = useLiveRunStream({
    runId: run.id,
    active: isActive,
    onChunks: applyLiveChunks,
    onCommit: () => void refreshRun(),
  });

  React.useEffect(() => {
    if (!isActive) return;
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isActive]);

  const elapsedMs = isWaitingForDaemon
    ? (run.durationMs ?? 0)
    : (run.durationMs ?? Math.max(0, nowTick - new Date(run.startedAt).getTime()));
  // Active tokens = uncached input + output (matching Antigravity `total_tokens`).
  // Prompt-cache reads are tracked and shown separately so multi-turn prefix re-reads
  // don't visually inflate headline token counts by 5x–15x.
  const activeTokens = run.inputTokens + run.outputTokens;
  const cacheRate =
    run.inputTokens + run.cacheReadTokens > 0
      ? Math.round((run.cacheReadTokens / (run.inputTokens + run.cacheReadTokens)) * 100)
      : 0;

  const passedAgents = run.agents.filter((a) => a.status === "passed").length;
  const progressPct =
    run.status === "passed"
      ? 100
      : run.agents.length > 0
        ? Math.round((passedAgents / run.agents.length) * 100)
        : 10;

  const pendingInteractions = run.interactions.filter((i) => i.status === "pending");
  const selectedAgent = run.agents.find((a) => a.id === selectedAgentId) ?? null;

  const committedStepMap = React.useMemo(() => {
    const map = new Map<string, RunDetailData["steps"][number]>();
    for (const s of run.steps) {
      map.set(s.step, s);
    }
    return map;
  }, [run.steps]);

  const filteredSteps = React.useMemo(() => {
    const base = selectedAgent
      ? run.steps.filter((s) => {
          if (s.runAgentId || s.agentId) {
            return s.runAgentId === selectedAgent.id || s.agentId === selectedAgent.agentKey;
          }
          return Boolean(selectedAgent.specId && s.spec === selectedAgent.specId);
        })
      : run.steps;
    if (!isActive) return base;
    return base.map((s) => {
      if (s.status !== "started") return s;
      const liveText = liveOverlay.streamingTextByStep[s.step];
      if (liveText && liveText.text.length > (s.summary?.length ?? 0)) {
        return { ...s, summary: liveText.text };
      }
      const liveTool = liveOverlay.activeToolsByStep[s.step];
      if (liveTool?.output) {
        const prevData =
          s.data && typeof s.data === "object" && !Array.isArray(s.data)
            ? (s.data as Record<string, unknown>)
            : {};
        if (String(prevData.output || "") !== liveTool.output) {
          return { ...s, data: { ...prevData, output: liveTool.output } };
        }
      }
      return s;
    });
  }, [run.steps, selectedAgent, isActive, liveOverlay]);

  const visibleLiveEntries = React.useMemo(() => {
    if (!isActive) {
      return {
        texts: [] as Array<{
          stepKey: string;
          agentKey: string;
          agentName?: string;
          text: string;
          model?: string;
          ts: number;
        }>,
        tools: [] as Array<{
          stepKey: string;
          agentKey: string;
          agentName?: string;
          tool: string;
          label: string;
          output?: string;
          ts: number;
        }>,
        thinking: null as LiveOverlayState["liveThinking"],
      };
    }

    const matchesSelected = (agentKey: string) =>
      !selectedAgent || selectedAgent.agentKey === agentKey;

    const texts = Object.entries(liveOverlay.streamingTextByStep)
      .filter(([stepKey, entry]) => {
        if (!entry.text.trim() || !matchesSelected(entry.agentKey)) return false;
        // If DB already has this step (either draft patched above or finalized), don't duplicate
        return !committedStepMap.has(stepKey);
      })
      .map(([stepKey, entry]) => ({ stepKey, ...entry }))
      .sort((a, b) => a.ts - b.ts);

    const tools = Object.entries(liveOverlay.activeToolsByStep)
      .filter(([stepKey, entry]) => {
        if (!matchesSelected(entry.agentKey)) return false;
        const dbStep = committedStepMap.get(stepKey);
        if (dbStep) return false;
        return true;
      })
      .map(([stepKey, entry]) => ({ stepKey, ...entry }))
      .sort((a, b) => a.ts - b.ts);

    const thinking =
      liveOverlay.liveThinking &&
      matchesSelected(liveOverlay.liveThinking.agentKey) &&
      !committedStepMap.has(liveOverlay.liveThinking.stepKey)
        ? liveOverlay.liveThinking
        : null;

    return { texts, tools, thinking };
  }, [isActive, selectedAgent, liveOverlay, committedStepMap]);

  const liveOverlaySig =
    visibleLiveEntries.texts.map((t) => `${t.stepKey}:${t.text.length}`).join("|") +
    "#" +
    visibleLiveEntries.tools.map((t) => `${t.stepKey}:${t.output?.length ?? 0}`).join("|") +
    "#" +
    (visibleLiveEntries.thinking?.text.length ?? 0);

  const lastStepSig = filteredSteps.at(-1)
    ? `${filteredSteps.at(-1)!.id}:${filteredSteps.at(-1)!.summary?.length ?? 0}`
    : "";
  const workingActivity =
    (selectedAgent
      ? liveOverlay.liveActivityByAgent[selectedAgent.agentKey]?.activity
      : liveOverlay.liveActivityByAgent["orchestrator"]?.activity) ||
    run.agents.find((a) => a.status === "working")?.activity ||
    "";

  React.useEffect(() => {
    if (viewMode === "chat") {
      scrollChatToBottom(false);
    }
  }, [
    filteredSteps.length,
    lastStepSig,
    liveOverlaySig,
    workingActivity,
    run.status,
    selectedAgentId,
    viewMode,
    scrollChatToBottom,
  ]);

  // Ticket status map & resolved inspected issue for Right Pane
  const ticketStatusByKey = React.useMemo(() => {
    const map: Record<string, string> = {};
    for (const iss of run.projectDraftIssues || []) {
      map[iss.issueKey.toUpperCase()] = iss.status;
    }
    return map;
  }, [run.projectDraftIssues]);

  const inspectedDbIssue = React.useMemo(() => {
    const list = run.projectDraftIssues || [];
    if (selectedIssueId) {
      return list.find((i) => i.id === selectedIssueId) ?? null;
    }
    if (selectedTicket) {
      return (
        list.find(
          (i) => i.issueKey.toUpperCase() === selectedTicket.issueKey.toUpperCase(),
        ) ?? null
      );
    }
    return null;
  }, [run.projectDraftIssues, selectedIssueId, selectedTicket]);

  const inspectedIssue = inspectedDbIssue
    ? {
        id: inspectedDbIssue.id,
        issueKey: inspectedDbIssue.issueKey,
        title: inspectedDbIssue.title,
        goal: inspectedDbIssue.goal,
        body: inspectedDbIssue.body,
        criteria: inspectedDbIssue.criteria,
        dependsOn: inspectedDbIssue.dependsOn,
        priority: inspectedDbIssue.priority,
        complexity: inspectedDbIssue.complexity,
        tier: inspectedDbIssue.tier,
        autonomy: inspectedDbIssue.autonomy,
        status: inspectedDbIssue.status,
      }
    : selectedTicket
      ? {
          id: null as string | null,
          issueKey: selectedTicket.issueKey,
          title: selectedTicket.title,
          goal: selectedTicket.goal,
          body: selectedTicket.body,
          criteria: selectedTicket.criteria,
          dependsOn: selectedTicket.dependsOn,
          priority: selectedTicket.priority,
          complexity: selectedTicket.complexity,
          tier: null as string | null,
          autonomy: null as string | null,
          status: "backlog",
        }
      : null;

  function handleSelectChatTicket(ticket: ParsedChatTicket) {
    const dbMatch = (run.projectDraftIssues || []).find(
      (i) => i.issueKey.toUpperCase() === ticket.issueKey.toUpperCase(),
    );
    setSelectedPrototype(null);
    setSelectedIssueId(dbMatch?.id ?? null);
    setSelectedTicket(ticket);
  }

  function handleSelectDbIssue(issueId: string) {
    const dbMatch = (run.projectDraftIssues || []).find((i) => i.id === issueId);
    setSelectedPrototype(null);
    setSelectedIssueId(issueId);
    setSelectedTicket(
      dbMatch
        ? {
            issueKey: dbMatch.issueKey,
            title: dbMatch.title,
            goal: dbMatch.goal,
            body: dbMatch.body,
            criteria: dbMatch.criteria,
            dependsOn: dbMatch.dependsOn,
            priority: dbMatch.priority,
            complexity: dbMatch.complexity,
          }
        : null,
    );
  }

  function handleSelectPrototype(vm: PrototypeViewModel) {
    setSelectedIssueId(null);
    setSelectedTicket(null);
    setSelectedPrototype(vm);
  }

  async function handleUpdateInspectedStatus(issueId: string, status: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${run.project.id}/issues/${issueId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        toast.error("Could not update ticket status");
        return;
      }
      toast.success(`Moved ticket to ${status.replace("_", " ")}`);
      await refreshRun();
    } finally {
      setBusy(false);
    }
  }

  async function handleRunSingleIssue(issueId: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${run.project.id}/dispatch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "run_issue", issueId }),
      });
      const data = (await res.json().catch(() => null)) as {
        run?: { id: string };
        issueKey?: string;
        error?: string;
      } | null;
      if (!res.ok || !data?.run) {
        toast.error(data?.error || "Could not start Factory run");
        return;
      }
      toast.success(`Launched Factory run for ${data.issueKey || "ticket"}`);
      router.push(`/sessions/${data.run.id}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteInspectedIssue(issueId: string, key: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${run.project.id}/issues/${issueId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        toast.error("Could not delete ticket");
        return;
      }
      setSelectedIssueId(null);
      setSelectedTicket(null);
      toast.success(`Deleted ${key}`);
      await refreshRun();
    } finally {
      setBusy(false);
    }
  }

  const isBaMode = run.mode === "ba";
  const isClarifyMode = run.mode === "clarify";
  const isUnattendedBuild = run.mode === "factory" || run.mode === "mission";
  const isInitMode = run.mode === "init" || (run.issue ? isFactoryInitIssue(run.issue) : false);
  const showLeftRail = !isBaMode && !isInitMode && !isClarifyMode && run.agents.length > 1;
  const showRightPane = Boolean(activePrototype) || (isBaMode ? Boolean(inspectedIssue) : inspectorOpen);

  const timelineGroups = groupTimelineSteps(filteredSteps);

  const activeQuestionTurn = React.useMemo(
    () => findActiveQuestionTurn(run.mode, run.status, run.steps, selectedAgentId),
    [run.mode, run.status, run.steps, selectedAgentId],
  );
  const dbFallbackTickets = React.useMemo<ParsedChatTicket[]>(
    () =>
      (run.projectDraftIssues || []).map((iss) => ({
        issueKey: iss.issueKey,
        title: iss.title,
        goal: iss.goal,
        body: iss.body,
        criteria: iss.criteria,
        dependsOn: iss.dependsOn,
        priority: iss.priority,
        complexity: iss.complexity,
      })),
    [run.projectDraftIssues],
  );

  const q = agentQuery.trim().toLowerCase();
  const visibleAgents = run.agents.filter(
    (a) =>
      !q ||
      a.name.toLowerCase().includes(q) ||
      a.role.toLowerCase().includes(q) ||
      (a.activity || "").toLowerCase().includes(q),
  );
  const waitingAgents = visibleAgents.filter((a) => a.status === "waiting_on_you");
  const workingAgents = visibleAgents.filter((a) => a.status === "working");
  const idleAgents = visibleAgents.filter(
    (a) => a.status !== "waiting_on_you" && a.status !== "working",
  );

  const [steerAttachments, setSteerAttachments] = React.useState<PendingAttachment[]>([]);
  const [steerDragOver, setSteerDragOver] = React.useState(false);
  const steerFileInputRef = React.useRef<HTMLInputElement | null>(null);

  const initialPromptAttachments = React.useMemo(() => {
    const createdStep = run.steps.find((s) => s.step === "session-created");
    return extractStepAttachments(createdStep?.data);
  }, [run.steps]);

  async function handleAddSteerFiles(files: FileList | File[]) {
    const { added, errors } = await prepareFilesForAttachment(files, steerAttachments);
    for (const err of errors) toast.error(err);
    if (added.length > 0) {
      setSteerAttachments((prev) => [...prev, ...added]);
    }
  }

  async function handleSteerSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!steerMessage.trim() && steerAttachments.length === 0) return;
    if (runnerOnlineCount === 0) {
      toast.error("No local daemon connected — start `sf daemon` on your machine first.", {
        action: {
          label: "Connect",
          onClick: () => router.push("/settings?tab=runners"),
        },
      });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/sessions/${run.id}/steer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: steerMessage.trim(),
          attachments:
            steerAttachments.length > 0 ? toAttachmentPayload(steerAttachments) : undefined,
          agentKey: selectedAgent?.agentKey,
        }),
      });
      if (!res.ok) {
        const errData = (await res.json().catch(() => null)) as {
          error?: string;
          code?: string;
        } | null;
        toast.error(errData?.error || "Failed to send instruction", {
          action:
            errData?.code === "NO_RUNNER_ONLINE" || res.status === 503
              ? {
                  label: "Connect",
                  onClick: () => router.push("/settings?tab=runners"),
                }
              : undefined,
        });
        return;
      }
      setSteerMessage("");
      setSteerAttachments([]);
      toast.success("Steer instruction dispatched");
      await refreshRun();
      scrollChatToBottom(true);
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmitQuestionAnswers(formattedMessage: string) {
    const trimmed = formattedMessage.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/sessions/${run.id}/steer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          agentKey: selectedAgent?.agentKey,
        }),
      });
      if (!res.ok) {
        const errData = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(errData?.error || "Failed to send answers");
        return;
      }
      toast.success("Answers sent — resuming session");
      await refreshRun();
      scrollChatToBottom(true);
    } finally {
      setBusy(false);
    }
  }

  async function handleResolveInteraction(
    interactionId: string,
    decision: "approved" | "answered" | "dismissed",
    overrideMessage?: string,
  ) {
    setBusy(true);
    try {
      const res = await fetch(`/api/sessions/${run.id}/steer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          interactionId,
          decision,
          message: overrideMessage ?? answerDrafts[interactionId] ?? "",
        }),
      });
      if (!res.ok) {
        const errData = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(errData?.error || "Failed to submit response");
        return;
      }
      setAnswerDrafts((prev) => ({ ...prev, [interactionId]: "" }));
      toast.success(`Interaction ${decision}`);
      await refreshRun();
      scrollChatToBottom(true);
    } finally {
      setBusy(false);
    }
  }

  async function handleTogglePause() {
    setBusy(true);
    try {
      const pausing = run.status === "running" || run.status === "queued";
      const res = await fetch(`/api/sessions/${run.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: pausing ? "awaiting_input" : "running",
          action: pausing ? "pause" : "resume",
        }),
      });
      if (res.ok) {
        toast.success(pausing ? "Run paused" : "Run resumed");
        await refreshRun();
      } else {
        const errData = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(errData?.error || (pausing ? "Could not pause run" : "Could not resume run"));
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelSession() {
    setBusy(true);
    try {
      const res = await fetch(`/api/sessions/${run.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
      });
      if (res.ok) {
        toast.success("Session cancelled");
        await refreshRun();
        router.refresh();
      } else {
        const errData = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(errData?.error || "Could not cancel session");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteSession() {
    setBusy(true);
    try {
      const res = await fetch(`/api/sessions/${run.id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Session deleted");
        router.push(`/projects/${run.project.id}`);
        router.refresh();
      } else {
        const errData = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(errData?.error || "Could not delete session");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmBaTickets(autoRun: boolean) {
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${run.project.id}/dispatch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: autoRun ? "confirm_and_run" : "confirm_all" }),
      });
      const data = (await res.json().catch(() => null)) as {
        confirmedCount?: number;
        needsInit?: boolean;
        skippedReason?: string | null;
        dispatched?: Array<{ issueKey: string }>;
        error?: string;
      } | null;
      if (!res.ok) {
        toast.error(data?.error || "Could not confirm tickets");
        return;
      }
      const needsInit = Boolean(
        data?.needsInit || data?.skippedReason === "project_not_initialized",
      );
      if (autoRun) {
        toast.success(
          needsInit
            ? `Confirmed ${data?.confirmedCount ?? 0} ticket(s) — run /factory init once before Auto-Run starts`
            : `Confirmed ${data?.confirmedCount ?? 0} ticket(s) — Auto-Run started on Kanban Board`,
        );
        router.push(`/projects/${run.project.id}?tab=issues`);
        return;
      }
      toast.success(
        needsInit
          ? `Confirmed ${data?.confirmedCount ?? 0} ticket(s) → Ready (run /factory init once before building)`
          : `Confirmed ${data?.confirmedCount ?? 0} ticket(s) → Ready`,
      );
      await refreshRun();
    } finally {
      setBusy(false);
    }
  }

  async function handleCompleteInitIssue() {
    setBusy(true);
    try {
      const res = run.issue
        ? await fetch(`/api/projects/${run.project.id}/issues/${run.issue.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ status: "passed" }),
          })
        : await fetch(`/api/projects/${run.project.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ initStatus: "complete" }),
          });
      if (!res.ok) {
        toast.error("Could not mark Factory Init as complete");
        return;
      }
      toast.success("Factory Init completed — unattended Factory builds unlocked!");
      await refreshRun();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleOpenClarifyForIssue(issueId: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${run.project.id}/dispatch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "clarify_issue", issueId }),
      });
      const data = (await res.json().catch(() => null)) as {
        run?: { id: string };
        error?: string;
      } | null;
      if (!res.ok || !data?.run) {
        toast.error(data?.error || "Could not start /factory clarify");
        return;
      }
      toast.success("Opened interactive /factory clarify session");
      router.push(`/sessions/${data.run.id}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleApproveClarifiedTicket(startBuild: boolean) {
    if (!run.issue) return;
    setBusy(true);
    try {
      const patchRes = await fetch(`/api/projects/${run.project.id}/issues/${run.issue.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "ready" }),
      });
      if (!patchRes.ok) {
        toast.error("Could not approve ticket to Ready");
        return;
      }
      if (startBuild) {
        const dispatchRes = await fetch(`/api/projects/${run.project.id}/dispatch`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "run_issue", issueId: run.issue.id }),
        });
        const data = (await dispatchRes.json().catch(() => null)) as {
          run?: { id: string };
          error?: string;
        } | null;
        if (dispatchRes.ok && data?.run) {
          toast.success(`Approved ${run.issue.issueKey} & started unattended Factory build`);
          router.push(`/sessions/${data.run.id}`);
          return;
        }
        toast.warning(data?.error || `Approved ${run.issue.issueKey} → Ready`);
      } else {
        toast.success(`Approved ${run.issue.issueKey} → Ready`);
      }
      await refreshRun();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleRetrySession() {
    setBusy(true);
    try {
      const res = await fetch(`/api/sessions/${run.id}/retry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          phase: run.currentPhase,
          specId: selectedAgent?.specId,
        }),
      });
      if (res.ok) {
        toast.success(
          sessionSkillSlash
            ? `Retrying session with ${sessionSkillSlash}`
            : "Retrying session...",
        );
        await refreshRun();
        router.refresh();
      } else {
        const errData = (await res.json().catch(() => null)) as {
          error?: string;
          code?: string;
        } | null;
        toast.error(errData?.error || "Retry failed", {
          action:
            errData?.code === "NO_RUNNER_ONLINE" || res.status === 503
              ? {
                  label: "Connect",
                  onClick: () => router.push("/settings?tab=runners"),
                }
              : undefined,
        });
      }
    } finally {
      setBusy(false);
    }
  }

  const sessionSkill = React.useMemo(() => {
    const fromPrompt = run.prompt ? detectSkillFromPrompt(run.prompt)?.skill : null;
    return fromPrompt ?? findSkillByIdOrMode(run.mode);
  }, [run.prompt, run.mode]);
  const sessionSkillSlash = sessionSkill?.slash || "";
  const isRetryable =
    run.status === "failed" ||
    run.status === "blocked" ||
    run.status === "stalled" ||
    run.status === "cancelled";

  const activeSkillDisplay = sessionSkill
    ? `${sessionSkill.slash} · ${sessionSkill.label}`
    : `/${run.mode}`;

  const steerComposer = (
    <form onSubmit={handleSteerSubmit} className="border-t bg-background px-5 py-3">
      <div className="mx-auto w-full max-w-3xl">
        <InputGroup
          onDragOver={(e) => {
            e.preventDefault();
            if (!steerDragOver) setSteerDragOver(true);
          }}
          onDragLeave={() => setSteerDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setSteerDragOver(false);
            if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
              void handleAddSteerFiles(e.dataTransfer.files);
            }
          }}
          className={`rounded-lg bg-card transition-colors ${
            steerDragOver ? "border-primary ring-2 ring-primary/30" : ""
          }`}
        >
          <input
            ref={steerFileInputRef}
            type="file"
            multiple
            accept={ATTACHMENT_ACCEPT_ATTR}
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                void handleAddSteerFiles(e.target.files);
              }
              e.target.value = "";
            }}
          />
          {steerAttachments.length > 0 && (
            <div className="w-full px-3 pt-2.5">
              <AttachmentPreviewStrip
                attachments={steerAttachments}
                onRemove={(id) =>
                  setSteerAttachments((prev) => prev.filter((a) => a.id !== id))
                }
              />
            </div>
          )}
          <InputGroupTextarea
            rows={2}
            value={steerMessage}
            onChange={(e) => setSteerMessage(e.target.value)}
            onPaste={(e) => {
              const files = e.clipboardData?.files;
              if (files && files.length > 0) {
                e.preventDefault();
                void handleAddSteerFiles(files);
              }
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Enter") {
                if (e.metaKey || e.ctrlKey) {
                  e.preventDefault();
                  const el = e.currentTarget;
                  const start = el.selectionStart ?? steerMessage.length;
                  const end = el.selectionEnd ?? steerMessage.length;
                  const next = `${steerMessage.slice(0, start)}\n${steerMessage.slice(end)}`;
                  setSteerMessage(next);
                  requestAnimationFrame(() => {
                    el.setSelectionRange(start + 1, start + 1);
                  });
                  return;
                }
                if (e.shiftKey || e.altKey) {
                  return;
                }
                e.preventDefault();
                if ((steerMessage.trim() || steerAttachments.length > 0) && !busy) {
                  void handleSteerSubmit();
                }
              }
            }}
            placeholder={
              selectedAgent
                ? `Message ${selectedAgent.name} (paste/drop images or files)...`
                : "Message the orchestrator, or paste/drop images & files..."
            }
            className="min-h-12 px-3 pt-2.5 text-sm"
          />
          <InputGroupAddon align="block-end" className="justify-between gap-2 px-2.5 pb-2">
            <div className="flex min-w-0 items-center gap-2 font-mono text-xs text-muted-foreground">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={busy}
                onClick={() => steerFileInputRef.current?.click()}
                title="Attach images (PNG, JPG, WEBP, GIF, AVIF, BMP, SVG) or files (PDF, MD, JSON, CSV, code)"
                aria-label="Attach images or files"
              >
                <PaperclipIcon />
              </Button>
              <span
                className="inline-flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground"
                title={sessionSkill?.description || `Active skill: ${activeSkillDisplay}`}
              >
                {sessionSkill?.slash || `/${run.mode}`}
              </span>
              <span className="truncate">{formatModelLabel(run.model)}</span>
              {runnerOnlineCount === 0 && (
                <Link
                  href="/settings?tab=runners"
                  className="inline-flex shrink-0 items-center gap-1 rounded border border-warning/35 bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning transition-colors hover:bg-warning/15"
                  title="No local sf daemon connected"
                >
                  <AlertTriangleIcon className="size-3" />
                  <span>Daemon offline</span>
                </Link>
              )}
              {run.humanInterventions > 0 && (
                <span className="shrink-0">· {run.humanInterventions} steer</span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {isWaitingForDaemon ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void handleCancelSession()}
                >
                  <XCircleIcon data-icon="inline-start" />
                  Cancel
                </Button>
              ) : (
                (run.status === "running" || run.status === "queued") && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void handleTogglePause()}
                  >
                    <PauseIcon data-icon="inline-start" />
                    Pause
                  </Button>
                )
              )}
              {run.status === "awaiting_input" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void handleTogglePause()}
                >
                  <PlayIcon data-icon="inline-start" />
                  Resume
                </Button>
              )}
              {isRetryable && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void handleRetrySession()}
                >
                  <RotateCcwIcon data-icon="inline-start" />
                  Retry
                </Button>
              )}
              <Button
                type="submit"
                variant={runnerOnlineCount === 0 ? "secondary" : "default"}
                size="icon-sm"
                disabled={busy || (!steerMessage.trim() && steerAttachments.length === 0)}
                title={
                  runnerOnlineCount === 0
                    ? "Connect sf daemon before sending"
                    : "Send (Enter · Shift/⌘/Ctrl+Enter for new line)"
                }
              >
                {busy ? <Spinner /> : <ArrowUpIcon />}
              </Button>
            </div>
          </InputGroupAddon>
        </InputGroup>
      </div>
    </form>
  );

  // Group agents by level for Left Mission Tree
  const groupedByLevel = React.useMemo(() => {
    const groups = new Map<string, RunDetailData["agents"]>();
    for (const a of run.agents) {
      const label =
        a.role === "orchestrator" || a.role === "planner"
          ? "Orchestration & Spec"
          : a.role === "checker"
            ? "Verification Checks"
            : a.role === "reviewer" || a.role === "spec-reviewer" || a.role === "qc"
              ? "Review & QC"
              : a.role === "subagent" ||
                  a.role === "research" ||
                  a.role === "browser" ||
                  a.role === "worker"
                ? "Subagents"
                : `Build Wave ${a.level ?? 1}`;
      const list = groups.get(label) ?? [];
      list.push(a);
      groups.set(label, list);
    }
    return Array.from(groups.entries());
  }, [run.agents]);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Top Mission Control Header Strip */}
      <header className="flex flex-col border-b bg-background px-5 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Link
                href={`/projects/${run.project.id}`}
                className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
              >
                <ArrowLeftIcon className="size-3.5" />
                <span>{run.project.name}</span>
              </Link>
              {run.issue && (
                <>
                  <span>/</span>
                  <span className="font-mono font-medium text-foreground">
                    {run.issue.issueKey}
                  </span>
                </>
              )}
              {!(run.mode === "factory" && viewMode === "pipeline") && (
                <>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1.5 text-foreground/85">
                    <StatusDot status={isWaitingForDaemon ? "waiting_on_you" : run.status} />
                    <span className={isWaitingForDaemon ? "text-warning" : "capitalize"}>
                      {isWaitingForDaemon ? "Waiting for daemon" : run.status.replace("_", " ")}
                    </span>
                  </span>
                </>
              )}
              {run.risk === "high" && (
                <Badge variant="destructive" className="ml-1 h-4 px-1.5 text-[10px]">
                  high risk
                </Badge>
              )}
            </div>
            <h1 className="truncate text-base font-semibold tracking-tight text-foreground">
              {run.title}
            </h1>
          </div>

          {/* Right Controls (KPIs omitted in Factory Live mode since the dashboard band shows them) */}
          <div className="flex flex-wrap items-center gap-3">
            {isActive && (liveTransport === "ably" || liveTransport === "supabase") && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-medium text-primary"
                title={`Real-time token & log streaming via ${liveTransport === "ably" ? "Ably Realtime" : "Supabase Broadcast"}`}
              >
                <span className="size-1.5 animate-pulse rounded-full bg-primary" />
                Live
              </span>
            )}
            {!(run.mode === "factory" && viewMode === "pipeline") && (
              <div
                className="hidden items-center gap-2 font-mono text-xs text-muted-foreground tabular-nums md:flex"
                title={`Active: ${activeTokens.toLocaleString()} (Input: ${run.inputTokens.toLocaleString()} · Output: ${run.outputTokens.toLocaleString()}) · Cached reads: ${run.cacheReadTokens.toLocaleString()} (${cacheRate}% cache hit)${run.engine === "antigravity" ? " · Cost is API-equivalent estimate" : ""}`}
              >
                <span className="text-foreground">{formatClockDuration(elapsedMs)}</span>
                <span>·</span>
                <span>
                  {formatCompactTokens(activeTokens)}
                  {cacheRate > 0 ? ` (${cacheRate}% cache)` : ""}
                </span>
                <span>·</span>
                <span className="text-foreground">
                  {run.engine === "antigravity" && run.costUsd > 0 ? "~" : ""}
                  {formatUsd(run.costUsd)}
                </span>
              </div>
            )}

            <div className="flex items-center gap-1.5">
              {/* Compact run controls directly in header when in Factory Live view (unattended: no Pause/Resume mid-loop) */}
              {isUnattendedBuild && viewMode === "pipeline" && (
                <>
                  {isRetryable && run.issue && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() => void handleOpenClarifyForIssue(run.issue!.id)}
                    >
                      <MessageSquareIcon data-icon="inline-start" />
                      Clarify Ticket
                    </Button>
                  )}
                  {isRetryable && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => void handleRetrySession()}
                    >
                      <RotateCcwIcon data-icon="inline-start" />
                      Retry
                    </Button>
                  )}
                </>
              )}
              {run.mode === "factory" && (
                <div className="flex items-center rounded-md border bg-muted/40 p-0.5">
                  <Button
                    type="button"
                    variant={viewMode === "pipeline" ? "secondary" : "ghost"}
                    size="xs"
                    onClick={() => setViewMode("pipeline")}
                  >
                    <ActivityIcon data-icon="inline-start" />
                    Live
                  </Button>
                  <Button
                    type="button"
                    variant={viewMode === "chat" ? "secondary" : "ghost"}
                    size="xs"
                    onClick={() => setViewMode("chat")}
                  >
                    <TerminalIcon data-icon="inline-start" />
                    Chat
                  </Button>
                </div>
              )}
              {runPrototypes.length > 0 && viewMode === "chat" && (
                <Button
                  type="button"
                  variant={activePrototype ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => {
                    if (activePrototype) {
                      setSelectedPrototype(null);
                    } else {
                      handleSelectPrototype(toPrototypeViewModel(runPrototypes[0]));
                    }
                  }}
                  title="Toggle interactive HTML Prototype Studio"
                >
                  <EyeIcon data-icon="inline-start" />
                  Prototype ({runPrototypes.length})
                </Button>
              )}
              {!isBaMode && viewMode === "chat" && (
                <Button
                  type="button"
                  variant={inspectorOpen && !activePrototype ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => {
                    setSelectedPrototype(null);
                    setInspectorOpen((prev) => !prev);
                  }}
                  title="Toggle Specs, PRs, Files, and Models inspector"
                >
                  <PanelRightIcon data-icon="inline-start" />
                  Inspector
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link href={`/projects/${run.project.id}?tab=issues`} />}
              >
                <Columns3Icon data-icon="inline-start" />
                Kanban
                {run.mode === "ba" && run.projectDraftIssues?.length > 0
                  ? ` (${run.projectDraftIssues.length})`
                  : ""}
              </Button>
            </div>
          </div>
        </div>

        {/* Slim live progress strip — only while actively running in Chat mode */}
        {!(run.mode === "factory" && viewMode === "pipeline") &&
          !isWaitingForDaemon &&
          (run.status === "running" || run.status === "queued") && (
            <div className="mt-2 flex items-center gap-3">
              <span className="text-xs text-muted-foreground">{run.currentPhase}</span>
              <Progress value={progressPct} className="h-1 flex-1" />
              <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                {run.specLine || `${run.steps.length} steps`}
              </span>
            </div>
          )}
      </header>

      {/* Main Body: Live Pipeline (Factory, full height without chat bar) or 1/2/3-Pane Chat */}
      {run.mode === "factory" && viewMode === "pipeline" ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <FactoryPipelineView
            run={run}
            elapsedMs={elapsedMs}
            onInspectAgent={(agentId) => {
              setSelectedAgentId(agentId);
              setViewMode("chat");
            }}
            onOpenChat={() => setViewMode("chat")}
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <ResizablePanelGroup orientation="horizontal">
            {/* LEFT PANE: Collapsible Agent Tree (hidden in BA / single-agent chats) */}
            {showLeftRail && (
              <>
                <ResizablePanel id="agents" defaultSize="18%" minSize="14%">
                  <div className="flex h-full flex-col border-r bg-muted/15">
                    <div className="flex items-center justify-between border-b px-3 py-2 text-xs font-medium text-muted-foreground">
                      <span>Agents ({run.agents.length})</span>
                      {selectedAgentId && (
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => setSelectedAgentId(null)}
                        >
                          All
                        </Button>
                      )}
                    </div>
                    <ScrollArea className="flex-1">
                      <div className="flex flex-col gap-2.5 p-2">
                        <Button
                          variant={selectedAgentId === null ? "secondary" : "ghost"}
                          size="sm"
                          className="w-full justify-between"
                          onClick={() => setSelectedAgentId(null)}
                        >
                          <span className="flex items-center gap-2 truncate">
                            <StatusDot status={run.status} />
                            <span className="truncate">Full Timeline</span>
                          </span>
                          <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                            {run.steps.length}
                          </span>
                        </Button>

                        {groupedByLevel.map(([groupLabel, agents]) => (
                          <Collapsible
                            key={groupLabel}
                            defaultOpen={
                              agents.length <= 6 ||
                              agents.some((a) => a.id === selectedAgentId || a.status === "working")
                            }
                          >
                            <CollapsibleTrigger
                              render={
                                <button
                                  type="button"
                                  className="group/grp flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                                >
                                  <span className="truncate">{groupLabel}</span>
                                  <span className="flex shrink-0 items-center gap-1 font-mono text-[10px] tabular-nums">
                                    <span>{agents.length}</span>
                                    <ChevronRightIcon className="size-3 transition-transform group-aria-expanded/grp:rotate-90" />
                                  </span>
                                </button>
                              }
                            />
                            <CollapsibleContent>
                              <div className="mt-0.5 flex flex-col gap-0.5">
                                {agents.map((agent) => (
                                  <Button
                                    key={agent.id}
                                    variant={selectedAgentId === agent.id ? "secondary" : "ghost"}
                                    size="sm"
                                    className="w-full justify-start gap-2"
                                    onClick={() => setSelectedAgentId(agent.id)}
                                    title={agent.name}
                                  >
                                    <StatusDot status={agent.status} />
                                    <span className="truncate text-xs">{agent.name}</span>
                                  </Button>
                                ))}
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                </ResizablePanel>

                <ResizableHandle />
              </>
            )}

            {/* CENTER PANE: Live Transcript / Traces + Inline BA Confirmation / Steer Composer */}
            <ResizablePanel
              id="chat"
              defaultSize={
                showLeftRail
                  ? showRightPane
                    ? "54%"
                    : "82%"
                  : showRightPane
                    ? "64%"
                    : "100%"
              }
              minSize="36%"
            >
              <div className="flex h-full flex-col">
                <div ref={chatScrollContainerRef} className="relative min-h-0 flex-1">
                  <ScrollArea className="h-full">
                    <div
                      data-slot="chat-scroll-content"
                      className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-6 py-5"
                    >
                      {/* Original Prompt Bubble (Right-aligned — User side) */}
                      {(run.prompt || initialPromptAttachments.length > 0) && (
                        <UserChatBubble
                          text={run.prompt || ""}
                          label="You"
                          timestamp={run.startedAt}
                          attachments={initialPromptAttachments}
                        />
                      )}

                      {/* Selected Agent compact header strip */}
                      {selectedAgent &&
                        (() => {
                          const cleanSummary = formatCleanAgentSummary(selectedAgent.summary);
                          return (
                            <div className="rounded-lg border bg-card px-3.5 py-2.5">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex min-w-0 items-center gap-2">
                                  <StatusDot status={selectedAgent.status} />
                                  <span className="truncate text-sm font-semibold text-foreground">
                                    {selectedAgent.name}
                                  </span>
                                  <span className="font-mono text-xs text-muted-foreground">
                                    {selectedAgent.specId
                                      ? `Spec ${selectedAgent.specId}`
                                      : selectedAgent.role}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground tabular-nums">
                                  <span>{formatModelLabel(selectedAgent.model)}</span>
                                  <span>·</span>
                                  <span>
                                    {formatCompactTokens(
                                      selectedAgent.inputTokens + selectedAgent.outputTokens,
                                    )}
                                  </span>
                                  <span>·</span>
                                  <span className="text-foreground">
                                    {formatUsd(selectedAgent.costUsd)}
                                  </span>
                                </div>
                              </div>
                              {cleanSummary && (
                                <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                                  {cleanSummary}
                                </p>
                              )}
                            </div>
                          );
                        })()}

                      {/* Chronological Conversation (Left = AI + Trace, Right = User) */}
                      <div className="flex flex-col gap-4">
                        {filteredSteps.length === 0 ? (
                          <Empty className="border py-10">
                            <EmptyHeader>
                              <EmptyMedia variant="icon">
                                <BotIcon />
                              </EmptyMedia>
                              <EmptyTitle>No steps recorded yet</EmptyTitle>
                              <EmptyDescription>
                                Start <code className="font-mono">sf daemon</code> or run{" "}
                                <code className="font-mono">/factory</code> to stream live agent steps
                                here.
                              </EmptyDescription>
                            </EmptyHeader>
                          </Empty>
                        ) : (
                          (() => {
                            const agentNameById = new Map(run.agents.map((a) => [a.id, a.name]));
                            const agentStatusById = new Map(run.agents.map((a) => [a.id, a.status]));
                            const runActive =
                              run.status === "running" || run.status === "queued";
                            const totalTraceSteps = filteredSteps.length;

                            return (
                              <>
                                {totalTraceSteps > 12 && (
                                  <div className="flex items-center justify-end gap-1.5">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="xs"
                                      onClick={() => setExpandAllGroups(true)}
                                    >
                                      Expand all
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="xs"
                                      onClick={() => setExpandAllGroups(false)}
                                    >
                                      Collapse all
                                    </Button>
                                  </div>
                                )}

                                {timelineGroups.map((group, gIdx) => {
                                  if (group.type === "human") {
                                    const step = group.step;
                                    return (
                                      <UserChatBubble
                                        key={group.key}
                                        text={step.summary || step.label || ""}
                                        label={step.label || "You"}
                                        timestamp={step.createdAt}
                                        attachments={extractStepAttachments(step.data)}
                                      />
                                    );
                                  }

                                  if (group.type === "assistant") {
                                    return (
                                      <AssistantMessageCard
                                        key={group.key}
                                        step={group.step}
                                        runActive={runActive}
                                        selectedTicketKey={inspectedIssue?.issueKey ?? null}
                                        ticketStatusByKey={ticketStatusByKey}
                                        onSelectTicket={handleSelectChatTicket}
                                        fallbackTickets={isBaMode ? dbFallbackTickets : undefined}
                                        isActiveQuestionStep={
                                          activeQuestionTurn?.stepId === group.step.id
                                        }
                                        dbPrototypes={runPrototypes}
                                        selectedPrototypeSlug={activePrototype?.slug ?? null}
                                        onSelectPrototype={handleSelectPrototype}
                                      />
                                    );
                                  }

                                  const isLastTimelineGroup = gIdx === timelineGroups.length - 1;
                                  const clusters = splitTraceIntoAgentClusters(
                                    group.items,
                                    agentNameById,
                                  );

                                  return (
                                    <div key={group.key} className="flex flex-col gap-2">
                                      {clusters.map((cluster, cIdx) => {
                                        const isVeryLast =
                                          isLastTimelineGroup && cIdx === clusters.length - 1;
                                        const agStatus = agentStatusById.get(cluster.agentKey);
                                        const isCompleted =
                                          !isVeryLast ||
                                          !runActive ||
                                          agStatus === "passed" ||
                                          agStatus === "idle";
                                        return (
                                          <CollapsibleTraceCluster
                                            key={cluster.key}
                                            cluster={cluster}
                                            isCompleted={isCompleted}
                                            runActive={runActive}
                                            showAgentBadge={selectedAgentId === null}
                                            forceExpanded={expandAllGroups}
                                            onClearForce={() => setExpandAllGroups(null)}
                                          />
                                        );
                                      })}
                                    </div>
                                  );
                                })}
                              </>
                            );
                          })()
                        )}

                        {/* Real-time Ephemeral Live Overlay (zero-latency thinking, running tool output, and streaming text) */}
                        {isActive &&
                          (visibleLiveEntries.thinking ||
                            visibleLiveEntries.tools.length > 0 ||
                            visibleLiveEntries.texts.length > 0) && (
                            <div className="flex flex-col gap-3">
                              {visibleLiveEntries.thinking && (
                                <div className="rounded-lg border border-border/70 bg-muted/35 px-3.5 py-2.5 text-xs">
                                  <div className="mb-1 flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                                    <Spinner className="size-3" />
                                    <span className="shimmer font-medium">
                                      {visibleLiveEntries.thinking.agentName
                                        ? `${visibleLiveEntries.thinking.agentName} · Thinking`
                                        : "Thinking"}
                                    </span>
                                  </div>
                                  <p className="max-h-36 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-muted-foreground/90">
                                    {visibleLiveEntries.thinking.text}
                                  </p>
                                </div>
                              )}

                              {visibleLiveEntries.tools.map((t) => (
                                <div
                                  key={t.stepKey}
                                  className="rounded-lg border border-primary/25 bg-card px-3.5 py-2.5 text-xs"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="flex min-w-0 items-center gap-2">
                                      <Spinner className="size-3 shrink-0 text-primary" />
                                      <span className="truncate font-mono text-xs font-medium text-foreground">
                                        {t.label}
                                      </span>
                                    </div>
                                    {t.agentName && t.agentKey !== "orchestrator" && (
                                      <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
                                        {t.agentName}
                                      </Badge>
                                    )}
                                  </div>
                                  {t.output && (
                                    <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted/60 p-2.5 font-mono text-[11px] leading-relaxed text-foreground/90">
                                      {t.output}
                                    </pre>
                                  )}
                                </div>
                              ))}

                              {visibleLiveEntries.texts.map((entry) => (
                                <div key={entry.stepKey} className="flex flex-col gap-1.5">
                                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <span className="size-1.5 animate-pulse rounded-full bg-primary" />
                                    <span className="font-medium text-foreground">
                                      {entry.agentName || "Assistant"}
                                    </span>
                                    {entry.model && (
                                      <span className="font-mono text-[11px]">
                                        {formatModelLabel(entry.model)}
                                      </span>
                                    )}
                                  </div>
                                  <div className="pl-3.5">
                                    <MarkdownContent
                                      content={entry.text}
                                      className="text-sm leading-relaxed text-foreground"
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                        {isWaitingForDaemon ? (
                          <div className="rounded-lg border border-warning/35 bg-warning/[0.06] px-4 py-3">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="flex min-w-0 items-start gap-2.5">
                                <LaptopIcon className="mt-0.5 size-4 shrink-0 text-warning" />
                                <div className="min-w-0 space-y-1">
                                  <div className="text-xs font-semibold text-foreground">
                                    No local daemon connected
                                  </div>
                                  <p className="text-xs leading-relaxed text-muted-foreground">
                                    This session is queued but cannot execute until{" "}
                                    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">
                                      sf daemon
                                    </code>{" "}
                                    is running on your machine. Start the daemon to resume
                                    automatically, or cancel/delete this session.
                                  </p>
                                </div>
                              </div>
                              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="xs"
                                  onClick={() => {
                                    void navigator.clipboard?.writeText("sf daemon");
                                    toast.success("Copied `sf daemon`");
                                  }}
                                >
                                  <CopyIcon data-icon="inline-start" />
                                  Copy command
                                </Button>
                                <Button
                                  size="xs"
                                  nativeButton={false}
                                  render={<Link href="/settings?tab=runners" />}
                                >
                                  Connect Runner
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="xs"
                                  disabled={busy}
                                  onClick={() => void handleCancelSession()}
                                >
                                  <XCircleIcon data-icon="inline-start" />
                                  Cancel
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="xs"
                                  disabled={busy}
                                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                  onClick={() => void handleDeleteSession()}
                                >
                                  <Trash2Icon data-icon="inline-start" />
                                  Delete
                                </Button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          (run.status === "running" || run.status === "queued") && (
                            <div className="flex w-full justify-start">
                              <Trace>
                                <TraceLine status="running">
                                  <TraceIcon>
                                    <Spinner />
                                  </TraceIcon>
                                  <TraceTitle>
                                    {(selectedAgent
                                      ? liveOverlay.liveActivityByAgent[selectedAgent.agentKey]
                                          ?.activity
                                      : liveOverlay.liveActivityByAgent["orchestrator"]
                                          ?.activity) ||
                                      (selectedAgent?.status === "working"
                                        ? selectedAgent.activity
                                        : null) ||
                                      workingAgents.find((a) => a.agentKey !== "orchestrator")
                                        ?.activity ||
                                      workingAgents[0]?.activity ||
                                      (run.status === "queued"
                                        ? "Queued for local daemon..."
                                        : "Agent is working...")}
                                  </TraceTitle>
                                </TraceLine>
                              </Trace>
                            </div>
                          )
                        )}

                        {/* Blocked / Failure / Stalled Banner — compact inline alert */}
                        {(run.status === "blocked" ||
                          run.status === "failed" ||
                          run.status === "stalled") && (
                          <div className="rounded-lg border border-destructive/35 bg-destructive/[0.06] px-3.5 py-2.5">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex min-w-0 items-start gap-2">
                                <ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
                                <div className="min-w-0">
                                  <div className="text-xs font-semibold capitalize text-destructive">
                                    {run.status} in {run.currentPhase}
                                  </div>
                                  <p className="mt-0.5 text-xs leading-relaxed text-foreground/85">
                                    {run.summary
                                      ? formatPlainExcerpt(run.summary, 180)
                                      : `No agent activity received in ${run.currentPhase}. Retry to resume.`}
                                  </p>
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-1.5">
                                {run.summary && run.summary.length > 180 && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="xs"
                                    onClick={() => setShowStatusDetails((prev) => !prev)}
                                  >
                                    {showStatusDetails ? "Hide" : "Details"}
                                  </Button>
                                )}
                                {isUnattendedBuild && isRetryable && run.issue && (
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="xs"
                                    disabled={busy}
                                    onClick={() => void handleOpenClarifyForIssue(run.issue!.id)}
                                  >
                                    <MessageSquareIcon data-icon="inline-start" />
                                    Clarify Ticket
                                  </Button>
                                )}
                                {isRetryable && (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="xs"
                                    disabled={busy}
                                    onClick={() => void handleRetrySession()}
                                  >
                                    <RotateCcwIcon data-icon="inline-start" />
                                    Retry
                                  </Button>
                                )}
                              </div>
                            </div>
                            {showStatusDetails && run.summary && (
                              <div className="mt-2 border-t border-destructive/20 pt-2">
                                <MarkdownContent
                                  content={run.summary}
                                  className="text-xs leading-relaxed text-muted-foreground"
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </ScrollArea>

                  {showJumpToBottom && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-end px-4">
                      <Button
                        type="button"
                        size="xs"
                        variant="secondary"
                        className="pointer-events-auto shadow-md"
                        onClick={() => scrollChatToBottom(true)}
                      >
                        <ArrowDownIcon data-icon="inline-start" />
                        Latest
                      </Button>
                    </div>
                  )}
                </div>

                {/* Slim 1-row Factory Init completion bar (Stage 1: once per project, interactive) */}
                {isInitMode &&
                  run.status !== "passed" &&
                  (run.issue ? run.issue.status !== "passed" : run.project.initStatus !== "complete") && (
                    <div className="border-t bg-muted/30 px-5 py-2.5">
                      <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs">
                          <UserIcon className="size-3.5 text-primary" />
                          <span className="font-medium text-foreground">
                            Stage 1 · Factory Init{run.issue ? ` (${run.issue.issueKey})` : ""}
                          </span>
                          <span className="hidden text-muted-foreground sm:inline">
                            · Discuss stack, checks &amp; design with AI, then mark complete to unlock unattended builds
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Button
                            size="xs"
                            variant="outline"
                            nativeButton={false}
                            render={<Link href={`/projects/${run.project.id}?tab=issues`} />}
                          >
                            <Columns3Icon data-icon="inline-start" />
                            Board
                          </Button>
                          <Button
                            size="xs"
                            disabled={busy}
                            onClick={() => void handleCompleteInitIssue()}
                          >
                            {busy ? (
                              <Spinner data-icon="inline-start" />
                            ) : (
                              <CheckIcon data-icon="inline-start" />
                            )}
                            Mark Init Complete
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                {/* Slim 1-row Factory Clarify approval bar (Stage 2: per feature, interactive) */}
                {isClarifyMode &&
                  run.issue &&
                  (run.issue.status === "backlog" || run.issue.status === "needs_human") && (
                    <div className="border-t bg-muted/30 px-5 py-2.5">
                      <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs">
                          <MessageSquareIcon className="size-3.5 text-primary" />
                          <span className="font-medium text-foreground">
                            Stage 2 · Clarify ({run.issue.issueKey})
                          </span>
                          <span className="hidden text-muted-foreground sm:inline">
                            · Answer questions &amp; review mockups/plan, then approve for unattended build
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={busy}
                            onClick={() => void handleApproveClarifiedTicket(false)}
                          >
                            <CheckIcon data-icon="inline-start" />
                            Approve → Ready
                          </Button>
                          <Button
                            size="xs"
                            disabled={busy || run.project.initStatus !== "complete"}
                            title={
                              run.project.initStatus !== "complete"
                                ? "Complete /factory init once before starting builds"
                                : undefined
                            }
                            onClick={() => void handleApproveClarifiedTicket(true)}
                          >
                            {busy ? (
                              <Spinner data-icon="inline-start" />
                            ) : (
                              <ZapIcon data-icon="inline-start" />
                            )}
                            Approve &amp; Build
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                {/* Slim 1-row BA confirmation bar — only shown while draft tickets await confirmation */}
                {run.mode === "ba" &&
                  (() => {
                    const pendingCount = (run.projectDraftIssues || []).filter(
                      (i) => i.status === "backlog" || i.status === "needs_human",
                    ).length;
                    if (pendingCount === 0) return null;
                    return (
                      <div className="border-t bg-muted/30 px-5 py-2.5">
                        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-xs">
                            <SparklesIcon className="size-3.5 text-primary" />
                            <span className="font-medium text-foreground">
                              {pendingCount} drafted {pendingCount === 1 ? "ticket" : "tickets"} waiting for confirmation
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Button
                              size="xs"
                              variant="outline"
                              disabled={busy}
                              onClick={() => void handleConfirmBaTickets(false)}
                            >
                              <CheckIcon data-icon="inline-start" />
                              Confirm All
                            </Button>
                            <Button
                              size="xs"
                              disabled={busy}
                              onClick={() => void handleConfirmBaTickets(true)}
                            >
                              {busy ? (
                                <Spinner data-icon="inline-start" />
                              ) : (
                                <ZapIcon data-icon="inline-start" />
                              )}
                              Confirm &amp; Auto-Run
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                {/* Inline Pending Interaction Action Card (interactive sessions only; never on unattended Factory builds) */}
                {!isUnattendedBuild &&
                  pendingInteractions.length > 0 &&
                  !(run.mode === "ba" && run.projectDraftIssues?.length > 0) &&
                  (() => {
                    const inter = pendingInteractions[0];
                    const interactionQuestions = extractQuestionsFromInteractionPayload(
                      inter.payload,
                      inter.title,
                    );
                    if (interactionQuestions && interactionQuestions.length > 0) {
                      return (
                        <QuestionSelectorDock
                          key={`inter-${inter.id}`}
                          questionSet={{
                            source: "sf-questions",
                            questions: interactionQuestions,
                          }}
                          busy={busy}
                          onSubmit={(reply) =>
                            handleResolveInteraction(inter.id, "answered", reply)
                          }
                        />
                      );
                    }
                    return (
                      <div className="border-t bg-muted/40 px-4 py-3">
                        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2.5 rounded-lg border bg-card p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-2">
                              <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-primary" />
                              <div className="flex flex-col gap-0.5">
                                <span className="text-sm font-medium">{inter.title}</span>
                                {inter.prompt && (
                                  <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                                    {inter.prompt}
                                  </p>
                                )}
                              </div>
                            </div>
                            <Badge variant="outline">{inter.type}</Badge>
                          </div>

                          <div className="flex items-center gap-2">
                            <Input
                              placeholder="Type your answer or feedback..."
                              value={answerDrafts[inter.id] || ""}
                              onChange={(e) =>
                                setAnswerDrafts((prev) => ({
                                  ...prev,
                                  [inter.id]: e.target.value,
                                }))
                              }
                            />
                            <Button
                              size="sm"
                              disabled={busy}
                              onClick={() => void handleResolveInteraction(inter.id, "approved")}
                            >
                              Approve &amp; Resume
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => void handleResolveInteraction(inter.id, "dismissed")}
                            >
                              Dismiss
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                {/* Docked Interactive Question Selector (above composer for unanswered AI question waves) */}
                {!isUnattendedBuild &&
                  activeQuestionTurn &&
                  !(
                    pendingInteractions.length > 0 &&
                    extractQuestionsFromInteractionPayload(
                      pendingInteractions[0].payload,
                      pendingInteractions[0].title,
                    )
                  ) && (
                    <QuestionSelectorDock
                      key={activeQuestionTurn.stepId}
                      questionSet={activeQuestionTurn.questionSet}
                      busy={busy}
                      onSubmit={handleSubmitQuestionAnswers}
                    />
                  )}

                {/* Bottom Steer Composer (interactive sessions only; unattended Factory builds are read-only) */}
                {isUnattendedBuild ? (
                  <div className="border-t bg-muted/30 px-5 py-2.5">
                    <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <LockIcon className="size-3.5 shrink-0" />
                        <span>
                          Unattended Factory build loop — read-only live trace. Questions belong in{" "}
                          <code className="font-mono">/factory init</code>,{" "}
                          <code className="font-mono">/ba-ticket</code>, or{" "}
                          <code className="font-mono">/factory clarify</code>.
                        </span>
                      </div>
                      {isRetryable && (
                        <div className="flex items-center gap-1.5">
                          {run.issue && (
                            <Button
                              type="button"
                              variant="secondary"
                              size="xs"
                              disabled={busy}
                              onClick={() => void handleOpenClarifyForIssue(run.issue!.id)}
                            >
                              <MessageSquareIcon data-icon="inline-start" />
                              Clarify Ticket
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            disabled={busy}
                            onClick={() => void handleRetrySession()}
                          >
                            <RotateCcwIcon data-icon="inline-start" />
                            Retry
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  steerComposer
                )}
              </div>
            </ResizablePanel>

            {showRightPane && (
              <>
                <ResizableHandle />

                {/* RIGHT PANE: Interactive Prototype Studio, Issue Detail Inspector (BA), or Tabbed Inspector */}
                <ResizablePanel
                  id="inspector"
                  defaultSize={activePrototype ? "46%" : "30%"}
                  minSize="24%"
                >
                  {activePrototype ? (
                    <div className="flex h-full flex-col border-l bg-sidebar/20">
                      <div className="flex items-center justify-between gap-2 border-b bg-card px-3 py-2">
                        <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
                          <SparklesIcon className="size-3.5 shrink-0 text-primary" />
                          {runPrototypes.length > 1 ? (
                            runPrototypes.map((p) => (
                              <Button
                                key={p.id}
                                type="button"
                                size="xs"
                                variant={
                                  p.slug.toLowerCase() === activePrototype.slug.toLowerCase()
                                    ? "secondary"
                                    : "ghost"
                                }
                                onClick={() => handleSelectPrototype(toPrototypeViewModel(p))}
                              >
                                {p.title}
                              </Button>
                            ))
                          ) : (
                            <span className="truncate text-xs font-medium text-foreground">
                              Prototype Studio
                            </span>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="shrink-0"
                          title="Close Prototype Studio"
                          onClick={() => setSelectedPrototype(null)}
                        >
                          <XIcon />
                        </Button>
                      </div>
                      <div className="min-h-0 flex-1 p-2">
                        <PrototypeStudio
                          key={`${activePrototype.id ?? activePrototype.slug}-v${activePrototype.version ?? 1}`}
                          prototype={activePrototype}
                          projectId={run.project.id}
                          canWrite={!isUnattendedBuild}
                          compact
                          onUpdated={() => void refreshRun()}
                          onSteer={
                            !isUnattendedBuild ? handleSubmitQuestionAnswers : undefined
                          }
                        />
                      </div>
                    </div>
                  ) : isBaMode && inspectedIssue ? (
                    <div className="flex h-full flex-col border-l bg-sidebar/20">
                      <div className="flex items-start justify-between gap-2 border-b px-3.5 py-3">
                        <div className="flex min-w-0 flex-col gap-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge variant="outline">{inspectedIssue.issueKey}</Badge>
                            <Badge variant="secondary">{inspectedIssue.priority}</Badge>
                            <Badge variant="outline">{inspectedIssue.complexity}</Badge>
                            {inspectedIssue.status && (
                              <Badge variant="outline">
                                {inspectedIssue.status.replace("_", " ")}
                              </Badge>
                            )}
                          </div>
                          <h2 className="text-sm font-medium leading-snug text-foreground">
                            {inspectedIssue.title}
                          </h2>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          title="Close issue inspector"
                          onClick={() => {
                            setSelectedIssueId(null);
                            setSelectedTicket(null);
                          }}
                        >
                          <XIcon />
                        </Button>
                      </div>

                      <ScrollArea className="min-h-0 flex-1">
                        <div className="flex flex-col gap-4 p-3.5">
                          {/* Status & Actions */}
                          {inspectedIssue.id && (
                            <div className="flex flex-wrap items-center gap-2">
                              <Select
                                value={inspectedIssue.status}
                                onValueChange={(v) => {
                                  if (v && inspectedIssue.id) {
                                    void handleUpdateInspectedStatus(inspectedIssue.id, v);
                                  }
                                }}
                                disabled={busy}
                              >
                                <SelectTrigger className="h-8 w-36 text-xs">
                                  <SelectValue placeholder="Status">
                                    {inspectedIssue.status.replace("_", " ")}
                                  </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectGroup>
                                    <SelectItem value="backlog">Draft / Backlog</SelectItem>
                                    <SelectItem value="ready">Ready (Confirmed)</SelectItem>
                                    <SelectItem value="in_progress">Running</SelectItem>
                                    <SelectItem value="in_review">In Review</SelectItem>
                                    <SelectItem value="done">Done</SelectItem>
                                    <SelectItem value="blocked">Blocked</SelectItem>
                                  </SelectGroup>
                                </SelectContent>
                              </Select>

                              {(inspectedIssue.status === "backlog" ||
                                inspectedIssue.status === "needs_human") && (
                                <Button
                                  type="button"
                                  size="xs"
                                  variant="secondary"
                                  disabled={busy}
                                  onClick={() =>
                                    void handleUpdateInspectedStatus(inspectedIssue.id!, "ready")
                                  }
                                >
                                  <CheckIcon data-icon="inline-start" />
                                  Confirm
                                </Button>
                              )}

                              <Button
                                type="button"
                                size="xs"
                                disabled={busy}
                                onClick={() => void handleRunSingleIssue(inspectedIssue.id!)}
                              >
                                <PlayIcon data-icon="inline-start" />
                                Run Factory
                              </Button>

                              <Button
                                type="button"
                                size="xs"
                                variant="ghost"
                                disabled={busy}
                                onClick={() =>
                                  void handleDeleteInspectedIssue(
                                    inspectedIssue.id!,
                                    inspectedIssue.issueKey,
                                  )
                                }
                              >
                                <Trash2Icon data-icon="inline-start" />
                                Delete
                              </Button>
                            </div>
                          )}

                          {/* Linked Interactive Prototype (when BA built one for this ticket) */}
                          {(() => {
                            const linkedProto = runPrototypes.find((p) =>
                              p.issueKeys.some(
                                (k) => k.toUpperCase() === inspectedIssue.issueKey.toUpperCase(),
                              ),
                            );
                            if (!linkedProto) return null;
                            return (
                              <div className="flex items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
                                <div className="flex min-w-0 flex-col gap-0.5">
                                  <span className="truncate font-medium text-foreground">
                                    {linkedProto.title}
                                  </span>
                                  <span className="font-mono text-[10px] text-muted-foreground">
                                    {linkedProto.manifest.screens.length || 1} states · binding:{" "}
                                    {linkedProto.binding}
                                  </span>
                                </div>
                                <Button
                                  type="button"
                                  size="xs"
                                  onClick={() =>
                                    handleSelectPrototype(toPrototypeViewModel(linkedProto))
                                  }
                                >
                                  <EyeIcon data-icon="inline-start" />
                                  Preview
                                </Button>
                              </div>
                            );
                          })()}

                          {/* Goal */}
                          {inspectedIssue.goal && (
                            <div className="flex flex-col gap-1">
                              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                                Goal
                              </span>
                              <p className="text-xs leading-relaxed text-foreground">
                                {inspectedIssue.goal}
                              </p>
                            </div>
                          )}

                          {/* Dependencies */}
                          {inspectedIssue.dependsOn.length > 0 && (
                            <div className="flex flex-col gap-1.5">
                              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                                Depends On
                              </span>
                              <div className="flex flex-wrap gap-1.5">
                                {inspectedIssue.dependsOn.map((dep) => {
                                  const match = (run.projectDraftIssues || []).find(
                                    (i) => i.issueKey.toUpperCase() === dep.toUpperCase(),
                                  );
                                  return (
                                    <Button
                                      key={dep}
                                      type="button"
                                      variant="outline"
                                      size="xs"
                                      onClick={() => match && handleSelectDbIssue(match.id)}
                                    >
                                      <Link2Icon data-icon="inline-start" />
                                      {dep}
                                    </Button>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* Acceptance Criteria */}
                          <div className="flex flex-col gap-1.5">
                            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                              Acceptance Criteria ({inspectedIssue.criteria.length})
                            </span>
                            {inspectedIssue.criteria.length === 0 ? (
                              <p className="text-xs text-muted-foreground">
                                No criteria defined yet.
                              </p>
                            ) : (
                              <div className="flex flex-col gap-1.5">
                                {inspectedIssue.criteria.map((c) => (
                                  <div
                                    key={c.id}
                                    className="flex items-start gap-2 rounded-[4px] border bg-card p-2 text-xs"
                                  >
                                    <span className="shrink-0 font-mono text-[11px] font-semibold text-primary">
                                      {c.id}
                                    </span>
                                    <span className="leading-relaxed text-foreground/90">
                                      {c.text}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Detailed Spec Body */}
                          {inspectedIssue.body && (
                            <div className="flex flex-col gap-1.5">
                              <Separator />
                              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                                Specification &amp; Out of Scope
                              </span>
                              <MarkdownContent
                                content={inspectedIssue.body}
                                className="text-xs leading-5"
                              />
                            </div>
                          )}
                        </div>
                      </ScrollArea>

                      <div className="flex items-center justify-between border-t bg-card px-3.5 py-2.5">
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {inspectedIssue.id ? "Synced to Kanban" : "Draft preview"}
                        </span>
                        <Button
                          variant="outline"
                          size="xs"
                          nativeButton={false}
                          render={<Link href={`/projects/${run.project.id}?tab=issues`} />}
                        >
                          <Columns3Icon data-icon="inline-start" />
                          Open Board
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Tabs defaultValue="specs" className="flex h-full flex-col gap-0 border-l">
              <div className="flex items-center justify-between gap-1 border-b px-2 pt-2">
                <TabsList variant="line" className="min-w-0 flex-1 justify-start">
                  <TabsTrigger value="specs">
                    Specs {(run.specs?.length || 0) + run.criteria.length}
                  </TabsTrigger>
                  <TabsTrigger value="prs">
                    PRs {run.pullRequests.length}
                  </TabsTrigger>
                  <TabsTrigger value="artifacts">
                    Files {run.artifacts.length}
                  </TabsTrigger>
                  <TabsTrigger value="models">Models</TabsTrigger>
                  <TabsTrigger value="agents">
                    Agents {run.agents.length}
                  </TabsTrigger>
                </TabsList>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="mb-1 shrink-0"
                  title="Close inspector"
                  onClick={() => setInspectorOpen(false)}
                >
                  <XIcon />
                </Button>
              </div>

              {/* TAB 1: AGENTS (Waiting on you / Working / Idle) */}
              <TabsContent value="agents" className="flex min-h-0 flex-1 flex-col">
                <div className="border-b p-2.5">
                  <div className="relative">
                    <SearchIcon className="pointer-events-none absolute top-2 left-2.5 size-3.5 text-muted-foreground" />
                    <Input
                      value={agentQuery}
                      onChange={(e) => setAgentQuery(e.target.value)}
                      placeholder="Search agents..."
                      className="h-8 pl-8 text-xs"
                    />
                  </div>
                </div>
                <ScrollArea className="flex-1">
                  <div className="flex flex-col gap-3 p-3">
                    {[
                      { label: "Waiting on you", items: waitingAgents },
                      { label: "Working", items: workingAgents },
                      { label: "Idle & Completed", items: idleAgents },
                    ].map((group) => (
                      <Collapsible key={group.label} defaultOpen>
                        <CollapsibleTrigger
                          render={
                            <button
                              type="button"
                              className="flex w-full items-center gap-1.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                            >
                              <ChevronDownIcon className="size-3.5" />
                              <span>{group.label}</span>
                              <span className="font-mono text-[11px]">{group.items.length}</span>
                            </button>
                          }
                        />
                        <CollapsibleContent className="flex flex-col gap-1 pt-1">
                          {group.items.length === 0 ? (
                            <div className="px-2 py-1 text-xs text-muted-foreground/70">
                              None
                            </div>
                          ) : (
                            group.items.map((agent) => (
                              <button
                                key={agent.id}
                                type="button"
                                onClick={() => setSelectedAgentId(agent.id)}
                                className="flex w-full items-start justify-between gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-xs hover:border-border hover:bg-muted/60"
                              >
                                <div className="flex min-w-0 items-start gap-2">
                                  <span className="mt-1">
                                    <StatusDot status={agent.status} />
                                  </span>
                                  <div className="flex min-w-0 flex-col">
                                    <span className="truncate font-medium text-foreground">
                                      {agent.name}
                                    </span>
                                    <span className="truncate text-muted-foreground">
                                      {agent.activity || agent.role}
                                    </span>
                                  </div>
                                </div>
                                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                                  {formatRelativeTime(agent.updatedAt)}
                                </span>
                              </button>
                            ))
                          )}
                        </CollapsibleContent>
                      </Collapsible>
                    ))}
                  </div>
                </ScrollArea>
              </TabsContent>

              {/* TAB 2: AI SPECS, CRITERIA & FAILURE LOG */}
              <TabsContent value="specs" className="min-h-0 flex-1">
                <ScrollArea className="h-full">
                  <div className="flex flex-col gap-3 p-3">
                    {run.specs && run.specs.length > 0 && (
                      <>
                        <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                          AI Generated Specs ({run.specs.length})
                        </div>
                        {run.specs.map((sp) => (
                          <div
                            key={sp.id}
                            className="flex flex-col gap-1.5 rounded-md border p-2.5 text-xs"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-1.5">
                              <div className="flex min-w-0 items-center gap-1.5">
                                <span className="font-mono font-semibold text-foreground">
                                  {sp.id}
                                </span>
                                <span className="truncate font-medium">
                                  {sp.title || "Spec"}
                                </span>
                                {sp.kind && <Badge variant="outline">{sp.kind}</Badge>}
                              </div>
                              <div className="flex shrink-0 items-center gap-1 font-mono text-[10px]">
                                {sp.impl && (
                                  <Badge
                                    variant={
                                      sp.impl === "fail"
                                        ? "destructive"
                                        : sp.impl === "ok"
                                          ? "secondary"
                                          : "outline"
                                    }
                                  >
                                    impl:{sp.impl}
                                  </Badge>
                                )}
                                {sp.test && sp.test !== "none" && (
                                  <Badge
                                    variant={
                                      sp.test === "fail"
                                        ? "destructive"
                                        : sp.test === "ok"
                                          ? "secondary"
                                          : "outline"
                                    }
                                  >
                                    qa:{sp.test}
                                  </Badge>
                                )}
                              </div>
                            </div>
                            {sp.goal && (
                              <p className="leading-relaxed text-muted-foreground">{sp.goal}</p>
                            )}
                            {sp.filesOwned && sp.filesOwned.length > 0 && (
                              <div className="flex flex-wrap gap-1 font-mono text-[10px] text-muted-foreground">
                                {sp.filesOwned.map((f) => (
                                  <span
                                    key={f}
                                    className="rounded-[2px] border bg-muted/40 px-1.5 py-0.5"
                                  >
                                    {f}
                                  </span>
                                ))}
                              </div>
                            )}
                            {(sp.implNote || sp.testNote || sp.waitFor) && (
                              <div className="flex flex-col gap-0.5 font-mono text-[10px] text-muted-foreground">
                                {sp.waitFor && <span>waits for: {sp.waitFor}</span>}
                                {sp.implNote && <span>{sp.implNote}</span>}
                                {sp.testNote && <span>{sp.testNote}</span>}
                              </div>
                            )}
                          </div>
                        ))}
                        <Separator />
                      </>
                    )}

                    <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                      Acceptance Criteria ({run.criteria.length})
                    </div>
                    {run.criteria.length === 0 ? (
                      <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                        No acceptance criteria attached yet.
                      </div>
                    ) : (
                      run.criteria.map((c) => (
                        <div key={c.id} className="flex items-start gap-2 rounded-md border p-2.5 text-xs">
                          {c.status === "met" ? (
                            <CheckCircle2Icon className="mt-0.5 size-3.5 shrink-0 text-success" />
                          ) : c.status === "not_met" ? (
                            <XCircleIcon className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                          ) : (
                            <span className="mt-1 size-2 shrink-0 rounded-full bg-muted-foreground/40" />
                          )}
                          <div className="flex flex-col gap-0.5">
                            <span className="font-mono font-medium">{c.id}</span>
                            <span className="leading-relaxed text-muted-foreground">{c.text}</span>
                          </div>
                        </div>
                      ))
                    )}

                    {run.failureLog.length > 0 && (
                      <>
                        <Separator />
                        <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                          Failure Log ({run.failureLog.length})
                        </div>
                        {run.failureLog.map((f, idx) => (
                          <div key={idx} className="rounded-md border p-2.5 text-xs">
                            <div className="flex items-center gap-1.5 font-mono text-[11px]">
                              <Badge variant="destructive">{f.kind || "failure"}</Badge>
                              {f.stage && <span>{f.stage}</span>}
                              {f.file && <span className="truncate text-muted-foreground">{f.file}</span>}
                            </div>
                            <p className="mt-1 text-muted-foreground">{f.problem}</p>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              {/* TAB 3: LINKED PULL REQUESTS */}
              <TabsContent value="prs" className="min-h-0 flex-1">
                <ScrollArea className="h-full">
                  <div className="flex flex-col gap-2.5 p-3">
                    {run.pullRequests.length === 0 && !run.prUrl ? (
                      <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                        No pull requests opened for this session yet.
                      </div>
                    ) : (
                      <>
                        {run.pullRequests.map((pr) => (
                          <div key={pr.id} className="flex flex-col gap-2 rounded-lg border p-3 text-xs">
                            <div className="flex items-start justify-between gap-2">
                              <span className="flex items-center gap-1.5 font-medium">
                                <GitPullRequestIcon className="size-3.5" />
                                #{pr.number} {pr.title}
                              </span>
                              <Badge variant="outline">{pr.state}</Badge>
                            </div>
                            <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                              <span>
                                {pr.baseBranch} ← {pr.headBranch}
                              </span>
                              <span>+{pr.additions} -{pr.deletions}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                size="xs"
                                variant="outline"
                                nativeButton={false}
                                render={<Link href="/reviews" />}
                              >
                                Open in Code Review
                              </Button>
                              {pr.url && (
                                <Button
                                  size="xs"
                                  variant="ghost"
                                  nativeButton={false}
                                  render={<a href={pr.url} target="_blank" rel="noreferrer" />}
                                >
                                  <ExternalLinkIcon data-icon="inline-start" />
                                  GitHub
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              {/* TAB 4: ARTIFACTS (Mockups, QC Screenshots, Reports) */}
              <TabsContent value="artifacts" className="min-h-0 flex-1">
                <ScrollArea className="h-full">
                  <div className="flex flex-col gap-2.5 p-3">
                    {run.artifacts.length === 0 ? (
                      <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                        Mockups, QC screenshots, and <code className="font-mono">pr-judge</code>{" "}
                        reports registered via{" "}
                        <code className="font-mono">sf artifact</code> appear here.
                      </div>
                    ) : (
                      run.artifacts.map((art) => {
                        const isImage =
                          /\.(png|jpe?g|webp|svg)$/i.test(art.pathOrUrl) ||
                          (art.mimeType || "").startsWith("image/");
                        const protoId =
                          art.kind === "prototype" && typeof art.meta?.prototypeId === "string"
                            ? art.meta.prototypeId
                            : null;
                        const matchedProto = protoId
                          ? runPrototypes.find((p) => p.id === protoId) ?? null
                          : null;
                        const fileHref = matchedProto
                          ? `/api/prototypes/${encodeURIComponent(matchedProto.id)}/raw`
                          : `/api/artifacts/file?id=${encodeURIComponent(art.id)}`;
                        return (
                          <div key={art.id} className="flex flex-col gap-2 rounded-lg border p-2.5 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="flex items-center gap-1.5 truncate font-medium">
                                {isImage ? (
                                  <FileImageIcon className="size-3.5 shrink-0" />
                                ) : (
                                  <FileTextIcon className="size-3.5 shrink-0" />
                                )}
                                <span className="truncate">{art.title}</span>
                              </span>
                              <Badge variant="secondary">{art.kind}</Badge>
                            </div>
                            {matchedProto && (
                              <Button
                                type="button"
                                size="xs"
                                variant="secondary"
                                onClick={() =>
                                  handleSelectPrototype(toPrototypeViewModel(matchedProto))
                                }
                              >
                                <EyeIcon data-icon="inline-start" />
                                Open Interactive Preview
                              </Button>
                            )}
                            {isImage && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={fileHref}
                                alt={art.title}
                                className="max-h-44 w-full rounded-md border object-cover"
                              />
                            )}
                            <a
                              href={fileHref}
                              target="_blank"
                              rel="noreferrer"
                              className="truncate font-mono text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                            >
                              {art.pathOrUrl}
                            </a>
                          </div>
                        );
                      })
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              {/* TAB 5: MODELS & PROGRESS LOG */}
              <TabsContent value="models" className="min-h-0 flex-1">
                <ScrollArea className="h-full">
                  <div className="flex flex-col gap-4 p-3">
                    <div className="flex flex-col gap-2">
                      <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                        Model Allocation by Role
                      </div>
                      {[
                        {
                          role: "Orchestrator (CLI)",
                          model: formatModelLabel(run.model),
                          raw: run.model,
                        },
                        {
                          role: "Planner",
                          model: run.engine === "claude" ? "Fable (High)" : "Gemini 4 Neon (XHigh)",
                          raw: run.engine === "claude" ? "fable" : "gemini-4-neon-xhigh",
                        },
                        {
                          role: "Implementer / QA",
                          model: run.engine === "claude" ? "Sonnet (Med)" : "Gemini 4 Carbon (Med)",
                          raw: run.engine === "claude" ? "sonnet" : "gemini-4-carbon-medium",
                        },
                        {
                          role: "Checker",
                          model: run.engine === "claude" ? "Sonnet (Low)" : "Gemini 4 Hydrogen (Low)",
                          raw: run.engine === "claude" ? "haiku" : "gemini-4-hydrogen-low",
                        },
                        {
                          role: "Reviewer / QC",
                          model:
                            run.risk === "high"
                              ? run.engine === "claude"
                                ? "Opus (XHigh)"
                                : "Gemini 4 Neon (XHigh / High)"
                              : run.engine === "claude"
                                ? "Opus / Sonnet"
                                : "Neon (High) / Hydrogen (Med)",
                          raw: run.engine === "claude" ? "opus" : "gemini-4-neon-high",
                        },
                      ].map((row) => (
                        <div
                          key={row.role}
                          className="flex items-center justify-between rounded-md border px-2.5 py-2 text-xs"
                        >
                          <span className="text-muted-foreground">{row.role}</span>
                          <span className="flex items-center gap-2 font-mono">
                            <span>{row.model}</span>
                            <MeterBars level={effortForModel(row.raw)} />
                          </span>
                        </div>
                      ))}
                    </div>

                    <Separator />

                    <div className="flex flex-col gap-1.5">
                      <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                        Progress Log
                      </div>
                      {[...run.steps].reverse().slice(0, 25).map((s) => (
                        <div
                          key={s.id}
                          className="flex items-center justify-between gap-2 py-1 text-xs"
                        >
                          <span className="flex min-w-0 items-center gap-1.5">
                            <StatusDot status={s.status} />
                            <span className="truncate text-muted-foreground">
                              {s.label || s.step}
                            </span>
                          </span>
                          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                            {formatRelativeTime(s.createdAt)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </ScrollArea>
              </TabsContent>
                  </Tabs>
                  )}
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        </div>
      )}
    </div>
  );
}
