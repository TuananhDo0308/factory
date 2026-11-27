"use client";

import {
  CircleCheckIcon,
  CircleDotIcon,
  GitCommitHorizontalIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestIcon,
  Undo2Icon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { SerializedProjectIssue } from "@/lib/project-stats";
import { cn } from "@/lib/utils";

// Labels the factory uses for its own flow; the card already shows them as a status.
const FLOW_LABELS = new Set(["ready", "review", "needs-decision"]);

function stop(e: React.SyntheticEvent) {
  e.stopPropagation();
}

function LinkChip({
  href,
  title,
  className,
  children,
}: {
  href: string;
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={title}
      onClick={stop}
      onKeyDown={stop}
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-md border bg-background px-1.5 font-mono text-2xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground",
        className,
      )}
    >
      {children}
    </a>
  );
}

/**
 * The ticket's places on GitHub: the issue, the newest linked pull request, and new-factory's
 * merge commit on staging (or its revert). Each opens GitHub without opening the ticket.
 */
export function TicketGithubLinks({
  issue,
  repo,
  variant = "card",
}: {
  issue: SerializedProjectIssue;
  repo: string | null;
  variant?: "card" | "sheet";
}) {
  const { github } = issue;
  const issueUrl =
    issue.githubIssueUrl ||
    (repo && issue.githubIssueNumber ? `https://github.com/${repo}/issues/${issue.githubIssueNumber}` : null);
  const commitUrl = github.merge && repo ? `https://github.com/${repo}/commit/${github.merge.sha}` : null;
  const labels = github.labels.filter((l) => variant === "sheet" || !FLOW_LABELS.has(l));
  if (!issueUrl && !github.pr && !github.merge && labels.length === 0) return null;

  const closed = github.state === "closed";
  const prState = github.pr?.state ?? "open";
  const PrIcon = prState === "merged" ? GitMergeIcon : prState === "closed" ? GitPullRequestClosedIcon : GitPullRequestIcon;

  return (
    <div className={cn("flex flex-wrap items-center gap-1", variant === "card" && "border-t border-border/50 pt-2")}>
      {issueUrl && (
        <LinkChip href={issueUrl} title={`Issue #${issue.githubIssueNumber} on GitHub (${github.state ?? "open"})`}>
          {closed ? (
            <CircleCheckIcon className="size-3 text-purple-500" />
          ) : (
            <CircleDotIcon className="size-3 text-emerald-600 dark:text-emerald-400" />
          )}
          #{issue.githubIssueNumber}
        </LinkChip>
      )}
      {github.pr?.url && (
        <LinkChip href={github.pr.url} title={`Pull request #${github.pr.number} (${prState})`}>
          <PrIcon
            className={cn(
              "size-3",
              prState === "merged" ? "text-purple-500" : prState === "closed" ? "text-destructive" : "text-emerald-600 dark:text-emerald-400",
            )}
          />
          PR #{github.pr.number}
          {variant === "sheet" && <span className="text-muted-foreground/80">· {prState}</span>}
        </LinkChip>
      )}
      {github.merge && commitUrl && (
        <LinkChip
          href={commitUrl}
          title={
            github.merge.revertedAt
              ? `Merged into staging as ${github.merge.sha.slice(0, 7)}, then reverted`
              : `Merged into staging as ${github.merge.sha.slice(0, 7)}`
          }
          className={github.merge.revertedAt ? "line-through decoration-muted-foreground/60" : undefined}
        >
          <GitCommitHorizontalIcon className="size-3 text-purple-500" />
          {github.merge.sha.slice(0, 7)}
          {variant === "sheet" && <span className="text-muted-foreground/80 no-underline">· staging</span>}
        </LinkChip>
      )}
      {github.merge?.revertedAt && (
        <span className="inline-flex h-6 items-center gap-1 px-1 font-mono text-2xs text-destructive" title="Reverted on staging">
          <Undo2Icon className="size-3" />
          reverted
        </span>
      )}
      {labels.slice(0, variant === "card" ? 2 : undefined).map((l) => (
        <Badge key={l} variant="outline">
          {l}
        </Badge>
      ))}
    </div>
  );
}
