---
name: f-plan
description: Single entry point before building with Software Factory v2. Auto-detects greenfield vs brownfield repos, clarifies requirements & aesthetic direction, generates a UI Code Prototype filtered by Design Critic, cuts naturally parallel tracks (batch.json), generates hidden Holdout Scenarios (holdout.md), and validates everything deterministically.
---

# `/f-plan` — Plan, Prototype & Parallel Batch

The single user-facing step before `/f-run`.

## Steps

1. **Detect Repo (`scripts/detect-repo.mjs <repo>`):**
   - `initialized`: Check `existingProduct`. If the user's new request is for a *different* product, ask whether to reset `.factory/design.md` and `AGENTS.md` before continuing.
   - `brownfield-uninit`: Run `/f-init` workflow once (~2 min) to scan stack/UI/routes, pick 1–2 Exemplars, write `AGENTS.md` (≤ 150 lines) + `.factory/harness.json`, and run preflight.
   - `greenfield`: Proceed to Step 2, then pick a Golden Template (`nextjs-shadcn` or `node-api`) and run `scripts/bootstrap.mjs <repo> <template>`.
2. **Clarify & Taste Anchor (at most 2 short waves, ≤ 4 questions/wave with recommended defaults):**
   - Lock core scope, data persistence, critical edge cases, and **visual direction** (either user's reference screenshot/product name, or 3 genuinely distinct aesthetic options).
3. **Prototype (when the task has UI):**
   - Run `UI Designer` (`roles/ui-designer.md` + `frontend-design` skill) to build `/_preview/page.tsx` (when `shadcn/ui` is present) or `.factory/batches/<id>/prototype/index.html`.
   - Capture screenshots with `scripts/shoot-prototype.mjs` (1440px & 390px, light & dark).
   - Run `Design Critic` (`roles/design-critic.md`) on the screenshots; if any check < 4/5, run 1 automatic polish pass before showing the user.
   - Present the live prototype & screenshots to the user. Iterate in 30–60s turns until approved, then copy final shots to `prototype/approved-1440.png` and `prototype/approved-390.png`.
4. **Cut Natural Parallel Tracks & Write Hidden Holdout:**
   - **Wave 0 (Foundation):** Shared layout shell, design tokens, core types/interfaces/schema (no feature sprawl).
   - **Wave 1 (Parallel Tracks — max 3):** Split along natural boundaries (multi-page: by route/domain; single-page: e.g. Store/Logic vs Sidebar/Dialogs vs Main Workspace). Never invent fake plugin-slot registries just to force parallelism.
   - **Wave 2 (Wiring — optional, Size S):** Thin glue connecting Wave 1 modules into the root page.
   - Write `.factory/batches/<id>/batch.json` and `.factory/batches/<id>/holdout.md` (hidden end-to-end user scenarios that Builder NEVER sees).
5. **Validate & Export:**
   - Run `node <this-skill>/scripts/validate-batch.mjs <repo>/.factory/batches/<id>/batch.json` (must exit 0).
   - Summarize the batch (waves, tracks, parallel speedup, criteria `C1..Cn`) and ask the user to run `/f-run <batch-id>`.
