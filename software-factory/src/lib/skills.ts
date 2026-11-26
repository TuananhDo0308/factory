export type SessionSkillOption = {
  id: string;
  slash: string;
  aliases: string[];
  mode: "ba" | "factory" | "clarify" | "init" | "ui-refine" | "pr-judge" | "normal";
  label: string;
  description: string;
  defaultWorktree: boolean;
};

export const SESSION_SKILLS: SessionSkillOption[] = [
  {
    id: "ba-ticket",
    slash: "/ba-ticket",
    aliases: ["/ba-ticket", "/ba"],
    mode: "ba",
    label: "BA Create Tickets",
    description: "Break idea into 1-PR Kanban tickets with C1..Cn criteria",
    defaultWorktree: false,
  },
  {
    id: "factory",
    slash: "/factory",
    aliases: ["/factory"],
    mode: "factory",
    label: "Factory Build",
    description: "Run Spec → Build (TDD + QA) → Check → Review & QC",
    defaultWorktree: true,
  },
  {
    id: "factory-clarify",
    slash: "/factory clarify",
    aliases: ["/factory clarify", "/factory-clarify", "/clarify"],
    mode: "clarify",
    label: "Clarify Spec",
    description: "Grill requirements, generate mockups & ready plan",
    defaultWorktree: false,
  },
  {
    id: "factory-init",
    slash: "/factory init",
    aliases: ["/factory init", "/factory-init", "/init"],
    mode: "init",
    label: "Factory Init",
    description: "Set up .factory/ profile, stack skills & standards",
    defaultWorktree: false,
  },
  {
    id: "dev-subissues",
    slash: "/dev-subissues",
    aliases: ["/dev-subissues", "/subissues"],
    mode: "normal",
    label: "Dev Sub-issues",
    description: "Technical breakdown into sub-issues before build",
    defaultWorktree: false,
  },
  {
    id: "ui-refine-loop",
    slash: "/ui-refine-loop",
    aliases: ["/ui-refine-loop", "/ui-refine", "/refine"],
    mode: "ui-refine",
    label: "UI Refine Loop",
    description: "Bounded visual polish check → fix loop",
    defaultWorktree: true,
  },
  {
    id: "pr-judge",
    slash: "/pr-judge",
    aliases: ["/pr-judge", "/judge"],
    mode: "pr-judge",
    label: "PR Judge",
    description: "Independent multi-judge pull request scorecard",
    defaultWorktree: false,
  },
  {
    id: "normal",
    slash: "",
    aliases: [],
    mode: "normal",
    label: "Normal Session",
    description: "Freeform chat without a skill slash command",
    defaultWorktree: false,
  },
];

// Longest aliases first so `/factory clarify` and `/factory init` always match before `/factory`.
const SORTED_ALIAS_ENTRIES: Array<{ alias: string; skill: SessionSkillOption }> = SESSION_SKILLS.flatMap(
  (skill) => skill.aliases.map((alias) => ({ alias: alias.toLowerCase(), skill })),
).sort((a, b) => b.alias.length - a.alias.length);

export function findSkillByIdOrMode(raw?: string | null): SessionSkillOption | null {
  const key = (raw || "").trim().toLowerCase();
  if (!key) return null;
  const cleaned = key.replace(/^\/+/, "");
  return (
    SESSION_SKILLS.find(
      (s) =>
        s.id === cleaned ||
        s.mode === cleaned ||
        s.slash.toLowerCase() === `/${cleaned}` ||
        s.aliases.some((a) => a.toLowerCase() === `/${cleaned}`),
    ) ?? null
  );
}

/**
 * Detects a leading `/skill` slash command at the start of a prompt.
 * Matches only on a token boundary (followed by whitespace or end-of-string).
 */
export function detectSkillFromPrompt(prompt: string): {
  skill: SessionSkillOption;
  matchedPrefix: string;
  body: string;
} | null {
  const trimmedStart = prompt.trimStart();
  if (!trimmedStart.startsWith("/")) return null;
  const lower = trimmedStart.toLowerCase();

  for (const entry of SORTED_ALIAS_ENTRIES) {
    if (!lower.startsWith(entry.alias)) continue;
    const nextChar = trimmedStart[entry.alias.length];
    if (nextChar !== undefined && !/\s/.test(nextChar)) continue;
    const matchedPrefix = trimmedStart.slice(0, entry.alias.length);
    const body = trimmedStart.slice(entry.alias.length).replace(/^[ \t]+/, "");
    return { skill: entry.skill, matchedPrefix, body };
  }
  return null;
}

/**
 * Replaces or inserts the chosen skill's `/slash` prefix at the start of the prompt,
 * preserving whatever task description the user already typed.
 */
export function applySkillPrefixToPrompt(prompt: string, target: SessionSkillOption): string {
  const detected = detectSkillFromPrompt(prompt);
  let body = detected ? detected.body : prompt.trimStart();
  // If user was mid-typing an incomplete slash command (e.g. "/ba"), clear that partial token
  if (!detected && /^\/[^\s]*$/.test(body)) {
    body = "";
  }
  if (!target.slash) {
    return body;
  }
  return body ? `${target.slash} ${body}` : `${target.slash} `;
}

/**
 * Returns slash-command autocomplete suggestions while typing `/` at the beginning of the prompt.
 */
export function getSlashSuggestions(prompt: string): SessionSkillOption[] {
  const trimmedStart = prompt.trimStart();
  if (!trimmedStart.startsWith("/") || trimmedStart.includes("\n")) return [];

  // Hide autocomplete once a complete skill command already has prompt text after a space
  // (except `/factory ` where user might still want `/factory clarify` or `/factory init`).
  const lower = trimmedStart.toLowerCase();
  const isFactorySpace = lower === "/factory " || lower.startsWith("/factory c") || lower.startsWith("/factory i");
  const detected = detectSkillFromPrompt(trimmedStart);
  if (detected && !isFactorySpace) {
    const afterAlias = trimmedStart.slice(detected.matchedPrefix.length);
    if (/\s/.test(afterAlias)) {
      return [];
    }
  }

  const query = lower.trim();
  const slashSkills = SESSION_SKILLS.filter((s) => Boolean(s.slash));
  if (query === "/") return slashSkills;

  return slashSkills.filter(
    (s) =>
      s.slash.toLowerCase().includes(query) ||
      s.aliases.some((a) => a.toLowerCase().startsWith(query)) ||
      s.id.toLowerCase().includes(query.slice(1)) ||
      s.label.toLowerCase().includes(query.slice(1)),
  );
}
