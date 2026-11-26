"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangleIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  Columns3Icon,
  CpuIcon,
  FolderIcon,
  GitBranchIcon,
  LaptopIcon,
  PaperclipIcon,
  PlusIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { FactoryMark, StatusDot } from "@/components/factory/factory-primitives";
import {
  AttachmentPreviewStrip,
  prepareFilesForAttachment,
  toAttachmentPayload,
  type PendingAttachment,
} from "@/components/factory/chat-attachments";
import { NewProjectDialog } from "@/components/factory/new-project-dialog";
import { ATTACHMENT_ACCEPT_ATTR } from "@/lib/attachments";
import {
  buildModelFamilies,
  defaultModelForEngine,
  findModelChoice,
} from "@/lib/models";
import {
  applySkillPrefixToPrompt,
  detectSkillFromPrompt,
  findSkillByIdOrMode,
  getSlashSuggestions,
  SESSION_SKILLS,
  type SessionSkillOption,
} from "@/lib/skills";
import type { SidebarData } from "@/lib/workspace-data";

export function SessionLauncher({
  projects,
  runners,
  initialProjectId,
  initialRunnerId,
  initialSkill,
  initialPrompt,
}: {
  projects: SidebarData["projects"];
  runners: SidebarData["runners"];
  initialProjectId?: string;
  initialRunnerId?: string;
  initialSkill?: string;
  initialPrompt?: string;
}) {
  const router = useRouter();
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

  const resolvedInitialSkill =
    findSkillByIdOrMode(initialSkill) ??
    SESSION_SKILLS.find((s) => s.id === "normal")!;
  const resolvedInitialProject =
    projects.find((p) => p.id === initialProjectId || p.slug === initialProjectId) ??
    projects[0] ??
    null;

  const [skillId, setSkillId] = React.useState<string>(resolvedInitialSkill.id);
  const [prompt, setPrompt] = React.useState<string>(() => {
    if (initialSkill && resolvedInitialSkill.slash) {
      return applySkillPrefixToPrompt(initialPrompt || "", resolvedInitialSkill);
    }
    return initialPrompt || "";
  });
  const [slashDismissed, setSlashDismissed] = React.useState(false);
  const [slashIndex, setSlashIndex] = React.useState(0);

  const baseProjectId = resolvedInitialProject?.id ?? "";
  const [projectOverride, setProjectOverride] = React.useState<{
    base: string;
    value: string;
  } | null>(null);
  const projectId =
    projectOverride?.base === baseProjectId ? projectOverride.value : baseProjectId;
  const selectedProject = projects.find((p) => p.id === projectId) ?? projects[0] ?? null;

  const initialEngine = selectedProject?.engine === "claude" ? "claude" : "antigravity";
  const [engineOverride, setEngineOverride] = React.useState<{
    projectId: string;
    value: "antigravity" | "claude";
  } | null>(null);
  const engine: "antigravity" | "claude" =
    engineOverride?.projectId === (selectedProject?.id ?? "")
      ? engineOverride.value
      : initialEngine;

  const [modelOverride, setModelOverride] = React.useState<{
    projectId: string;
    value: string;
  } | null>(null);
  const model =
    modelOverride?.projectId === (selectedProject?.id ?? "")
      ? modelOverride.value
      : defaultModelForEngine(engine);

  const [branchOverride, setBranchOverride] = React.useState<{
    projectId: string;
    value: string;
  } | null>(null);
  const branch =
    branchOverride?.projectId === (selectedProject?.id ?? "")
      ? branchOverride.value
      : selectedProject?.defaultBranch || "main";

  const setEngine = React.useCallback(
    (next: "antigravity" | "claude") => {
      setEngineOverride({ projectId: selectedProject?.id ?? "", value: next });
    },
    [selectedProject?.id],
  );
  const setModel = React.useCallback(
    (next: string) => {
      setModelOverride({ projectId: selectedProject?.id ?? "", value: next });
    },
    [selectedProject?.id],
  );

  const [useWorktree, setUseWorktree] = React.useState(resolvedInitialSkill.defaultWorktree);
  const [submitting, setSubmitting] = React.useState(false);
  const [addProjectOpen, setAddProjectOpen] = React.useState(false);
  const [noticeDismissed, setNoticeDismissed] = React.useState(false);
  const [daemonWarningHighlight, setDaemonWarningHighlight] = React.useState(false);

  const activeSkill =
    SESSION_SKILLS.find((s) => s.id === skillId) ?? SESSION_SKILLS[SESSION_SKILLS.length - 1];

  // Auto-focus prompt when jumped here from a project's "New Chat" button or skill shortcut
  React.useEffect(() => {
    if (!initialSkill && !initialProjectId) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    const pos = el.value.length;
    el.setSelectionRange(pos, pos);
  }, [initialSkill, initialProjectId]);

  const slashSuggestions = React.useMemo(
    () => (slashDismissed ? [] : getSlashSuggestions(prompt)),
    [prompt, slashDismissed],
  );
  const effectiveSlashIndex =
    slashSuggestions.length > 0 ? Math.min(slashIndex, slashSuggestions.length - 1) : 0;

  function focusPromptEnd(nextText: string) {
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(nextText.length, nextText.length);
    });
  }

  function handleSelectSkill(nextSkill: SessionSkillOption) {
    setSkillId(nextSkill.id);
    setUseWorktree(nextSkill.defaultWorktree);
    setSlashDismissed(true);
    setSlashIndex(0);
    const nextPrompt = applySkillPrefixToPrompt(prompt, nextSkill);
    setPrompt(nextPrompt);
    focusPromptEnd(nextPrompt);
  }

  function handlePromptChange(nextValue: string) {
    setPrompt(nextValue);
    setSlashDismissed(false);
    setSlashIndex(0);

    const detected = detectSkillFromPrompt(nextValue);
    if (detected) {
      if (detected.skill.id !== skillId) {
        setSkillId(detected.skill.id);
        setUseWorktree(detected.skill.defaultWorktree);
      }
    } else if (!nextValue.trimStart().startsWith("/") && skillId !== "normal") {
      setSkillId("normal");
    }
  }

  function handleSelectProject(nextProject: SidebarData["projects"][number]) {
    setProjectOverride({ base: baseProjectId, value: nextProject.id });
    const nextEngine = nextProject.engine === "claude" ? "claude" : "antigravity";
    setEngineOverride({ projectId: nextProject.id, value: nextEngine });
    setBranchOverride({ projectId: nextProject.id, value: nextProject.defaultBranch || "main" });
    setModelOverride({ projectId: nextProject.id, value: defaultModelForEngine(nextEngine) });
    // Clear manual runner override so the newly selected project uses its own default daemon
    setRunnerOverride(null);
  }

  const onlineRunners = React.useMemo(
    () => runners.filter((r) => r.status === "online"),
    [runners],
  );
  const [runnerOverride, setRunnerOverride] = React.useState<{
    projectId: string;
    runnerId: string;
  } | null>(null);
  const preferredRunnerId =
    runnerOverride?.projectId === (selectedProject?.id ?? "")
      ? runnerOverride.runnerId
      : initialRunnerId && selectedProject?.id === baseProjectId
        ? initialRunnerId
        : selectedProject?.defaultRunnerId || "";
  const onlineRunner =
    (preferredRunnerId ? onlineRunners.find((r) => r.id === preferredRunnerId) : null) ??
    onlineRunners.find((r) => r.isOwn) ??
    onlineRunners[0] ??
    null;
  const selectedOfflineDefaultRunner =
    !onlineRunner || (preferredRunnerId && onlineRunner.id !== preferredRunnerId)
      ? runners.find((r) => r.id === preferredRunnerId && r.status !== "online") ?? null
      : null;
  const usingSharedRunner = Boolean(onlineRunner && !onlineRunner.isOwn);
  const supportedEngines = React.useMemo(() => {
    const raw = onlineRunner?.engines || [];
    const filtered = raw.filter(
      (e): e is "antigravity" | "claude" => e === "antigravity" || e === "claude",
    );
    return filtered.length > 0 ? filtered : (["antigravity", "claude"] as const);
  }, [onlineRunner]);
  const effectiveEngine: "antigravity" | "claude" = supportedEngines.includes(engine)
    ? engine
    : supportedEngines[0];
  const modelFamilies = React.useMemo(
    () => buildModelFamilies(effectiveEngine, onlineRunner?.models),
    [effectiveEngine, onlineRunner],
  );
  const activeSelection = (() => {
    for (const fam of modelFamilies) {
      const eff = fam.efforts.find((e) => e.value === model);
      if (eff) {
        return {
          value: eff.value,
          label: fam.label,
          effort: eff.label,
        };
      }
    }
    const fallbackFam = modelFamilies[0];
    if (fallbackFam) {
      const fallbackEff =
        fallbackFam.efforts.find((e) => e.value === fallbackFam.defaultValue) ??
        fallbackFam.efforts[0];
      if (fallbackEff) {
        return {
          value: fallbackEff.value,
          label: fallbackFam.label,
          effort: fallbackEff.label,
        };
      }
    }
    const fallback = findModelChoice(effectiveEngine, model);
    return {
      value: fallback.value,
      label: fallback.label,
      effort: fallback.effort,
    };
  })();

  const [attachments, setAttachments] = React.useState<PendingAttachment[]>([]);
  const [dragOver, setDragOver] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  async function handleAddFiles(files: FileList | File[]) {
    const { added, errors } = await prepareFilesForAttachment(files, attachments);
    for (const err of errors) toast.error(err);
    if (added.length > 0) {
      setAttachments((prev) => [...prev, ...added]);
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.files;
    if (items && items.length > 0) {
      e.preventDefault();
      void handleAddFiles(items);
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      void handleAddFiles(e.dataTransfer.files);
    }
  }

  async function launchSession() {
    const trimmed = prompt.trim();
    if (!trimmed && attachments.length === 0) {
      toast.error("Describe a task, attach a file/image, or type / to pick a skill first.");
      return;
    }

    const detected = trimmed ? detectSkillFromPrompt(trimmed) : null;
    const effectiveSkill = detected?.skill ?? activeSkill;
    if (detected && !detected.body && effectiveSkill.id !== "factory-init" && attachments.length === 0) {
      toast.error(`Describe what you want ${effectiveSkill.slash} to do after the command.`);
      focusPromptEnd(prompt.endsWith(" ") ? prompt : `${prompt} `);
      return;
    }

    if (!onlineRunner) {
      setNoticeDismissed(false);
      setDaemonWarningHighlight(true);
      toast.error("No local daemon connected — start `sf daemon` on your machine first.", {
        action: {
          label: "Connect",
          onClick: () => router.push("/settings?tab=runners"),
        },
      });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: trimmed,
          attachments: attachments.length > 0 ? toAttachmentPayload(attachments) : undefined,
          projectId: selectedProject?.id,
          runnerId: onlineRunner?.id,
          mode: effectiveSkill.mode,
          skill: effectiveSkill.id,
          autonomy: "medium",
          engine: effectiveEngine,
          model: activeSelection.value,
          branch,
          useWorktree:
            effectiveSkill.mode === "ba"
              ? false
              : usingSharedRunner
                ? true
                : useWorktree,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        run?: { id: string; runKey: string };
        dispatchedToRunner?: string | null;
        code?: string;
        error?: string;
      } | null;
      if (!res.ok || !data?.run) {
        if (data?.code === "NO_RUNNER_ONLINE" || res.status === 503) {
          setNoticeDismissed(false);
          setDaemonWarningHighlight(true);
          toast.error(data?.error || "No local daemon connected — start `sf daemon` locally first.", {
            action: {
              label: "Connect",
              onClick: () => router.push("/settings?tab=runners"),
            },
          });
        } else {
          toast.error(data?.error || "Could not start session");
        }
        return;
      }
      toast.success(
        data.dispatchedToRunner
          ? `Dispatched (${activeSelection.label}) to ${data.dispatchedToRunner}`
          : "Session created — live tracking ready",
      );
      router.push(`/sessions/${data.run.id}`);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;

    if (slashSuggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((i) => (i + 1) % slashSuggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((i) => (i - 1 + slashSuggestions.length) % slashSuggestions.length);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey)) {
        e.preventDefault();
        const chosen = slashSuggestions[effectiveSlashIndex];
        if (chosen) handleSelectSkill(chosen);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashDismissed(true);
        return;
      }
    }

    if (e.key === "Enter") {
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        const el = e.currentTarget;
        const start = el.selectionStart ?? prompt.length;
        const end = el.selectionEnd ?? prompt.length;
        const next = `${prompt.slice(0, start)}\n${prompt.slice(end)}`;
        handlePromptChange(next);
        requestAnimationFrame(() => {
          el.setSelectionRange(start + 1, start + 1);
        });
        return;
      }
      if (e.shiftKey || e.altKey) {
        return;
      }
      e.preventDefault();
      if ((prompt.trim() || attachments.length > 0) && !submitting) {
        void launchSession();
      }
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">
      <div className="flex w-full max-w-[700px] flex-col items-center gap-4">
        {/* Minimal centered brand mark + concise heading */}
        <div className="mb-1 flex flex-col items-center gap-3">
          <FactoryMark className="size-11 text-muted-foreground/45" />
          <h1 className="text-xl font-medium tracking-tight text-foreground">
            What are we building?
          </h1>
        </div>

        {/* Runner Status Callout Card */}
        {!onlineRunner && !noticeDismissed && (
          <div
            className={`flex w-full items-center justify-between gap-3 rounded-lg border px-4 py-3 transition-colors ${
              daemonWarningHighlight
                ? "border-warning/60 bg-warning/10"
                : "border-warning/30 bg-card"
            }`}
          >
            <div className="flex min-w-0 items-center gap-2.5 text-xs">
              <LaptopIcon
                className={`size-4 shrink-0 ${
                  daemonWarningHighlight ? "text-warning" : "text-muted-foreground"
                }`}
              />
              <span className="truncate text-muted-foreground">
                No local daemon connected — start{" "}
                <code className="font-mono text-foreground">sf daemon</code> to execute locally.
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                size="xs"
                nativeButton={false}
                render={<Link href="/settings?tab=runners" />}
              >
                Connect
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                title="Dismiss"
                onClick={() => {
                  setNoticeDismissed(true);
                  setDaemonWarningHighlight(false);
                }}
              >
                <XIcon />
              </Button>
            </div>
          </div>
        )}

        {/* BA Board Sync Context Strip when `/ba-ticket` is selected */}
        {activeSkill.mode === "ba" && selectedProject && (
          <div className="flex w-full items-center justify-between gap-3 rounded-lg border bg-card px-3.5 py-2 text-xs">
            <div className="flex min-w-0 items-center gap-2">
              <SparklesIcon className="size-3.5 shrink-0 text-primary" />
              <span className="truncate text-muted-foreground">
                Drafted tickets sync to{" "}
                <strong className="font-medium text-foreground">{selectedProject.name}</strong>{" "}
                Kanban.
              </span>
            </div>
            <Button
              size="xs"
              variant="ghost"
              nativeButton={false}
              render={<Link href={`/projects/${selectedProject.id}?tab=issues`} />}
            >
              <Columns3Icon data-icon="inline-start" />
              Board
            </Button>
          </div>
        )}

        {/* Composer + Slash Command Autocomplete wrapper */}
        <div className="relative w-full">
          {slashSuggestions.length > 0 && (
            <div
              role="listbox"
              aria-label="Slash skills"
              className="absolute right-0 bottom-full left-0 z-30 mb-1.5 overflow-hidden rounded-[4px] border bg-popover shadow-md"
            >
              <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                <span>Skills · Type /skill to auto-select</span>
                <span>↑↓ · Tab / Enter</span>
              </div>
              <div className="flex max-h-64 flex-col overflow-y-auto p-1">
                {slashSuggestions.map((item, idx) => {
                  const highlighted = idx === effectiveSlashIndex;
                  const active = item.id === activeSkill.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      aria-selected={highlighted}
                      onMouseEnter={() => setSlashIndex(idx)}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSelectSkill(item);
                      }}
                      className={`flex w-full items-center justify-between gap-3 rounded-[3px] px-2.5 py-2 text-left text-xs transition-colors ${
                        highlighted ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                      }`}
                    >
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-semibold text-primary">
                            {item.slash}
                          </span>
                          <span className="font-medium text-foreground">{item.label}</span>
                        </div>
                        <span className="truncate text-[11px] text-muted-foreground">
                          {item.description}
                        </span>
                      </div>
                      {active && <CheckIcon className="size-3.5 shrink-0 text-primary" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Clean bordered composer card (supports file picker, Cmd+V image paste, and drag-and-drop) */}
          <InputGroup
            onDragOver={(e) => {
              e.preventDefault();
              if (!dragOver) setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`rounded-lg bg-card shadow-xs transition-colors ${
              dragOver ? "border-primary ring-2 ring-primary/30" : ""
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ATTACHMENT_ACCEPT_ATTR}
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  void handleAddFiles(e.target.files);
                }
                e.target.value = "";
              }}
            />

            {attachments.length > 0 && (
              <div className="w-full px-3 pt-2.5">
                <AttachmentPreviewStrip
                  attachments={attachments}
                  onRemove={(id) => setAttachments((prev) => prev.filter((a) => a.id !== id))}
                />
              </div>
            )}

            <InputGroupTextarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => handlePromptChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              rows={3}
              placeholder={
                activeSkill.mode === "ba"
                  ? "/ba-ticket Describe a feature to break into tickets (or paste/drop images & specs)..."
                  : "Describe a task, type / for skills, or paste/drop images & files..."
              }
              className="min-h-24 px-4 pt-3.5 text-sm"
            />

            <InputGroupAddon align="block-end" className="flex-wrap justify-between gap-2 px-3 pb-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <InputGroupButton
                  variant="ghost"
                  size="icon-sm"
                  title="Attach images (PNG, JPG, WEBP, GIF, AVIF, BMP, SVG) or files (PDF, MD, JSON, CSV, code)"
                  aria-label="Attach images or files"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <PaperclipIcon />
                </InputGroupButton>

                <InputGroupButton
                  variant="ghost"
                  size="icon-sm"
                  title="Add project"
                  onClick={() => setAddProjectOpen(true)}
                >
                  <PlusIcon />
                </InputGroupButton>

                {/* Skill / Slash Command selector — syncs 2-way with `/skill` in prompt */}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button type="button" variant="ghost" size="sm">
                        <SparklesIcon data-icon="inline-start" />
                        <span>{activeSkill.label}</span>
                        {activeSkill.slash && (
                          <span className="font-mono text-[11px] text-primary">
                            {activeSkill.slash}
                          </span>
                        )}
                        <ChevronDownIcon data-icon="inline-end" />
                      </Button>
                    }
                  />
                  <DropdownMenuContent align="start" className="w-80">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>Skill / Execution Mode</DropdownMenuLabel>
                      {SESSION_SKILLS.map((s) => (
                        <DropdownMenuItem
                          key={s.id}
                          onClick={() => handleSelectSkill(s)}
                          className="justify-between gap-2"
                        >
                          <div className="flex min-w-0 flex-col gap-0.5">
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium">{s.label}</span>
                              {s.slash && (
                                <span className="font-mono text-[11px] text-primary">
                                  {s.slash}
                                </span>
                              )}
                            </div>
                            <span className="truncate text-[11px] text-muted-foreground">
                              {s.description}
                            </span>
                          </div>
                          {activeSkill.id === s.id && <CheckIcon className="size-3.5 shrink-0" />}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="flex items-center gap-1.5">
                {/* Gemini-style 2-level Model -> Thinking effort selector */}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button type="button" variant="ghost" size="sm" className="gap-1.5">
                        <span className="font-medium text-foreground">{activeSelection.label}</span>
                        {activeSelection.effort && (
                          <span className="text-muted-foreground">{activeSelection.effort}</span>
                        )}
                        <ChevronDownIcon data-icon="inline-end" className="text-muted-foreground" />
                      </Button>
                    }
                  />
                  <DropdownMenuContent align="end" className="w-80">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>Model</DropdownMenuLabel>
                      {modelFamilies.map((family) => {
                        const activeEffort = family.efforts.find(
                          (e) => e.value === activeSelection.value,
                        );
                        const defaultEffort =
                          family.efforts.find((e) => e.value === family.defaultValue) ??
                          family.efforts[0];

                        if (family.efforts.length === 1) {
                          const only = family.efforts[0];
                          const isSelected = activeSelection.value === only.value;
                          return (
                            <DropdownMenuItem
                              key={family.id}
                              onClick={() => setModel(only.value)}
                              className="justify-between gap-2 py-1.5"
                            >
                              <div className="flex min-w-0 items-center gap-1.5">
                                <span className="truncate font-medium text-foreground">
                                  {family.label}
                                </span>
                                {family.badge && (
                                  <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                    {family.badge}
                                  </span>
                                )}
                              </div>
                              {isSelected && <CheckIcon className="size-3.5 shrink-0" />}
                            </DropdownMenuItem>
                          );
                        }

                        const shownEffortLabel = activeEffort?.label || defaultEffort?.label || "";
                        return (
                          <DropdownMenuSub key={family.id}>
                            <DropdownMenuSubTrigger
                              className={`justify-between gap-2 py-1.5 ${
                                activeEffort ? "bg-accent/50" : ""
                              }`}
                            >
                              <div className="flex min-w-0 items-center gap-1.5">
                                <span className="truncate font-medium text-foreground">
                                  {family.label}
                                </span>
                                {shownEffortLabel && (
                                  <span className="shrink-0 text-xs text-muted-foreground">
                                    {shownEffortLabel}
                                  </span>
                                )}
                                {family.badge && (
                                  <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                    {family.badge}
                                  </span>
                                )}
                              </div>
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent className="w-44" sideOffset={6}>
                              <DropdownMenuGroup>
                                <DropdownMenuLabel>
                                  {family.submenuLabel || "Thinking effort"}
                                </DropdownMenuLabel>
                                {family.efforts.map((eff) => {
                                  const isSelected = activeSelection.value === eff.value;
                                  return (
                                    <DropdownMenuItem
                                      key={eff.value}
                                      onClick={() => setModel(eff.value)}
                                      className="justify-between gap-2 py-1.5"
                                    >
                                      <span
                                        className={
                                          isSelected ? "font-medium text-foreground" : undefined
                                        }
                                      >
                                        {eff.label}
                                      </span>
                                      {isSelected && <CheckIcon className="size-3.5 shrink-0" />}
                                    </DropdownMenuItem>
                                  );
                                })}
                              </DropdownMenuGroup>
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                        );
                      })}
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* Sharp square Send button */}
                <Button
                  type="button"
                  variant={
                    onlineRunner && (prompt.trim() || attachments.length > 0)
                      ? "default"
                      : "secondary"
                  }
                  size="icon-sm"
                  disabled={submitting || (!prompt.trim() && attachments.length === 0)}
                  onClick={() => void launchSession()}
                  title={
                    !onlineRunner
                      ? "Connect sf daemon before sending"
                      : "Send (Enter · Shift/⌘/Ctrl+Enter for new line)"
                  }
                >
                  {submitting ? <Spinner /> : <ArrowUpIcon />}
                </Button>
              </div>
            </InputGroupAddon>
          </InputGroup>
        </div>

        {/* Single-row target context bar */}
        <div className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-1 text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center gap-1.5">
            {runners.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      title={
                        selectedOfflineDefaultRunner
                          ? `Project default daemon "${selectedOfflineDefaultRunner.name}" is offline — falling back to "${onlineRunner?.name ?? "offline"}"`
                          : onlineRunner
                            ? `Daemon: ${onlineRunner.name}`
                            : "All daemons offline"
                      }
                    >
                      <StatusDot status={onlineRunner ? "online" : "offline"} />
                      <span className="max-w-[180px] truncate font-mono">
                        {onlineRunner ? onlineRunner.name : "Daemon offline"}
                      </span>
                      {onlineRunner &&
                        selectedProject?.defaultRunnerId === onlineRunner.id && (
                          <Badge variant="outline" className="h-4 px-1 text-[10px]">
                            default
                          </Badge>
                        )}
                      {usingSharedRunner && (
                        <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                          shared
                        </Badge>
                      )}
                      <ChevronDownIcon data-icon="inline-end" />
                    </Button>
                  }
                />
                <DropdownMenuContent align="start" className="w-68">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Daemon / Runner</DropdownMenuLabel>
                    {runners.map((r) => {
                      const isProjectDefault = selectedProject?.defaultRunnerId === r.id;
                      const isOnline = r.status === "online";
                      const isSelected = onlineRunner?.id === r.id;
                      return (
                        <DropdownMenuItem
                          key={r.id}
                          disabled={!isOnline}
                          onClick={() =>
                            setRunnerOverride({
                              projectId: selectedProject?.id ?? "",
                              runnerId: r.id,
                            })
                          }
                          className="justify-between gap-2"
                        >
                          <div className="flex min-w-0 items-center gap-1.5">
                            <StatusDot status={r.status} />
                            <span className="truncate font-mono text-xs">{r.name}</span>
                            {isProjectDefault && (
                              <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                                default
                              </Badge>
                            )}
                            {!r.isOwn && (
                              <Badge variant="outline" className="h-4 px-1 text-[10px]">
                                @{r.ownerLogin}
                              </Badge>
                            )}
                          </div>
                          {isSelected && <CheckIcon className="size-3.5 shrink-0" />}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Link
                href="/settings?tab=runners"
                className="flex items-center gap-1.5 px-1.5 hover:text-foreground"
              >
                <AlertTriangleIcon className="size-3.5 text-warning" />
                <span>Offline</span>
              </Link>
            )}

            {projects.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button type="button" variant="ghost" size="xs">
                      <FolderIcon data-icon="inline-start" />
                      <span>{selectedProject?.name || "Project"}</span>
                      <ChevronDownIcon data-icon="inline-end" />
                    </Button>
                  }
                />
                <DropdownMenuContent align="start">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Project</DropdownMenuLabel>
                    {projects.map((p) => (
                      <DropdownMenuItem
                        key={p.id}
                        onClick={() => handleSelectProject(p)}
                        className="justify-between gap-2"
                      >
                        <span className="flex items-center gap-1.5">
                          <span>{p.name}</span>
                          {!p.isOwner && (
                            <Badge variant="outline" className="h-4 px-1 text-[10px]">
                              @{p.ownerLogin}
                            </Badge>
                          )}
                        </span>
                        {selectedProject?.id === p.id && <CheckIcon className="size-3.5" />}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => setAddProjectOpen(true)}
              >
                <FolderIcon data-icon="inline-start" />
                Add project
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {supportedEngines.length > 1 ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button type="button" variant="ghost" size="xs">
                      <CpuIcon data-icon="inline-start" />
                      <span>{effectiveEngine === "claude" ? "Claude" : "Antigravity"}</span>
                      <ChevronDownIcon data-icon="inline-end" />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end">
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      onClick={() => {
                        setEngine("antigravity");
                        setModel(defaultModelForEngine("antigravity"));
                      }}
                    >
                      <span className="flex-1">Antigravity (agy)</span>
                      {effectiveEngine === "antigravity" && <CheckIcon className="size-3.5" />}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        setEngine("claude");
                        setModel(defaultModelForEngine("claude"));
                      }}
                    >
                      <span className="flex-1">Claude Code (claude)</span>
                      {effectiveEngine === "claude" && <CheckIcon className="size-3.5" />}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <span
                className="inline-flex items-center gap-1 px-1 text-xs text-muted-foreground"
                title="Only one CLI engine is installed on this runner"
              >
                <CpuIcon className="size-3.5" />
                <span>{supportedEngines[0] === "claude" ? "Claude" : "Antigravity"}</span>
              </span>
            )}

            <span className="inline-flex items-center gap-1 font-mono">
              <GitBranchIcon className="size-3.5" />
              {branch}
            </span>

            <label
              className="flex cursor-pointer items-center gap-1.5 select-none"
              title={
                activeSkill.mode === "ba"
                  ? "BA Planning reads the workspace directly"
                  : usingSharedRunner
                    ? "Isolated worktree is enforced on shared runners"
                    : "Run in an isolated git branch & folder (.agents/worktrees) without modifying your main workspace"
              }
            >
              <Checkbox
                checked={
                  activeSkill.mode === "ba"
                    ? false
                    : usingSharedRunner
                      ? true
                      : useWorktree
                }
                disabled={activeSkill.mode === "ba" || usingSharedRunner}
                onCheckedChange={(checked) => setUseWorktree(checked === true)}
              />
              <span>Worktree</span>
            </label>
          </div>
        </div>
      </div>

      <NewProjectDialog
        open={addProjectOpen}
        onOpenChange={setAddProjectOpen}
        onCreated={() => router.refresh()}
      />
    </div>
  );
}
