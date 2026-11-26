---
name: pr-judge
description: Judge the quality of one GitHub pull request that is linked to an issue - measured checks (build, type check, lint, tests, base against head; new dependencies, shortcuts around checks, optional SonarQube) and one isolated AI judge per criterion (acceptance criteria C1..Cn of the issue, readability, fit with the repository, simplicity, failure handling, tests, security, merge readiness) - then write report.md and report.json with a pass / fail / unknown verdict. Independent of Factory - it loads none of Factory's skills. Use when the user says "pr-judge", "judge PR 123", "grade this PR", or wants a quality report or score for a pull request or a Factory run's output.
---

# pr-judge

Judge one pull request against the issue it closes. Input: a PR number or URL, run from inside a clone of its repository. Output: `report.md` and `report.json` in the out dir.

It is a standalone skill in the Factory repository: a person starts it, the Factory team never loads it, and it is not in the `SKILLS` registry. The rubric (`rubric.md`, version `pr-judge/1`) and the verdict rule are drafts the owner reviews line by line; the judges are uncalibrated until the owner's labels say otherwise.

**Independence.** Factory's implementers, QA and reviewers load `mp-code-review`, `pr-security-review`, `tdd`, `codebase-design`, `testing-strategy`, `diagnosing-bugs` and `verification-before-completion`. A judge that used them would share their blind spots and Factory would be grading itself. So neither you nor any judge loads those skills, or any skill, while running pr-judge. The judges' briefs are in `rubric.md` only.

`<skill>` below is this skill's directory (the one that holds this file).

## Arguments

`/pr-judge <pr> [--issue <n>]... [--run <run id>] [--allow-fork] [--keep-worktrees]`

- `--issue`: the issue(s) to judge against when the PR has no `Closes #n` link.
- `--run`: the Factory run the PR came from, when its head branch is not `factory/<run id>`.

A branch with no pull request (a Factory run that was not merged): `/pr-judge --branch <ref> --base <commit> --criteria <file> [--label <name>] --run <run id>`. The criteria file holds lines starting `C1`..`Cn` (for a Factory run, its contract's criteria). Pass `--branch`, `--base`, `--criteria`, `--label` and `--title` to `prepare.ts` in place of `--pr`. When several branches of the same task are judged to compare them, give each a neutral label (`branch-x`, ...) in a random order the judges cannot see, and never tell a judge which config or model made its branch.

## Steps

### 1. Prepare (measured checks)

From the repository clone, run (it installs dependencies and runs the test suite twice at most, so give it time; `run_command` backgrounds long commands automatically):

```bash
node <skill>/scripts/prepare.ts --pr <pr> [--issue <n>...] [--allow-fork]
```

Its last line is the out dir (`~/.factory/judge/<owner>__<repo>/pr-<n>/<head sha>/`). Exit 3: the PR comes from a fork, so its code would run on this machine; ask the user before rerunning with `--allow-fork`. Exit 4: no linked issue; ask the user for the issue number and rerun with `--issue`. Any other failure: show the error and stop; do not judge a PR whose checkout failed.

Read `<out>/context.json`. Check `issues[].criteria`: if every issue has none, the C6 judge derives them, and the report marks them derived.

### 2. Judge (one isolated agent per criterion)

Start these 8 judges **in parallel** (using `invoke_subagent` with `TypeName: "self"`, `Role: "PR Judge <id>"`, or a `run_workflow` script using `parallel`), so none sees another's answer: `C6`, `C1`, `C2`, `C3`, `C4`, `C5`, `C7`, `H1`. Give each judge the prompt:

1. the line: `Out dir: <out>. Read context.json first.`
2. the **Common brief** section of `<skill>/rubric.md`, verbatim;
3. that judge's own section of `rubric.md`, verbatim (from its `##` heading to the next one).

Nothing else: no summary of the PR, no opinion of yours, no other judge's section. When each answers, take its last fenced `json` block and write it, unchanged, to `<out>/judges/<id>.json`. If a judge gave no parseable JSON, send it one follow-up asking for the JSON block only; if that fails too, write nothing for it (it counts as not answered, and its score shows `?`). Never fill in or adjust a judge's answer yourself.

### 3. Assemble

```bash
node <skill>/scripts/assemble.ts --out <out> --judge-model <your exact model id> [--run <run id>] [--keep-worktrees]
```

It writes `report.json` and `report.md`, applies the verdict rule, removes the worktrees, and prints the verdict and `run: <id>` (from `--run` or the head branch `factory/<run id>`; `?` when unknown).

### 4. Tell the user

Reply with the verdict and its reasons, the merge recommendation, the acceptance criteria table, any check that failed or was flagged, the blocker and major findings, and the path of `report.md`. Say that the verdict is an uncalibrated judgement. Do not comment on the PR on GitHub; that is the user's call.
