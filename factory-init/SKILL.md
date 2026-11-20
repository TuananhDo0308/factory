---
name: factory-init
description: Set a repository up for the factory, once - check first whether it already is (one command, so a repeat costs nothing), then scan it to tell a new project from an existing one, read its stack, design and README, ask the person only what the files do not say, capture the screens an existing app already has, find and install the best vetted skills for its stack, and write .factory/ (project profile, product, decisions, design, UI store) so /factory runs can start. Use when the user says "factory init", "/factory init", "set up factory", "onboard this repo to the factory", or runs the factory in a repository with no .factory/project.json, even if they do not name this skill.
---

# Factory init

You set a repository up so that factory runs can build in it without guessing. A factory run's agents never meet the person: what they need to know about the product, the stack, the look and the defaults must be written down before the first run. You find out as much as you can from the repository, ask the person the rest, and write it into `.factory/`, `CLAUDE.md` and `.claude/skills/`. You do not build features.

The scripts are in the factory skill's `scripts/` folder, next to this skill: `<factory>` below is that skill's directory (`~/.claude/skills/factory`, or wherever it is installed). Every script reads; only `init-skeleton.mjs`, `capture-screens.mjs` and `stack-skills.mjs` write, and only inside the repository.

## How you ask

Ask in waves of at most three questions, the ones whose answers change the most first. Number them, and put your recommended answer under each, marked as your suggestion, so the person can answer "yes" or "you pick". Never ask what the files already answer; say what you found instead and ask them to correct it. When the person does not know, write the question under **Open** in `product.md` and move on: an unknown is recorded, never invented. Every answer that settles a rule goes into `decisions.md` as one line with its source (`init <date>`).

## 0. Check whether it is already done

**Before you read, scan or ask anything**, run:

```bash
node <factory>/scripts/init-status.mjs .
```

It costs one command and reads no code. What it prints decides how much of this skill runs:

- **`complete`**: tell the person in one line that the project is already set up and current, and stop. Read nothing else. Redo a step only if the person asked for it by name ("redo the design", "rescan the components"), and then only that step.
- **`partial`**: an init was started and stopped, or the profile was written by hand. Do only the steps it lists under "left to do", in the order of this skill; skip the rest.
- **`stale`**: the files some steps were based on changed since they were done. Redo only those steps, and do as little as each needs: `catalog` is `scan-ui.mjs` again (no questions, unless it finds a new duplicate); `stack` is `detect-stack.mjs` again, showing the person only what differs from `project.json`; `design`, `product`, `skills` and `defaults` show what changed and ask only about that.
- **`none`**: a first init: all of it.

After each step below, record it: `node <factory>/scripts/init-status.mjs . --mark <step>`, with the step's name in brackets in its heading. A stopped init then resumes where it stopped, and a later one knows what each step was based on. Commit `.factory/init.json` with the rest of the setup.

The repository must be a git repository; if it is not, ask whether to run `git init`. Unless the state was `complete`, note the current branch, then `git switch -c factory/init` (or reuse it if it exists), so nothing lands on the branch until the person merges the setup.

## 1. Scan

Run, from the repository root, and keep the outputs in your scratchpad:

```bash
node <factory>/scripts/detect-stack.mjs .  > <scratch>/stack.json
node <factory>/scripts/detect-design.mjs . > <scratch>/design.json
node <factory>/scripts/find-routes.mjs .   > <scratch>/routes.json
```

Then read the README, `CLAUDE.md` or `AGENTS.md`, `PRODUCT.md`, anything under `docs/`, and any brief the person gave you. Tell the person in one short message what you found: new or existing, the stack and commands, the design sources, the screens, what the README says the product is. `stack.json`'s `isNew` decides the path: **A** when there is product code, **B** when there is none.

## 2A. An existing project

1. **Stack** [`stack`]. Show the detected languages, frameworks, package manager, test runner, linter, CI and the commands for test, typecheck, lint, build and e2e. Ask the person to correct them, and ask what the scans cannot see: how to start the app for someone using it (`run.start`, which must take a free port), whether it needs a sign-in (and a test account; write a sign-in script to `scripts/test-login.mjs` in the shape `ui-refine-loop/references/config.md` describes, with test credentials from the project's own example env file, never the person's real ones), test data (`run.seed`), and the env file with test values. Ask also for two commands the factory uses to check its own work, when the stack has them: `testFile`, which runs only the test files given in `{files}` (for example `pnpm exec vitest run {files}`; `detect-stack.mjs` guesses it), so a run can show that new tests fail without the change; and `migrate` with `rollback`, against the test database, so a change with a migration is run up, down and up again. Run each command once; one that fails is fixed with the person or left out, never kept failing.
2. **Product** [`product`]. If the README or `PRODUCT.md` says what the product is, summarise it back and ask what is wrong or missing. Otherwise ask the questions in [references/intake-questions.md](references/intake-questions.md) that matter for building features (users, main journeys, rules, what is out of scope); skip the ones about budget and launch. Write `.factory/product.md` (or keep the root `PRODUCT.md`) from [references/product-template.md](references/product-template.md).
3. **Design** [`design`, and `catalog` once `scan-ui.mjs` ran and its duplicates are settled]. Look at `design.json`.
   - **Design found** (tokens, a design doc, Storybook, Figma, Penpot or Claude Design links): ask which one is the source of truth. For Figma or Penpot, ask whether to connect (their MCP server, or an access token for the REST API) to export the frames of existing screens as PNG into `.factory/design/ui-store/` and the variables into `.factory/design/tokens.json`; never paste a token into a file in the repository. For Claude Design, the person can export HTML or use its handoff to Claude Code, or `/design-sync` for a design system; it runs in the cloud, so what agents use must be copied into the repository.
   - **Catalogue the UI from the code first**, design found or not, because it is what new screens are built from: `node <factory>/scripts/scan-ui.mjs .` writes `.factory/design/ui-store/catalog.md` and `catalog.json`: the UI libraries, every component with its props, variants and how often it is used, the file to copy for each pattern (a form, a table, an empty state, a dialog, a page shell), and the components nobody uses. Agents reuse what it lists instead of drawing look-alikes.
   - **Settle the duplicates.** For each set of components that do the same job (`Button` and `PrimaryButton`, `Modal` and `Dialog`), show the person both, with how often each is used, and ask which one new code must use; recommend the one built on the project's tokens and library, usually the most used. Write each choice into `preferred` in `catalog.json` (`{ "button": "components/ui/button.tsx#Button" }`), rerun `scan-ui.mjs` (it keeps the choices), and add each to `decisions.md`. Offer a lint rule (`no-restricted-imports`, or the stack's equivalent) that stops new imports of the others; the person decides.
   - **Screenshots are optional**, for people rather than for agents: they show reviewers and the client how the app looks today, and give QC a picture to compare with. Ask whether to take them now. If yes, start the app as `run.start` says and run `node <factory>/scripts/capture-screens.mjs --repo . --routes <scratch>/routes.json --start "<run.start>" --port <free port> [--auth scripts/test-login.mjs] [--values '<json>']`. Ask the person for a real value for each dynamic route (`/orders/[id]` → `/orders/1`) and for the screens a file-system router cannot see. It needs Playwright in the project and the `ui-refine-loop` skill installed next to the factory; if either is missing, say so and ask whether to install Playwright as a dev dependency.
   - **Write the design down from what exists**, not from taste, using the catalogue and, when taken, the screenshots: `DESIGN.md` from [references/design-template.md](references/design-template.md), with the colours, type, spacing and components the code and the screenshots actually use, and `tokens.json` (W3C design tokens) extracted from the Tailwind theme, CSS variables or UI-library theme the scan found, or `design.tokens` pointing at that file when the person wants it to stay the source. Show both to the person before saving.
   - Recommend, and ask: keep the tokens and the UI store in the repository as the source of truth; Storybook as the catalogue of components if the project has none and the person wants one; Figma or Penpot as the place designers work, exported into the repository.
4. **Skills:** step 3.

## 2B. A new project

1. **Requirements** [`product`]. Read the README and any brief. Summarise what it asks for, then ask the gaps with [references/intake-questions.md](references/intake-questions.md), in waves. Propose the smallest first version that real users could try (one or two journeys done end to end) and what waits; the person decides. Write `.factory/product.md` from [references/product-template.md](references/product-template.md) and the rules into `decisions.md`.
2. **Stack** [`stack`]. Propose two or three stacks that fit what `product.md` says (users, numbers, constraints, who maintains it): for each, the pieces, why it fits, the cost to run, who can maintain it, its main risk; recommend one. When the person chooses, write `docs/adr/0001-stack.md` from [references/adr-template.md](references/adr-template.md), create the project with the framework's own starter (not a layout you invent), add one passing test, a type check, a linter, a build, CI running exactly those commands, `.env.example` with test values, and a one-command way to start it. Run every command; all must pass before you go on.
3. **Design** [`design`; `catalog` once the first components exist and `scan-ui.mjs` ran]. Ask whether there is a brand already (logo, colours, fonts, guidelines) and whether the team uses Figma, Penpot, Claude Design or nothing. Recommend: tokens in the repository (`.factory/design/tokens.json`) as the source of truth, wired into the stack (CSS variables or the framework's theme); Figma or Penpot if designers will work on it, Penpot when it must be self-hosted; Claude Design to explore directions with the person. With no brand, make two or three directions, each a palette, a type pairing and one MVP screen built as an HTML page from its tokens and screenshotted, and let the person choose. Write `DESIGN.md` from [references/design-template.md](references/design-template.md) and `tokens.json` from the choice.
4. **Skills:** step 3.

## 3. Skills for the stack [`skills`]

The team's process skills (`tdd`, `mp-code-review`, `pr-security-review` and the rest) are installed by the factory itself. Here you add the stack's own, into `.claude/skills/` of the repository, where Claude Code loads them for everyone who works on it.

1. `node <factory>/scripts/stack-skills.mjs plan --stacks <the stack's names, plus web-ui if it has screens>` gives the vetted skills from the catalogue, per role, and the stacks with none.
2. For each stack with no vetted skill, and each where the person wants better: `node <factory>/scripts/find-skills.mjs --stack <name>` lists candidates from GitHub, ranked (the stack's maker and Anthropic first, then stars, freshness and licence), each with the exact commit. **Read each candidate's `SKILL.md` at that commit** (`gh api repos/<source>/contents/<path>/SKILL.md?ref=<commit>`) before you propose it: say what it teaches, whether it is for building apps with the stack or for developing the stack itself (a framework's own repository often has the latter), and anything in it that asks the agent to run, fetch or send something. Propose at most two per stack, with their role (implementer, QA, reviewer, QC, planner).
3. Install only what the person approves: `stack-skills.mjs install --repo . --stacks …` for catalogue skills, `stack-skills.mjs add --repo . --name … --source owner/repo --commit <sha> --path …` for one found by search. A skill is a prompt every agent that loads it obeys: never install one nobody read, and never at a branch instead of the commit read.
4. A stack with no good skill gets its conventions in `CLAUDE.md` instead (step 4).

## 4. Write it all down

1. `node <factory>/scripts/init-skeleton.mjs . --stack <scratch>/stack.json --design <scratch>/design.json` lays out `.factory/` (keeping anything that exists) and writes `.factory/project.draft.json`.
2. Complete the draft with the answers and save it as `.factory/project.json`: commands, `run`, `skills` per role as installed, `design`, `docs`, `escalate` (ask which kinds of change need a person before merging; default all), `protectedPaths`. Remove `$comment` and empty fields.
3. [`defaults`] Create or extend `CLAUDE.md` from [references/claude-md-template.md](references/claude-md-template.md): run, checks, layout, the patterns to copy (with a file to copy from), and the **project defaults** (page size, date and number formats, time zone, how errors are shown, deletion, names, default access). Ask the person for each default the code does not already show; each one written saves a run from stopping to ask.
4. If the project has screens, ask whether to add a `tokens` check (a lint rule or script that fails on colours and sizes written outside the tokens) to `commands`; it is the check that keeps new screens on the design.
5. Ask before anything that reaches GitHub: the factory labels (`bash <factory>/scripts/factory-issue.sh labels`) and, if the person wants issues built automatically, the dispatcher (`<factory>/github/README.md`).

## 5. Check, then hand over [`check`]

Run `node <factory>/scripts/project-check.mjs . --run`. Fix every problem with the person until it prints that the project is ready, then mark `check` and run `init-status.mjs .` once more: it must say `complete`. Commit the setup on `factory/init` (only the files you wrote, by path), and ask whether to push it and open a pull request; screenshots of the app are the person's to publish, so if the repository is public, say so before pushing them.

## Report

New or existing; the stack and the commands, each with its result; what the product is in one sentence; the design source, the screens captured and those skipped (with why); the skills installed per role, and the stacks left to `CLAUDE.md`; the defaults written; everything still under **Open**; the branch or pull request; and what comes next: write an issue (`ba-ticket`), then `/factory #<n>`.
