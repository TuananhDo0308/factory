# GEMINI.md

This monorepo holds three independent top-level directories:

- `antigravity/`: self-contained **Gemini Antigravity** Factory skill suite (Python `run_workflow` scripts, role briefs, setup/pipeline scripts, `ui-refine-loop`, `pr-judge`, and Python + Node tests). See [antigravity/GEMINI.md](antigravity/GEMINI.md) for detailed architecture and rules.
- `claude/`: self-contained **Claude Code** Factory skill suite (JavaScript Workflow scripts, role briefs, setup/pipeline scripts, `ui-refine-loop`, `pr-judge`, and Node tests). See [claude/CLAUDE.md](claude/CLAUDE.md) for detailed architecture and rules.
- `software-factory/`: upcoming Next.js (App Router) + SQLite/Prisma web application and internal `sf` CLI that tracks all Factory projects, tasks, live runs, logs, and approvals (XS Factory Bench has been removed).

## Rules

- Keep `antigravity/` and `claude/` completely self-contained — no cross-directory runtime imports or symlinks between them.
- Skills in `~/.gemini/config/skills/` point to `antigravity/<skill>`. Every edit under `antigravity/` immediately affects Antigravity sessions using those symlinks.
- Untracked and ignored files (for example `factory-workspace/` or local `live.js` files) are not recoverable through git: move them to the Trash instead of removing them outright, and inspect the target first.
- Commit or push only when the user asks.

## Testing

- **Antigravity**: `cd antigravity && python3 -m unittest discover -s tests -v && node --test tests/*.test.mjs tests/*.test.ts`
- **Claude**: `cd claude && node --test tests/*.test.mjs tests/*.test.ts`
