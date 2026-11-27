# Factory

**Software Factory** (a web app and its `sf` runner daemon) that runs **factory v2** on **Claude Code**.

## Repository layout

```text
factory/
├── software-factory/  Web app (Next.js + Prisma/PostgreSQL) and the `sf` CLI/daemon (cli/sf.ts)
├── factory_v2/        factory v2 skills: new-ba (BA → GitHub epic + tickets), new-factory (builds an epic into staging)
└── factory-v2/        Separate experimental suite (/f-plan, /f-run, /f-init, /f-polish)
```

The old suites (`claude/`, `antigravity/`) and Antigravity/Gemini support were removed: every run is a Claude Code run of factory v2.

## How it works

1. **BA session**: in the web app, start a session with `/new-ba <request>`. A runner's daemon runs `claude -p "/new-ba …"` in the project's clone and streams every tool call, message, token and cost to the run page; questions come back as clickable options. When new-ba publishes, the epic and its tickets appear on the board.
2. **Epic run**: **Run epic** makes the daemon run `node factory_v2/skills/new-factory/orchestrator/run.mjs --repo <owner/name> --epic <n>` and report each of its agents, ticket status, alarms and decisions. A ticket that needs a decision is answered in the UI, which retries it.

Token and cost numbers are Claude's own (per message usage counted once, and each process's `total_cost_usd`); nothing is estimated. The daemon ↔ web contract is [software-factory/docs/factory-v2-contract.md](software-factory/docs/factory-v2-contract.md).

## Running it

```sh
cd software-factory
cp .env.example .env            # fill in DATABASE_URL, GitHub OAuth, SESSION_SECRET
pnpm install && pnpm db:push && pnpm dev   # http://localhost:8787
```

A runner on any machine: `curl -fsSL <app-url>/install.sh | bash`. It installs `sf`, links `new-ba` and `new-factory` into `~/.claude/skills` (from `SF_SKILLS_REPO_URL`, this repository by default), signs the runner in, and `sf daemon` then runs what the web app sends. A runner needs `claude`, `gh` (signed in), `git` and Node 22+; `sf doctor` checks them.

## Tests

```sh
cd factory_v2/skills/new-ba && node --test tests/*.test.mjs
cd factory_v2/skills/new-factory && node --test tests/unit/*.test.mjs tests/integration/*.test.mjs
cd software-factory && node --test tests/*.test.mjs        # includes sf daemon end to end with fake claude/gh
cd software-factory && pnpm db:generate && pnpm lint && pnpm build
```
