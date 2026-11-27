// The only skill a person starts from a session is factory v2's `/new-ba`.
// Epic runs (new-factory) start from the Kanban board, not from a prompt.

export type SessionSkillOption = {
  id: string;
  slash: string;
  aliases: string[];
  mode: "ba";
  label: string;
  description: string;
};

export const BA_SKILL: SessionSkillOption = {
  id: "new-ba",
  slash: "/new-ba",
  aliases: ["/new-ba", "/ba"],
  mode: "ba",
  label: "BA & Prototype",
  description: "Turn a request into an epic of ready tickets (C1..Cn) and a prototype",
};

export const SESSION_SKILLS: SessionSkillOption[] = [BA_SKILL];

export function findSkillByIdOrMode(raw?: string | null): SessionSkillOption | null {
  const cleaned = (raw || "").trim().toLowerCase().replace(/^\/+/, "");
  if (!cleaned) return null;
  return (
    SESSION_SKILLS.find(
      (s) => s.id === cleaned || s.mode === cleaned || s.aliases.some((a) => a === `/${cleaned}`),
    ) ?? null
  );
}

/** Detects a leading `/new-ba` (or `/ba`) on a token boundary. */
export function detectSkillFromPrompt(prompt: string): {
  skill: SessionSkillOption;
  matchedPrefix: string;
  body: string;
} | null {
  const trimmedStart = prompt.trimStart();
  if (!trimmedStart.startsWith("/")) return null;
  const lower = trimmedStart.toLowerCase();
  const aliases = SESSION_SKILLS.flatMap((skill) => skill.aliases.map((alias) => ({ alias, skill }))).sort(
    (a, b) => b.alias.length - a.alias.length,
  );
  for (const entry of aliases) {
    if (!lower.startsWith(entry.alias)) continue;
    const nextChar = trimmedStart[entry.alias.length];
    if (nextChar !== undefined && !/\s/.test(nextChar)) continue;
    const matchedPrefix = trimmedStart.slice(0, entry.alias.length);
    const body = trimmedStart.slice(entry.alias.length).replace(/^[ \t]+/, "");
    return { skill: entry.skill, matchedPrefix, body };
  }
  return null;
}

/** Makes sure a BA prompt starts with `/new-ba `, keeping what the user typed. */
export function toBaPrompt(prompt: string): string {
  const detected = detectSkillFromPrompt(prompt);
  const body = (detected ? detected.body : prompt.trimStart()).trim();
  return body ? `${BA_SKILL.slash} ${body}` : BA_SKILL.slash;
}
