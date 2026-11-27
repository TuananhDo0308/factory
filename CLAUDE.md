# CLAUDE.md

This repository holds:

- `software-factory/`: the Software Factory web app (Next.js App Router + Prisma/PostgreSQL) and the `sf` CLI/daemon in a single file, `cli/sf.ts` (served to runners at `/api/cli/sf.ts`, so it must stay one file).
- `factory_v2/`: the factory v2 skills, `new-ba` and `new-factory`, that Software Factory runs on Claude Code.
- `factory-v2/`: a separate experimental suite (`/f-plan`, `/f-run`, …), not used by Software Factory.

## Rules

- Claude Code is the only engine; do not add other engines back. Tokens and cost come from Claude's own numbers, never estimates.
- The daemon ↔ web contract is `software-factory/docs/factory-v2-contract.md`: change both sides and the contract together.
- Untracked and ignored files are not recoverable through git: move them to the Trash instead of removing them outright, and inspect the target first.
- Commit or push only when the user asks.

## Testing

- **factory v2**: `cd factory_v2/skills/new-ba && node --test tests/*.test.mjs`, and `cd factory_v2/skills/new-factory && node --test tests/unit/*.test.mjs tests/integration/*.test.mjs`
- **Software Factory**: `cd software-factory && node --test tests/*.test.mjs && pnpm db:generate && pnpm lint && pnpm build`
