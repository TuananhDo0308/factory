"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeftIcon, HelpCircleIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

/**
 * Answer box for a ticket that needs a decision (a `decision` RunInteraction of an epic run).
 * Answering enqueues `run_epic` again with `retry: [issue]` and `note: <answer>` as a new run.
 */
export function DecisionAnswer({
  runId,
  interactionId,
  issue,
  question,
  reason,
  canWrite = true,
  compact = false,
  onAnswered,
}: {
  runId: string;
  interactionId: string;
  issue: number | null;
  question: string;
  reason?: string | null;
  canWrite?: boolean;
  compact?: boolean;
  onAnswered?: (retryRunId: string | null) => void;
}) {
  const router = useRouter();
  const [answer, setAnswer] = React.useState("");
  const [busy, setBusy] = React.useState<"answer" | "dismiss" | null>(null);

  async function send(decision: "answered" | "dismissed") {
    if (decision === "answered" && !answer.trim()) {
      toast.error("Write your answer first");
      return;
    }
    setBusy(decision === "answered" ? "answer" : "dismiss");
    try {
      const res = await fetch(`/api/sessions/${runId}/steer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ interactionId, decision, message: answer.trim() }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        retryRun?: { id: string };
      } | null;
      if (!res.ok) {
        toast.error(data?.error || "Could not send the answer");
        return;
      }
      if (decision === "dismissed") {
        toast.success("Decision dismissed");
        onAnswered?.(null);
        return;
      }
      toast.success(issue ? `Retrying #${issue} with your answer` : "Retrying with your answer");
      setAnswer("");
      onAnswered?.(data?.retryRun?.id ?? null);
      if (data?.retryRun?.id && !onAnswered) router.push(`/sessions/${data.retryRun.id}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-primary/35 bg-primary/5 p-3 text-xs">
      <div className="flex items-start gap-2">
        <HelpCircleIcon className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-medium text-foreground">
            {issue ? `#${issue} needs a decision` : "A ticket needs a decision"}
          </span>
          {question && (
            <p className="whitespace-pre-wrap leading-relaxed text-foreground/90">{question}</p>
          )}
          {reason && !compact && (
            <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
              Why: {reason}
            </p>
          )}
        </div>
      </div>
      {canWrite && (
        <>
          <Textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Your answer — the ticket is built again with it"
            className="min-h-16 text-xs"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send("answered");
              }
            }}
          />
          <div className="flex items-center justify-end gap-1.5">
            <Button
              size="xs"
              variant="ghost"
              disabled={busy !== null}
              onClick={() => void send("dismissed")}
            >
              {busy === "dismiss" ? <Spinner data-icon="inline-start" /> : <XIcon data-icon="inline-start" />}
              Dismiss
            </Button>
            <Button size="xs" disabled={busy !== null || !answer.trim()} onClick={() => void send("answered")}>
              {busy === "answer" ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <CornerDownLeftIcon data-icon="inline-start" />
              )}
              Answer &amp; retry
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
