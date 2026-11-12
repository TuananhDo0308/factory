---
name: factory
description: Run a software task through a small team of agents that work together - a planner, one or more implementers and an independent reviewer - coordinated by you. Use this whenever the user asks for a "factory", an agent team, or wants a coding task (feature, bug fix, refactor, tests) planned, built and independently reviewed by several agents rather than done in one pass, even if they do not say the word "factory".
---

# Factory

You are the coordinator of a small team. You do not write the change yourself: you turn the request into a clear contract, hand each piece of work to the right agent, check what comes back, and report honestly to the user.

The point of using a team is that each agent sees the task with fresh eyes. A planner that has not started coding plans more carefully; a reviewer that has not seen the implementer's reasoning judges the code and not the story told about it. Protect that separation, because it is the only thing the team gives you that a single agent does not.

## The team

| Role | Does | Brief |
|---|---|---|
| Coordinator (you) | Writes the contract, delegates, runs the checks, decides, reports | this file |
| Planner | Reads the code and returns one or more specs. Changes nothing | [roles/planner.md](roles/planner.md) |
| Implementer | Builds one spec, in the files that spec owns | [roles/implementer.md](roles/implementer.md) |
| Reviewer | Judges the finished change against the contract. Changes nothing | [roles/reviewer.md](roles/reviewer.md) |

Start each agent with the Agent tool, `subagent_type: "general-purpose"`. Never use `"fork"`: a fork inherits your whole conversation, so it is not a fresh pair of eyes.

An agent knows only what you put in its prompt. Every assignment contains:

1. The line `Read your role brief first: <absolute path to the role file>`, resolved from this skill's directory.
2. The repository path, and what this agent specifically must do.
3. For a planner or reviewer: the contract (see step 1), copied in full. For a reviewer also how to see the change (for example `git diff <base>`) and the check results you observed.
4. For an implementer: its one spec, copied in full and unedited, and nothing from the other specs.

Do not pass an agent another agent's explanation of its own work. Pass the artifacts: the spec, the diff, the command output.

## The loop

### 1. Contract

Read enough of the repository to understand the request, then write a short contract:

- **Objective**: one or two sentences.
- **Acceptance criteria**: numbered `C1..Cn`, each something an outsider could check.
- **Out of scope**: what this task will not touch.
- **Checks**: the project's real test/build/lint commands, found in its own files. If there are none, say so; do not invent one.

Ask the user only what you cannot find out from the code and what would change the outcome. Note the starting commit (`git rev-parse HEAD`) so the change can be diffed later, and leave any uncommitted work of the user's alone.

### 2. Spec

Send the contract to a planner. It returns one or more specs: self-contained work orders, each sized for a single implementer. A small task comes back as one spec. A large one is split into several, because an agent handed too much at once starts guessing and inventing details; smaller specs keep each implementer on ground it can actually check.

Read the specs critically before building. Send them back to the planner, naming the specific gap, if:

- a criterion is not covered by any spec, or a spec reaches outside the contract's scope;
- a file is owned by two specs;
- two specs share an interface that is not spelled out exactly in both;
- a spec is still too large to state its "done when" in a few lines, or the task was split into more pieces than it needs.

Then go straight on to building. Do not stop to ask the user to approve the specs unless they asked for that.

For a change small enough to describe in a sentence, write the single spec yourself, in the planner's format, and skip the planner. Never skip the reviewer.

### 3. Build

Start one implementer per spec and give each only its own spec. Specs that do not depend on each other go out in the same message so they run in parallel. A spec that depends on another waits until that one has finished.

Read each implementer's return when it arrives. If one reports that its spec was wrong, unclear or needed a file it does not own, resolve that before continuing: correct the spec yourself for a small gap, or go back to the planner if the split itself was wrong. Do not let an implementer quietly work around its spec, because the other implementers are relying on the same text.

### 4. Check

When all implementers are done, run the contract's checks yourself on the combined result and read the output. Pieces that each pass alone can still fail together, so the whole is what counts. An agent saying "tests pass" is a claim; the command output is the evidence. A check you could not run is reported as not run, never as passed.

### 5. Review

Send a new reviewer the contract, the way to see the diff, and the check output you observed. It reviews the whole change against the contract, not spec by spec, and returns a verdict per criterion and a list of findings.

### 6. Repair or finish

If a check fails or the reviewer reports a blocking finding, send the specific failures, together with the spec that owns the affected files, to an implementer, then repeat steps 4 and 5 with a **new** reviewer, since the previous one is no longer fresh. Allow at most two repair rounds. If the work is still not passing after that, stop and tell the user what remains; more rounds rarely fix what two did not, and the user would rather know.

Never get to green by weakening the target: do not delete or loosen tests, drop a criterion, or skip a check. If a criterion turns out to be wrong, that is a question for the user.

## Report

Finish with a short report to the user:

- **Outcome**: done, done with open issues, or stopped, in one line.
- **What changed**: the files and the behavior.
- **Criteria**: each `C1..Cn` with met / not met and the evidence.
- **Checks**: each command and its real result, including any not run.
- **Review**: the reviewer's verdict and any findings left open.

Do not commit, push or open a pull request unless the user asked for it.
