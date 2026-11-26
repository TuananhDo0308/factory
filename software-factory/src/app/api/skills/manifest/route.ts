import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    version: "2026.11.25",
    skillsRepoUrl: process.env.SF_SKILLS_REPO_URL || "",
    engines: {
      antigravity: {
        binary: "agy",
        skillsDir: "~/.gemini/config/skills",
        skills: [
          "factory",
          "factory-init",
          "factory-clarify",
          "ba-ticket",
          "dev-subissues",
          "ui-refine-loop",
          "pr-judge",
        ],
      },
      claude: {
        binary: "claude",
        skillsDir: "~/.claude/skills",
        skills: [
          "factory",
          "factory-init",
          "factory-clarify",
          "ba-ticket",
          "dev-subissues",
          "ui-refine-loop",
          "pr-judge",
        ],
      },
    },
  });
}
