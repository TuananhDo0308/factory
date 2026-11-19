---
name: tech-lead
description: Tech-lead step of the factory pipeline - read an approved PRODUCT.md and the client's constraints, propose two or three stacks with their trade-offs, record the one the tech lead chooses as an ADR, and set up the project skeleton (repository layout, run and check commands, CI, CLAUDE.md with the project's defaults) that every factory run builds on. Use after client intake, when someone asks to choose a stack, write an ADR, scaffold or bootstrap a project, or set up a repository for the factory, even if they do not name this skill.
---

# Tech lead

You prepare the ground the factory builds on. The person at the keyboard is the tech lead; they decide, you propose and then do the setup. You read what the client approved and leave behind a stack decision, a project that builds and tests green while still empty, and the written defaults that let agents build without guessing.

Why this matters: the factory's planner and implementers follow the project's existing patterns and run its commands. In an empty or undocumented repository there are no patterns to follow and no commands to run, so every agent invents its own, and the specs disagree.

## 1. Read

`PRODUCT.md` (users, journeys, numbers, constraints, especially technology the client requires or refuses and who runs the product after launch), `DECISIONS.md`, and any existing code. If `PRODUCT.md` is missing or not approved, stop: run `client-intake` first.

## 2. Propose stacks

Two or three options that fit the constraints, not a survey. For each: the pieces (language, framework, database, hosting, auth, payments or other services the journeys need), why it fits this product, what it costs to run at the numbers in `PRODUCT.md`, who can maintain it after launch, and its main risk. Recommend one and say why. Ask about anything that changes the choice and that `PRODUCT.md` does not say (the team's experience, existing contracts with a cloud).

The tech lead chooses. Do not start setting up before they do.

## 3. Record the decision

Write `docs/adr/0001-stack.md` from [references/adr-template.md](references/adr-template.md): the context, the options with their trade-offs, the choice and its consequences. Later decisions of the same weight (a queue, a second database, a change of host) get their own numbered ADR.

## 4. Set up the skeleton

On a branch, the smallest project that runs and is checked:

- The framework's own starter, not one you invent, with the layout the framework's documentation recommends.
- One check per kind that the factory can run: a test command with one passing test, a type check if the language has one, a linter, a build. Each is one command that exits non-zero on failure.
- CI on pull requests running exactly those commands.
- A way to run the product locally in one command, with every secret it needs read from an example env file (`.env.example`) that holds test values only.
- A preview deployment per pull request if the host offers one, so the client can try each change.

## 5. Write the defaults down

Create or extend `CLAUDE.md` (and `AGENTS.md` pointing to it if other tools are used) from [references/claude-md-template.md](references/claude-md-template.md): how to run the product and each check, the layout, the patterns to follow, and the **project defaults**: the decisions nobody should have to ask about per ticket (page size, date and number formats, time zone, how errors are shown and logged, naming, how money is stored). The factory's planner treats a default written here as settled, not as a guess, so every default you write saves a question later; every one you leave out is one a run may stop on.

## 6. The tech lead approves

Open a pull request with the ADR, the skeleton and `CLAUDE.md`. It is ready when CI is green on it and the tech lead approves. Record the stack decision in `DECISIONS.md` with the ADR as its source.

## Report

The stack chosen and why, the pull request, the commands for run and each check, the defaults written, anything left open, and what comes next: `brand-design` if the look is not settled, then `ba-ticket` for the MVP journeys.
