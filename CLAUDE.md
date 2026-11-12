# CLAUDE.md

This repository is the source of **Factory**, a Claude Code skill that runs a coding task through a small team of agents: a coordinator (the invoking session), a planner, one or more implementers and an independent reviewer. It is being rebuilt from scratch, starting from a deliberately small baseline. See [README.md](README.md) for the user-facing description (written in Vietnamese).

## Layout

- `factory/SKILL.md`: coordinator instructions and the loop (contract, spec, build, check, review, repair, report). The planner's output is one or more self-contained specs, one implementer per spec; large tasks are split so no single agent is handed more than it can do without guessing.
- `factory/roles/*.md`: one brief per role. An agent is a `general-purpose` subagent told to read its brief.
- `factory/evals/<case-name>/`: test cases in the `claude plugin eval` layout (prompt, starting files, graders).
- `factory-workspace/`: test run outputs, created on demand next to the skill. Disposable; never part of the skill.

## How to work here

- **Grow from the baseline in small steps.** Add machinery (scripts, a ledger, per-task modes, a dashboard) only when the user asks for it or a test shows the loop needs it. Do not port pieces of the old suite back in on your own initiative.
- **Skill text is a prompt, not documentation.** Write it for the agent that will read it: imperative, lean, and with the reason behind each rule so the agent can apply it to cases the text did not foresee. Avoid all-caps MUST/NEVER rules without a reason.
- **Keep the roles independent.** The value of the team is fresh context. Changes must not let a reviewer see the implementer's narrative, must not use `subagent_type: "fork"`, and must not let two writers own the same file.
- **Keep the skill self-contained.** It currently needs no install step beyond copying the folder. Anything that requires writing to `~/.claude/` (for example custom agent definitions) is a design change to raise with the user first.
- **Skill and role files are in English.** `README.md` is in Vietnamese; keep it in sync when the team, the loop or the layout changes.
- `SKILL.md` stays under about 500 lines; move detail into a referenced file instead of growing it.

## Testing

Use the `skill-creator` skill's workflow: run each case in `factory/evals/` with the skill and without it, save results under `factory-workspace/iteration-N/`, grade, and show the user the viewer before revising. A factory run starts three to five agents, so confirm with the user before running the full set.

## Boundaries

- An older Factory suite is still installed in `~/.claude/skills/` (its own git repo) with agents in `~/.claude/agents/`. It shares the name `factory`. Do not modify, replace or delete it unless the user asks.
- Untracked and ignored files (for example `factory-workspace/`) are not recoverable through git, so move them to the Trash instead of removing them outright, and look at the target first.
- Commit or push only when the user asks.
