# Software Factory v2

Lean, parallel, verification-first AI Software Factory powered by a **zero-dependency Node.js orchestrator** (`state.json`) with pluggable engine adapters (`claude`, `antigravity`, `mock`).

## Core Principles

1. **2 main commands, 5 sharp AI roles:** `/f-plan` (`BA/Architect` + `UI Designer` + `Evaluator/Critic`) ➔ `/f-run` (`Builder` + `Reviewer` + `Evaluator/Blind QC`). Auxiliary: `/f-init`, `/f-polish`.
2. **Code owns the skeleton, AI owns judgment:** Preflight, worktrees, APFS `node_modules`/cache cloning, fail-fast checks, ownership (`owns`), Anti-Bloat Guard, Pre-Merge Verification Queue, watchdog, and `state.json` resume are 100% deterministic Node.js.
3. **Natural parallel tracks:** Wave 0 (Foundation + Shell + Contracts) ➔ Wave 1..N (up to 3 parallel worktrees on naturally disjoint files) ➔ Pre-Merge Queue (verifies before advancing `staging`, so `staging` never breaks) ➔ 1 Blind Evaluator QC pass (Playwright script Holdout + 4-axis Anthropic UI/UX vision scoring).
4. **Harness-first quality:** Golden Templates pre-install `shadcn/ui`, `lucide-react`, `happy-dom`, `@testing-library/react`, and Playwright so agents never hand-roll fake DOMs or raw unstyled forms.

## Layout

```text
factory-v2/
├── templates/
│   └── nextjs-shadcn/       Golden template (Next.js + shadcn/ui + lucide + happy-dom + RTL + Playwright)
├── skills/
│   ├── f-plan/              /f-plan: detect/bootstrap, BA, UI Designer prototype, Design Critic, validate-batch
│   ├── f-run/               /f-run: Node orchestrator, engine adapters, worktrees, gates, merge queue, roles
│   ├── f-init/              /f-init: brownfield harness onboarding (reuses factory/scripts/)
│   └── f-polish/            /f-polish: optional post-delivery UI polish & refactor micro-PR
├── benchmarks/
│   └── todo-app/            Ready-to-run parallel batch + holdout for A/B benchmarking
└── tests/                   Automated node --test suite (unit + real-git parallel integration)
```

## Quick Test

```sh
cd /Users/tuananhdo/factory/factory-v2
node --test tests/*.test.mjs
```

## Run a Batch

```sh
node skills/f-run/orchestrator/index.mjs \
  --repo /path/to/repo \
  --batch 2026-11-26-todo-app \
  --engine claude \
  --concurrency 3
```
