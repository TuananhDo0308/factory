<!--
The title is passed separately, not in the body: verb-first, what a user can do after this merges, with the repository's prefix if it has one ([FEAT] ...).
Objective, Acceptance criteria, Out of scope and Depends on are in every ticket, under exactly these headings: the factory reads the contract from them.
When the repository has an issue form for this type, use the form's fields and add those of the four it lacks.
Leave these comments out of the issue.
-->

## Objective

One or two sentences: what this delivers and why it matters.

## User stories

<!-- For a new capability; leave out when the form has no such field. -->

- As a <specific user in a specific situation>, I want <capability>, so that <benefit>.
- (1–3 more for other users or situations: a first-time user, an admin, the recipient, someone who denied a permission.)

## Acceptance criteria

Each criterion is checked on its own when the pull request is reviewed. Nothing outside this list is checked.

- **C1** Given <context>, when <action on a named screen, command or endpoint>, then <observable result>.
- **C2** Given <context>, when <something goes wrong>, then <exactly what the user sees or the system does>.
- **C3** <One observable fact, with its numbers: limits, sizes, formats.>
- **C4** <A technical constraint the user requires, as a fact someone can confirm: an API that must not change, a library that must be used.>

- **C5** <For each page of a screen change with a prototype: the prototype criterion, as references/prototype.md words it.>

## Out of scope

- <What a reader might expect and will not get here> (see #<issue> if another ticket has it).

## Depends on

- #<issue>: <what it provides that this needs>. Or "none".

## Prototype

<!-- For a ticket with a prototype: what prototype-section.mjs prints, filled in once the issue has its number. Leave out otherwise. -->

## Notes

Optional. Background for the planner and QC; it explains the criteria and does not add to them.

- **Today:** what happens now, and the screens or files where you saw it. Pointers only, not a plan.
- **To try it:** what is needed that the repository does not explain (a test account, a sandbox service, sample data). Names only, never secret values.
- The user flow step by step, examples, links.
