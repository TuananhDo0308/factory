import { NextResponse } from "next/server";

/** The skills `sf daemon` installs: factory v2 on Claude Code only. */
export async function GET() {
  return NextResponse.json({
    version: "2026.11.27",
    skillsRepoUrl: process.env.SF_SKILLS_REPO_URL || "",
    engines: {
      claude: {
        binary: "claude",
        skillsDir: "~/.claude/skills",
        skills: ["new-ba", "new-factory"],
      },
    },
  });
}
