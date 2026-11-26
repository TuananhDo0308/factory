"use client";

import * as React from "react";
import { BookOpenIcon, CheckIcon, PlusIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
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

type LessonItem = {
  id: string;
  patternKey: string;
  title: string;
  occurrences: number;
  target: string;
  proposal: string;
  status: string;
  projectName: string | null;
  updatedAt: string;
};

export function LessonsWorkspace({ initialLessons }: { initialLessons: LessonItem[] }) {
  const [lessons, setLessons] = React.useState(initialLessons);
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [proposal, setProposal] = React.useState("");
  const [target, setTarget] = React.useState("role_brief");
  const [saving, setSaving] = React.useState(false);

  async function reload() {
    const res = await fetch("/api/lessons", { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as {
        lessons?: Array<
          Omit<LessonItem, "projectName"> & { project?: { name: string } | null }
        >;
      };
      if (data.lessons) {
        setLessons(
          data.lessons.map((l) => ({
            ...l,
            projectName: l.project?.name ?? null,
          })),
        );
      }
    }
  }

  async function updateStatus(id: string, status: "accepted" | "rejected" | "done") {
    const res = await fetch(`/api/lessons/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      toast.success(`Lesson marked ${status}`);
      await reload();
    }
  }

  async function createLesson(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !proposal.trim()) {
      toast.error("Title and proposed rule are required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/lessons", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, proposal, target }),
      });
      if (res.ok) {
        setTitle("");
        setProposal("");
        setOpen(false);
        toast.success("Lesson proposed");
        await reload();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-medium tracking-tight">Lessons &amp; Self-Improvement</h1>
          <p className="text-sm text-muted-foreground">
            Recurring mistakes across runs surface here as reviewable workflow or brief proposals.
          </p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          <PlusIcon data-icon="inline-start" />
          Propose Lesson
        </Button>
      </div>

      {lessons.length === 0 ? (
        <Empty className="border py-14">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BookOpenIcon />
            </EmptyMedia>
            <EmptyTitle>No lessons recorded yet</EmptyTitle>
            <EmptyDescription>
              When a failure recurs in 3+ of the last 10 runs, it becomes a proposal here for your
              human approval.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {lessons.map((l) => (
            <Card key={l.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-sm">{l.title}</CardTitle>
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline">{l.occurrences}x</Badge>
                    <Badge
                      variant={
                        l.status === "accepted" || l.status === "done"
                          ? "default"
                          : l.status === "rejected"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {l.status}
                    </Badge>
                  </div>
                </div>
                <CardDescription className="font-mono text-xs">
                  target: {l.target} · {l.projectName || "Global"}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                <p className="text-muted-foreground">{l.proposal}</p>
                {l.status === "proposed" && (
                  <div className="flex items-center gap-2">
                    <Button size="xs" onClick={() => void updateStatus(l.id, "accepted")}>
                      <CheckIcon data-icon="inline-start" />
                      Accept
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => void updateStatus(l.id, "rejected")}
                    >
                      <XIcon data-icon="inline-start" />
                      Reject
                    </Button>
                  </div>
                )}
                {l.status === "accepted" && (
                  <Button
                    size="xs"
                    variant="outline"
                    className="w-fit"
                    onClick={() => void updateStatus(l.id, "done")}
                  >
                    Mark Applied in Repo
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader className="border-b pb-4 pr-8">
            <div className="flex items-start gap-3">
              <span
                className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary"
                aria-hidden="true"
              >
                <BookOpenIcon className="size-4.5" />
              </span>
              <div className="flex min-w-0 flex-col gap-1">
                <DialogTitle className="text-base font-semibold tracking-tight">
                  Propose Factory Lesson
                </DialogTitle>
                <DialogDescription className="text-xs leading-relaxed">
                  Record a recurring failure pattern and the guardrail rule to prevent it.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <form
            id="sf-lesson-form"
            onSubmit={createLesson}
            className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto pr-0.5"
          >
            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel htmlFor="ls-title">Failure pattern title</FieldLabel>
                <Input
                  id="ls-title"
                  autoFocus
                  required
                  placeholder="Implementer edits protected config files"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="ls-target">Where should the rule live?</FieldLabel>
                <Select value={target} onValueChange={(v) => v && setTarget(v)}>
                  <SelectTrigger id="ls-target" className="w-full">
                    <SelectValue>
                      {target === "workflow_code"
                        ? "Workflow code (factory.py/js)"
                        : target === "role_brief"
                          ? "Role brief (roles/*.md)"
                          : "Project CODING_STANDARDS.md"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="workflow_code">Workflow code (factory.py/js)</SelectItem>
                      <SelectItem value="role_brief">Role brief (roles/*.md)</SelectItem>
                      <SelectItem value="project_rule">Project CODING_STANDARDS.md</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="ls-proposal">Proposed rule</FieldLabel>
                <Textarea
                  id="ls-proposal"
                  rows={3}
                  required
                  placeholder="Reject any spec whose file list intersects protectedPaths before Build."
                  value={proposal}
                  onChange={(e) => setProposal(e.target.value)}
                />
              </Field>
            </FieldGroup>
          </form>

          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="sf-lesson-form" size="sm" disabled={saving || !title.trim()}>
              {saving && <Spinner data-icon="inline-start" />}
              Save Proposal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
