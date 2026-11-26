export type EffortKey = "low" | "medium" | "high" | "xhigh" | "max";

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

const CANONICAL_FAMILIES: Record<"antigravity" | "claude", ModelFamily[]> = {
  antigravity: [
    {
      id: "gemini-4-neon",
      label: "Gemini 4 Neon",
      badge: "New",
      submenuLabel: "Thinking effort",
      defaultValue: "gemini-4-neon-xhigh",
      efforts: [
        { value: "gemini-4-neon-low", label: "Low", effortKey: "low", bars: 1 },
        { value: "gemini-4-neon-medium", label: "Medium", effortKey: "medium", bars: 2 },
        { value: "gemini-4-neon-high", label: "High", effortKey: "high", bars: 3 },
        { value: "gemini-4-neon-xhigh", label: "Extra High", effortKey: "xhigh", bars: 4 },
      ],
    },
    {
      id: "gemini-4-carbon",
      label: "Gemini 4 Carbon",
      badge: "New",
      submenuLabel: "Thinking effort",
      defaultValue: "gemini-4-carbon-medium",
      efforts: [
        { value: "gemini-4-carbon-low", label: "Low", effortKey: "low", bars: 1 },
        { value: "gemini-4-carbon-medium", label: "Medium", effortKey: "medium", bars: 2 },
        { value: "gemini-4-carbon-high", label: "High", effortKey: "high", bars: 3 },
      ],
    },
    {
      id: "gemini-4-argon",
      label: "Gemini 4 Argon",
      badge: "Leaving Soon",
      submenuLabel: "Thinking effort",
      defaultValue: "gemini-4-argon-medium",
      efforts: [
        { value: "gemini-4-argon-low", label: "Low", effortKey: "low", bars: 1 },
        { value: "gemini-4-argon-medium", label: "Medium", effortKey: "medium", bars: 2 },
        { value: "gemini-4-argon-high", label: "High", effortKey: "high", bars: 3 },
      ],
    },
    {
      id: "gemini-4-hydrogen",
      label: "Gemini 4 Hydrogen",
      badge: "New",
      submenuLabel: "Thinking effort",
      defaultValue: "gemini-4-hydrogen-medium",
      efforts: [
        { value: "gemini-4-hydrogen-low", label: "Low", effortKey: "low", bars: 1 },
        { value: "gemini-4-hydrogen-medium", label: "Medium", effortKey: "medium", bars: 2 },
        { value: "gemini-4-hydrogen-high", label: "High", effortKey: "high", bars: 3 },
        { value: "gemini-4-hydrogen-xhigh", label: "Extra High", effortKey: "xhigh", bars: 4 },
      ],
    },
    {
      id: "orchestrator",
      label: "Orchestrator",
      badge: "New",
      submenuLabel: "Model",
      defaultValue: "gemini-pro-orchestrator-neon",
      efforts: [
        { value: "gemini-pro-orchestrator-neon", label: "Neon", effortKey: "high", bars: 4 },
        { value: "gemini-pro-orchestrator", label: "Carbon", effortKey: "medium", bars: 3 },
        { value: "gemini-pro-orchestrator-argon", label: "Argon", effortKey: "medium", bars: 2 },
      ],
    },
    {
      id: "gemini-3.8-flash",
      label: "Gemini 3.8 Flash",
      badge: "Leaving Soon",
      submenuLabel: "Thinking effort",
      defaultValue: "gemini-3.8-flash-medium",
      efforts: [
        { value: "gemini-3.8-flash-low", label: "Low", effortKey: "low", bars: 1 },
        { value: "gemini-3.8-flash-medium", label: "Medium", effortKey: "medium", bars: 2 },
        { value: "gemini-3.8-flash-high", label: "High", effortKey: "high", bars: 3 },
      ],
    },
    {
      id: "claude-sonnet-4-6",
      label: "Claude Sonnet 4.6 (Thinking)",
      defaultValue: "claude-sonnet-4-6",
      efforts: [{ value: "claude-sonnet-4-6", label: "", effortKey: "medium", bars: 3 }],
    },
    {
      id: "claude-opus-4-6-thinking",
      label: "Claude Opus 4.6 (Thinking)",
      defaultValue: "claude-opus-4-6-thinking",
      efforts: [{ value: "claude-opus-4-6-thinking", label: "", effortKey: "high", bars: 4 }],
    },
    {
      id: "gpt-oss-120b-medium",
      label: "GPT-OSS 120B (Medium)",
      defaultValue: "gpt-oss-120b-medium",
      efforts: [{ value: "gpt-oss-120b-medium", label: "", effortKey: "medium", bars: 2 }],
    },
  ],
  claude: [
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
  ],
};

function flattenFamilies(families: ModelFamily[]): ModelChoice[] {
  const out: ModelChoice[] = [];
  for (const fam of families) {
    for (const eff of fam.efforts) {
      out.push({
        value: eff.value,
        label: fam.label,
        effort: eff.label,
        effortKey: eff.effortKey,
        bars: eff.bars,
        badge: fam.badge,
      });
    }
  }
  return out;
}

/**
 * Flat list of all canonical models (kept for backward compatibility & label lookup).
 */
export const MODEL_OPTIONS: Record<"antigravity" | "claude", ModelChoice[]> = {
  antigravity: flattenFamilies(CANONICAL_FAMILIES.antigravity),
  claude: flattenFamilies(CANONICAL_FAMILIES.claude),
};

const EFFORT_META: Record<EffortKey, { label: string; bars: number; rank: number }> = {
  low: { label: "Low", bars: 1, rank: 1 },
  medium: { label: "Medium", bars: 2, rank: 2 },
  high: { label: "High", bars: 3, rank: 3 },
  xhigh: { label: "Extra High", bars: 4, rank: 4 },
  max: { label: "Max", bars: 4, rank: 5 },
};

function parseUnknownEffort(
  id: string,
  rawLabel: string,
): { familyKey: string; familyLabel: string; effortKey: EffortKey | null } {
  const idMatch = /^(.+?)-(low|medium|high|xhigh|max)$/i.exec(id);
  const labelMatch = /^(.+?)\s*\((low|medium|high|xhigh|extra high|max)\)\s*$/i.exec(rawLabel);
  if (idMatch) {
    const effortRaw = idMatch[2].toLowerCase() as EffortKey;
    const famLabel = labelMatch ? labelMatch[1].trim() : rawLabel.trim();
    return { familyKey: idMatch[1].toLowerCase(), familyLabel: famLabel, effortKey: effortRaw };
  }
  if (labelMatch) {
    const rawEff = labelMatch[2].toLowerCase();
    const effortKey: EffortKey = rawEff === "extra high" ? "xhigh" : (rawEff as EffortKey);
    return {
      familyKey: labelMatch[1].trim().toLowerCase(),
      familyLabel: labelMatch[1].trim(),
      effortKey,
    };
  }
  return { familyKey: id.toLowerCase(), familyLabel: rawLabel.trim() || id, effortKey: null };
}

/**
 * Builds grouped Model Families with nested Thinking Effort options (Gemini-style 2-level picker).
 * Deduplicates live runner models against canonical families and auto-groups any unknown future IDs.
 */
export function buildModelFamilies(
  engine: "antigravity" | "claude",
  liveRunnerModels?: Array<{ id: string; label: string; engine: string }>,
): ModelFamily[] {
  const canonical = CANONICAL_FAMILIES[engine];
  if (engine === "claude" || !liveRunnerModels || liveRunnerModels.length === 0) {
    return canonical;
  }

  const liveForEngine = liveRunnerModels.filter((m) => m.engine === engine);
  if (liveForEngine.length === 0) return canonical;

  const liveIds = new Set(liveForEngine.map((m) => m.id));
  const consumedIds = new Set<string>();
  const result: ModelFamily[] = [];

  for (const fam of canonical) {
    const availableEfforts = fam.efforts.filter((e) => liveIds.has(e.value));
    if (availableEfforts.length === 0) continue;
    for (const e of availableEfforts) consumedIds.add(e.value);
    const defaultValue = availableEfforts.some((e) => e.value === fam.defaultValue)
      ? fam.defaultValue
      : availableEfforts[availableEfforts.length - 1].value;
    result.push({
      ...fam,
      defaultValue,
      efforts: availableEfforts,
    });
  }

  // Group any future/unrecognized live models by base family so they never flatten into duplicates
  const extraFamilies = new Map<string, ModelFamily>();
  for (const m of liveForEngine) {
    if (consumedIds.has(m.id)) continue;
    const parsed = parseUnknownEffort(m.id, m.label || m.id);
    const existing = extraFamilies.get(parsed.familyKey);
    const effMeta = parsed.effortKey ? EFFORT_META[parsed.effortKey] : null;
    const effortOpt: ModelEffortOption = {
      value: m.id,
      label: effMeta ? effMeta.label : "",
      effortKey: parsed.effortKey ?? "medium",
      bars: effMeta ? effMeta.bars : effortBarsForModel(m.id),
    };
    if (existing) {
      if (!existing.efforts.some((e) => e.value === m.id)) {
        existing.efforts.push(effortOpt);
        existing.submenuLabel = "Thinking effort";
      }
    } else {
      extraFamilies.set(parsed.familyKey, {
        id: `live-${parsed.familyKey}`,
        label: parsed.familyLabel,
        submenuLabel: parsed.effortKey ? "Thinking effort" : undefined,
        defaultValue: m.id,
        efforts: [effortOpt],
      });
    }
  }

  for (const extra of extraFamilies.values()) {
    extra.efforts.sort(
      (a, b) => (EFFORT_META[a.effortKey]?.rank ?? 0) - (EFFORT_META[b.effortKey]?.rank ?? 0),
    );
    result.push(extra);
  }

  return result.length > 0 ? result : canonical;
}

export function defaultModelForEngine(engine: string): string {
  return engine === "claude" ? "opus:high" : "gemini-4-neon-xhigh";
}

export function findModelChoice(engine: string, modelId: string | null | undefined): ModelChoice {
  const list = engine === "claude" ? MODEL_OPTIONS.claude : MODEL_OPTIONS.antigravity;
  if (!modelId) return list[0];
  const exact = list.find((m) => m.value === modelId);
  if (exact) return exact;

  const lower = modelId.toLowerCase();
  if (engine === "claude") {
    if (lower === "opus" || lower === "fable") {
      return list.find((m) => m.value === "opus:high") ?? list[0];
    }
    if (lower === "sonnet") {
      return list.find((m) => m.value === "sonnet:medium") ?? list[0];
    }
    if (lower === "haiku") {
      return list.find((m) => m.value === "haiku") ?? list[0];
    }
  } else {
    if (lower === "pro") return list.find((m) => m.value === "gemini-4-neon-xhigh") ?? list[0];
    if (lower === "flash") return list.find((m) => m.value === "gemini-4-carbon-medium") ?? list[0];
    if (lower === "flash_lite") {
      return list.find((m) => m.value === "gemini-4-hydrogen-medium") ?? list[0];
    }
  }
  return list[0];
}

export function formatModelLabel(modelId: string | null | undefined): string {
  if (!modelId) return "default";
  for (const list of [MODEL_OPTIONS.antigravity, MODEL_OPTIONS.claude]) {
    const found = list.find((m) => m.value === modelId);
    if (found) return found.effort ? `${found.label} · ${found.effort}` : found.label;
  }
  // Legacy Claude & Antigravity tier shorthands
  const lower = modelId.toLowerCase();
  if (lower === "opus") return "Claude Opus";
  if (lower === "sonnet") return "Claude Sonnet";
  if (lower === "haiku") return "Claude Haiku";
  if (lower === "fable") return "Claude Opus";
  if (lower === "pro") return "Gemini 4 Neon · Extra High";
  if (lower === "flash") return "Gemini 4 Carbon · Medium";
  if (lower === "flash_lite") return "Gemini 4 Hydrogen · Medium";
  return modelId;
}

export function effortBarsForModel(modelId: string | null | undefined): number {
  const m = (modelId || "").toLowerCase();
  if (m.endsWith(":max") || m.endsWith(":xhigh") || m.endsWith("-xhigh")) return 4;
  if (m.endsWith(":high") || m.endsWith("-high")) return 3;
  if (m.endsWith(":medium") || m.endsWith("-medium")) return 2;
  if (m.endsWith(":low") || m.endsWith("-low")) return 1;
  if (
    m.includes("neon") ||
    m.includes("orchestrator") ||
    m.includes("opus") ||
    m.includes("fable") ||
    m === "pro"
  ) {
    return 4;
  }
  if (m.includes("carbon") || m.includes("sonnet")) return 3;
  if (
    m.includes("hydrogen") ||
    m.includes("gpt-oss") ||
    (m.includes("flash") && !m.includes("lite"))
  ) {
    return 2;
  }
  return 1;
}
