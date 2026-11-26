---
name: factory-clarify
description: The one step before a factory build - take a GitHub issue or a plain request, grill the person until it is concrete, and write it as a ready ticket (criteria C1..Cn, UI and states, data, permissions, copy, out of scope), with mockups drawn from the app's own components for every new screen, checked by code and by the planner, then approved by the person and handed to the AI. Use when the user asks to clarify, refine or spec an issue or a feature, says "/factory clarify", or asks the factory to build something that is not a ready issue yet, even if they do not name this skill.
---

# Factory clarify

You turn a request into a ticket the factory can build without asking anyone anything. The request is a GitHub issue (`#12`, a URL) or a sentence the person typed. You find out what you can from the project, ask the person the rest, draw what a new screen will look like, and get the person's approval. Then the ticket is the AI's: a factory run builds it, and nobody is asked again.

Why this step carries so much: every agent after it works from the ticket alone and never meets the person. A gap here is a run that stops to ask, or a run that guesses and builds the wrong thing. Settle it here, where someone can answer.

You do not design the code. Which files change and how is the planner's job, in the run, against the code as it is then. The ticket says what must be true when it is done, and what it looks like.

`<factory>` below is the factory skill's directory; its scripts and the `ba-ticket` skill's references are used throughout.

## 0. Is the project set up?

Run `node <factory>/scripts/init-status.mjs .`. If it says `none`, tell the person that `/factory init` sets the project up (profile, decisions, UI catalogue) and that clarify works much better after it; ask whether to run it first. If it is `stale` with only `catalog`, run `node <factory>/scripts/scan-ui.mjs .` and go on.

## 1. Take the request

- **An issue**: `gh issue view <n> --json number,title,body,state,labels,comments,url` and its sub-issues (`gh api repos/{owner}/{repo}/issues/<n>/sub_issues`). If it already passes `node <factory>/scripts/ready-check.mjs <n>` and carries `ready`, say so and ask whether to clarify it again. Keep the original text: you will rewrite the body, and the person's own words must stay in it, quoted under **Original request**.
- **A prompt**: the person's text is the request. It becomes an issue only at the end, once approved.

Give the work a key: the issue number, or `draft-<few-words>` until the issue exists. Keep your working files in `.factory/runs/<key>/` (not committed): `draft.md`, the questions and answers.

## 2. Read before you ask

Read only what the request touches, and stop when you can write the questions:

- The profile `.factory/project.json`, the decisions file, the product file, and the defaults in `GEMINI.md` or `AGENTS.md`. A rule already decided there is not asked again, and the ticket must not contradict it.
- The UI catalogue `.factory/design/ui-store/catalog.md` and, if taken, the screenshots: which screens and components exist.
- The code the request touches: search for it and open the files that matter, to know what exists, what it is called, and what would have to change. Do not plan the change.
- The checklist for the request's kind in `ba-ticket/references/checklists.md` (`crud`, `form`, `list`, `auth`, `payment`, `integration`, `report`, `ui`, `bug`, `other`).
- How earlier tickets of that kind went: `bash <factory>/scripts/issue-history.sh --kind <kind> --limit 20`. The questions they had to ask later are the ones to ask now.

## 3. Grill

Ask in waves of at most three questions, the ones whose answers change the most first. Number them and put your recommended answer under each, marked as yours, so the person can say "yes" or "you pick". If the `grill-me` skill is installed, follow its way of questioning; this skill decides what to ask.

Ask about behaviour, never about implementation: who may do it, what happens in each case that goes wrong (empty, invalid, no permission, offline, a limit), the numbers, the exact copy, what is left out. Go through every checklist item for the kind: each is something an earlier run stopped to ask. An item that does not apply goes into **Out of scope**, said on purpose. An answer that settles a rule for the whole product becomes a line for the decisions file (with source `#<n>` or the key).

Stop asking when every checklist item is answered or out of scope and you could write every criterion with a concrete example. If the person does not know something, the ticket is not ready: leave that part out of scope, or wait.

## 4. Write the ticket

Write `.factory/runs/<key>/draft.md` from `ba-ticket/references/ticket-template.md`, by the rules of the `ba-ticket` skill's step 3: criteria `C1..Cn`, each checkable from outside, as Given / When / Then with real values; no vague word ("fast", "easy", "appropriate", "etc.", "nhanh", "phù hợp", "v.v."); one wording per rule; every behaviour that must hold is a criterion; **Data and API**, **Permissions**, **Copy** filled in or "None"; **Out of scope** explicit; **Depends on** with real issue numbers. Add **Original request** at the end, quoting the person's words or the issue's original body.

**Size.** One ticket is one pull request. If it has more than about eight criteria, criteria about unrelated parts, or a part that must exist before the rest can be used (a data model before its screens), propose splitting it into several tickets, each usable on its own, in build order, and let the person decide. Each becomes its own draft and key, and later its own issue, linked by **Depends on**. Do not split into sub-issues: inside one ticket, the planner splits the work against the code, and code checks its split.

## 5. Draw what is new

For each screen the ticket needs, check it against the catalogue and the existing screens:

| The screen | What to do |
|---|---|
| exists and does not change | name it in **UI and states**, with its screenshot if there is one |
| changes a little (a column, a label, a field that follows an existing pattern) | describe the change in words in **UI and states** |
| is new, or its layout changes | draw a mockup |

**Draw from the app itself**, never from scratch: compose the screen from the components in the catalogue (the preferred one of any duplicate) and the project's tokens, following the pattern file the catalogue names for a form, a table, an empty state or a dialog, with realistic copy and sample data. Build it where the app can render it: a Storybook story under a `mockups/` folder when the project has Storybook, otherwise a page the app serves only in development, or, if neither works, a standalone HTML page that imports the project's token CSS. Draw every state the ticket lists (empty, loading, error, many items, the narrow screen).

Screenshot each state at 1440 and 390 wide (and dark, if the app has it) with `ui-refine-loop`'s `scripts/shoot.mjs`, into `.factory/design/mockups/<key>/<screen>-<state>-<viewport>.png`. Look at every image yourself before you show it. Show them to the person, take their comments, redraw, repeat until they are happy. If the team designs in Figma or Penpot instead, export the approved frames into the same folder and skip the drawing.

Fill **UI and states** with the path of each image. These are what the build follows and what QC compares the finished screens with.

Then list the **screens that must not break**: every existing screen the ticket changes, and every screen that uses a component the ticket changes (the catalogue's usage of that component tells you which). Write them under **UI and states** as `Must not break: <screen> (<route>)`, with what the change intends there if anything. The build shoots them before it starts, and QC compares them after, so a change to a shared component cannot quietly break a screen nobody was looking at.

## 6. Check it is ready

1. `node <factory>/scripts/ready-check.mjs --body-file .factory/runs/<key>/draft.md`. Fix every problem it names.
2. Run the planner alone on it, as a factory run with `questionsOnly: true` (the factory skill's "Check an issue is ready"): the contract from the draft, the profile's part from `project-check.mjs --contract`, and `design.screens` from the mockups. Every question it returns goes back to the person (step 3) and into the draft, then run it again, until it has none.
3. Keep what the planner planned: write `.factory/plans/<key>.json` with `{ "base": "<the commit it planned against>", "criteria": [the contract's criteria, as written], "specs": [...], "overview": "...", "risk": "...", "surfaces": [...] }`; the build reuses these specs only while the criteria and the files they touch are unchanged, and summarise it for the person in a few lines: how the work divides, which screens and modules it touches, its risk, and what will need a person before merging (auth, money, a migration, a dependency, CI, a visible screen).

## 7. The person approves

Show the person the whole package: the ticket, the mockups, the plan summary. Ask them to approve it, change it, or drop it. Change → back to the step it concerns. Nothing goes to GitHub before they approve.

## 8. Hand it to the AI

Say exactly what you will do on GitHub, then do it:

1. **The issue.** For a prompt: `bash <factory>/scripts/factory-issue.sh create --kind <kind> --title "<title>" --body-file <draft>`; the key becomes its number (rename the mockup folder and plan file to it, and fix the paths in the body). For an issue: `gh issue edit <n> --body-file <draft>`, and label it with `bash <factory>/scripts/factory-issue.sh labels` then `gh issue edit <n> --add-label factory --add-label kind/<kind>`.
2. **The branch.** From the default branch as it is on GitHub, `git switch -c factory/<n>`, commit the mockups and their source (the stories or pages), `.factory/plans/<n>.json`, and the new lines of the decisions file, by path; push it. The build continues on this branch, so the pull request shows what was approved next to what was built.
3. **The comment.** On the issue: the plan summary, the mockups (as links to the images on the branch), and the decisions taken.
4. **AI mode.** Add the label `ready`. From now on the ticket is the AI's: the dispatcher (if the project has one) or `/factory #<n>` builds it, and nobody is asked anything until the pull request. A run that still finds a question posts it on the issue and goes back to `needs-info`.

## Report

The issue (number and link) or issues, in build order; the criteria in one line each; the mockups by screen; the plan in two lines and its risk; the decisions recorded; what was left out of scope; and what happens next (the dispatcher builds it, or run `/factory #<n>`).
