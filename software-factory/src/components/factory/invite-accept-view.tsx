"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderIcon, ShieldCheckIcon, UsersIcon, XCircleIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import {
  FactoryMark,
  FactoryWordmark,
} from "@/components/factory/factory-primitives";

export function InviteAcceptView({
  token,
  user,
  invite,
}: {
  token: string;
  user: { name: string; githubLogin: string };
  invite: {
    projectId: string;
    projectName: string;
    engine: string;
    ownerLogin: string;
    ownerName: string | null;
    role: string;
    expired: boolean;
    revoked: boolean;
  } | null;
}) {
  const router = useRouter();
  const [joining, setJoining] = React.useState(false);

  async function handleJoin() {
    setJoining(true);
    try {
      const res = await fetch(`/api/invites/${encodeURIComponent(token)}`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => null)) as {
        projectId?: string;
        error?: string;
      } | null;
      if (!res.ok || !data?.projectId) {
        toast.error(data?.error || "Could not join project");
        return;
      }
      toast.success(`Joined ${invite?.projectName || "project"} team`);
      router.push(`/projects/${data.projectId}`);
      router.refresh();
    } finally {
      setJoining(false);
    }
  }

  const invalid = !invite || invite.expired || invite.revoked;

  return (
    <div className="flex min-h-screen flex-1 items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center gap-3 text-center">
          <div className="flex items-center gap-2.5 text-foreground">
            <FactoryMark className="size-7" />
            <FactoryWordmark className="text-[24px]" />
          </div>
          <CardDescription>
            Project Team Invitation · signed in as{" "}
            <span className="font-medium text-foreground">@{user.githubLogin}</span>
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          {invalid ? (
            <div className="flex flex-col items-center gap-3 rounded-[4px] border border-destructive/40 bg-card p-5 text-center">
              <XCircleIcon className="size-8 text-destructive" />
              <span className="text-sm font-medium text-foreground">
                {!invite
                  ? "Invite link not found"
                  : invite.revoked
                    ? "Invite link revoked"
                    : "Invite link expired"}
              </span>
              <span className="text-xs text-muted-foreground">
                Ask the project owner to generate a new invite link from Project → Team.
              </span>
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link href="/sessions" />}
              >
                Go to Sessions
              </Button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 rounded-[4px] border bg-secondary/40 px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <FolderIcon className="size-4 text-primary" />
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-foreground">
                      {invite.projectName}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      Owner: @{invite.ownerLogin} · {invite.engine}
                    </span>
                  </div>
                </div>
                <Badge variant="secondary" className="capitalize">
                  <UsersIcon data-icon="inline-start" />
                  {invite.role}
                </Badge>
              </div>

              <p className="text-xs leading-relaxed text-muted-foreground">
                Joining gives you shared access to this project&apos;s live runs, traces, issues,
                code reviews, and any runners shared with the team (isolated via git worktrees).
              </p>

              <div className="flex items-center gap-2">
                <Button className="flex-1" disabled={joining} onClick={() => void handleJoin()}>
                  {joining ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <ShieldCheckIcon data-icon="inline-start" />
                  )}
                  Join Project Team
                </Button>
                <Button
                  variant="outline"
                  nativeButton={false}
                  render={<Link href="/sessions" />}
                >
                  Cancel
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
