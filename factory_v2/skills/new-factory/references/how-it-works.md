# How new-factory works

The design is `docs/factory-design.md` in the new_factory project; this page maps it to the code.

## Files of a run

`<clone>/.factory/runs/epic-<n>/` (ignored by git through `.git/info/exclude`):

| File | What |
|---|---|
| `state.json` | The whole run, written atomically. `state.js` is the same for the dashboard. |
| `plan.json` | The plan `check-batch.mjs` built from the tickets. |
| `run.log` | One line per event. |
| `logs/agents/*.jsonl` | Each agent's stream-json. |
| `logs/<issue>/`, `logs/staging/`, `logs/bisect/` | Each check's output and JSON report. |
| `report.md`, `dashboard.html` | Written by code at the end, and the page that follows the run. |

Worktrees live outside the clone, in `~/.new-factory/worktrees/<owner>__<name>/epic-<n>/`: `_staging` (the staging worktree, where dependencies are installed once and every merge happens; only the orchestrator writes there, and it is put back to HEAD before a merge if anything was left changed), `<issue>` per ticket, `_bisect`, and `_server1`/`_server2` for the check that two dev servers run side by side.

## Modules (`orchestrator/lib/`)

| Module | Design step |
|---|---|
| `state.mjs` | state.json, atomic; `once()` for side effects; step timings |
| `plan.mjs` | 1: labels `ready`, `check-batch.mjs --repo --epic --write`, snapshots, "changed after BA", size floor (new-ba's `sizeFloor`) |
| `queue.mjs` | 0: one batch at a time per clone |
| `prepare.mjs` | 2: new dependencies and prototype in one commit, install once, QC precheck (browser, Playwright MCP, two dev servers on two ports, Playwright config reads PORT) |
| `scheduler.mjs` | 3: by the dependency graph, at most 4 (`NF_MAX_PARALLEL`) |
| `ticket.mjs` | 4a-4c: worktree, implementer (a server it left listening on the ticket's `PORT`, in its worktree, is stopped by PID), checks by code, reviewer |
| `owns.mjs`, `criteria.mjs` | 4b: Owns against the commits since the ticket's merge-base; a tagged test with an assertion per criterion |
| `fixloop.mjs`, `locks.mjs` | 4d: rounds, diagnoser, lock table, cycle check, needs-decision, 4-round limit |
| `watchdog.mjs` | 4e: stall alarms; kills a stuck child by PID in the agent's tree |
| `merge.mjs`, `bisect.mjs` | 5: serial `--no-ff` merges, lockfile made again, `staging` pushed after every merge and revert, check after merging only when a ticket waits, bisect to the culprit, reverts |
| `final.mjs` | 6: full check, e2e by criterion, one QC agent |
| `resume.mjs` | 7: after a crash; `--retry` with the user's answer, revert of the revert |
| `report.mjs` | 8: report.md, dashboard |
| `agents.mjs`, `models.mjs`, `briefs.mjs` | `claude -p` runs, tool limits, models by size, prompts from `roles/`; a brief carries the contracts the ticket provides (their file is in its Owns) and the ones it uses |

## Agents

| Role | When | Model |
|---|---|---|
| implementer | each ticket; each fix round | S haiku, M sonnet, L opus; a "hard" fix from round 3: S sonnet, M opus, L opus with `--effort max` |
| reviewer | M and L (an S whose diff touches a shared file is reviewed as M) | M sonnet, L opus with the security section |
| diagnoser | after 2 fix rounds, or when an implementer returns `blocked` | sonnet |
| reviewer (second) | when the diagnoser says the judge was wrong (not for S) | opus |
| qc | once at the end, then only the criteria that failed | sonnet, with Playwright MCP |

Every agent runs with `--permission-mode dontAsk`, a short tool list, edits limited to its worktree, and git (other than add/commit/status/diff/log/show), `gh`, package installs and `pkill`/`killall` denied.

## Environment variables

| Variable | Default | Use |
|---|---|---|
| `NF_CLAUDE_BIN`, `NF_GH_BIN` | `claude`, `gh` | Replace the agent or GitHub command (the tests use fakes) |
| `NF_BA_DIR` | `../new-ba`, then `~/.claude/skills/new-ba` | Where `check-batch.mjs` is |
| `NF_WT_ROOT` | `~/.new-factory/worktrees/<repo>` | Where worktrees go |
| `NF_MAX_PARALLEL` | 4 | Tickets at once |
| `NF_STALL_MS`, `NF_WATCH_INTERVAL_MS` | 30 min, 60 s | No-progress alarm, and how often to look |
| `NF_QUEUE_POLL_MS` | 30 s | How often a queued batch looks again |
| `NF_INSTALL_CMD`, `NF_LOCK_CMD` | by package manager | Install, and make the lockfile again |
| `NF_NO_NOTIFY=1`, `NF_MCP_CHECK=skip`, `NF_BROWSER_CHECK=skip` | | For tests |
| `NF_CRASH_AT` | | Tests: exit at `after-merge:<issue>` or `agent:<role>:<issue>` |

## Checks

From the plan's `architecture.checks` (`[{ name, command }]`, written by new-ba; in a new repository the only source, since there is no `package.json` yet), with `.factory/project.json` `checks` overriding it when present (`{ "checks": { "unit": "npm test", "lint": null } }`). The plan's `test` is the `unit` step; other names keep theirs and run on every ticket. Only when the plan has none, from `package.json` scripts: `typecheck`, `lint`, `format:check`, `build`, `test:unit`/`test`, `e2e`/`test:e2e`, and `dev`/`start` for the dev server. A ticket runs all of them in parallel; after merging and at the end: typecheck, build, unit, e2e. Every check gets `CI=1`, and the ticket's `PORT` and `BASE_URL`. e2e always runs with `--reporter=line,json` and `PLAYWRIGHT_JSON_OUTPUT_NAME`, which gives the results by criterion and the failing files for bisecting.

## Tests

`node --test tests/unit tests/integration` from the skill's folder. The integration tests run the whole orchestrator on a fixture repository with fake `claude` and `gh` (`tests/fixtures/`), so they cost no tokens.
