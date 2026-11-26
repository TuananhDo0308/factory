# Factory dispatcher

Builds `ready` issues on their own: a GitHub Action in the project hands the next one to a Claude Code session on a machine you run (a self-hosted runner), which runs the `factory` skill on it and leaves the pull request open for a person to accept.

```
person adds `ready` ─► readiness check (code) ─► next-issue.mjs picks the oldest buildable issue
                         │ fails: comment, label removed       │
                         ▼                                     ▼
                   back to the BA              claude -p "factory #N, no-merge" on the runner
                                                               │
                         ┌──────────────── passed ─────────────┼──── blocked with questions ───┐
                         ▼                                     ▼                               ▼
              PR open, CI green, label            comment + factory-failed           Q lines on the issue,
              factory-review; a person merges                                        needs-info; a person answers
                         │                                                           and adds ready again
                         ▼
              issue closes ─► the issues it blocked become buildable ─► next run
```

## What decides what

| Decision | Made by |
|---|---|
| What to build, and that it is ready | A person who can write to the repository, by adding `ready` |
| Whether the issue is complete enough | `scripts/ready-check.mjs` (sections, criteria, vague words, mockup links, unanswered `Q` lines, dependency cycles) |
| Which issue goes next | `scripts/next-issue.mjs`: oldest, labelled `factory` and `ready`, every dependency closed, not `needs-info`, `factory-running` or `factory-failed`, written by someone in `FACTORY_AUTHORS` |
| How it is built | The factory workflow, as for any run. Its planner stops with questions instead of guessing |
| Whether it ships | A person, by merging the pull request (`no-merge`); with `FACTORY_AUTO_MERGE`, the run itself when code's merge decision is `auto` |

## Set up

1. **Labels.** In the project: `bash ~/.claude/skills/factory/scripts/factory-issue.sh labels`.
2. **A machine for the runner.** One you control, with Claude Code signed in, the factory skill and the team's skills installed (`scripts/install-skills.sh`), `gh`, `node`, `git`, Docker if your checks use it, and whatever the project needs to build and test. Use a user account of its own: the session can run any command the project's checks and the agents run.
3. **Register the runner** on the project (Settings → Actions → Runners → New self-hosted runner) and give it the label `factory`. The runner pulls jobs from GitHub; nothing has to reach the machine from outside.
4. **Repository variables** (Settings → Secrets and variables → Actions → Variables):
   - `FACTORY_CLAUDE_FLAGS` (required): the flags the unattended session runs with. A factory run needs git, gh, the test commands and file edits without anyone to approve them, so this is usually `--permission-mode bypassPermissions` on a machine that holds nothing else. Prefer an allow-list (`--allowedTools ...`) if your project's commands are known. For a project with a UI, ensure Playwright MCP is configured in `.mcp.json` (which `factory-init` writes) or globally on the runner via `claude mcp add playwright -- npx -y @playwright/mcp@0.0.84 --headless --isolated` so the unattended session loads the browser QC clicks through. The runner needs Google Chrome installed: Playwright MCP drives it by default.
   - `FACTORY_AUTHORS` (recommended): comma-separated logins whose issues may be built, for example the bot account the BA uses. Issues by anyone else are skipped even if they are labelled.
   - `FACTORY_AUTO_MERGE` (optional): `true` lets a run merge its own pull request when the workflow's merge decision is `auto` (no auth, money, migration, dependency or CI file, not high risk, no visible change, no test rewritten). Anything else still waits for a person. Leave it unset while you are learning to trust the runs.
   - `FACTORY_HOME` (optional): where the factory skill is on the runner; default `~/.claude/skills/factory`.
5. **Copy** `factory-dispatch.yml` to `.github/workflows/` in the project and commit it to the default branch.
6. **Branch protection** on the default branch, with a required review, so a pull request cannot be merged without a person even by mistake.

## Risks

- **Never attach this runner to a public repository.** On a public repository anyone can open issues, and the bodies are read by an agent that runs commands on your machine. On a private one, only people you let in can.
- Issue bodies and comments are data to the agents, but they are still text an agent reads. Keep `FACTORY_AUTHORS` and the `ready` rule (only people who can write) in place: they are what stand between a stranger's issue and your runner.
- A run costs agents. One issue is about five agents at the least and many more when work goes back to Build; the dispatcher runs one at a time, but it runs every `ready` issue there is.
