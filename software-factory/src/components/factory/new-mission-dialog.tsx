"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { SidebarData } from "@/lib/workspace-data";

export function NewMissionDialog({
  open,
  onOpenChange,
  projects,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: SidebarData["projects"];
  onCreated?: () => void;
}) {
  const router = useRouter();
  const [projectId, setProjectId] = React.useState(projects[0]?.id ?? "");
  const [title, setTitle] = React.useState("");
  const [goal, setGoal] = React.useState("");
  const [contract, setContract] = React.useState("");
  const [autonomy, setAutonomy] = React.useState("medium");
  const [submitting, setSubmitting] = React.useState(false);

  const effectiveProjectId = projectId || projects[0]?.id || "";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!effectiveProjectId || !title.trim()) {
      toast.error("Select a project and enter a mission title.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/missions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: effectiveProjectId,
          title,
          goal,
          validationContractMd: contract,
          autonomy,
        }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        toast.error(data?.error || "Failed to create mission");
        return;
      }
      toast.success(`Mission "${title.trim()}" created`);
      setTitle("");
      setGoal("");
      setContract("");
      onOpenChange(false);
      onCreated?.();
      router.push(`/projects/${projectId}?tab=missions`);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="border-b pb-4 pr-8">
          <DialogTitle className="text-base font-semibold tracking-tight">New Mission</DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            Group multi-PR issues under a shared goal and validation contract.
          </DialogDescription>
        </DialogHeader>

        <form
          id="sf-mission-form"
          onSubmit={handleSubmit}
          className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto pr-0.5"
        >
          <FieldGroup className="gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="sf-mission-project">Project</FieldLabel>
                <Select value={effectiveProjectId} onValueChange={(v) => v && setProjectId(v)}>
                  <SelectTrigger id="sf-mission-project" className="w-full">
                    <SelectValue placeholder="Choose project">
                      {projects.find((p) => p.id === effectiveProjectId)?.name || "Choose project"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {projects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="sf-mission-autonomy">Autonomy</FieldLabel>
                <Select value={autonomy} onValueChange={(v) => v && setAutonomy(v)}>
                  <SelectTrigger id="sf-mission-autonomy" className="w-full">
                    <SelectValue>
                      {autonomy === "off"
                        ? "Off (ask always)"
                        : autonomy === "low"
                          ? "Low"
                          : autonomy === "high"
                            ? "High (auto-run)"
                            : "Medium"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="off">Off (ask always)</SelectItem>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High (auto-run)</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="sf-mission-title">Mission title</FieldLabel>
              <Input
                id="sf-mission-title"
                autoFocus
                required
                placeholder="Checkout & Subscription Billing"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="sf-mission-goal">Goal &amp; scope</FieldLabel>
              <Textarea
                id="sf-mission-goal"
                rows={2}
                placeholder="What end-to-end user capability should ship across the mission's issues?"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="sf-mission-contract">Validation contract (optional)</FieldLabel>
              <Textarea
                id="sf-mission-contract"
                rows={3}
                placeholder="### VAL-001: User completes checkout and sees receipt..."
                value={contract}
                onChange={(e) => setContract(e.target.value)}
                className="font-mono text-xs"
              />
              <FieldDescription>
                Behavioral assertions written before implementation begins.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="sf-mission-form"
            size="sm"
            disabled={submitting || !effectiveProjectId || !title.trim()}
          >
            {submitting && <Spinner data-icon="inline-start" />}
            Create Mission
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
