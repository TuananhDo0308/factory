---
name: f-polish
description: Standalone post-delivery polish for Software Factory v2 — either tighten visual craft on one specific screen (with 1440/390 light/dark before-after screenshots) or run a bounded garbage-collection refactor/dedupe micro-PR outside the main build loop.
---

# `/f-polish` — Optional UI Polish & Code Garbage Collection

Runs **outside** `/f-run` once a feature works, on its own branch (`polish/<slug>`), ending in a small draft PR.

## Modes

1. **Visual Polish (`--ui <route-or-component>`):**
   - Capture before screenshots (1440px & 390px, light & dark).
   - Run up to 2 bounded Evaluator ➔ Builder visual refinement rounds targeting layout hierarchy, spacing, typography, and micro-interactions.
   - Verify all project checks remain green and present a Before | After screenshot comparison in a draft PR.
2. **Code Garbage Collection (`--gc [path]`):**
   - Scan recently merged tracks for duplicated helpers, dead code, or overly long files (>300 LOC).
   - Refactor cleanly with zero behavior change, confirm full tests + typecheck + build pass, and open a small reviewable micro-PR.
