"use client";

import * as React from "react";
import { GitBranchIcon, RefreshCwIcon, UnlinkIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { formatRelativeTime } from "@/components/factory/factory-primitives";

type TrackingStatus = {
  tracked: boolean;
  githubFullName: string | null;
  githubUrl: string | null;
  githubSyncedAt: string | null;
  githubSyncError: string | null;
};

/**
 * Paste a repository link once: the app installs a webhook and follows the epics, tickets,
 * staging merges and prototype branches new-ba and new-factory leave there.
 */
export function GithubTrackingCard({
  projectId,
  defaultLink,
  canWrite,
  onSynced,
}: {
  projectId: string;
  defaultLink: string | null;
  canWrite: boolean;
  onSynced?: () => void;
}) {
  const [status, setStatus] = React.useState<TrackingStatus | null>(null);
  const [link, setLink] = React.useState(defaultLink ?? "");
  const [busy, setBusy] = React.useState<"track" | "sync" | "untrack" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/github`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: TrackingStatus | null) => {
        if (!cancelled && s) setStatus(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function call(kind: "track" | "sync" | "untrack") {
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/github`, {
        method: kind === "track" ? "POST" : kind === "sync" ? "PUT" : "DELETE",
        headers: { "content-type": "application/json" },
        body: kind === "track" ? JSON.stringify({ link }) : undefined,
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        status?: TrackingStatus;
        epics?: number;
        prototypes?: number;
      };
      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        return;
      }
      if (data.status) setStatus(data.status);
      if (kind === "untrack") toast.success("Stopped tracking; the webhook was removed.");
      else toast.success(`Synced ${data.epics ?? 0} epic(s) and ${data.prototypes ?? 0} prototype(s) from GitHub.`);
      onSynced?.();
    } finally {
      setBusy(null);
    }
  }

  const tracked = Boolean(status?.tracked);
  const shownError = error || status?.githubSyncError || null;

  return (
    <div className="mb-3 flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex items-center gap-2 text-sm font-medium text-foreground">
            <GitBranchIcon className="size-4 text-muted-foreground" />
            GitHub tracking
            {tracked ? <Badge variant="secondary">Live</Badge> : <Badge variant="outline">Off</Badge>}
          </span>
          <span className="text-xs text-muted-foreground">
            {tracked
              ? `Following ${status?.githubFullName}: epics, tickets, merges into staging and prototype branches. Last sync ${formatRelativeTime(status?.githubSyncedAt)}.`
              : "Paste the repository link. The app installs a webhook and follows what new-ba and new-factory publish there."}
          </span>
        </div>
        {tracked && canWrite && (
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void call("sync")}>
              {busy === "sync" ? <Spinner data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}
              Re-sync
            </Button>
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void call("untrack")}>
              {busy === "untrack" ? <Spinner data-icon="inline-start" /> : <UnlinkIcon data-icon="inline-start" />}
              Untrack
            </Button>
          </div>
        )}
      </div>

      {!tracked && canWrite && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void call("track");
          }}
        >
          <InputGroup className="min-w-64 flex-1">
            <InputGroupAddon>
              <GitBranchIcon />
            </InputGroupAddon>
            <InputGroupInput
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://github.com/owner/repo"
              aria-label="Repository link"
            />
          </InputGroup>
          <Button type="submit" size="sm" disabled={busy !== null || !link.trim()}>
            {busy === "track" && <Spinner data-icon="inline-start" />}
            Track
          </Button>
        </form>
      )}

      {shownError && <p className="text-xs text-destructive">{shownError}</p>}
    </div>
  );
}
