---
name: f-run
description: Run a planned Software Factory v2 batch in parallel worktrees using the zero-dependency Node orchestrator (state.json resume, APFS clone, fail-fast script gates, Anti-Bloat Guard, Pre-Merge Queue, and Blind 4-axis Evaluator QC).
---

# `/f-run` — Parallel Factory Orchestrator

Run a planned batch (`.factory/batches/<batch-id>/batch.json`) end-to-end on local `staging`, then optionally push and open a single Pull Request into `main`.

## Command

```sh
node <this-skill>/orchestrator/index.mjs \
  --repo <absolute-repo-path> \
  --batch <batch-id> \
  --engine <antigravity|claude> \
  --concurrency 3 \
  --max-retries 2
```

### Key Flags

- `--engine antigravity | claude`: Choose which headless CLI adapter executes Builder, Reviewer, and Evaluator turns (default to `antigravity` when invoked from Gemini Antigravity, or `claude` when invoked from Claude Code, unless the user requests the other).
- `--concurrency <n>`: Max parallel worktrees (default `3`).
- `--pause-wave0`: Pause after Wave 0 merges into `staging` for an Early Visual Check before launching Wave 1+ parallel tracks.
- `--approve-wave0`: Mark Wave 0 approved and resume Wave 1+.
- `--resume`: Resume an interrupted or `needs_decision` batch from `.factory/batches/<batch-id>/state.json`.
- `--push --pr`: Push `factory/<batch-id>` and open one PR to `main` ONLY after local gates + Blind Evaluator pass.

## What You Do

1. Confirm `.factory/batches/<batch-id>/batch.json` exists. If not, direct the user to `/f-plan` first.
2. Start the Node orchestrator (`index.mjs`) directly — never coordinate Builder/Reviewer/Evaluator by hand.
3. When it finishes, read `.factory/batches/<batch-id>/report.md` and `state.json`, and report status, wall clock, cost, UI/UX 4-axis scores, PR URL (if opened), or any `needs-decision` items clearly to the user.
