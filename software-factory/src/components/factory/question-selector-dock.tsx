"use client";

import * as React from "react";
import {
  ArrowUpIcon,
  CheckCircle2Icon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ListChecksIcon,
  SparklesIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
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
  buildRecommendedAnswers,
  formatQuestionAnswers,
  isQuestionAnswered,
  type InteractiveQuestion,
  type ParsedQuestionSet,
  type QuestionAnswerDraft,
} from "@/lib/questions";
import { cn } from "@/lib/utils";

function emptyDraft(): QuestionAnswerDraft {
  return {
    selectedOptionIds: [],
    useOther: false,
    otherText: "",
  };
}

export function QuestionSelectorDock({
  questionSet,
  busy = false,
  onSubmit,
}: {
  questionSet: ParsedQuestionSet;
  busy?: boolean;
  onSubmit: (formattedReply: string) => Promise<void> | void;
}) {
  const { questions } = questionSet;
  const [activeIdx, setActiveIdx] = React.useState(0);
  const [collapsed, setCollapsed] = React.useState(false);
  const [answers, setAnswers] = React.useState<Record<string, QuestionAnswerDraft>>({});
  const otherInputRef = React.useRef<HTMLInputElement | null>(null);

  const safeIdx = Math.min(activeIdx, Math.max(0, questions.length - 1));
  const activeQuestion = questions[safeIdx];
  if (!activeQuestion) return null;

  const activeDraft = answers[activeQuestion.id] ?? emptyDraft();

  const answeredCount = questions.reduce(
    (acc, q) => acc + (isQuestionAnswered(q, answers[q.id]) ? 1 : 0),
    0,
  );
  const allAnswered = answeredCount === questions.length;
  const unansweredQuestions = questions.filter((q) => !isQuestionAnswered(q, answers[q.id]));
  const allHaveRecommended = questions.every((q) => q.options.some((o) => o.recommended));
  const unansweredAllHaveRecommended =
    unansweredQuestions.length > 0 &&
    unansweredQuestions.every((q) => q.options.some((o) => o.recommended));
  const anyUnansweredHasRecommended = unansweredQuestions.some((q) =>
    q.options.some((o) => o.recommended),
  );

  function toggleOption(q: InteractiveQuestion, optId: string) {
    setAnswers((prev) => {
      const cur = prev[q.id] ?? emptyDraft();
      if (q.multiSelect) {
        const exists = cur.selectedOptionIds.includes(optId);
        const nextIds = exists
          ? cur.selectedOptionIds.filter((id) => id !== optId)
          : [...cur.selectedOptionIds, optId];
        return {
          ...prev,
          [q.id]: {
            ...cur,
            selectedOptionIds: nextIds,
          },
        };
      }

      const alreadySelected = cur.selectedOptionIds.length === 1 && cur.selectedOptionIds[0] === optId;
      return {
        ...prev,
        [q.id]: {
          ...cur,
          selectedOptionIds: alreadySelected ? [] : [optId],
          useOther: false,
        },
      };
    });
  }

  function selectOtherMode(q: InteractiveQuestion) {
    setAnswers((prev) => {
      const cur = prev[q.id] ?? emptyDraft();
      if (q.multiSelect) {
        return {
          ...prev,
          [q.id]: {
            ...cur,
            useOther: !cur.useOther || cur.otherText.trim().length > 0,
          },
        };
      }
      return {
        ...prev,
        [q.id]: {
          ...cur,
          selectedOptionIds: [],
          useOther: true,
        },
      };
    });
    requestAnimationFrame(() => otherInputRef.current?.focus());
  }

  function updateOtherText(q: InteractiveQuestion, value: string) {
    setAnswers((prev) => {
      const cur = prev[q.id] ?? emptyDraft();
      const hasSelected = cur.selectedOptionIds.length > 0;
      return {
        ...prev,
        [q.id]: {
          ...cur,
          useOther: hasSelected ? cur.useOther : value.trim().length > 0,
          otherText: value,
        },
      };
    });
  }

  function goToNextUnanswered(fromIdx: number): boolean {
    for (let offset = 1; offset <= questions.length; offset += 1) {
      const idx = (fromIdx + offset) % questions.length;
      if (!isQuestionAnswered(questions[idx], answers[questions[idx].id])) {
        setActiveIdx(idx);
        return true;
      }
    }
    return false;
  }

  async function handleAcceptRecommended() {
    if (busy) return;
    const filled = buildRecommendedAnswers(questions, answers);

    // 1-click instant submit when nothing was typed yet and every question has a recommendation
    if (answeredCount === 0 && allHaveRecommended) {
      setAnswers(filled);
      const formatted = formatQuestionAnswers(questions, filled);
      if (formatted) {
        await onSubmit(formatted);
      }
      return;
    }

    setAnswers(filled);
    const firstUnanswered = questions.findIndex((q) => !isQuestionAnswered(q, filled[q.id]));
    if (firstUnanswered >= 0) {
      setActiveIdx(firstUnanswered);
    }
  }

  async function handleSubmit() {
    if (busy || answeredCount === 0) return;
    const formatted = formatQuestionAnswers(questions, answers);
    if (!formatted) return;
    await onSubmit(formatted);
  }

  function handleContainerKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement | null;
    const inEditable =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      Boolean(target?.isContentEditable);
    if (inEditable || busy || collapsed) return;

    if (e.key >= "1" && e.key <= "9") {
      const idx = Number(e.key) - 1;
      const opt = activeQuestion.options[idx];
      if (opt) {
        e.preventDefault();
        toggleOption(activeQuestion, opt.id);
      }
    } else if (e.key === "ArrowLeft" && questions.length > 1 && safeIdx > 0) {
      e.preventDefault();
      setActiveIdx(safeIdx - 1);
    } else if (e.key === "ArrowRight" && questions.length > 1 && safeIdx < questions.length - 1) {
      e.preventDefault();
      setActiveIdx(safeIdx + 1);
    }
  }

  const hasSelectedOption = activeDraft.selectedOptionIds.length > 0;
  const showOtherRow = activeQuestion.allowOther || activeQuestion.options.length === 0;
  const otherChecked =
    activeQuestion.options.length === 0
      ? activeDraft.otherText.trim().length > 0
      : activeDraft.useOther || (!hasSelectedOption && activeDraft.otherText.trim().length > 0);

  return (
    <div
      className="border-t bg-muted/25 px-5 py-2.5"
      onKeyDown={handleContainerKeyDown}
    >
      <div className="mx-auto w-full max-w-3xl">
        <div className="overflow-hidden rounded-lg border bg-card">
          {/* Top Stepper / Tabs Header */}
          <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
            <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
              {collapsed ? (
                <button
                  type="button"
                  onClick={() => setCollapsed(false)}
                  className="flex items-center gap-2 text-left text-xs font-medium text-foreground hover:text-primary"
                >
                  <ListChecksIcon className="size-3.5 shrink-0 text-primary" />
                  <span>
                    {questions.length} {questions.length === 1 ? "question" : "questions"} awaiting
                    your selection
                  </span>
                </button>
              ) : questions.length === 1 ? (
                <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <ListChecksIcon className="size-3.5 shrink-0 text-primary" />
                  <span>Quick answer</span>
                </div>
              ) : (
                questions.map((q, idx) => {
                  const answered = isQuestionAnswered(q, answers[q.id]);
                  const isActive = idx === safeIdx;
                  const tabLabel =
                    q.header.toUpperCase() === `Q${idx + 1}` ? q.header : `${idx + 1}. ${q.header}`;
                  return (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => setActiveIdx(idx)}
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors",
                        isActive
                          ? "border-primary/45 bg-primary/10 text-foreground"
                          : answered
                            ? "border-border/70 bg-background text-foreground/85 hover:bg-muted/60"
                            : "border-transparent bg-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                      )}
                    >
                      {answered ? (
                        <CheckCircle2Icon className="size-3.5 shrink-0 text-primary" />
                      ) : (
                        <span
                          className={cn(
                            "inline-flex size-4 items-center justify-center rounded-full font-mono text-[10px]",
                            isActive
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {idx + 1}
                        </span>
                      )}
                      <span className="max-w-32 truncate">{tabLabel}</span>
                    </button>
                  );
                })
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                {answeredCount}/{questions.length}
              </span>
              {collapsed && answeredCount === 0 && allHaveRecommended && (
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void handleAcceptRecommended()}
                >
                  <SparklesIcon data-icon="inline-start" />
                  {questionSet.acceptAllLabel || "Accept all"}
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                title={collapsed ? "Expand options" : "Minimize options"}
                onClick={() => setCollapsed((v) => !v)}
              >
                {collapsed ? <ChevronUpIcon /> : <ChevronDownIcon />}
              </Button>
            </div>
          </div>

          {/* Active Question Body + Options */}
          {!collapsed && (
            <>
              <div className="flex flex-col gap-2.5 px-3.5 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-sm font-medium leading-snug text-foreground">
                    {questions.length > 1 && (
                      <span className="mr-1.5 font-mono text-xs text-muted-foreground">
                        {safeIdx + 1}.
                      </span>
                    )}
                    {activeQuestion.question}
                  </p>
                  {activeQuestion.multiSelect && (
                    <Badge variant="outline">Select all that apply</Badge>
                  )}
                </div>

                {activeQuestion.hint && (
                  <p className="border-l-2 border-primary/45 pl-2.5 text-xs leading-relaxed text-muted-foreground">
                    {activeQuestion.hint}
                  </p>
                )}

                <div className="flex max-h-56 flex-col gap-1.5 overflow-y-auto pr-0.5">
                  {activeQuestion.options.map((opt, oIdx) => {
                    const selected = activeDraft.selectedOptionIds.includes(opt.id);
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        disabled={busy}
                        onClick={() => toggleOption(activeQuestion, opt.id)}
                        className={cn(
                          "group flex w-full items-start gap-2.5 rounded-md border px-3 py-2 text-left transition-colors",
                          selected
                            ? "border-primary/60 bg-primary/[0.07]"
                            : "border-border/80 bg-background hover:border-border hover:bg-muted/45",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 flex size-4 shrink-0 items-center justify-center border transition-colors",
                            activeQuestion.multiSelect ? "rounded-[4px]" : "rounded-full",
                            selected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-input bg-background group-hover:border-muted-foreground/60",
                          )}
                        >
                          {selected &&
                            (activeQuestion.multiSelect ? (
                              <CheckIcon className="size-3" />
                            ) : (
                              <span className="size-1.5 rounded-full bg-current" />
                            ))}
                        </span>

                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[13px] font-medium leading-snug text-foreground">
                              {opt.label}
                            </span>
                            {opt.recommended && <Badge variant="secondary">Recommended</Badge>}
                          </div>
                          {opt.description && (
                            <span className="text-xs leading-relaxed text-muted-foreground">
                              {opt.description}
                            </span>
                          )}
                        </div>

                        {oIdx < 9 && (
                          <span className="mt-0.5 hidden shrink-0 font-mono text-[10px] text-muted-foreground/60 sm:inline">
                            {oIdx + 1}
                          </span>
                        )}
                      </button>
                    );
                  })}

                  {showOtherRow && (
                    <div
                      className={cn(
                        "flex items-center gap-2.5 rounded-md border px-3 py-1.5 transition-colors",
                        otherChecked
                          ? "border-primary/60 bg-primary/[0.07]"
                          : "border-border/80 bg-background hover:border-border",
                      )}
                    >
                      <button
                        type="button"
                        disabled={busy}
                        title={
                          activeQuestion.multiSelect
                            ? "Toggle custom answer"
                            : "Choose custom answer"
                        }
                        onClick={() => selectOtherMode(activeQuestion)}
                        className={cn(
                          "flex size-4 shrink-0 items-center justify-center border transition-colors",
                          activeQuestion.multiSelect ? "rounded-[4px]" : "rounded-full",
                          otherChecked
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input bg-background hover:border-muted-foreground/60",
                        )}
                      >
                        {otherChecked &&
                          (activeQuestion.multiSelect ? (
                            <CheckIcon className="size-3" />
                          ) : (
                            <span className="size-1.5 rounded-full bg-current" />
                          ))}
                      </button>

                      <Input
                        ref={otherInputRef}
                        disabled={busy}
                        value={activeDraft.otherText}
                        onChange={(e) => updateOtherText(activeQuestion, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            if (!goToNextUnanswered(safeIdx) && answeredCount > 0) {
                              void handleSubmit();
                            }
                          }
                        }}
                        placeholder={
                          hasSelectedOption && !activeQuestion.multiSelect
                            ? "Add extra details (optional)..."
                            : "Other — type your own answer..."
                        }
                        className="h-8 flex-1"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Footer Controls */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/20 px-3.5 py-2">
                <div className="flex items-center gap-1.5">
                  {questions.length > 1 && (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        disabled={busy || safeIdx === 0}
                        onClick={() => setActiveIdx((i) => Math.max(0, i - 1))}
                      >
                        <ChevronLeftIcon data-icon="inline-start" />
                        Prev
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        disabled={busy || safeIdx >= questions.length - 1}
                        onClick={() =>
                          setActiveIdx((i) => Math.min(questions.length - 1, i + 1))
                        }
                      >
                        Next
                        <ChevronRightIcon data-icon="inline-end" />
                      </Button>
                    </>
                  )}

                  {anyUnansweredHasRecommended && (
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      disabled={busy}
                      onClick={() => void handleAcceptRecommended()}
                    >
                      <SparklesIcon data-icon="inline-start" />
                      {answeredCount === 0 && allHaveRecommended
                        ? questionSet.acceptAllLabel || "Accept all recommended"
                        : unansweredAllHaveRecommended
                          ? "Fill remaining"
                          : "Use recommended"}
                    </Button>
                  )}
                </div>

                <Button
                  type="button"
                  size="sm"
                  disabled={busy || answeredCount === 0}
                  onClick={() => void handleSubmit()}
                >
                  {busy ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <ArrowUpIcon data-icon="inline-start" />
                  )}
                  {questions.length === 1
                    ? "Send answer"
                    : allAnswered
                      ? "Submit answers"
                      : `Submit (${answeredCount}/${questions.length})`}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Compact read-only collapsible summary rendered inside an assistant message bubble
 * when an `sf-questions` JSON block was emitted (keeps raw JSON out of chat history).
 */
export function AskedQuestionsSummary({
  questions,
  isPendingBelow = false,
}: {
  questions: InteractiveQuestion[];
  isPendingBelow?: boolean;
}) {
  if (questions.length === 0) return null;

  return (
    <Trace className="pt-0.5">
      <TraceCollapsible defaultOpen={false}>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceIcon>
              <ListChecksIcon />
            </TraceIcon>
            <TraceTitle>
              Asked {questions.length} {questions.length === 1 ? "question" : "questions"}
            </TraceTitle>
            <TraceDescription>
              {isPendingBelow ? "Select options below" : "View options"}
            </TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <div className="flex flex-col gap-2 text-xs">
            {questions.map((q, idx) => (
              <div key={q.id} className="flex flex-col gap-1 rounded-md border bg-muted/30 p-2.5">
                <span className="font-medium text-foreground">
                  {idx + 1}. {q.question}
                </span>
                {q.options.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {q.options.map((opt) => (
                      <span
                        key={opt.id}
                        className={cn(
                          "rounded border px-2 py-0.5 text-[11px]",
                          opt.recommended
                            ? "border-primary/40 bg-primary/10 text-foreground"
                            : "bg-background text-muted-foreground",
                        )}
                      >
                        {opt.label}
                        {opt.recommended ? " ★" : ""}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
