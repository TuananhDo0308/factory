export type QuestionOption = {
  id: string;
  label: string;
  description?: string;
  recommended?: boolean;
};

export type InteractiveQuestion = {
  id: string;
  header: string;
  question: string;
  hint?: string;
  multiSelect: boolean;
  allowOther: boolean;
  options: QuestionOption[];
};

export type ParsedQuestionSet = {
  source: "sf-questions" | "markdown";
  questions: InteractiveQuestion[];
  acceptAllLabel?: string;
  rawJson?: string;
};

export type QuestionAnswerDraft = {
  selectedOptionIds: string[];
  useOther: boolean;
  otherText: string;
};

export type SplitQuestionsBlockResult = {
  prose: string;
  questionsJson: string | null;
  questionsStreaming: boolean;
  questionCount: number;
};

/**
 * Compact prompt contract appended to headless interactive Software Factory sessions
 * (`init`, `clarify`, `ba`, `normal`) so AI models emit structured clickable options.
 */
export const SF_QUESTIONS_PROMPT_CONTRACT = [
  "Interactive Questions Contract:",
  "- Do NOT call interactive-only tools like `ask_question` / `AskUserQuestion` (this session runs headless over Software Factory).",
  "- Whenever you need the user to answer questions (at most 3 questions per wave), write brief context first and end your reply with a single fenced JSON block tagged `sf-questions` so Software Factory renders clickable radio/multi-select options:",
  "```sf-questions",
  "{",
  '  "questions": [',
  "    {",
  '      "id": "Q1",',
  '      "header": "Short topic",',
  '      "question": "Clear question text?",',
  '      "multiSelect": false,',
  '      "options": [',
  '        { "label": "Recommended option", "description": "Short rationale", "recommended": true },',
  '        { "label": "Alternative option", "description": "Trade-off" }',
  "      ],",
  '      "allowOther": true',
  "    }",
  "  ]",
  "}",
  "```",
  "- Keep option labels concise (2-8 words), mark your best default with `\"recommended\": true`, set `\"multiSelect\": true` when multiple choices apply, and write in the same language as the user.",
  "- Do NOT duplicate the full options list in plain markdown prose when emitting `sf-questions`.",
].join("\n");

export const SF_QUESTIONS_RESUME_REMINDER =
  '(Interactive Questions reminder: if you ask the user any follow-up questions in this reply, end with a ```sf-questions JSON block with concise options and `"recommended": true` on your suggested default so the user can click instead of typing.)';

const RECOMMENDED_PREFIX_RE =
  /^\s*(?:\((?:recommended|suggested|default|đề xuất|khuyên dùng|gợi ý)\)|\[(?:recommended|suggested|đề xuất)\]|★)\s*[-–—:]?\s*/i;
const RECOMMENDED_SUFFIX_RE =
  /\s*(?:\*?[\(\[](?:recommended|suggested|default|my suggestion|ai suggestion|đề xuất|khuyên dùng|gợi ý)[\)\]]\*?|★)\s*$/i;

const OTHER_OPTION_RE =
  /^(?:something\s+else|other(?:\s*\(.*\))?|custom(?:\s+answer)?|none\s+of\s+(?:the\s+)?above|khác(?:\s*\(.*\))?|tự\s+nhập|ý\s+kiến\s+khác)\.?$/i;

function stripMarkdownFormatting(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/_([^_\n]+)_/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanOptionLabel(raw: string): { label: string; recommended: boolean } {
  let label = stripMarkdownFormatting(raw);
  let recommended = false;
  if (RECOMMENDED_PREFIX_RE.test(label)) {
    recommended = true;
    label = label.replace(RECOMMENDED_PREFIX_RE, "").trim();
  }
  if (RECOMMENDED_SUFFIX_RE.test(label)) {
    recommended = true;
    label = label.replace(RECOMMENDED_SUFFIX_RE, "").trim();
  }
  return { label, recommended };
}

function deriveHeader(questionText: string, index: number, explicitHeader?: string): string {
  const cleanExplicit = explicitHeader ? stripMarkdownFormatting(explicitHeader) : "";
  if (cleanExplicit) {
    return cleanExplicit.length > 24 ? `${cleanExplicit.slice(0, 23).trimEnd()}…` : cleanExplicit;
  }
  const clean = stripMarkdownFormatting(questionText);
  // If question starts with "Topic: actual question?", use "Topic"
  const colonMatch = /^([^:?.!]{2,26}):\s+.+/.exec(clean);
  if (colonMatch?.[1]) {
    return colonMatch[1].trim();
  }
  return `Q${index + 1}`;
}

function splitLabelAndDescription(raw: string): {
  label: string;
  description?: string;
  recommended: boolean;
} {
  // Check for bold label followed by description: "**Label** — desc" or "**Label**: desc"
  const boldSplit = /^\s*\*\*([^*\n]+?)\*\*\s*(?:[:—–-]\s+)(.+)$/.exec(raw.trim());
  if (boldSplit) {
    const cleaned = cleanOptionLabel(boldSplit[1]);
    const descClean = cleanOptionLabel(boldSplit[2]);
    return {
      label: cleaned.label,
      description: descClean.label || undefined,
      recommended: cleaned.recommended || descClean.recommended,
    };
  }

  // Check for "Label — description" (em/en dash)
  const dashSplit = /^(.+?)\s+[—–]\s+(.+)$/.exec(raw.trim());
  if (dashSplit && dashSplit[1].trim().length <= 72) {
    const cleaned = cleanOptionLabel(dashSplit[1]);
    const descClean = cleanOptionLabel(dashSplit[2]);
    return {
      label: cleaned.label,
      description: descClean.label || undefined,
      recommended: cleaned.recommended || descClean.recommended,
    };
  }

  const cleaned = cleanOptionLabel(raw);
  return {
    label: cleaned.label,
    recommended: cleaned.recommended,
  };
}

function isOtherOptionLabel(label: string): boolean {
  return OTHER_OPTION_RE.test(label.trim());
}

function truncateText(text: string, maxLen: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 1).trimEnd()}…`;
}

/**
 * Strips ```sf-questions ... ``` blocks from an assistant message so raw JSON is never
 * rendered in chat prose, mirroring `splitAssistantTicketsBlock`.
 */
export function splitAssistantQuestionsBlock(rawText: string): SplitQuestionsBlockResult {
  if (!rawText) {
    return {
      prose: "",
      questionsJson: null,
      questionsStreaming: false,
      questionCount: 0,
    };
  }

  const closedRe = /```sf-questions\s*([\s\S]*?)```/gi;
  let lastMatch: { index: number; length: number; jsonRaw: string } | null = null;
  let m: RegExpExecArray | null;
  const spans: Array<{ start: number; end: number }> = [];

  while ((m = closedRe.exec(rawText)) !== null) {
    spans.push({ start: m.index, end: m.index + m[0].length });
    lastMatch = {
      index: m.index,
      length: m[0].length,
      jsonRaw: m[1].trim(),
    };
  }

  if (lastMatch) {
    let prose = "";
    let cursor = 0;
    for (const span of spans) {
      prose += rawText.slice(cursor, span.start);
      cursor = span.end;
    }
    prose += rawText.slice(cursor);
    const count = (lastMatch.jsonRaw.match(/"question"\s*:/g) || []).length;
    return {
      prose: prose.replace(/\n{3,}/g, "\n\n").trim(),
      questionsJson: lastMatch.jsonRaw,
      questionsStreaming: false,
      questionCount: count,
    };
  }

  // Unclosed ```sf-questions fence while live-streaming
  const openRe = /```sf-questions\b([\s\S]*)$/i;
  const openMatch = openRe.exec(rawText);
  if (openMatch) {
    const partial = openMatch[1].trim();
    const prose = rawText.slice(0, openMatch.index).trim();
    const count = (partial.match(/"question"\s*:/g) || []).length;
    return {
      prose,
      questionsJson: partial,
      questionsStreaming: true,
      questionCount: count,
    };
  }

  return {
    prose: rawText,
    questionsJson: null,
    questionsStreaming: false,
    questionCount: 0,
  };
}

/**
 * Parses a structured `sf-questions` JSON payload into normalized interactive questions.
 */
export function parseQuestionsJson(code: string): ParsedQuestionSet | null {
  if (!code || !code.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(code);
  } catch {
    return null;
  }

  const rawQuestions = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed !== null
      ? Array.isArray((parsed as { questions?: unknown }).questions)
        ? (parsed as { questions: unknown[] }).questions
        : Array.isArray((parsed as { items?: unknown }).items)
          ? (parsed as { items: unknown[] }).items
          : null
      : null;

  if (!rawQuestions || rawQuestions.length === 0) return null;

  const questions: InteractiveQuestion[] = [];
  rawQuestions.slice(0, 8).forEach((item, qIdx) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return;
    const obj = item as Record<string, unknown>;
    const rawQuestion =
      typeof obj.question === "string"
        ? obj.question
        : typeof obj.prompt === "string"
          ? obj.prompt
          : typeof obj.text === "string"
            ? obj.text
            : typeof obj.title === "string"
              ? obj.title
              : "";
    const questionText = stripMarkdownFormatting(rawQuestion);
    if (!questionText) return;

    const id =
      typeof obj.id === "string" && obj.id.trim() ? obj.id.trim() : `Q${qIdx + 1}`;
    const explicitHeader =
      typeof obj.header === "string"
        ? obj.header
        : typeof obj.topic === "string"
          ? obj.topic
          : typeof obj.shortLabel === "string"
            ? obj.shortLabel
            : undefined;
    const multiSelect = Boolean(
      obj.multiSelect ?? obj.multi_select ?? obj.is_multi_select ?? obj.multiple ?? false,
    );
    let allowOther = obj.allowOther === false || obj.allow_other === false ? false : true;
    const rawHint =
      typeof obj.hint === "string"
        ? obj.hint
        : typeof obj.suggestion === "string"
          ? obj.suggestion
          : typeof obj.context === "string"
            ? obj.context
            : typeof obj.description === "string"
              ? obj.description
              : "";
    const hint = stripMarkdownFormatting(rawHint) || undefined;

    const rawOptions = Array.isArray(obj.options)
      ? obj.options
      : Array.isArray(obj.choices)
        ? obj.choices
        : [];
    const options: QuestionOption[] = [];
    const seenLabels = new Set<string>();

    rawOptions.forEach((rawOpt, oIdx) => {
      if (typeof rawOpt === "string") {
        const split = splitLabelAndDescription(rawOpt);
        if (!split.label) return;
        if (isOtherOptionLabel(split.label)) {
          allowOther = true;
          return;
        }
        const key = split.label.toLowerCase();
        if (seenLabels.has(key)) return;
        seenLabels.add(key);
        options.push({
          id: `${id}-opt-${oIdx + 1}`,
          label: split.label,
          description: split.description,
          recommended: split.recommended || undefined,
        });
        return;
      }

      if (rawOpt && typeof rawOpt === "object" && !Array.isArray(rawOpt)) {
        const optObj = rawOpt as Record<string, unknown>;
        const rawLabel =
          typeof optObj.label === "string"
            ? optObj.label
            : typeof optObj.title === "string"
              ? optObj.title
              : typeof optObj.text === "string"
                ? optObj.text
                : typeof optObj.value === "string"
                  ? optObj.value
                  : "";
        const cleaned = cleanOptionLabel(rawLabel);
        if (!cleaned.label) return;
        if (isOtherOptionLabel(cleaned.label)) {
          allowOther = true;
          return;
        }
        const key = cleaned.label.toLowerCase();
        if (seenLabels.has(key)) return;
        seenLabels.add(key);
        const optId =
          typeof optObj.id === "string" && optObj.id.trim()
            ? optObj.id.trim()
            : `${id}-opt-${oIdx + 1}`;
        const rawDesc =
          typeof optObj.description === "string"
            ? optObj.description
            : typeof optObj.rationale === "string"
              ? optObj.rationale
              : typeof optObj.detail === "string"
                ? optObj.detail
                : "";
        const description = stripMarkdownFormatting(rawDesc) || undefined;
        const recommended = Boolean(
          optObj.recommended ?? optObj.isRecommended ?? optObj.suggested ?? cleaned.recommended,
        );
        options.push({
          id: optId,
          label: cleaned.label,
          description,
          recommended: recommended || undefined,
        });
      }
    });

    // Support question-level `recommended` (option id, label, or 0-based index)
    if (!options.some((o) => o.recommended) && obj.recommended !== undefined) {
      if (typeof obj.recommended === "number" && options[obj.recommended]) {
        options[obj.recommended].recommended = true;
      } else if (typeof obj.recommended === "string" && obj.recommended.trim()) {
        const needle = obj.recommended.trim().toLowerCase();
        const found = options.find(
          (o) =>
            o.id.toLowerCase() === needle ||
            o.label.toLowerCase() === needle ||
            o.label.toLowerCase().includes(needle),
        );
        if (found) found.recommended = true;
      }
    }

    // If question has a suggestion/hint but no explicit options, provide a 1-click recommendation option
    if (options.length === 0 && hint) {
      options.push({
        id: `${id}-rec`,
        label: "Use AI recommendation",
        description: truncateText(hint, 240),
        recommended: true,
      });
    }

    questions.push({
      id,
      header: deriveHeader(questionText, qIdx, explicitHeader),
      question: questionText,
      hint: options.length === 1 && options[0].id === `${id}-rec` ? undefined : hint,
      multiSelect,
      allowOther,
      options,
    });
  });

  if (questions.length === 0) return null;

  const acceptAllLabel =
    typeof parsed === "object" &&
    parsed !== null &&
    !Array.isArray(parsed) &&
    typeof (parsed as { acceptAllLabel?: unknown }).acceptAllLabel === "string" &&
    (parsed as { acceptAllLabel: string }).acceptAllLabel.trim()
      ? (parsed as { acceptAllLabel: string }).acceptAllLabel.trim()
      : undefined;

  return {
    source: "sf-questions",
    questions,
    acceptAllLabel,
    rawJson: code,
  };
}

// ---------------------------------------------------------------------------
// Layer 2: Smart Markdown Fallback Parser (for legacy / plain-markdown waves)
// ---------------------------------------------------------------------------

const SUGGESTION_LINE_RE =
  /^\s*(?:>\s*)?(?:[-*•]\s+)?(?:\*{1,2}|_{1,2})?(?:my\s+suggestion|suggestion|recommended(?:\s+answer|\s+option)?|recommendation|our\s+recommendation|default|đề\s*xuất(?:\s+của\s+mình)?|gợi\s*ý|khuyên\s+dùng)(?:\*{1,2}|_{1,2})?\s*:\s*(?:\*{1,2}|_{1,2})?\s*(.+)$/i;

const NUMBERED_QUESTION_HEADER_RE =
  /^(?:#{1,4}\s+)?(?:(?:\*\*|__)\s*)?(?:Q(?:uestion)?\s*)?(\d{1,2})\s*[.)\]:]\s+(.+?)\s*(?:(?:\*\*|__)\s*)?$/i;

const LETTERED_OPTION_RE =
  /^\s*(?:[-*•]\s+)?(?:\*\*|__)?(?:(?:option|lựa\s+chọn)\s+)?([a-hA-H1-6])\s*[.)\]:]\s*(?:\*\*|__)?\s+(.+)$/i;

const CHECKBOX_OPTION_RE = /^\s*[-*•]\s+\[\s*[xX ]?\s*\]\s+(.+)$/;

const PLAIN_BULLET_RE = /^\s*[-*•]\s+(.+)$/;

function stripCodeFences(markdown: string): string {
  return markdown.replace(/```[\s\S]*?```/g, "\n");
}

function isNonQuestionHeading(text: string): boolean {
  const lower = stripMarkdownFormatting(text).toLowerCase();
  return (
    /^(?:c\d+|i\d+|s\d+)\b/.test(lower) ||
    /^(?:scope|out of scope|acceptance criteria|summary|next steps|files changed|verification|checks|what i found|report)\b/.test(
      lower,
    )
  );
}

function detectRecommendationMatch(
  suggestion: string,
  options: QuestionOption[],
  letterToIdx: Map<string, number>,
): number {
  const lower = suggestion.toLowerCase();
  // Match explicit letter/option reference at start or after recommend/pick/use/go with
  const letterRef =
    /(?:^|\b(?:option|choice|pick|choose|use|go with|recommend|chọn|đề xuất)\s+)(?:\*\*)?([a-h])(?:\*\*)?(?:\)|\b)/i.exec(
      suggestion,
    );
  if (letterRef?.[1]) {
    const idx = letterToIdx.get(letterRef[1].toLowerCase());
    if (idx !== undefined && options[idx]) return idx;
  }

  // Match if suggestion quotes or closely starts with one of the option labels
  for (let i = 0; i < options.length; i += 1) {
    const lbl = options[i].label.toLowerCase();
    if (lbl.length >= 6 && lower.includes(lbl)) {
      return i;
    }
  }
  return -1;
}

/**
 * Fallback parser that extracts interactive questions from plain-markdown question waves
 * (such as `/factory init`, `/factory clarify`, or `/ba-ticket` replies that don't emit
 * an explicit `sf-questions` block).
 *
 * Designed for high precision: returns `null` on normal numbered summaries/checklists.
 */
export function extractQuestionsFromMarkdown(markdown: string): ParsedQuestionSet | null {
  if (!markdown || !markdown.trim()) return null;

  const withoutCode = stripCodeFences(markdown.replace(/\r\n/g, "\n"));
  const lines = withoutCode.split("\n");

  type RawSection = {
    num: number;
    headerLine: string;
    bodyLines: string[];
  };

  const sections: RawSection[] = [];
  let current: RawSection | null = null;
  let inFooter = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    // Stop collecting body if a horizontal rule or footer prompt appears after questions
    if (current && /^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      inFooter = true;
      continue;
    }
    if (
      current &&
      /^(?:answer\s+["'“]?yes["'”]?|reply\s+with|trả\s+lời\s+|bạn\s+chỉ\s+cần\s+trả\s+lời)/i.test(
        trimmed,
      )
    ) {
      inFooter = true;
      continue;
    }

    // Check for numbered question start (top-level, not deeply indented)
    const isTopLevel = !/^\s{2,}/.test(line) && !/^\s*[-*•>]\s/.test(line);
    const numMatch = isTopLevel ? NUMBERED_QUESTION_HEADER_RE.exec(trimmed) : null;
    if (numMatch) {
      const num = Number(numMatch[1]);
      const rest = numMatch[2].trim();
      const expectedNext = sections.length === 0 ? 1 : sections[sections.length - 1].num + 1;
      const startsSequence =
        (sections.length === 0 && num === 1) ||
        (sections.length > 0 && num === expectedNext && num <= 8);

      // Avoid capturing plain numbered steps inside a non-question list if we already hit a footer
      if (startsSequence && !isNonQuestionHeading(rest) && !inFooter) {
        current = { num, headerLine: rest, bodyLines: [] };
        sections.push(current);
        continue;
      }
    }

    if (current && !inFooter) {
      current.bodyLines.push(line);
    }
  }

  if (sections.length === 0) return null;

  const parsedQuestions: InteractiveQuestion[] = [];
  let totalOptionSignals = 0;

  for (let sIdx = 0; sIdx < sections.length; sIdx += 1) {
    const sec = sections[sIdx];
    const questionText = stripMarkdownFormatting(sec.headerLine);
    if (!questionText) continue;

    const options: QuestionOption[] = [];
    const letterToIdx = new Map<string, number>();
    let allowOther = true;
    let multiSelect = false;
    let sawCheckbox = false;
    const suggestionParts: string[] = [];
    const noteParts: string[] = [];

    // First pass: check if this section has lettered options or checkboxes
    let hasExplicitLabeledOpts = false;
    let plainBulletCount = 0;
    for (const rawLine of sec.bodyLines) {
      const t = rawLine.trim();
      if (!t || SUGGESTION_LINE_RE.test(t)) continue;
      if (CHECKBOX_OPTION_RE.test(rawLine)) {
        sawCheckbox = true;
        hasExplicitLabeledOpts = true;
      } else if (LETTERED_OPTION_RE.test(rawLine)) {
        hasExplicitLabeledOpts = true;
      } else if (PLAIN_BULLET_RE.test(rawLine)) {
        plainBulletCount += 1;
      }
    }

    const usePlainBulletsAsOptions =
      !hasExplicitLabeledOpts &&
      plainBulletCount >= 2 &&
      plainBulletCount <= 6 &&
      (questionText.includes("?") ||
        /\b(?:choose|pick|select|prefer|which|option|chọn|ưu tiên)\b/i.test(questionText));

    let inSuggestionBlockquote = false;
    for (const rawLine of sec.bodyLines) {
      const trimmed = rawLine.trim();
      if (!trimmed) {
        inSuggestionBlockquote = false;
        continue;
      }

      const sugMatch = SUGGESTION_LINE_RE.exec(trimmed);
      if (sugMatch?.[1]) {
        suggestionParts.push(stripMarkdownFormatting(sugMatch[1]));
        inSuggestionBlockquote = trimmed.startsWith(">");
        continue;
      }

      if (inSuggestionBlockquote && trimmed.startsWith(">")) {
        const cont = stripMarkdownFormatting(trimmed.replace(/^>\s?/, ""));
        if (cont) suggestionParts.push(cont);
        continue;
      }
      inSuggestionBlockquote = false;

      const cbMatch = CHECKBOX_OPTION_RE.exec(rawLine);
      if (cbMatch?.[1]) {
        sawCheckbox = true;
        const split = splitLabelAndDescription(cbMatch[1]);
        if (split.label) {
          if (isOtherOptionLabel(split.label)) {
            allowOther = true;
          } else {
            options.push({
              id: `Q${sec.num}-opt-${options.length + 1}`,
              label: split.label,
              description: split.description,
              recommended: split.recommended || undefined,
            });
          }
        }
        continue;
      }

      const letMatch = LETTERED_OPTION_RE.exec(rawLine);
      if (letMatch?.[1] && letMatch?.[2]) {
        const letter = letMatch[1].toLowerCase();
        const split = splitLabelAndDescription(letMatch[2]);
        if (split.label) {
          if (isOtherOptionLabel(split.label)) {
            allowOther = true;
          } else {
            letterToIdx.set(letter, options.length);
            options.push({
              id: `Q${sec.num}-opt-${options.length + 1}`,
              label: split.label,
              description: split.description,
              recommended: split.recommended || undefined,
            });
          }
        }
        continue;
      }

      if (usePlainBulletsAsOptions) {
        const bulMatch = PLAIN_BULLET_RE.exec(rawLine);
        if (bulMatch?.[1]) {
          const split = splitLabelAndDescription(bulMatch[1]);
          if (split.label) {
            if (isOtherOptionLabel(split.label)) {
              allowOther = true;
            } else {
              options.push({
                id: `Q${sec.num}-opt-${options.length + 1}`,
                label: split.label,
                description: split.description,
                recommended: split.recommended || undefined,
              });
            }
          }
          continue;
        }
      }

      // Capture brief clarifying sub-prompt (skip stray footer lines)
      if (!trimmed.startsWith(">")) {
        const cleanNote = stripMarkdownFormatting(trimmed);
        if (cleanNote) noteParts.push(cleanNote);
      }
    }

    if (
      sawCheckbox ||
      /\b(?:select all|multiple|multi-select|chọn nhiều|có thể chọn nhiều)\b/i.test(
        `${questionText} ${noteParts.join(" ")}`,
      )
    ) {
      multiSelect = true;
    }

    const suggestion = suggestionParts.join(" ").trim();
    const isLikelyQuestion =
      questionText.includes("?") ||
      Boolean(suggestion) ||
      options.length >= 2 ||
      noteParts.some((n) => n.includes("?"));

    if (!isLikelyQuestion) continue;

    if (suggestion) {
      if (options.length > 0) {
        const matchedIdx = detectRecommendationMatch(suggestion, options, letterToIdx);
        if (matchedIdx >= 0 && !options.some((o) => o.recommended)) {
          options[matchedIdx].recommended = true;
        }
      } else {
        // Open-ended question with an AI suggestion -> turn suggestion into a 1-click option
        options.push({
          id: `Q${sec.num}-rec`,
          label: "Use AI suggestion",
          description: truncateText(suggestion, 240),
          recommended: true,
        });
      }
    }

    if (options.length > 0) {
      totalOptionSignals += 1;
    }

    const combinedHintParts: string[] = [];
    if (noteParts.length > 0) {
      combinedHintParts.push(truncateText(noteParts.join(" "), 200));
    }
    if (suggestion && !(options.length === 1 && options[0].id === `Q${sec.num}-rec`)) {
      combinedHintParts.push(`AI suggestion: ${truncateText(suggestion, 220)}`);
    }

    parsedQuestions.push({
      id: `Q${sec.num}`,
      header: deriveHeader(questionText, sIdx),
      question: questionText,
      hint: combinedHintParts.length > 0 ? combinedHintParts.join(" · ") : undefined,
      multiSelect,
      allowOther,
      options,
    });
  }

  // Precision guardrail: require at least 1 question with selectable options/recommendations
  if (parsedQuestions.length === 0 || totalOptionSignals === 0) {
    return null;
  }

  const hasAcceptAllHint =
    /\b(?:answer\s+["'“]?yes["'”]?|you\s+pick|take\s+my\s+suggestions?|accept\s+all)\b/i.test(
      withoutCode,
    );

  return {
    source: "markdown",
    questions: parsedQuestions,
    acceptAllLabel: hasAcceptAllHint ? "Accept AI suggestions" : undefined,
  };
}

/**
 * Extracts interactive questions from an assistant message.
 * Layer 1 (`sf-questions` fenced JSON) always takes precedence over Layer 2 (markdown fallback).
 */
export function extractQuestionSetFromAssistantText(rawText: string): ParsedQuestionSet | null {
  if (!rawText || !rawText.trim()) return null;
  const split = splitAssistantQuestionsBlock(rawText);
  if (split.questionsStreaming) return null;
  if (split.questionsJson) {
    const structured = parseQuestionsJson(split.questionsJson);
    if (structured) return structured;
  }
  return extractQuestionsFromMarkdown(split.prose);
}

/**
 * Extracts optional clickable options/questions from a `RunInteraction.payload`.
 */
export function extractQuestionsFromInteractionPayload(
  payload: Record<string, unknown> | null | undefined,
  fallbackTitle?: string,
): InteractiveQuestion[] | null {
  if (!payload || typeof payload !== "object") return null;
  if (Array.isArray(payload.questions) && payload.questions.length > 0) {
    const parsed = parseQuestionsJson(JSON.stringify({ questions: payload.questions }));
    if (parsed && parsed.questions.length > 0) return parsed.questions;
  }
  if (Array.isArray(payload.options) && payload.options.length > 0) {
    const parsed = parseQuestionsJson(
      JSON.stringify({
        questions: [
          {
            id: "Q1",
            question: fallbackTitle || "Choose an option",
            multiSelect: Boolean(payload.multiSelect ?? payload.multi_select),
            options: payload.options,
            allowOther: true,
          },
        ],
      }),
    );
    if (parsed && parsed.questions.length > 0) return parsed.questions;
  }
  return null;
}

export function isQuestionAnswered(
  q: InteractiveQuestion,
  draft: QuestionAnswerDraft | undefined,
): boolean {
  if (!draft) return false;
  if (draft.selectedOptionIds.length > 0) return true;
  if (draft.useOther && draft.otherText.trim().length > 0) return true;
  if (!q.options.length && draft.otherText.trim().length > 0) return true;
  return false;
}

/**
 * Builds pre-selected answers choosing each question's recommended option (when present).
 */
export function buildRecommendedAnswers(
  questions: InteractiveQuestion[],
  existing: Record<string, QuestionAnswerDraft> = {},
): Record<string, QuestionAnswerDraft> {
  const next: Record<string, QuestionAnswerDraft> = { ...existing };
  for (const q of questions) {
    if (isQuestionAnswered(q, next[q.id])) continue;
    const recOpts = q.options.filter((o) => o.recommended);
    if (recOpts.length > 0) {
      next[q.id] = {
        selectedOptionIds: q.multiSelect ? recOpts.map((o) => o.id) : [recOpts[0].id],
        useOther: false,
        otherText: "",
      };
    }
  }
  return next;
}

/**
 * Formats selected answers into a crisp, unambiguous reply sent to `/api/sessions/[id]/steer`.
 */
export function formatQuestionAnswers(
  questions: InteractiveQuestion[],
  answers: Record<string, QuestionAnswerDraft>,
): string {
  const lines: string[] = [];

  for (let i = 0; i < questions.length; i += 1) {
    const q = questions[i];
    const draft = answers[q.id];
    if (!draft) continue;

    const chosenLabels: string[] = [];
    for (const optId of draft.selectedOptionIds) {
      const opt = q.options.find((o) => o.id === optId);
      if (!opt) continue;
      if (
        (opt.id.endsWith("-rec") || /^use ai (?:recommendation|suggestion)$/i.test(opt.label)) &&
        opt.description
      ) {
        chosenLabels.push(`${opt.label} (${opt.description})`);
      } else {
        chosenLabels.push(opt.label);
      }
    }

    const custom = draft.otherText.trim();
    if (custom && (draft.useOther || chosenLabels.length === 0 || q.multiSelect)) {
      chosenLabels.push(custom);
    } else if (custom && chosenLabels.length > 0) {
      chosenLabels.push(`Note: ${custom}`);
    }

    if (chosenLabels.length === 0) continue;

    const answerStr = chosenLabels.join(q.multiSelect ? ", " : " — ");
    if (questions.length === 1) {
      lines.push(answerStr);
    } else {
      lines.push(`${i + 1}. **${q.question}**: ${answerStr}`);
    }
  }

  return lines.join("\n");
}
