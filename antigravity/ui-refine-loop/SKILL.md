---
name: ui-refine-loop
description: Unattended check → fix loop that polishes the look of one existing page or component. It reads the target's code, asks the user at most 10 questions ("you pick" welcome) and writes the answers into a per-project taste and direction file, then runs bounded rounds through a workflow script - each round fresh checkers (a design reviewer and a detector that never see each other, then a checker that ranks typed problems) and a fresh fixer that chains the matching Impeccable commands, keeps the checks green or reverts, and commits. Screenshots cover before vs now, light and dark, 1440 and 390. A fresh finish reviewer grades every fix, and the loop ends in a draft pull request with a Before | After table; it never merges. Standalone - a person starts it, the factory team never runs it. Use when the user says "ui-refine-loop", "refine loop", "iterate on this page", "polish this page", "keep polishing", or wants a page that works but looks off tightened up without watching every edit.
argument-hint: "<route | component path | description> [\"<what's wrong / what we want>\"] [--rounds N] [screenshot paths…]"
---

# ui-refine-loop: check → fix, bounded

Impeccable's `critique` and `audit` find problems once, and each of its fix commands (`distill`, `layout`, `polish`, and the rest) fixes one kind once. This skill chains them into a short unattended loop. Each round, **fresh checkers** find and rank the problems, then a **fresh fixer** picks the right commands and lands one green commit. A short ledger is the only thing carried between rounds, because a checker that watched the last edits grades the intent, not the pixels.

```
/ui-refine-loop /dashboard/reports "the summary strip feels cramped"
/ui-refine-loop src/components/ReceiptViewer.tsx "mobile layout breaks under 400px" --rounds 3
/ui-refine-loop "the billing page plan cards" "too loud, make it calmer" ~/Desktop/billing.png
```

Rounds default to **5**. More rounds rarely pay: asking for more than 8 gets a one-line warning about cost and diminishing returns. In the paths below, `<main>` is this checkout, `<wt>` is the refine worktree, `<run>` is its run dir, and `<skill>` is this skill's folder.

It is **standalone**: only a person starts it. The `factory` team never runs it, because its first step asks the user questions and nobody answers during a factory run. The two fit one after the other: a factory `ux` spec builds behaviour test-first against criteria, and this loop then polishes how the result looks, which no acceptance criterion can pin down. It works on its own `refine/<slug>` branch from `HEAD` and ends with finish grades and a **draft pull request** for a person to review. It never merges: whether a page looks better is the user's call, not a check's.

The loop is run by a Python `run_workflow` script, so it needs the **`run_workflow`** tool. If this session does not have it, tell the user the loop cannot run here, before any setup. Do not run the rounds by hand with sub-agents: the isolation between the design reviewer and the detector, the stop rules and the revert rule hold only because code enforces them.

It refines an existing surface. A new page or a full redesign is not its job; anything that needs one comes back as an open question.

## 1. Read the target's code first

The prompt names where: a route, a component path or a description. Turn it into a **route** to screenshot and the **scope** paths the fixer may edit:

- **Route**: the page file that serves it (`app/**/page.*`, `pages/**`, `src/routes/**`, or whatever the framework uses), plus the component folders it imports.
- **Component path**: that file's folder. The route is a page that renders it (grep for its import), or its Storybook story.
- **Description**: search for it. Any screenshots the user pasted show which surface they mean.

Then **read that code area** before asking anything: the page, the components it renders, the shared UI it uses, the tokens and theme (including how dark mode works), and `PRODUCT.md` / `DESIGN.md` if they exist. Write a one-paragraph **context** for the sub-agents: what the surface does, its components, its tokens, its dark-mode mechanism. Use a sub-agent for this if it spans many files.

If two readings of the target are plausible, or target files are dirty in `<main>` (the worktree branches from `HEAD`, so uncommitted edits won't be in it), make that the grill's first question.

## 2. Grill (at most 10 questions)

Follow [`references/grill.md`](references/grill.md): numbered questions with your recommended answer under each, asked in waves. Wave 1 is 3 questions; later waves come only if needed, and the total is 10 at most. "You pick" accepts your recommendation. Don't ask what the code or an existing taste file already answers. Keep the answers for step 3.4.

## 3. Setup (once)

1. **Settings.** Run `bash <skill>/scripts/refine-setup.sh detect` from the repository root. It resolves the dev command, checks, env files, auth script, data states, taste file and Impeccable install from the project's `.agents/ui-refine-loop.json` (or `.gemini/ui-refine-loop.json`) if there is one, then `package.json`, then defaults ([`references/config.md`](references/config.md)). If `devCommand` is null, ask once (and suggest saving the answer as `dev_command` in that file).
2. **Impeccable detection.** Detect's `impeccable` field is `{layout, skillDir, version, detect, context}` or null. It handles both installs: v4.4+ ships a launcher (`scripts/impeccable detect --json`, `scripts/impeccable context`), and v4.0.x ships Node scripts (`node scripts/detect.mjs --json`, `node scripts/context.mjs`). It searches `.agents/skills/impeccable` and `.gemini/skills/impeccable` in this directory and every parent, then `~`. **If `warnings` is non-empty, show them to the user now, verbatim.** With no Impeccable, the loop runs on [`references/rubric.md`](references/rubric.md), the result carries `degraded`, and the pull request says so. It is never silent.
3. **Worktree, deps, server.** `slug` is the route or file in kebab-case.
   ```bash
   bash <skill>/scripts/refine-setup.sh up --slug <slug>
   ```
   This creates `<wt>` = `.agents/worktrees/refine-<slug>` on branch `refine/<slug>`, with `<run>` = `<wt>.run` beside it, so shots, auth state and logs never reach a commit. It records the base sha and base branch. It gives the worktree a node_modules: an APFS clone, else a reflink copy, else a frozen-lockfile install. It copies the env files, starts the dev server on a free port, and waits for `ready_path`. Exit 69 means the server never came up: read `<run>/dev.log`, fix it once, or tell the user. If the app can't run but the target has a story, set `dev_command` to Storybook with `--port $PORT --ci --no-open`; the route becomes `/iframe.html?id=<story-id>&viewMode=story`.
4. **Taste and direction file.** Write the grill's answers to `<wt>/<tasteFile>` as [`references/grill.md`](references/grill.md) § Output describes (from the neutral [`references/taste.md`](references/taste.md) if the project has none), and commit it: `[ui] <slug>: taste and direction`.
5. **Impeccable context.** With Impeccable, run `cd <wt> && <impeccable.context> --target <page or component file>` once and fold its directives into the context paragraph.
6. **Round-0 shots, for every data state** (from `states`, default `main`; never invent a dense dataset):
   ```bash
   cd <wt> && node <skill>/scripts/shoot.mjs --base <baseUrl> --route <route> --out <run>/shots --label round-0 \
     --states '<states JSON from detect>' [--auth <authScript>] [--env <first env file>]
   ```
   [`scripts/shoot.mjs`](scripts/shoot.mjs) writes `<label>-<state>-<desktop|mobile>-<light|dark>.png` at 1440 and 390, grown to the inner scroll height, plus light-theme **section crops** (`…-s<i>.png`, from `[data-refine-section]` or `main`'s sections). With `--compare round-0`, later rounds also get **before | after sheets** (`cmp-…png`). Read every image. A sign-in page or an error overlay means setup isn't done. Playwright must resolve from `<wt>`; if it doesn't, run `npx playwright install chromium` there.

## 4. The loop: the `run_workflow` script

Call the **`run_workflow`** tool with `ScriptPath` set to the absolute path of `workflow/ui-refine-loop.py` in this skill's directory, `Description` set to a short one-line summary, and `Args` set to the JSON object documented below: slug, target, scope, the brief verbatim (`prompt`), rounds, the absolute worktree/run/skill paths, `critic` and `impeccable` (detect's object, as-is), `tasteFile` (`<wt>/<tasteFile>`), checks, `shootCmd` (the step 3.6 command without `--label`), baseUrl, route, the context paragraph, the round-0 shots (every path printed, as `beforeShots`), the user's screenshots (`extraShots`), and detect's `warnings`. Invoking this skill is the user's opt-in to that workflow.

Each round:

1. **Check.** Two isolated sub-agents run in parallel: the **design reviewer** (Impeccable critique's Assessment A, scoring visual quality /20 across specificity, hierarchy, typography, color and composition) and the **detector** (Impeccable's detector plus the audit, /20). Neither sees the other. A fresh **checker** merges them into at most 8 **ranked, typed** problems and judges before vs now from the sheets. See [`references/checker-brief.md`](references/checker-brief.md).
2. **Fix.** A fresh **fixer** reads Impeccable's command table, the playbook for each command it runs, and craft-floor. It routes each problem by type ([`references/routing.md`](references/routing.md): cluttered → `distill`, bland → `bolder`, too loud → `quieter`, dull color → `colorize`, spacing/hierarchy → `layout`, type → `typeset`, mobile → `adapt`, slow → `optimize`, empty/first-run → `onboard`, confusing copy → `clarify`, edge cases and a11y → `harden`, motion → `animate`, personality → `delight`, drift or 3+ copies → `extract`), chains them, and always runs **`polish` last**. It keeps the checks green or reverts, makes one commit, and takes AFTER shots with `--compare round-0`. See [`references/fixer-brief.md`](references/fixer-brief.md).

The workflow appends a [ledger](references/ledger.md) line per check. The **score** is visual quality /40 (design /20 + audit /20) plus before/after (`better`/`same`/`worse`); Nielsen heuristics are not used. After the last fix round, a closing check scores the final state.

**Stop rules**, whichever comes first:

- N fix rounds have run (default 5), followed by the closing check.
- Two consecutive checks found no P0 or P1.
- Two fix rounds in a row were reverted.
- A sub-agent died.

**Finish review.** A fresh **finish reviewer** grades every claimed fix `fixed`, `partial` or `not-fixed` against round-0 vs final shots, and names up to three regressions ([`references/finish-reviewer-brief.md`](references/finish-reviewer-brief.md)).

**Budget.** A round is four sub-agents, with at most two at once (design reviewer and detector; only the reviewer may open a browser). Expect about 350–500k tokens and 15–25 minutes per round, so the default 5 rounds come to roughly 2–2.5M. Say so before starting when the user asked for more than the default.

## 5. Finish: draft pull request

1. Write the returned ledger to `<run>/ledger.md`, then `bash <skill>/scripts/refine-setup.sh down --run <run>`.
2. **Shots onto the branch.** Run
   ```bash
   bash <skill>/scripts/pr-shots.sh --worktree <wt> --run <run> --slug <slug> --final <finalLabel>
   ```
   It copies round-0 and the final round's `main` shots (1440 and 390, light and dark) to `<wt>/docs/ui-refine/<slug>/`, commits them, and prints a **Before | After** markdown table whose images are `https://github.com/<owner>/<repo>/raw/<sha>/…` links. Never upload shots to a public image host: a screenshot of the user's app is theirs to publish, not yours.
3. **Push the refine branch only:** `git -C <wt> push -u origin refine/<slug>`. Never push to the base branch.
4. **Pull request body**, written to `<run>/pr.md`, with these sections in this order:
   - **Status**: draft, the check commands and their result, the head sha. Open it with `> [!WARNING]` and the `degraded` line when the result carries one, otherwise with `> [!NOTE]`.
   - **Target and brief**: one line each, plus every entry of `warnings`.
   - **What changed**: the score line (`C1 22/40 → C2 27/40 (better) → …`) and one plain bullet per fixed problem.
   - **Finish grades**: a checklist, one line per graded fix (`id · severity · grade · evidence`). Checked means `fixed`; unchecked means still open, with why. List here too any problem still open after three checks and each open question.
   - **Rounds**: one row per check from the ledger (check, score, better/same/worse, commit).
   - **Before | After**: the table from step 2.
   - **Risk**: low, medium or high, with one line drawn from the regressions and the disposition, and a note that the shots live in `docs/ui-refine/<slug>/` (drop that commit before merging if unwanted; the links are pinned to a sha and keep working).

   Title, in the form of the loop's commits: `[ui] <slug>: <what got better>`.
5. **Plain words.** Short sentences, no hype, no "this PR aims to": say what changed and why. If the `humanizer` skill is installed, run the title and body through it.
6. Open it as a draft against `$(cat <run>/base-branch)`: `gh pr create --draft --base <base-branch> --head refine/<slug> --title "…" --body-file <run>/pr.md`.

## Report

Tell the user: the pull request URL, the stop reason, the score line, the grade counts (fixed / partial / not-fixed), the regressions, the open questions, and `degraded` and every warning if there were any. Leave the worktree in place for follow-ups and say where it is.

## Guardrails

- **Never merge. Never push to the base branch.** The only push is `refine/<slug>`, for the draft pull request. Never touch `<main>`'s working tree during the loop.
- The fixer edits outside scope only with a stated reason, and changes a shared component only behind a new prop that defaults to today's behaviour.
- A fix round that can't get every check command green is reverted, never committed red.
- No auth script means no sign-in. No dense fixture means no dense shots. Never fabricate either.
- Impeccable missing means a loud warning and the rubric, never a silent fallback.
