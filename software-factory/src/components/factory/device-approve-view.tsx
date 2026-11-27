"use client";

import * as React from "react";
import Link from "next/link";
import {
  CheckCircle2Icon,
  LaptopIcon,
  ShieldCheckIcon,
  XCircleIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  FactoryMark,
  FactoryWordmark,
} from "@/components/factory/factory-primitives";

type DeviceInfo = {
  userCode: string;
  runnerName: string;
  hostname: string;
  os: string;
  status: string;
  expired: boolean;
} | null;

export function DeviceApproveView({
  initialCode,
  user,
  device,
}: {
  initialCode: string;
  user: { name: string; githubLogin: string };
  device: DeviceInfo;
}) {
  const [code, setCode] = React.useState(initialCode);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<"approved" | "denied" | null>(
    device?.status === "approved" || device?.status === "consumed"
      ? "approved"
      : device?.status === "denied"
        ? "denied"
        : null,
  );
  const [error, setError] = React.useState<string | null>(
    device?.expired ? "This verification code has expired. Re-run `sf setup`." : null,
  );

  async function submit(decision: "approve" | "deny") {
    const clean = code.trim().toUpperCase();
    if (!clean) {
      toast.error("Enter the code shown in your terminal");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/device/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userCode: clean, decision }),
      });
      const data = (await res.json().catch(() => null)) as {
        status?: string;
        runnerName?: string;
        error?: string;
      } | null;
      if (!res.ok) {
        const msg = data?.error || "Verification failed";
        setError(msg);
        toast.error(msg);
        return;
      }
      setResult(decision === "approve" ? "approved" : "denied");
      toast.success(
        decision === "approve"
          ? `Connected ${data?.runnerName || "machine"} to Factory`
          : "Device authorization denied",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-1 items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center gap-3 text-center">
          <div className="flex items-center gap-2.5 text-foreground">
            <FactoryMark className="size-7" />
            <FactoryWordmark className="text-[24px]" />
          </div>
          <CardDescription>
            Authorize a local <code className="font-mono">sf</code> runner machine to connect as{" "}
            <span className="font-medium text-foreground">@{user.githubLogin}</span>
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          {result === "approved" ? (
            <div className="flex flex-col items-center gap-3 rounded-[4px] border border-success/40 bg-card p-5 text-center">
              <CheckCircle2Icon className="size-8 text-success" />
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium text-foreground">Machine authorized</span>
                <span className="text-xs text-muted-foreground">
                  Your terminal received its machine token automatically. You can close this tab or
                  open Sessions now.
                </span>
              </div>
              <Button size="sm" nativeButton={false} render={<Link href="/sessions" />}>
                Open Sessions
              </Button>
            </div>
          ) : result === "denied" ? (
            <div className="flex flex-col items-center gap-3 rounded-[4px] border border-destructive/40 bg-card p-5 text-center">
              <XCircleIcon className="size-8 text-destructive" />
              <span className="text-sm font-medium text-foreground">Authorization denied</span>
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link href="/sessions" />}
              >
                Back to App
              </Button>
            </div>
          ) : (
            <>
              <Field>
                <FieldLabel htmlFor="device-code">Verification Code</FieldLabel>
                <Input
                  id="device-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="FCTY-XXXX"
                  className="text-center font-mono text-lg font-semibold tracking-[0.22em]"
                />
              </Field>

              {device && (
                <div className="flex items-center justify-between gap-2 rounded-[4px] border bg-secondary/40 px-3.5 py-2.5 text-xs">
                  <div className="flex items-center gap-2">
                    <LaptopIcon className="size-4 text-muted-foreground" />
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">{device.runnerName}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {device.hostname} ({device.os})
                      </span>
                    </div>
                  </div>
                  <Badge variant="secondary">CLI Runner</Badge>
                </div>
              )}

              {error && (
                <div className="rounded-[4px] border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <Button
                  className="flex-1"
                  disabled={busy || !code.trim() || Boolean(device?.expired)}
                  onClick={() => void submit("approve")}
                >
                  {busy ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <ShieldCheckIcon data-icon="inline-start" />
                  )}
                  Approve &amp; Connect
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || !code.trim()}
                  onClick={() => void submit("deny")}
                >
                  Deny
                </Button>
              </div>

              <p className="text-center text-xs text-muted-foreground">
                This mints a dedicated revocable API key for this machine only. You can revoke it
                anytime in Settings → API Keys.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
