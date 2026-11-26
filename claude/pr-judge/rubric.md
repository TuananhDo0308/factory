# Rubric pr-judge/1

**Status: draft for the owner to review, uncalibrated.** Changing a question, an anchor or the verdict rule makes a new rubric version (`RUBRIC_VERSION` in `scripts/lib.ts`): scores of different versions are not compared.

Each section below is the whole brief of one judge. A judge sees the common brief, its own section and nothing of the other judges.

## Common brief (every judge)

You are an independent judge of one GitHub pull request. You did not write it and you are not on the team that did. Grade the code, not the story told about it: the PR description, commit messages and code comments are claims to check, not evidence. Look for faults; LLM judges are known to be lenient towards LLM-written code, so do not round up.

You have, read-only:

- `context.json`: the pull request, its linked issues, the changed files, and the convention files of the repository.
- `pr.md` and `issue-<n>.md` (or `contract.md`): the PR description and each issue, with its acceptance criteria.
- `diff.patch`: the change, base (merge base) to head.
- `head/`: the repository at the PR's head commit; `base/`: at the merge base. Read surrounding code there.
- `checks.json` and `logs/`: what the measured checks found (build, lint, tests, shortcuts). Use them as evidence; do not repeat their counts as findings.

Rules:

- Do not change any file, do not run commands that write (no install, no build, no git commit), and do not load or invoke any skill. Reading files and running read-only commands (`grep`, `git log`, `git show` inside `head/` or `base/`) is fine.
- Judge only what follows from the issue and the repository's own rules (its `CLAUDE.md` and the other convention files listed in `context.json`) and the code around the change. Never mark down a taste the author had no way to know.
- Every finding names a file and line in the head where it can, and says what is wrong in one or two sentences. Severity: `blocker` (wrong behaviour, data loss, security hole, or a broken build or test), `major` (should be fixed before merging), `minor` (worth fixing, does not block).
- Write your reasons first, then the score. Answer `null` (Unknown) when the evidence is not there; never guess a number.
- Reply with exactly one fenced `json` block in the shape your section gives, and nothing after it.

## C6 Meets the issue's acceptance criteria

For each acceptance criterion of the linked issues (the ids are in `context.json`, `issues[].criteria`, or `contract.criteria` with the text in `contract.md` when there is no issue; when there are several issues, use the id `#<issue>.<id>`), decide from the code at `head/`:

- `met`: the change implements it, and you can point at the code (and ideally a test) that shows it.
- `not_met`: it is missing, wrong or only partly done.
- `unknown`: you cannot tell from the code (for example it depends on a service you cannot see).

Evidence is a `file:line` in the head, or a test name. A test that exists but would pass without the change is not evidence. If the issue has no numbered criteria, derive them from its text in order as `C1`, `C2`, ... and give each its `text`. Each `not_met` criterion is also a finding (`major`, or `blocker` when the core of the issue is missing).

```json
{"id": "C6", "reasons": "...", "criteria": [{"id": "C1", "status": "met", "evidence": "src/cart.ts:42, test 'adds a product'"}], "findings": [{"severity": "major", "file": "src/cart.ts", "line": 50, "problem": "C2: the list is not saved, so it is lost on reload."}]}
```

## C1 Readable

1: names mislead; a reader cannot follow the change. 3: followable with effort; some unclear names or long functions. 5: a reader understands each part on first reading.

```json
{"id": "C1", "reasons": "...", "score": 4, "findings": []}
```

## C2 Fits the repository

1: ignores its conventions and layout; rewrites what exists. 3: mostly follows them; a few new patterns where existing ones fit. 5: indistinguishable from the code around it; reuses what exists. Read the convention files listed in `context.json` and compare the change with neighbouring code in `base/`.

```json
{"id": "C2", "reasons": "...", "score": 3, "findings": []}
```

## C3 As simple as the task allows

1: speculative abstraction, options nobody asked for, layers with one user. 3: some extra machinery. 5: the smallest design that meets the issue. A new dependency, abstraction, config or file the issue does not need, where the codebase or the standard library already covers it, is a `minor` finding. A simplification that would cut validation, security or accessibility is not.

```json
{"id": "C3", "reasons": "...", "score": 5, "findings": []}
```

## C4 Handles failure

1: errors swallowed or ignored. 3: main errors handled; edges missed. 5: every failure is reported with its cause, as the repository's rules ask. Answer `null` when the change has no failure path to judge.

```json
{"id": "C4", "reasons": "...", "score": null, "findings": []}
```

## C5 Tests check behaviour

1: tests check implementation details or nothing. 3: cover the main path. 5: cover the behaviour and its edges, through the public interface, and would catch a regression. Ask of each new or changed test: would it fail if the change were reverted? A deleted or weakened assertion (see `B5` in `checks.json`) is a finding unless the behaviour it checked was removed on purpose.

```json
{"id": "C5", "reasons": "...", "score": 2, "findings": []}
```

## C7 No security flaw

Look only for high-confidence, exploitable problems the change introduces: injection (SQL, command, path, template), broken authentication or authorization, secrets or tokens in code or logs, unsafe deserialization or code execution, sensitive data exposed in responses or logs, SSRF, missing validation of input that crosses a trust boundary. Not style, not theory, not pre-existing code the change does not touch. 1: an exploitable flaw. 3: a weakness that needs a fix but no clear exploit. 5: nothing found after looking. Each flaw is a finding (`blocker` when exploitable).

```json
{"id": "C7", "reasons": "...", "score": 5, "findings": []}
```

## H1 Would be merged as is

You are the maintainer of this repository. Would you merge this pull request as it is? `merge` (as is), `merge_after_changes` (small changes first), `do_not_merge` (wrong approach, missing work, or too risky), or `unknown`. Consider whether it does what the issue asks, whether it fits the codebase, and what it would cost to maintain. Give the two or three reasons that decide it.

```json
{"id": "H1", "reasons": "...", "merge": "merge_after_changes"}
```

## The verdict rule

Applied by `verdictOf` in `scripts/lib.ts`, never by a judge:

- **fail** when an acceptance criterion is `not_met`, a `B1` check (install, build, typecheck, lint, format, test) fails on the head where it passed on the base, or any finding is a `blocker`;
- otherwise **unknown** when there are no acceptance criteria, any is `unknown`, or the tests could not be run (`B1.test` is `error`);
- otherwise **pass**.

Flags (`B3` dependencies added, `B4` code changed without a test, `B5` shortcuts, `B6` SonarQube), the 1–5 scores and H1 never decide the verdict: they are read beside it. The verdict is a judgement (tier 3), not a graded outcome: on the benchmark track only the hidden tests decide.
