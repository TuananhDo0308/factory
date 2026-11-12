# CLAUDE.md

This repository is the source of **Factory**, a Claude Code skill that runs a coding task through a small team of agents: a planner that writes specs, one implementer and one tester per spec, a checker, independent reviewers (one for the whole change, plus one per spec when the work was split) and a single fixer for repair rounds. The team is orchestrated by code (a Workflow script), not by an agent following instructions. It is being rebuilt from scratch, starting from a deliberately small baseline. See [README.md](README.md) for the user-facing description (written in Vietnamese).

## Layout

- `factory/SKILL.md`: instructions for the invoking session. It writes the contract with the user, starts the workflow, reruns the checks itself and reports.
- `factory/workflow/factory.js`: the Workflow script. It runs Spec, Build, Check, Review and Repair, validates specs, orders them by dependency, and decides pass or fail from the raw results.
- `factory/roles/*.md`: one brief per role (planner, implementer, tester, checker, reviewer, spec-reviewer, fixer). The script tells each agent to read its brief; the paths are passed in through `args`.
- `factory/evals/<case-name>/`: test cases in the `claude plugin eval` layout (prompt, starting files, graders).
- `factory-workspace/`: test run outputs, created on demand next to the skill. Disposable and git-ignored; never part of the skill.

## How to work here

- **Code owns the skeleton, agents own the judgment.** Anything that can be decided mechanically (order, parallelism, what an agent is shown, spec validation, the repair limit, pass or fail) belongs in `factory.js`, not in prose that an agent might not follow. Prose is for what needs judgment: writing the contract, splitting a task into specs, reviewing code.
- **Keep the script and the briefs in step.** The JSON schemas in `factory.js` define what each agent returns; the "Return" section of each role brief describes the same fields. Change both together, and update the `args` example in `SKILL.md` when the script's inputs change.
- **Workflow scripts are restricted.** Plain JavaScript only, starting with `export const meta = {...}` as a pure literal. No filesystem, shell or Node APIs, and no `Date.now()`, `Math.random()` or argless `new Date()`. That is why checks are run by a checker agent and role briefs are read by the agents themselves. Load the `workflow-authoring` skill before changing the script.
- **Grow from the baseline in small steps.** Add machinery (a ledger, per-task modes, a dashboard) only when the user asks for it or a test shows the loop needs it. Do not port pieces of the old suite back in on your own initiative.
- **Skill and role text is a prompt, not documentation.** Write it for the agent that will read it: imperative, lean, and with the reason behind each rule so the agent can apply it to cases the text did not foresee.
- **Keep the roles independent.** The value of the team is fresh context. One spec, one agent, one session: an implementer sees only its own spec, and no agent is ever handed several specs; the tests of a spec are written by a tester that runs beside its implementer, owns the test files and is not shown the planned changes, while the implementer is not shown the tests to write; the tester re-checks its tests in fresh sessions until a pass changes nothing, and from then on a failing test is presumed to be the code's fault, so only a reviewer finding against a test file sends it back to its tester; repair is the one job done across the whole change, by a single fixer in a fresh session each round, which gets the contract, the combined report of failures and a map of files and interfaces instead of the specs, and may change source files only; a spec reviewer sees one spec and its files; the whole-change reviewer sees the contract, the diff, the check results and the interfaces between specs; no reviewer sees an implementer's narrative; no file has two owners, across specs or between the implementer and the tester of one spec.
- **Keep the skill self-contained.** It needs no install step beyond copying the folder. Anything that requires writing to `~/.claude/` (for example custom agent definitions) is a design change to raise with the user first.
- **Skill, role and script files are in English.** `README.md` is in Vietnamese; keep it in sync when the team, the flow or the layout changes.

## Testing

- **Script logic**: the helpers at the top of `factory.js` (`validateSpecs`, `buildLevels`, `filesOutsideOwnership`, `filesOutsideAssignment`, `evaluate`, `splitFailures`) are pure functions. After changing them, copy the part of the file above the "The run" section into a scratch module and test it with `node`. For a syntax check, wrap the whole file in an `async function` and run `node --check`, since the body uses top-level `return`.
- **End to end**: copy an eval case's `files/` into a scratch directory, `git init` and commit it, then run the workflow against it. A run starts at least six agents (one spec), and 4N+3 to 5N+3 for N specs before any repair, so confirm with the user before running more than one.
- **Skill evals**: use the `skill-creator` skill's workflow with the cases in `factory/evals/`, saving results under `factory-workspace/iteration-N/`.

## Boundaries

- An older Factory suite is still installed in `~/.claude/skills/` (its own git repo) with agents in `~/.claude/agents/`. It shares the name `factory`. Do not modify, replace or delete it unless the user asks.
- Untracked and ignored files (for example `factory-workspace/`) are not recoverable through git, so move them to the Trash instead of removing them outright, and look at the target first.
- Commit or push only when the user asks.
