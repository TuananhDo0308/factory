---
name: factory
description: Run a software task through a small team of agents that work together - a planner that writes specs, one test-first implementer and one QA agent per spec, a checker, independent reviewers and a QC agent that uses the product, with failures sent back to the implementers - orchestrated by a workflow script instead of by you. Use this whenever the user asks for a "factory", an agent team, or wants a coding task (feature, bug fix, refactor, tests) or a GitHub issue planned, built and independently reviewed by several agents rather than done in one pass, even if they do not say the word "factory".
---

# Factory

A factory run has three parts. You write the contract with the user. A workflow script then runs the team: it is code, so the order of steps, what each agent is allowed to see, and how many times a spec may go back to Build are fixed and cannot drift. Finally you confirm the result yourself, merge it if it passed, and report.

You do not write the change, and you do not coordinate the agents by hand. Your judgment goes into the two places code cannot cover: understanding what the user wants, and telling them honestly what came out.

## The team

| Role | Does | Brief |
|---|---|---|
| You | Write the contract, start the workflow, confirm the result, merge a passing run, report | this file |
| Planner | Turns the contract into one or more specs. Changes nothing | [roles/planner.md](roles/planner.md) |
| Implementer | Builds one spec test-first: for each criterion, a test that fails, then the code that makes it pass. When QA or review sends the spec back to Build, a fresh session acts on the failures that concern that spec's files | [roles/implementer.md](roles/implementer.md) |
| QA | After the implementer of a spec is done, every time: checks that spec's tests against the spec for gaps, writes tests for the serious ones, runs the security pass and a code review, and sends the spec back to Build when the code or the tests must answer for something. Changes test files only | [roles/qa.md](roles/qa.md) |
| Checker | Runs the contract's checks and lists the changed files. Changes nothing | [roles/checker.md](roles/checker.md) |
| Reviewer | Judges the whole change against the contract, and how the parts fit together. Changes nothing | [roles/reviewer.md](roles/reviewer.md) |
| Spec reviewer | Only when the work was split: reads one spec's files line by line. Changes nothing | [roles/spec-reviewer.md](roles/spec-reviewer.md) |
| QC | Once the checks pass, beside the reviewers: starts the product and tries each criterion through its real entry point (CLI, HTTP, browser, public API), as a user would, without reading the diff. Changes nothing | [roles/qc.md](roles/qc.md) |

A large task is split into several specs because an agent handed too much at once starts guessing and inventing details. Every spec is built by its own agent in its own session, which sees only that spec; no agent is ever handed several specs. The implementer writes each test before its code and sees it fail first, so every test is known to be able to fail. Tests written by the agent that wrote the code tend to agree with what it built, so a separate QA agent then reads that spec's tests against the spec, without the implementer's plan or account, and closes the serious gaps. Review is split the same way: each spec has its own reviewer, and one more reviewer judges the whole change against the contract. No reviewer sees an implementer's or QA agent's explanation of its work, so each one judges the code with fresh eyes. Everyone so far still judges code and tests, so a misreading of the contract they all share passes them all; a QC agent then uses the product itself, seeing only the contract and how to run it, and a criterion passes only if it saw it work. When the change does not pass, each failure goes back to the implementer of the spec whose files it concerns, in a fresh session that sees only that spec, the failures and the interfaces of the other parts.

## 1. Write the contract

Read enough of the repository to understand the request, then write:

- **Objective**: one or two sentences.
- **Acceptance criteria**: numbered `C1..Cn`, each something an outsider could check.
- **Out of scope**: what this task will not touch.
- **Run**: how a user reaches the change, for QC: the commands to build and start the product (or the CLI to call, or the package entry point to import), the port, what it needs (a database, environment variables with test values) and where its data goes. Find it in the README and the manifest, and try it once. Leave it empty only when there is nothing to start; QC then finds out on its own.
- **Checks**: the project's real test, build or lint commands, found in its own files, each runnable from the repository root. If there are none, use an empty list and say so in the report; do not invent one.
- **When the repository has CI** (`.github/workflows/*.yml`, or another CI config), read it and write the checks as CI's own commands: one check per CI job or step that can run locally, with the same paths, flags, environment variables and setup steps, chained in the command (for example `bun run db:push && bun test tests/api tests/services`), and a service the job starts, such as Postgres, running locally the same way (`docker run` of the image CI names). A single command over the whole suite can pass where CI's separate jobs fail, because they select other files and run other setup. Keep the steps that cannot run locally (secrets, deploys, another OS) out of the checks and name them in the report.

Ask the user only what you cannot find out from the code and what would change the outcome. Every agent downstream works from this text alone, so a vague criterion here becomes a guess everywhere else.

### When the task is a GitHub issue

One issue is one run and one pull request. When the user names an issue (a number or a URL), the contract comes from it rather than from you, because a BA and the user already agreed on it there (the `ba-ticket` skill writes issues in this shape, and `dev-subissues` adds the sub-issues):

```bash
gh issue view <n> --json number,title,body,url,state
gh api --paginate repos/{owner}/{repo}/issues/<n>/sub_issues --jq '[.[] | {number, title, body}]'
```

- **Objective** from the issue's objective or overview; **criteria** from its acceptance criteria, in order, as `C1..Cn`, keeping their wording; **out of scope** from its out-of-scope section; **run** and **checks** from the project, as above, even when the issue lists some (run them once to be sure they exist).
- Take no criteria from the sub-issues. They are a developer's notes on how the work divides, passed to the planner as context through the `issue` arg; the run is judged against the issue's criteria only. If a sub-issue states a requirement the issue's criteria do not cover, or the issue has no acceptance criteria an outsider could check, stop and tell the user: the issue needs correcting first (with `ba-ticket`, or by hand), and a criterion you add yourself is one nobody agreed to.
- If the issue is closed, or says it depends on an issue that is still open, tell the user before going on.
- Pass the issue to the workflow as `issue`: `{ "number": <n>, "title": "...", "body": "...", "subIssues": [{ "number": ..., "title": "...", "body": "..." }] }`, with the bodies exactly as GitHub returned them.

An issue run ends in a pull request merged into the repository's default branch (step 5), so it must start from that branch as it is on GitHub: find it with `gh repo view --json defaultBranchRef --jq .defaultBranchRef.name`, run `git fetch origin`, and check that `HEAD` is `origin/<default>`. If it is not (another branch, local commits, or behind), tell the user and ask before going on, because the pull request would carry those differences or conflict. The target of the run is the default branch, and its id names the issue: `<date>-issue-<n>-<few words>`.

Then record the starting point:

- `git rev-parse HEAD` for the base commit. The workflow needs a Git repository with at least one commit; if there is none, tell the user instead of creating one.
- `git status --short` for files that were already modified or untracked. These are the user's work in progress: list them as `ignoreFiles` so the run does not mistake them for its own changes, and leave them alone.
- What running the checks leaves behind that the project's `.gitignore` does not cover (build output, coverage reports, logs). The agents run the checks too, so such files appear during the run and would stop it as changes that no spec owns. Add them to `ignoreFiles`. An entry is an exact path, a directory (everything beneath it), `*.ext`, or `**/name` for a name at any depth. Common caches (`__pycache__`, `*.pyc`, `.pytest_cache`, `.mypy_cache`, `.ruff_cache`, `.DS_Store`) are already ignored by the script.

Last, give the run its own branch. Note the current branch (`git branch --show-current`): it is the target a passing run is merged into (for an issue run, the default branch, which you checked above). Then `git switch -c factory/<run id>`, with a run id made of the date and a few words (the same id you give the dashboard below). The team works in this branch, so the target holds nothing from the run until the run has passed, and a run that fails leaves it exactly as it was. Switching does not disturb the user's uncommitted files. If `HEAD` is detached there is no target: stay where you are, skip the merge at the end and say so in the report.

## 2. Check the team's skills

The implementers, QA agents and reviewers each load installed skills, picked by the script the way super-board's skill registry picks them: the implementer by the spec's `kind` (`bug`: `diagnosing-bugs`, `tdd`; `feature`: `tdd`, `codebase-design`; `ux` and `tests`: `tdd`; `refactor` and `tech-debt`: `codebase-design`, `tdd`; `docs`: none) plus `verification-before-completion` and `mp-code-review` on its own diff; QA always `tdd`, `diagnosing-bugs`, `verification-before-completion`, `testing-strategy`, `mp-code-review` and `pr-security-review`; reviewers `mp-code-review` and `codebase-design`; QC none, so that it does not read the code the way the reviewers do (it is offered `playwright-best-practices` for a criterion seen in a browser). Implementers and QA are also offered `vitest` and `playwright-best-practices`, and implementers `testing-strategy` and `domain-modeling`, each with a rule for when to load it. They come from mattpocock/skills (mattpocock's `code-review` installed as `mp-code-review`, so that it does not take the name of Claude Code's own `/code-review`), obra/superpowers, EricTechPro/super-board, antfu/skills, anthropics/knowledge-work-plugins and currents-dev. The conditional ones are optional; a run starts without them. Resolve them before every run:

```bash
bash /absolute/path/to/this/skill/scripts/skills-ready.sh /absolute/path/to/repository
```

Exit 0 prints a JSON object of skill names and their SKILL.md paths, which also lists the optional skills that are installed and the repository's own skills under `.claude/skills`; pass it unchanged as the `skills` arg. Exit 10 names the missing skills on stderr, one per line: the run cannot start without them, because the script stops before the planner. Tell the user which are missing and that `scripts/install-skills.sh` installs them into `~/.claude/skills` from their own repositories, at pinned commits, without overwriting a skill that is already there. It downloads third-party code into a directory every Claude Code session reads, so run it only when the user agrees, then check again.

## 3. Run the workflow

Call the Workflow tool with `scriptPath` set to the absolute path of `workflow/factory.js` in this skill's directory, and these `args` (as a JSON object, not a string):

```json
{
  "repo": "/absolute/path/to/repository",
  "base": "<commit from git rev-parse HEAD>",
  "contract": {
    "objective": "...",
    "criteria": [{ "id": "C1", "text": "..." }, { "id": "C2", "text": "..." }],
    "outOfScope": ["..."],
    "checks": [{ "name": "test", "command": "python3 -m pytest -q" }],
    "run": "python3 wordstats.py <file>; no server, no setup"
  },
  "roles": {
    "planner": "/absolute/path/to/this/skill/roles/planner.md",
    "implementer": "/absolute/path/to/this/skill/roles/implementer.md",
    "qa": "/absolute/path/to/this/skill/roles/qa.md",
    "checker": "/absolute/path/to/this/skill/roles/checker.md",
    "reviewer": "/absolute/path/to/this/skill/roles/reviewer.md",
    "specReviewer": "/absolute/path/to/this/skill/roles/spec-reviewer.md",
    "qc": "/absolute/path/to/this/skill/roles/qc.md"
  },
  "skills": { "tdd": "/Users/you/.claude/skills/tdd/SKILL.md", "...": "the output of skills-ready.sh" },
  "ignoreFiles": [],
  "issue": { "number": 12, "title": "...", "body": "...", "subIssues": [{ "number": 13, "title": "...", "body": "..." }] },
  "dashboard": {
    "file": "/absolute/path/to/this/skill/dashboard/live.js",
    "id": "2026-01-31-json-flag",
    "title": "Add a --json flag to wordstats"
  }
}
```

`dashboard` makes the run show its progress on the skill's dashboard: at each step the script has a small recorder agent overwrite `file` with the state of the run. Give the run an `id` that no earlier run in `dashboard/runs.js` has (the date and a few words) and a `title` of a few words. Tell the user they can watch the run by opening `dashboard/index.html` from this skill's directory in a browser, and note the time (`date +%s`) so you can report how long the run took. Only one run can be shown in progress at a time, so leave `dashboard` out if another factory run is still going.

Just before you call the Workflow tool, tell XS Factory Bench that the run has begun, so that it is recorded even if it never reaches step 6 (the session ends, the machine stops, the run is given up). Do this only if `command -v xfb` finds it, and otherwise skip it without mentioning it:

```bash
xfb start --skill /absolute/path/to/this/skill --run <run id> --repo /absolute/path/to/repository \
  --base <base commit> --target <target branch> --title "<dashboard title>"
```

Use the same run id, base commit and target branch you will later pass to `xfb report`. It returns within seconds and keeps anything it cannot deliver. If it prints an error or exits non-zero, say so in one line of the report and start the workflow anyway: reporting never holds up or changes a run. A blocked run that you rerun with corrected specs keeps its run id, so do not call it again.

Optional args: `issue` (only for an issue run, see step 1; the planner alone is shown it), `maxRebuilds` (how many times one spec may be sent back to Build, by QA or by review, default 2; super-board's rebuild cap), `maxSpecRevisions` (default 2), `models` (replaces the model or effort of a role; the defaults are the planner on Fable at high effort, the reviewer of the whole change on Opus at high, implementers, QA, spec reviewers and QC on Sonnet at medium, an implementer whose spec was sent back to Build on Opus at medium, and the checker on Sonnet at low; for example `{"implementer": {"model": "opus"}}`, and a model of `"inherit"` uses the session's), `scratch` (the directory under which every agent gets a scratch folder of its own, default `<repo>-factory-scratch` next to the repository; pass another absolute path outside the repository when that one cannot be created or written to, and never one under `.git`, where Claude Code refuses writes), `specs` (see "When the run is blocked"), and `qc: false`, which runs no QC (then `roles.qc` is not needed). Turn QC off only when no user or caller can see the change at all (a refactor with no behavior change, docs, tests only), and say so in the report; a change that is hard to start is not one.

The workflow runs in the background and you are notified when it finishes. Do not start the agents yourself while it runs, and do not predict its result. It does this:

1. **Spec**: the planner returns specs, each with a `kind` (feature, bug, ux, refactor, tech-debt, tests, docs) that decides the skills its implementer loads. Code rejects them, and sends them back with the reasons, if a criterion is uncovered, a file has two owners, a kind is missing, a spec names a skill that is not installed, or the dependencies cannot be ordered.
2. **Build**: each spec runs like a card on super-board's board. Its implementer writes the tests first and then the code, in the source and test files the spec owns. Then a QA agent checks the spec: a ledger of which test asserts each criterion, the edge cases, tests that cannot fail, a code review and a security pass. It writes tests for the serious gaps, in the spec's test files only. If it sends failures back, the spec goes back to Build: a fresh session of its implementer acts on them and a fresh QA checks again, up to `maxRebuilds` times. Every spec gets QA, even one without test files. Specs that do not depend on each other run in parallel; a dependent spec waits for its whole level. The run stops if an agent reports changing a file it may not change (for QA, anything but the test files).
3. **Check**: the checker runs the contract's checks and lists the changed files. When a test check fails and its failing test files pass alone, it searches, in a bounded number of extra runs, for the run's test file that breaks them (a leaked mock or global). A change to a file no spec owns stops the run.
4. **Review and QC**: a fresh reviewer judges the whole change against the contract. When there are several specs, each spec also gets its own reviewer, which sees only that spec and its files. When every check passed, a QC agent runs beside them: it starts the product as the contract's `run` says and tries each criterion through its real entry point, recording the scenario, what it expected and what it saw. All of them run in parallel. A criterion passes only if every reviewer responsible for it says it is met and QC saw it pass (or found it `not_observable`: about the code, not about anything a user sees). QC returning `blocked` (the product cannot run here for a reason the change did not cause) or reporting a file it left in the repository stops the run.
5. **Back to Build**: there is no separate repair phase. If a check failed, a criterion is not met, QC saw one fail or there is a blocking finding, the specs concerned go back to Build, as a bounced card goes back to Ready: the owner of the file a failure names, the specs responsible for a criterion (also for one QC saw fail), or, for a failing check, the owner of the test file the checker found breaking the others, else the specs whose files appear in its output, and every spec when none do. Each goes through a fresh implementer session (with its spec, its failures and the interfaces of the other parts; it may change its spec's source and test files) and QA again, then the whole change is checked and reviewed again. A spec already sent back `maxRebuilds` times fails the run instead. Code records every test file changed after the first build.

If the Workflow tool is not available in this session, tell the user that the factory cannot run here. Do not fall back to coordinating the agents by hand: the guarantees above exist only because code enforces them.

## 4. Read the result

The workflow returns an object with `outcome`, `reason`, `specs`, `builds` (implementers, each with its `tdd` entries), `qa` (every QA session, the later ones tagged `rebuild`: its `ledger`, `gaps` and the `failures` it sent back), `rebuilds` (implementer sessions after a spec was sent back, each tagged `rebuild` with the `fixes` it made), `sentBack` (per spec, how many times it went back to Build), `testsChangedInRebuild` (test files changed after the first build, per spec), `check`, `review`, `specReviews`, `qc` (every QC session, each with its `round`, `startedWith` and per criterion the `scenario`, `expected` and `observed`), `failures`, `failureLog` (every failure that sent a spec back to Build, or ended the run, in the order found: its stage, kind, the specs that answered for it and a short problem) and `repairRounds` (how many times review sent work back to Build).

- **`passed`**: every check exited with 0, every criterion was judged met, QC saw every criterion work (unless `qc: false`), and no blocking finding remains.
- **`failed`**: a spec still fails QA or review after being sent back to Build `maxRebuilds` times. What remains is in `failures` (review) or `reason` (QA).
- **`blocked`**: the run stopped because it needed a decision that code cannot make. `reason` says what.

Whatever the outcome, confirm it yourself before reporting. Run each of the contract's checks from the repository root and read the output, and look at `git status --short` and `git diff --stat <base>`. The checker's results came from an agent; what you run now is the evidence you report. If your run disagrees with the workflow's result, report the disagreement and treat the task as not passing.

When the repository has CI and `docker info` succeeds, also rerun CI's test jobs in a Linux container that matches CI. A run on this machine, even of CI's exact command, can pass where CI fails: some runners order test files by the filesystem, which differs between macOS and Linux, so a test that leaves a fake global or a mock behind breaks later files only there. For each test job:

1. From the workflow file take the runtime and its version (`runs-on`, `container:`, the versions in `setup-*` steps), the `services` (image, environment, ports), the job's environment and its steps.
2. `docker network create factory-ci-<run id>`, and start each service on it: `docker run -d --rm --network factory-ci-<run id> --name <service> -e ... <image>`.
3. Run the steps on a copy of the working tree, so nothing built for this machine (such as `node_modules`) goes in and nothing comes out: `git ls-files -co --exclude-standard | tar -cf - -T - | docker run -i --rm --network factory-ci-<run id> -e ... <runtime image at CI's version> sh -c 'mkdir /w && tar -xf - -C /w && cd /w && <install> && <the job steps>'`. On this network a service is reached by its container name, not `localhost`, so write `-e` values such as `DATABASE_URL` with the service's name as the host. Wait until each service is ready (its health check, or a retry loop) before the job steps.
4. `docker rm -f` the services and `docker network rm` the network.

A failure there is a failed check: report it with its output and treat the task as not passing, like any disagreement. When Docker is not available, or a job cannot be reproduced this way, say in the report that order- and platform-dependent failures were not ruled out.

Then delete the `scratch` directory (default `<repo>-factory-scratch`): it holds only the agents' temporary files, one folder per agent. Look at it first, and keep it while you still need it for a blocked run.

Then file the run in the dashboard's history, so it stays there after the next run overwrites `live.js`. Read `dashboard/live.js`: it holds one object, the last state the workflow recorded. Append that object to the array in `dashboard/runs.js`, adding `seconds` (the time since you started the workflow). Keep what the workflow recorded, `workflowOutcome` included; if your own checks disagreed with it, set `outcome` to `failed` and say why in `note`, and leave `workflowOutcome` as the workflow wrote it, so the disagreement stays visible. If `live.js` is missing or belongs to another run, build the object from the workflow's result using the field list at the top of `runs.js`, with `workflowOutcome` set to the `outcome` the workflow returned and `failureLog` copied from the result unchanged. Never edit or shorten a filed `failureLog`: step 7 reads it across runs, and a log tidied by hand hides the pattern it is there to show. A run that ended `blocked` and that you are about to rerun with corrected specs is filed once, after the rerun.

## 5. Merge a passing run

Merge only when the workflow returned `passed` and your own run of the checks agrees. Anything else (failed, blocked, a disagreement, a check you could not run) stays on the run branch, unmerged, for the user to look at; never merge to see whether it works.

1. Commit the change on the run branch. Stage only the files the specs own (`filesOwned` and `testFiles` of every spec), by path: `git add -A` would sweep in the user's work in progress and the leftovers listed in `ignoreFiles`. Write a commit message that says what the change does, taken from the objective.
2. `git switch <target>` and `git merge --ff-only factory/<run id>`. The target has normally not moved since the run started, so this is a fast-forward. If it refuses, the target changed during the run: go back to the run branch, leave both branches as they are and tell the user, since the checks did not run against what the merge would now produce.
3. Delete the run branch with `git branch -d`.

The merge is local. Do not push or open a pull request unless the user asked for it.

### An issue run: pull request, merged into the default branch

An issue run ends on GitHub instead, because the issue is closed by the pull request that delivers it. The same rule holds: only a run that passed and that your own checks agree with.

1. Commit on the run branch exactly as in item 1 above: only the files the specs own, by path.
2. `git push -u origin factory/<run id>`.
3. Open the pull request into the default branch with `gh pr create --base <default> --head factory/<run id> --title "<issue title>" --body-file <file in your scratchpad>`. The body says what changed and how the work was split into specs, lists each criterion with its evidence and what QC saw when it used the product, and each check with the result of your own run, and ends with one closing line per issue: `Closes #<issue>` and a `Closes #<sub-issue>` for every sub-issue, since GitHub does not close sub-issues when their parent closes.
4. Wait for the pull request's CI: `gh pr checks <number> --watch --interval 30`. The run's checks and your Linux rerun came from this machine; CI on GitHub is the first run on the repository's own runners, and it is the gate a reviewer would wait for. If it reports no checks, the repository has no CI on pull requests: say so in the report and go on. If any check fails or is cancelled, do not merge: leave the pull request open, read the failing job's log (`gh run view <run id> --log-failed`) and report it, with its URL, as a failed check.
5. Merge it: `gh pr merge <number> --squash --delete-branch`, so the default branch gets one commit per issue. Then make sure you are on the default branch and `git pull --ff-only`.
6. If the merge is refused (branch protection that wants a review or checks still running, a conflict because the branch moved), leave the pull request open and tell the user why, with its URL. Never pass `--admin` or otherwise bypass the repository's protection: those rules are the owner's decision, not the run's.

A run that did not pass is not pushed: it stays on its local branch like any other.

If the run did not pass, tell the user that the work is on `factory/<run id>` and that the target branch is untouched. When you rerun a blocked run with corrected specs, stay on the same run branch.

## 6. Send the run to XS Factory Bench

XS Factory Bench records every factory run, of every user, so that the factory's cost and failures can be followed over time. Its `xfb` command reads the run's record and the session transcripts on this machine and sends them; it is installed separately, so do this only if `command -v xfb` finds it, and otherwise skip this step without mentioning it.

Run it after the run is filed in `dashboard/runs.js` and after the merge step, whatever the outcome, so it sees the final record and whether the change was merged:

```bash
xfb report --skill /absolute/path/to/this/skill --run <run id> --repo /absolute/path/to/repository \
  --base <base commit> --target <target branch> [--merged <merge commit>]
```

Pass `--merged` only when the run was merged, with the commit the target now points at (for an issue run, after `git pull`). A blocked run that you rerun with corrected specs is sent once, after the rerun, like its entry in `runs.js`.

Reporting must never change the run: `xfb` keeps anything it cannot deliver and sends it later. If the command fails, say so in one line of the report and carry on; never retry the run, edit its record or touch the repository because of it.

## 7. Look for recurring failures

A failure fixed inside one run is gone; a mistake the team keeps making comes back in the next run, in another project. Find those, so they can be fixed once in the skill. Do this after step 6, whatever the outcome.

1. Read `dashboard/runs.js`: the `failureLog` of the last 10 runs that are not `sample`, and the `reason` of those that ended `blocked` (the newest run included). Runs filed before the failure log existed have none; use their `reason` only.
2. Group what shares a cause, by judgment: the same role or step making the same kind of mistake, not the same bug in the same code. For example: implementers not running the lint check before reporting; two specs using different names for one interface; the planner leaving a needed file out of every spec, so the run stops on a file no spec owns; a check leaving an output file that stops the run; a QA failure the implementer's brief should have prevented. A failure that only says the task was hard is not a pattern.
3. A pattern counts when it occurred in at least 3 different runs. Read `dashboard/lessons.js` first: leave out a pattern already there, unless it is `rejected` or `done` and has occurred in 3 more runs since its `decided` date, which is worth raising again with the new runs as evidence.
4. For each new pattern, append an entry to `dashboard/lessons.js` with `status` `proposed` and today's date (the fields are listed at the top of that file), and put the proposal in the report: the pattern, the runs, two or three problems from their logs, and one fix. Propose a rule in `workflow/factory.js` when code can decide it mechanically (as the script already ignores common caches), otherwise one sentence, with its reason, in the brief of the role that makes the mistake. Name the file.
5. If the user decides in this session, record it: `status` `accepted` or `rejected`, `decided` with the date, and their reason in `note`.

Do not make the fix yourself, not even an accepted one. You are working in another project; the skill is shared by every Claude Code session on this machine (often through a symlink), so a change made now would alter runs that are going on elsewhere; and changing the team's rules is the user's decision, made as an ordinary change to the skill's own repository with its tests. Whoever makes that change sets the entry to `done`.

`runs.js` holds only the runs filed on this machine. XS Factory Bench receives every run's failure log, of every user, with step 6 (where each failure was found, its kind and the specs it concerned; the file and the problem only from people who turned sharing on); where the user has it, the same patterns can be followed there across a team.

## When the run is blocked

Read `reason` and decide, with the user if the choice is theirs:

- **The specs could not be made valid, or an implementer reported its spec was wrong or needed a file it does not own**: correct the specs. Take `specs` from the result, fix the problem, and run the workflow again with the corrected list as the `specs` arg; the planner is then skipped. Work already done stays in the repository, so say in the affected spec what is already in place.
- **An agent changed files it may not change** (an implementer outside its spec's files, or a QA agent outside the test files): show the user the file and ask whether to keep the change or undo it; do not undo it yourself.
- **QC returned `blocked`**: the product cannot run here, usually for a missing secret, service or setup step. Supply it (a test value, a `docker run` of the service) and correct the contract's `run`, then run again with `specs`. If it can never run on this machine, ask the user whether to run again with `qc: false`, and say in the report that nobody used the product.
- **QC left files in the repository**: look at them. If they are the product's own output (a database, logs), point that output at a scratch path in `run`, remove the files after asking the user, and run again with `specs`.
- **A QA agent returned `blocked`**, usually because the tests cannot be run: read its reason, fix what is missing (an installed dependency, a configuration file) and run again with `specs`.
- **Files were changed that no spec owns**: look at those files. If they are output of running the checks, add them to `ignoreFiles` and run again. If the change is needed, add the file to the spec that should own it and run again with `specs`. If it is not needed, ask the user before undoing anything.
- **Skills the team needs are not installed**: see step 2.
- **An agent returned no result**: run the workflow again.

For a change small enough to describe in a sentence, you may write the single spec yourself, using the fields in [roles/planner.md](roles/planner.md), and pass it as `specs` to skip the planner. Put source files in `filesOwned` and test files in `testFiles`. The implementer, the QA agent, the checker and the reviewer still run, and the loop back to Build if needed.

Never get to green by weakening the target: do not delete or loosen tests, drop a criterion, remove a check or raise `maxRebuilds`. If a criterion turns out to be wrong, that is a question for the user.

## Report

Finish with a short report to the user:

- **Outcome**: passed, failed or blocked, in one line, with the reason if it did not pass.
- **What changed**: the files and the behavior, and how the work was split into specs. Name any spec that ran without tests, and why, and any criterion an implementer reported in `tdd` without a test.
- **QA**: per spec, the gaps QA closed with tests and the medium or low gaps it only reported, so the user can decide whether they matter.
- **Tests changed after the first build**: every file in `testsChangedInRebuild`, with the reason the implementer gave in `fixes`. A test changed after review is where a weakened test would hide, so let the user look.
- **Criteria**: each `C1..Cn` with met / not met and the evidence.
- **Checks**: each command and the real result from your own run, including any not run; the CI steps left out of the checks; and the result of the CI run in a Linux container, or that it was not run and why.
- **Review**: findings left open from any reviewer, and anything a reviewer could not review.
- **QC**: how the product was started, and per criterion what QC tried and saw; every criterion it marked `not_observable`, so the user can disagree; anything in its `openIssues`. If QC was off, say so and why.
- **Back to Build**: which specs QA or review sent back, how many times, and what the implementer fixed.
- **Merge**: the commit and the branch it was merged into (for an issue run, the pull request URL, the result of its CI and the issues it closed), or the branch the unmerged work is on and why it was not merged.
- **Lessons**: any pattern step 7 proposed, with its runs, evidence and fix, and the question for the user: accept or reject. Leave this out when there was none.
