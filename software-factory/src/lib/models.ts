// Software Factory runs only on Claude Code. Models are `opus`, `sonnet`, `haiku`,
// optionally with a thinking effort (`opus:high`).

export type EffortKey = "low" | "medium" | "high" | "xhigh" | "max";

export const ENGINE = "claude" as const;

export type ModelChoice = {
  value: string;
  label: string;
  effort: string;
  effortKey: EffortKey;
  bars: number;
  badge?: string;
};

export type ModelEffortOption = {
  value: string;
  label: string;
  effortKey: EffortKey;
  bars: number;
};

export type ModelFamily = {
  id: string;
  label: string;
  badge?: string;
  submenuLabel?: string;
  defaultValue: string;
  efforts: ModelEffortOption[];
};

export const MODEL_FAMILIES: ModelFamily[] = [
  {
    id: "claude-opus",
    label: "Claude Opus",
    submenuLabel: "Thinking effort",
    defaultValue: "opus:high",
    efforts: [
      { value: "opus:low", label: "Low", effortKey: "low", bars: 1 },
      { value: "opus:medium", label: "Medium", effortKey: "medium", bars: 2 },
      { value: "opus:high", label: "High", effortKey: "high", bars: 3 },
      { value: "opus:xhigh", label: "Extra High", effortKey: "xhigh", bars: 4 },
      { value: "opus:max", label: "Max", effortKey: "max", bars: 4 },
    ],
  },
  {
    id: "claude-sonnet",
    label: "Claude Sonnet",
    submenuLabel: "Thinking effort",
    defaultValue: "sonnet:medium",
    efforts: [
      { value: "sonnet:low", label: "Low", effortKey: "low", bars: 1 },
      { value: "sonnet:medium", label: "Medium", effortKey: "medium", bars: 2 },
      { value: "sonnet:high", label: "High", effortKey: "high", bars: 3 },
    ],
  },
  {
    id: "claude-haiku",
    label: "Claude Haiku",
    defaultValue: "haiku",
    efforts: [{ value: "haiku", label: "", effortKey: "low", bars: 1 }],
  },
];

export const MODEL_OPTIONS: ModelChoice[] = MODEL_FAMILIES.flatMap((fam) =>
  fam.efforts.map((eff) => ({
    value: eff.value,
    label: fam.label,
    effort: eff.label,
    effortKey: eff.effortKey,
    bars: eff.bars,
    badge: fam.badge,
  })),
);

export const DEFAULT_MODEL = "opus:high";

const EFFORT_LABELS: Record<EffortKey, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
};

/** Normalises a model id (`opus`, `opus:high`, `claude-opus-4-…`) to a known choice. */
export function findModelChoice(modelId: string | null | undefined): ModelChoice {
  const fallback = MODEL_OPTIONS.find((m) => m.value === DEFAULT_MODEL) ?? MODEL_OPTIONS[0];
  if (!modelId) return fallback;
  const exact = MODEL_OPTIONS.find((m) => m.value === modelId);
  if (exact) return exact;
  const lower = modelId.toLowerCase();
  const family = ["opus", "sonnet", "haiku"].find((f) => lower.includes(f));
  if (!family) return fallback;
  const fam = MODEL_FAMILIES.find((f) => f.id === `claude-${family}`);
  return MODEL_OPTIONS.find((m) => m.value === fam?.defaultValue) ?? fallback;
}

export function formatModelLabel(modelId: string | null | undefined): string {
  if (!modelId) return "default";
  const exact = MODEL_OPTIONS.find((m) => m.value === modelId);
  if (exact) return exact.effort ? `${exact.label} · ${exact.effort}` : exact.label;
  const lower = modelId.toLowerCase();
  const [base, effort] = lower.split(":");
  const family = ["opus", "sonnet", "haiku"].find((f) => base.includes(f));
  if (!family) return modelId;
  const label = `Claude ${family[0].toUpperCase()}${family.slice(1)}`;
  const effortLabel = effort && effort in EFFORT_LABELS ? EFFORT_LABELS[effort as EffortKey] : "";
  return effortLabel ? `${label} · ${effortLabel}` : label;
}

export function effortBarsForModel(modelId: string | null | undefined): number {
  const m = (modelId || "").toLowerCase();
  if (m.endsWith(":max") || m.endsWith(":xhigh")) return 4;
  if (m.endsWith(":high")) return 3;
  if (m.endsWith(":medium")) return 2;
  if (m.endsWith(":low")) return 1;
  if (m.includes("opus")) return 4;
  if (m.includes("sonnet")) return 3;
  return 1;
}
