---
name: new-factory
description: Build a batch of new-ba tickets (a GitHub epic) into the staging branch - a Node orchestrator runs each ticket with one implementer in its own worktree, checks by code (project checks, Owns, a tagged test per criterion), a reviewer by size, merges into staging as soon as a ticket passes, schedules by the dependency graph (about 4 at once), and ends with one full check and one QC in the browser. Use when the user asks to run the factory or new-factory on an epic or batch, to build the tickets new-ba published, to retry a ticket that needs a decision, or to resume a factory run that stopped.
---

# new-factory

You start the orchestrator, tell the user how to follow it, and report when it ends. You do not build, review or merge anything yourself: `orchestrator/run.mjs` does all of it, in code, and calls `claude -p` for the agents.

Talk to the user in their language.

## 1. What to run

You need the repository (`owner/name`) and the epic's issue number. The epic is one that new-ba published: its tickets are sub-issues, each labelled `ready`.

Run from a clone of that repository (check `git remote get-url origin`); if the current directory is not one, ask the user where their clone is and pass `--dir <path>`.

```bash
node <this skill>/orchestrator/run.mjs --repo <owner/name> --epic <n>
```

Start it with the Bash tool's `run_in_background: true`. It runs for minutes to an hour; never wait on it in the foreground and never put a timeout on it.

## 2. Tell the user how to follow it

Right after starting, say in a few lines:

- the dashboard: `<clone>/.factory/runs/epic-<n>/dashboard.html` (open it in a browser; it refreshes itself);
- the log: `<clone>/.factory/runs/epic-<n>/run.log`;
- alarms come as macOS notifications and as comments on the ticket's issue;
- the factory merges only into `staging`, never into `main`; `staging` on GitHub follows each merge.

Then wait for the background command to finish. Do not poll the files.

## 3. When it ends

Read `<clone>/.factory/runs/epic-<n>/report.md` and tell the user, short:

1. Tickets delivered (merged into `staging`), and the total time and cost.
2. Each `needs-decision` ticket with its question, word for word, and the tickets waiting on it ("not delivered").
3. "Changed after BA" lines, alarms, and anything under Notes.
4. That they should check `staging` themselves before anything goes to `main`.

By exit code:

| Exit | Meaning | What you do |
|---|---|---|
| 0 | The batch ran to the end (some tickets may need a decision) | Report as above. |
| 2 | Refused: an issue lacks the `ready` label, or `check-batch` found a problem | Show the refusal from the report. The user fixes the tickets by hand (or with new-ba); then run the same command again. |
| 3 | No `staging` branch, it is checked out in the clone, or it diverged from origin | Show the reason. Missing branch: ask the user whether to create it from `main`; on yes, run again with `--create-staging`. Never create it without asking. |
| 64, 70 | Usage error, or the orchestrator failed | Show the last lines of `run.log`; the same command resumes after a fix. |

## 4. A ticket that needs a decision

The user answers the question (on the issue, or to you). Then:

```bash
node <this skill>/orchestrator/run.mjs --repo <owner/name> --epic <n> --retry <issue>[,<issue>] [--note "<their answer>"]
```

The orchestrator reads the answer from the issue's comments after its own question; when the user answered you in the chat instead, pass it with `--note` (do not post it for them unless they ask). If they changed the ticket's text instead, `--retry` alone is enough: the ticket is read again. Start it in the background, as in step 1, and report as in step 3.

## 5. After a crash, or a second batch

- Crash, reboot, killed terminal: run exactly the same command again. It goes on from `state.json`; nothing done is done twice.
- A second batch while one runs: start it the same way. It waits its turn and starts from the newest `staging`.

## Never

- Merge `staging` into `main`, push to `main`, or force-push.
- Edit the tickets, the plan or the BA's files to make a run pass.
- Kill an agent, or any process by name. The orchestrator kills only a stuck child command, by PID.
- Run agents yourself for the factory's work, or skip the orchestrator.

How it works inside, its files and its environment variables: [references/how-it-works.md](references/how-it-works.md).
