---
name: f-init
description: Onboard an existing (brownfield) repository to Software Factory v2 in ~2 minutes by reusing deterministic scanners (detect-stack, scan-ui, find-routes), verifying Playwright + test DOM readiness, picking 1-2 clean Exemplar files, and writing only 3 concise harness files (AGENTS.md <=150 lines, .factory/harness.json, .factory/design.md).
---

# `/f-init` — Brownfield Harness Setup

Called automatically on first `/f-plan` in an existing codebase, or run manually to onboard a repo for the team. For empty (greenfield) repos, skip `/f-init` — `/f-plan` selects a Golden Template automatically.

## Steps

1. **Scan deterministically (reuse v1 Node scanners when present under `antigravity/factory/scripts/`):**
   - `detect-stack.mjs`: detect package manager, stack, and exact CI/test/lint/typecheck/build/dev commands.
   - `scan-ui.mjs` & `find-routes.mjs`: catalog existing UI components and routes so `UI Designer` and `Builder` reuse real components instead of duplicating them.
2. **Check missing agent tooling (fail loud if missing):**
   - Web/React repos MUST have `happy-dom` (or `jsdom`) + `@testing-library/react` and launchable Playwright Chromium. Tell the user clearly if any is missing and install once approved.
3. **Pick 1–2 Exemplars:** Choose the cleanest existing source component + test file in the repo as style exemplars.
4. **Write ONLY 3 concise files (no sprawling docs):**
   - `AGENTS.md` (≤ 150 lines): repo map, commands, 5–8 positive coding principles, pointer to exemplars.
   - `.factory/harness.json`: commands (`lintChanged`, `lint`, `typecheck`, `testFiles`, `test`, `build`, `start`, `e2e`), `hasUi`, `exemplars`, `protectedPaths`, `antiBloat` thresholds.
   - `.factory/design.md` (~60–80 lines, UI repos only): visual tokens, component reuse list, typography & layout rules.
5. **Verify Preflight:** Run `f-run/orchestrator/preflight.mjs` + `test` + `build` to confirm green before finishing.
