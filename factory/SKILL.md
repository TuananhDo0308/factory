---
name: factory
description: Run a software task through a small team of agents that work together - a planner that writes specs, one implementer and one separate tester per spec, a checker, independent reviewers and a fixer - orchestrated by a workflow script instead of by you. Use this whenever the user asks for a "factory", an agent team, or wants a coding task (feature, bug fix, refactor, tests) planned, built and independently reviewed by several agents rather than done in one pass, even if they do not say the word "factory".
---

# Factory

A factory run has three parts. You write the contract with the user. A workflow script then runs the team: it is code, so the order of steps, what each agent is allowed to see, and the number of repair rounds are fixed and cannot drift. Finally you confirm the result yourself and report.

You do not write the change, and you do not coordinate the agents by hand. Your judgment goes into the two places code cannot cover: understanding what the user wants, and telling them honestly what came out.

## The team

| Role | Does | Brief |
|---|---|---|
| You | Write the contract, start the workflow, confirm the result, report | this file |
| Planner | Turns the contract into one or more specs. Changes nothing | [roles/planner.md](roles/planner.md) |
| Implementer | Builds one spec, in the source files that spec owns. Writes no tests | [roles/implementer.md](roles/implementer.md) |
| Tester | Writes the tests for one spec, in the test files that spec owns, without seeing the implementer's code, then re-checks them in fresh sessions | [roles/tester.md](roles/tester.md) |
| Checker | Runs the contract's checks and lists the changed files. Changes nothing | [roles/checker.md](roles/checker.md) |
| Reviewer | Judges the whole change against the contract, and how the parts fit together. Changes nothing | [roles/reviewer.md](roles/reviewer.md) |
| Spec reviewer | Only when the work was split: reads one spec's files line by line. Changes nothing | [roles/spec-reviewer.md](roles/spec-reviewer.md) |
| Fixer | Only when the change did not pass: repairs the code from the combined report of the checker and the reviewers. Never changes a test | [roles/fixer.md](roles/fixer.md) |

A large task is split into several specs because an agent handed too much at once starts guessing and inventing details. Every spec is built by its own agent in its own session, which sees only that spec; no agent is ever handed several specs. The tests of a spec are written by a different agent from the one that writes its code, working at the same time from the same spec, so that the tests measure what was asked for and cannot be fitted to what was built. The tester then re-checks its own tests against the spec until a pass finds nothing to correct, and from there the tests are the standard: when a test fails, the code is presumed wrong. Review is split the same way: each spec has its own reviewer, and one more reviewer judges the whole change against the contract. No reviewer sees an implementer's explanation of its work, so each one judges the code with fresh eyes. Repair is the one place where a single agent works across the whole change: failures often sit where two parts meet, so one fixer gets the combined report and a map of the files, not the specs.

## 1. Write the contract

Read enough of the repository to understand the request, then write:

- **Objective**: one or two sentences.
- **Acceptance criteria**: numbered `C1..Cn`, each something an outsider could check.
- **Out of scope**: what this task will not touch.
- **Checks**: the project's real test, build or lint commands, found in its own files, each runnable from the repository root. If there are none, use an empty list and say so in the report; do not invent one.

Ask the user only what you cannot find out from the code and what would change the outcome. Every agent downstream works from this text alone, so a vague criterion here becomes a guess everywhere else.

Then record the starting point:

- `git rev-parse HEAD` for the base commit. The workflow needs a Git repository with at least one commit; if there is none, tell the user instead of creating one.
- `git status --short` for files that were already modified or untracked. These are the user's work in progress: list them as `ignoreFiles` so the run does not mistake them for its own changes, and leave them alone.
- What running the checks leaves behind that the project's `.gitignore` does not cover (build output, coverage reports, logs). The agents run the checks too, so such files appear during the run and would stop it as changes that no spec owns. Add them to `ignoreFiles`. An entry is an exact path, a directory (everything beneath it), `*.ext`, or `**/name` for a name at any depth. Common caches (`__pycache__`, `*.pyc`, `.pytest_cache`, `.mypy_cache`, `.ruff_cache`, `.DS_Store`) are already ignored by the script.

## 2. Run the workflow

Call the Workflow tool with `scriptPath` set to the absolute path of `workflow/factory.js` in this skill's directory, and these `args` (as a JSON object, not a string):

```json
{
  "repo": "/absolute/path/to/repository",
  "base": "<commit from git rev-parse HEAD>",
  "contract": {
    "objective": "...",
    "criteria": [{ "id": "C1", "text": "..." }, { "id": "C2", "text": "..." }],
    "outOfScope": ["..."],
    "checks": [{ "name": "test", "command": "python3 -m pytest -q" }]
  },
  "roles": {
    "planner": "/absolute/path/to/this/skill/roles/planner.md",
    "implementer": "/absolute/path/to/this/skill/roles/implementer.md",
    "tester": "/absolute/path/to/this/skill/roles/tester.md",
    "checker": "/absolute/path/to/this/skill/roles/checker.md",
    "reviewer": "/absolute/path/to/this/skill/roles/reviewer.md",
    "specReviewer": "/absolute/path/to/this/skill/roles/spec-reviewer.md",
    "fixer": "/absolute/path/to/this/skill/roles/fixer.md"
  },
  "ignoreFiles": [],
  "dashboard": {
    "file": "/absolute/path/to/this/skill/dashboard/live.js",
    "id": "2026-01-31-json-flag",
    "title": "Add a --json flag to wordstats"
  }
}
```

`dashboard` makes the run show its progress on the skill's dashboard: at each step the script has a small recorder agent overwrite `file` with the state of the run. Give the run an `id` that no earlier run in `dashboard/runs.js` has (the date and a few words) and a `title` of a few words. Tell the user they can watch the run by opening `dashboard/index.html` from this skill's directory in a browser, and note the time (`date +%s`) so you can report how long the run took. Only one run can be shown in progress at a time, so leave `dashboard` out if another factory run is still going.

Optional args: `maxRepairRounds` (default 2), `maxSpecRevisions` (default 2), `maxTestChecks` (self-check passes per tester, default 2), and `specs` (see "When the run is blocked").

The workflow runs in the background and you are notified when it finishes. Do not start the agents yourself while it runs, and do not predict its result. It does this:

1. **Spec**: the planner returns specs. Code rejects them, and sends them back with the reasons, if a criterion is uncovered, a file has two owners, or the dependencies cannot be ordered.
2. **Build**: for each spec, one implementer writes the code and one tester writes the tests, side by side; each owns its own files and neither is shown the other's part of the spec. After writing, the tester is started again in a fresh session to check its tests against the spec and correct them, until a pass changes nothing (at most two passes); this runs while the implementer is still building. A spec with no test files gets no tester, and a spec with only test files gets no implementer. Specs that do not depend on each other run in parallel; a dependent spec waits. An agent that reports changing a file it does not own stops the run.
3. **Check**: the checker runs the contract's checks and lists the changed files. A change to a file no spec owns stops the run.
4. **Review**: a fresh reviewer judges the whole change against the contract. When there are several specs, each spec also gets its own reviewer, which sees only that spec and its files; all of them run in parallel. A criterion passes only if every reviewer responsible for it says it is met.
5. **Repair**: if a check failed, a criterion is not met, or there is a blocking finding, the failures are gathered into one report and the code is presumed wrong. A single fixer gets the contract, the report and a map of the files, and must make the code satisfy the tests; it may change source files only. A tester is called back only when a reviewer raised a blocking finding against one of its test files. Then a new checker and new reviewers look again. At most two rounds.

If the Workflow tool is not available in this session, tell the user that the factory cannot run here. Do not fall back to coordinating the agents by hand: the guarantees above exist only because code enforces them.

## 3. Read the result

The workflow returns an object with `outcome`, `reason`, `specs`, `builds` (implementers), `repairs` (the fixer, one entry per round, with the `fixes` it made), `tests` (testers; an entry with `selfCheck` is a self-check pass and lists the `problems` it corrected), `check`, `review`, `specReviews`, `failures` and `repairRounds`.

- **`passed`**: every check exited with 0, every criterion was judged met, and no blocking finding remains.
- **`failed`**: failures remain after the repair rounds. They are listed in `failures`.
- **`blocked`**: the run stopped because it needed a decision that code cannot make. `reason` says what.

Whatever the outcome, confirm it yourself before reporting. Run each of the contract's checks from the repository root and read the output, and look at `git status --short` and `git diff --stat <base>`. The checker's results came from an agent; what you run now is the evidence you report. If your run disagrees with the workflow's result, report the disagreement and treat the task as not passing.

Then file the run in the dashboard's history, so it stays there after the next run overwrites `live.js`. Read `dashboard/live.js`: it holds one object, the last state the workflow recorded. Append that object to the array in `dashboard/runs.js`, adding `seconds` (the time since you started the workflow). Keep what the workflow recorded; if your own checks disagreed with it, set `outcome` to `failed` and say why in `note`. If `live.js` is missing or belongs to another run, build the object from the workflow's result using the field list at the top of `runs.js`. A run that ended `blocked` and that you are about to rerun with corrected specs is filed once, after the rerun.

## When the run is blocked

Read `reason` and decide, with the user if the choice is theirs:

- **The specs could not be made valid, or an implementer reported its spec was wrong or needed a file it does not own**: correct the specs. Take `specs` from the result, fix the problem, and run the workflow again with the corrected list as the `specs` arg; the planner is then skipped. Work already done stays in the repository, so say in the affected spec what is already in place.
- **An agent changed files it does not own** (an implementer touched a test file, or a tester the code): the separation between code and tests was broken for that spec. Show the user the file and ask whether to keep the change or undo it; do not undo it yourself.
- **Files were changed that no spec owns**: look at those files. If they are output of running the checks, add them to `ignoreFiles` and run again. If the change is needed, add the file to the spec that should own it and run again with `specs`. If it is not needed, ask the user before undoing anything.
- **An agent returned no result**: run the workflow again.

For a change small enough to describe in a sentence, you may write the single spec yourself, using the fields in [roles/planner.md](roles/planner.md), and pass it as `specs` to skip the planner. Put source files in `filesOwned` and test files in `testFiles`. The tester, the checker, the reviewer and, if needed, the fixer still run.

Never get to green by weakening the target: do not delete or loosen tests, drop a criterion, remove a check or raise the repair limit. If a criterion turns out to be wrong, that is a question for the user.

## Report

Finish with a short report to the user:

- **Outcome**: passed, failed or blocked, in one line, with the reason if it did not pass.
- **What changed**: the files and the behavior, and how the work was split into specs. Name any spec that ran without a tester, and why, and any spec whose tests were still being corrected in the last self-check pass.
- **Disputed tests**: any test the fixer reported in `openIssues` as contradicting the contract. Tests win by default, so this is where a wrong test would show up; let the user decide.
- **Criteria**: each `C1..Cn` with met / not met and the evidence.
- **Checks**: each command and the real result from your own run, including any not run.
- **Review**: findings left open from any reviewer, and anything a reviewer could not review.
- **Repairs**: how many rounds were needed and what they fixed.

Do not commit, push or open a pull request unless the user asked for it.
