"use client";

import * as React from "react";
import Link from "next/link";
import { CheckIcon, CopyIcon, KeyRoundIcon, LaptopIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatRelativeTime, StatusDot } from "@/components/factory/factory-primitives";
import type { SidebarData } from "@/lib/workspace-data";

type TokenRecord = {
  id: string;
  label: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
};

export function SettingsDialog({
  open,
  onOpenChange,
  runners,
  isLocalMode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runners: SidebarData["runners"];
  isLocalMode: boolean;
}) {
  const [tokens, setTokens] = React.useState<TokenRecord[] | null>(null);
  const [label, setLabel] = React.useState("Local CLI / Daemon");
  const [newToken, setNewToken] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [copied, setCopied] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/tokens")
      .then((res) => (res.ok ? (res.json() as Promise<{ tokens?: TokenRecord[] }>) : null))
      .then((data) => {
        if (!cancelled) setTokens(data?.tokens ?? []);
      })
      .catch(() => {
        if (!cancelled) setTokens([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const loading = open && tokens === null;
  const activeTokens = tokens ?? [];

  async function createToken(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: label.trim() }),
      });
      const data = (await res.json().catch(() => null)) as {
        token?: string;
        record?: TokenRecord;
        error?: string;
      } | null;
      if (!res.ok || !data?.token) {
        toast.error(data?.error || "Failed to generate token");
        return;
      }
      setNewToken(data.token);
      if (data.record) setTokens((prev) => [data.record!, ...(prev ?? [])]);
      toast.success("API key created");
    } finally {
      setCreating(false);
    }
  }

  async function revokeToken(id: string) {
    const res = await fetch(`/api/tokens/${id}`, { method: "DELETE" });
    if (res.ok) {
      setTokens((prev) => (prev ?? []).filter((t) => t.id !== id));
      toast.success("API key revoked");
    }
  }

  function copyText(key: string, text: string) {
    void navigator.clipboard.writeText(text);
    setCopied(key);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(null), 1600);
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:8787";
  const loginCmd = `sf login --url ${origin} --token ${newToken || "<SF_TOKEN>"}`;
  const daemonCmd = "sf daemon --projects-dir ~/factory-projects";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader className="border-b pb-4 pr-8">
          <div className="flex items-start gap-3">
            <span
              className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary"
              aria-hidden="true"
            >
              <KeyRoundIcon className="size-4.5" />
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <DialogTitle className="text-lg font-semibold tracking-tight">
                Quick Settings
              </DialogTitle>
              <DialogDescription className="text-xs leading-relaxed">
                Manage API keys, local runners, and GitHub authentication.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="max-h-[65vh] overflow-y-auto pr-0.5">
          <Tabs defaultValue="cli" className="flex flex-col gap-4">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="cli">
                <KeyRoundIcon aria-hidden="true" />
                API Keys
              </TabsTrigger>
              <TabsTrigger value="runners">
                <LaptopIcon aria-hidden="true" />
                Runners ({runners.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="cli" className="mt-0 flex flex-col gap-4">
            <form onSubmit={createToken} className="flex items-end gap-2">
              <FieldGroup className="flex-1">
                <Field>
                  <FieldLabel htmlFor="sf-token-label">Key label</FieldLabel>
                  <Input
                    id="sf-token-label"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="MacBook Pro Daemon"
                  />
                </Field>
              </FieldGroup>
              <Button type="submit" disabled={creating || !label.trim()}>
                {creating ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <PlusIcon data-icon="inline-start" />
                )}
                Generate
              </Button>
            </form>

            {newToken && (
              <div className="flex flex-col gap-1.5 rounded-md border border-primary/40 bg-primary/5 p-3">
                <span className="text-xs font-medium text-primary">
                  Copy now — shown once only
                </span>
                <div className="flex items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 font-mono text-xs">
                  <code className="flex-1 truncate">{newToken}</code>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Copy generated token"
                    onClick={() => copyText("tok", newToken)}
                  >
                    {copied === "tok" ? <CheckIcon className="text-success" /> : <CopyIcon />}
                  </Button>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2 rounded-lg border bg-card p-3">
              <span className="font-mono text-2xs uppercase tracking-wider text-muted-foreground">
                Quick CLI connect
              </span>
              <div className="flex items-center justify-between gap-2 rounded-md border bg-background px-2.5 py-1.5 font-mono text-xs">
                <code className="truncate">{loginCmd}</code>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Copy login command"
                  onClick={() => copyText("login", loginCmd)}
                >
                  {copied === "login" ? <CheckIcon className="text-success" /> : <CopyIcon />}
                </Button>
              </div>
              <div className="flex items-center justify-between gap-2 rounded-md border bg-background px-2.5 py-1.5 font-mono text-xs">
                <code className="truncate">{daemonCmd}</code>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Copy daemon command"
                  onClick={() => copyText("daemon", daemonCmd)}
                >
                  {copied === "daemon" ? <CheckIcon className="text-success" /> : <CopyIcon />}
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between font-mono text-2xs uppercase tracking-wider text-muted-foreground">
                <span>Active keys ({activeTokens.length})</span>
                {loading && <Spinner />}
              </div>
              {activeTokens.length === 0 && !loading ? (
                <div className="rounded-lg border border-dashed py-4 text-center text-xs text-muted-foreground">
                  No active API keys yet.
                </div>
              ) : activeTokens.length > 0 ? (
                <div className="divide-y rounded-lg border bg-card">
                  {activeTokens.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
                    >
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate font-medium text-foreground">{t.label}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {t.prefix}… · {t.lastUsedAt ? formatRelativeTime(t.lastUsedAt) : "unused"}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Revoke ${t.label}`}
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => void revokeToken(t.id)}
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </TabsContent>

          <TabsContent value="runners" className="flex flex-col gap-4 pt-3">
            {runners.length === 0 ? (
              <div className="rounded-lg border border-dashed py-6 text-center text-xs text-muted-foreground">
                No runners connected. Start <code className="font-mono text-foreground">sf daemon</code>.
              </div>
            ) : (
              <div className="divide-y rounded-lg border bg-card">
                {runners.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <StatusDot status={r.status} />
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate font-medium text-foreground">{r.name}</span>
                        <span className="truncate font-mono text-xs text-muted-foreground tabular-nums">
                          {r.os} · {r.activeRuns}/{r.maxConcurrency} slots
                        </span>
                      </div>
                    </div>
                    <Badge variant={r.status === "online" ? "secondary" : "outline"}>
                      {r.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 text-xs">
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-foreground">GitHub OAuth</span>
                <span className="text-muted-foreground">
                  {isLocalMode ? "Local mode active" : "Connected with GitHub"}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<a href="/auth/github/login" />}
              >
                {isLocalMode ? "Connect" : "Reconnect"}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link href="/settings" />}
            onClick={() => onOpenChange(false)}
          >
            All Settings
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
