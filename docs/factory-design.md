# new_factory: factory design (final v2)

Settled on 2026-11-26. v2 incorporates an independent review (12 points). The BA side is the `new-ba` skill.

## Why a rewrite

The todo app took about 5 hours. The BA split it into 4 sequential issues, and each issue carried about 40 minutes of fixed overhead: the planner split specs by layer, so they ran one after another; each criterion had 4–5 graders; there was a recorder agent and a checker agent; QC clicked through by hand with Playwright MCP. There were zero fix rounds, so the slowness came from the process, not from fixing bugs.

There was another root cause: the old factory ran inside a Workflow script, and a Workflow script **cannot read or write files, run git or commands, or tell the time** (the old code says: "A script cannot write files, so a small agent writes the dashboard's progress"). So everything that should have been a script had to become an agent.

## Principles

- The process scales with each ticket's size (S/M/L) and with the number of tickets in the batch.
- The BA designs how the work splits to run in parallel. The factory only executes the plan: it does not re-cut it and **does not split tickets into specs**.
- Anything that can be done deterministically is done by **real code**, not by an agent.
- No dead ends: every failure gets a diagnosis and a next step; one stuck ticket does not block the batch.
- Claude only. No compatibility with the current Software Factory is required.
- **No change may add time to the normal path** (see the table at the end). Extra cost is allowed only when something fails.

## Runtime architecture

- The `new_factory` skill (in Claude Code) does only two things: start the orchestrator and report the result.
- **The orchestrator is a Node program** (`orchestrator/run.mjs`), not a Workflow script. It:
  - keeps all state in `.factory/runs/<id>/state.json`;
  - calls Claude for each agent step with `claude -p` (headless, `--output-format stream-json`, model chosen by size, `cwd` set to the ticket's worktree), and writes each agent's log to a file;
  - does in code: git (worktree, diff, merge, revert), running checks, checking tests per criterion, assigning ports, alarms when stuck, timing, cost, the dashboard, and comments and labels on GitHub (`gh`).
- **Resuming after a crash:** run the same command again. The orchestrator reads `state.json` and continues from the first unfinished step. Every step with side effects checks state before acting, so nothing happens twice (a recorded merge sha X is skipped; a comment whose marker already exists is not posted again).

## Input

An epic number on GitHub. **The tickets are the single source of truth.** The plan (Owns, Uses, Depends on, Size, Wave) is read from the tickets themselves; the JSON block in the epic is only a summary.

## Pipeline

0. **One batch at a time on `staging`.** A batch started while another is running is queued, and starts from the latest `staging`.
1. **Read and check the plan.**
   - The epic and every ticket must carry the `ready` label; otherwise the run is refused and the report says which tickets lack it.
   - Read the tickets from GitHub, build the plan, and always run `check-batch` (a few seconds, no tokens). On failure, stop and report the exact error so the user can fix it by hand. Re-running the BA is not required.
   - Save a snapshot of the tickets used into `state.json`. If it differs from what the BA created (by hash), the report says "ticket #12 changed after the BA".
2. **Prepare once for the whole batch.**
   - Take the check commands from the plan's `architecture.checks` (written by the BA; for a new repository they are also the foundation ticket's criteria). For an existing repository whose plan has none, read them from `package.json`/CI.
   - **No `staging` branch yet:** ask the user, then create `staging` from the default branch.
   - **Empty repository** (`architecture.layout` is `pages-features`; no code yet): ask the user, then create the first commit and the `staging` branch. For a repository that already has code, the factory changes nothing about its structure. For an empty repository, the steps that need a running app (installing dependencies, cloning `node_modules`, checking two servers and the browser) move to **after the foundation merges**, before the first wave-1 ticket starts. The foundation runs alone anyway, so this costs no time.
   - **New dependencies:** the orchestrator collects every `newDependencies` the tickets declared and adds them to `package.json` on `staging` in one commit. Implementers may not run `add`/`install` for new packages themselves.
   - **Prototype:** if the plan has a `prototype`, copy `git archive <commit>` of that branch into `path` on `staging` once, in the same commit as the new dependencies.
   - Install dependencies **once** in the main checkout. Each worktree gets a copy of `node_modules` through a copy-on-write clone (`cp -c` on APFS, a few seconds) or the pnpm store, plus its own cache directory. No worktree writes into another worktree's `node_modules`.
   - **Pre-checks for QC:** a browser is available, the app starts, and the dev server and test runner read `PORT`/`BASE_URL` from the environment (try starting two servers on two different ports). Anything missing is reported now, not discovered at the end of the batch.
3. **Schedule by the dependency graph**, without waiting for whole waves.
   - A ticket whose dependencies have all merged starts immediately. Waves are for display only.
   - At most about 4 tickets at once. Each ticket has its own worktree, `PORT` and cache directory.
   - A ticket starts from the current HEAD of `staging`, which already has every ticket it depends on.
   - **Each ticket's base** is the merge-base of its branch and `staging` (`git diff staging...<branch>`), not the batch's first commit. Every comparison in step 4 uses this base, so it stays correct after resuming in step 7.
4. **The factory for each ticket:**
   - a. **One implementer**: no planner, no spec. **Write the code normally (no TDD)**, then the tests: each criterion has at least one test (unit or e2e). Edit only within Owns. A ticket's Owns automatically includes its own test locations (e.g. `e2e/<ticket>/**` and tests next to the code). Each test carries its criterion ID in its name (e.g. `C5`; IDs are unique across the batch).
   - b. **Checks in code** (run by the orchestrator, no agent):
     - the project's checks; e2e runs with the **Playwright CLI** on its own `PORT` and never reuses an existing server;
     - the diff against Owns, taken from the **commits** relative to the base (handles deleted and renamed files; ignores `__pycache__`, `.gitkeep` and files generated by checks). Edits outside Owns go to 4d as "ticket lacks room";
     - **tests per criterion** (under a second, runs nothing extra): every criterion of the ticket has at least one test tagged with its ID, and that test has a real assertion (`expect`/`assert`). A gap goes back to the implementer as a normal failure;
     - `package.json` and the lockfile are ignored in the Owns check, but only for declared dependencies. An undeclared dependency is an error;
     - processes are killed only by recorded PID, never with `pkill` by name.
   - c. **Reviewer by size** (see the table). For M and L, the reviewer also reads the tests: do they test the right criterion, do they mock so much that they test nothing; an empty test is a failure sent back to the implementer. An S ticket whose diff touches shared files (the foundation ticket's files, the registry) is promoted to M.
   - d. **Fixing and escalation.** Rounds 1–2: a fresh implementer gets the list of failures. After 2 rounds, a diagnosing agent puts the failure into one category:
     - hard code: round 3 uses a stronger model (S → Sonnet, M → Opus, L → Opus at maximum effort, or Fable), with the diagnosis;
     - ticket lacks room: the orchestrator's **lock table** checks whether any running, waiting or unmerged ticket holds the file that needs editing. If it is free, lock it, widen Owns and run round 3. If it is held:
       - the holder **depends (directly or indirectly) on the ticket that needs it**: hand the lock to the ticket that needs it. No risk, since the holder only runs after this ticket has merged;
       - the holder is `needs-decision`: the ticket that needs it also becomes `needs-decision` with the reason "waiting on #X", and counts as "not delivered";
       - otherwise: wait for the holder to merge, then run round 3 from the new `staging`. Before waiting, check the wait graph for a cycle; on a cycle, go to `needs-decision` at once instead of waiting forever.

       The foundation's contract files may only be **added to**, never changed where they already exist;
     - wrong grader (not for S): re-run the checks and add a second, independent reviewer to arbitrate;
     - conflicting or ambiguous requirements: go straight to `needs-decision`.

     **Overall limit:** each ticket gets at most 4 fix rounds across the whole batch, including rounds sent back by post-merge checks or QC. Past the limit it becomes `needs-decision`, so QC and fixing never loop forever.

     **`needs-decision`**, not failure: keep the code branch, comment the diagnosis on the issue with one concrete question, and add the `needs-decision` label. The rest of the batch keeps running; tickets that depend on it (directly or indirectly) wait and are reported as "not delivered".
   - e. **No timeouts. Alarm when stuck, with the reason.** Agents are never killed. The orchestrator watches each agent's log stream; after 30 minutes without progress it acts by cause:
     - a command that never exits (a dev server in the foreground, tests in watch mode, a command waiting for y/n): **kill exactly that child process** by PID; the agent gets an error result and carries on; then raise an alarm;
     - an API error or rate limit: wait and retry, then raise an alarm;
     - looping, a locked port or resource, or unknown: alarm only.

     An alarm includes: ticket, step, agent, how long it has run, the reason, what was already done about it, and the last 20 log lines. It is sent as a push notification and as a comment on the ticket's issue.
5. **Merge in code, straight into `staging`.**
   - A passing ticket merges immediately with `--no-ff` (each ticket is one merge commit, revertible with one command). Merges are queued one at a time. Normal 3-way merge; a real conflict (rare, since Owns are disjoint) goes into a fix round.
   - Generated files (the lockfile) are not merged but regenerated after merging. **Snapshots are never regenerated automatically**: a changed snapshot is a bug to fix. A ticket that wants a new dependency must declare it up front.
   - **Name clashes** (routes, storage keys, shortcuts) surface through the foundation's registry test: each feature declares its own names and the registry fails on duplicates. CSS is scoped per feature. No separate script is needed.
   - **Post-merge check:** runs once when a ticket is waiting on the code that just merged (i.e. before a dependent ticket starts). It covers typecheck, build, unit and e2e; lint/format are skipped. If no ticket depends on it, it does not run here, because step 6 runs the full check on the final `staging`.
   - **On a post-merge failure, find the culprit in code:** run only the failing test files (fast), then bisect by merge order, running only those files each time. The failure goes to the ticket whose merge caused it, naming both the culprit and the affected ticket. Only if no culprit is found does it go to the ticket that owns the failing test file.
6. **QC exactly once**, when every ticket is done (merged or `needs-decision`), on `staging`.
   - It starts with **one full check** on the final `staging`: typecheck, build, unit, e2e. This is the only time the merged code of the last tickets is typechecked and built together (e2e runs through the dev server, without a typecheck). On failure, find the culprit as in step 5. E2E results are reported **per criterion** (e.g. `C5`) from the tests' tags.
   - One agent uses the app through Playwright MCP to smoke-test the main flows and check the criteria that have no e2e.
   - QC covers only merged tickets. `needs-decision` tickets and those that depend on them are listed as "not delivered", not counted as failures.
   - A failure goes back to the ticket that owns the criterion (fixed as in 4d). After the fix: re-run all checks; QC re-checks only the criteria that failed.
   - A ticket that becomes `needs-decision` **after it merged** is **reverted automatically** by the orchestrator (with any dependent tickets that merged) from `staging`; the revert commit's sha is recorded in `state.json`, then the checks run again. `staging` holds only code that passed QC.
7. **Report to the user**: delivered tickets, `needs-decision` tickets with their questions, and what changed after the BA. The factory never touches main; the user checks `staging` one last time and decides when to promote it to main.
   - **When the user answers a `needs-decision` ticket:** run the orchestrator again for that batch. It continues that ticket, then its dependents, then the post-merge check, then QC for their criteria.
     - A ticket that **never merged**: merge the latest `staging` into its branch and continue.
     - A ticket that **was reverted** (along with its reverted dependents): do **not** merge `staging` into the old branch, since that would apply the revert commit and delete the ticket's code. Instead, create a new branch from the latest `staging`, run `git revert <sha of the revert commit>` to bring the code back, and continue from there.
8. **Measure and report in code:** time per step, cost, each ticket's status, the dashboard. There is no recorder agent.
   - **Repository map** (only for an empty repository with `layout` `pages-features`; a repository that already has code does not get this file): in the report step, a script generates `docs/ARCHITECTURE.md` from the plan: a table of page → feature → folder → issue → criteria → contracts used. It is written to `staging` in a separate orchestrator commit. No agent writes this file.

A batch with a single ticket: no scheduling; it runs straight through and merges into `staging`.

## Sizing

The BA writes `size`. The factory re-checks it in code (number of criteria, number of Owns files, number of new routes or pages, number of prototype screens covered, auth/money/migrations) and only ever raises it, never lowers it. The size is the higher of scale and risk.

| | S | M (default) | L |
|---|---|---|---|
| Examples | Copy change, config, small bug, ≤3 criteria | A normal feature | A complex new screen, or auth/money/migrations |
| Implementer | 1 agent does everything, light model | Sonnet | Opus |
| Checks in code | Yes | Yes | Yes |
| Reviewer | None (promoted to M if the diff touches shared files) | 1 | 1 Opus + security review |
| QC | Final QC | Final QC | Final QC |
| Target time | 5–10 min | 15–20 min | ~30 min |

## Effect of v2 on run time

| Change | Normal path | Only on failure |
|---|---|---|
| Node orchestrator instead of Workflow | **Faster**: checks, diff, merge and dashboard are code, no agents needed | Resume from the unfinished step without re-running finished ones |
| Scheduling by dependency graph | **Faster**: no waiting for whole waves | — |
| Copy-on-write `node_modules` clone | +a few seconds per ticket | — |
| QC pre-checks in step 2 | +about 1 minute, once | Saves the whole batch if the browser is missing |
| Tests inside Owns, tagged with criterion IDs | 0 | Removes false stops at 4b |
| No TDD; only check that each criterion has a test with an assertion | **Faster** by about 1–2 minutes per ticket | — |
| Collect new dependencies, install once in step 2 | 0 | Removes fix rounds caused by `package.json` |
| One full check on the final `staging` | +1 check per batch | Catches typecheck/build errors that e2e misses |
| Per-ticket base, cycle-aware locks, revert of a revert | 0 | No hangs, no lost code |
| Name clashes caught by the registry test | 0 (part of existing tests) | — |
| Post-merge check only when a ticket depends on it | **Less** than before | — |
| Culprit search by bisection | 0 | Re-runs only the failing test files |
| Lock table, revert, 4-round limit | 0 | Stops infinite loops |
| Kill the stuck child process | 0 | **Faster**: no hours-long hangs |
| S with a diff touching shared files becomes M | +1 reviewer, for that ticket only | — |
| `ready` label, always run `check-batch` | +a few seconds | — |
