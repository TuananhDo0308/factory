"use client";

import * as React from "react";
import { GitBranchIcon, LaptopIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import {
  FactoryMark,
  FactoryWordmark,
} from "@/components/factory/factory-primitives";

export default function LoginPage() {
  const [enteringLocal, setEnteringLocal] = React.useState(false);

  const nextPath = React.useSyncExternalStore(
    () => () => {},
    () => {
      const raw = new URLSearchParams(window.location.search).get("next") || "";
      return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/sessions";
    },
    () => "/sessions",
  );

  async function continueLocal() {
    setEnteringLocal(true);
    try {
      const res = await fetch("/auth/local", { method: "POST" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(data?.error || "Local mode is disabled");
        return;
      }
      window.location.assign(nextPath);
    } finally {
      setEnteringLocal(false);
    }
  }

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
            Agent-native control plane for Antigravity &amp; Claude Code pipelines.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button
            className="w-full"
            disabled={enteringLocal}
            onClick={() => void continueLocal()}
          >
            {enteringLocal ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <LaptopIcon data-icon="inline-start" />
            )}
            Continue in Local Mode
          </Button>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <Separator className="flex-1" />
            <span>or</span>
            <Separator className="flex-1" />
          </div>
          <Button
            variant="outline"
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
