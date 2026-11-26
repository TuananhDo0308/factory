# <Verb-first title: what a user can do after this merges>

## Objective

One or two sentences: what this delivers and why it matters.

## User stories

- As a <specific user in a specific situation>, I want <capability>, so that <benefit>.
- (1–3 more for other users or situations: a first-time user, an admin, the recipient, someone who denied a permission.)

## Acceptance criteria

Each criterion is checked on its own when the pull request is reviewed. Nothing outside this list is checked.

- **C1** Given <context>, when <action>, then <observable result>.
- **C2** Given <context>, when <something goes wrong>, then <exactly what the user sees or the system does>.
- **C3** <One observable fact, with its numbers: limits, sizes, formats.>

## UI and states

For a change anyone can see; write "No visible change" otherwise.

- Screens: <screen> — <approved mockup in the repository, e.g. .factory/design/mockups/<issue>/<screen>.png>.
- States each screen must show: empty, loading, error, many items (<number>), narrow screen (390 px), and any other this feature has.

## Data and API

What is read, created, changed or deleted, with its fields and limits, and any API that is added or changes. "None" when nothing is.

## Permissions

Who may do each action in this ticket, and what everyone else sees when they try. "Everyone who can reach the screen" is an answer too.

## Copy

The exact text of every new label, button, message and error, in the product's language. "None" when there is no new text.

## Out of scope

- <What a reader might expect and will not get here> (see #<issue> if another ticket has it).

## Depends on

- #<issue>: <what it provides that this needs>. Or "none".

## Constraints

Optional. Only technical constraints the user requires (an API that must not change, a library that must be used). Leave out otherwise.

## Notes

Optional. Background that helps the developer understand the criteria: the user flow step by step, examples, links. It explains the criteria; it does not add to them.
