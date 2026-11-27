"use client";

import * as React from "react";

const POLL_MS = 30_000;

/**
 * While a project's page is open and visible, asks the server every 30s to apply new GitHub
 * events (only does work when no webhook can reach the app, e.g. on localhost). Board updates
 * then arrive through the factory event stream like webhook ones.
 */
export function useGithubPoll(projectId: string | null) {
  React.useEffect(() => {
    if (!projectId) return;
    let stopped = false;
    const poll = () => {
      if (stopped || document.visibilityState !== "visible") return;
      void fetch(`/api/projects/${projectId}/github/poll`, { method: "POST" }).catch(() => {});
    };
    poll();
    const timer = setInterval(poll, POLL_MS);
    document.addEventListener("visibilitychange", poll);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [projectId]);
}
