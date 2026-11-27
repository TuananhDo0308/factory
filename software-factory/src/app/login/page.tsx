"use client";

import * as React from "react";
import { AlertCircleIcon, GitBranchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import {
  FactoryMark,
  FactoryWordmark,
} from "@/components/factory/factory-primitives";

const OAUTH_ERROR_LABELS: Record<string, string> = {
  oauth_not_configured:
    "GitHub OAuth is not configured on this server. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.",
  invalid_state: "Login session expired or state mismatch. Please try signing in again.",
  access_denied: "GitHub authorization was cancelled.",
};

export default function LoginPage() {
  const search = React.useSyncExternalStore(
    () => () => {},
    () => window.location.search,
    () => "",
  );
  const { nextPath, errorMessage } = React.useMemo(() => {
    const params = new URLSearchParams(search);
    const rawNext = params.get("next") || "";
    const rawError = params.get("error") || "";
    return {
      nextPath: rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/sessions",
      errorMessage: rawError
        ? OAUTH_ERROR_LABELS[rawError] || `GitHub sign-in failed (${rawError}).`
        : "",
    };
  }, [search]);

  const githubLoginHref =
    nextPath !== "/sessions"
      ? `/auth/github/login?next=${encodeURIComponent(nextPath)}`
      : "/auth/github/login";

  return (
    <div className="flex min-h-screen flex-1 items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center gap-3 text-center">
          <div className="flex items-center gap-2.5 text-foreground">
            <FactoryMark className="size-7" />
            <FactoryWordmark className="text-[24px]" />
          </div>
          <CardDescription>
            Control plane for factory v2 on Claude Code: write epics with the BA, build them into staging.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {errorMessage && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/35 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertCircleIcon className="mt-0.5 size-3.5 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}
          <Button
            className="w-full"
            nativeButton={false}
            render={<a href={githubLoginHref} />}
          >
            <GitBranchIcon data-icon="inline-start" />
            Sign in with GitHub
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
