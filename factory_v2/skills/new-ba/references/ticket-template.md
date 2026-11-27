# Ticket template

The title is passed separately: verb-first, what a user can do after this merges ("Add a task"), with the repository's prefix if it has one. The foundation's title says what it sets up ("Set up the app shell, task store and test setup").

Every ticket has these sections under exactly these headings, because `check-ticket`, `check-batch` and the factory read them by name: **Objective**, **Acceptance criteria**, **Out of scope**, **Wave**, **Size**, **Owns**, **Uses**, **Depends on**. **New dependencies** is there whenever the ticket needs a package the project does not have yet: `name@version`, one per line, or `none`; the factory adds every ticket's to `package.json` and installs them at once before building, so an implementer never adds one. No slice owns `package.json`; in a new repository the foundation owns it, for its scripts and settings only. **Prototype** is added by `publish-batch.mjs`; **Notes** is optional. When the repository has an issue form for this type, use its fields too, with their labels as `##` headings.

## Slice ticket

```markdown
## Objective

One or two sentences: what a user can do after this merges, and why it matters.

## Acceptance criteria

- **C5** Given <context>, when <action on a named screen, command or endpoint>, then <observable result>.
- **C6** Given <context>, when <something goes wrong>, then <exactly what the user sees or the system does>.
- **C7** <One observable fact, with its numbers: limits, sizes, formats.>
- **C8** At 1440 and 390 wide, the `input` slot is built to match `docs/prototypes/<batch id>/index.html` at `#list` and `#list-empty` in layout, elements, order, labels and messages, states, colours and fonts; sample data aside, and not pixel for pixel.

## Out of scope

- <What a reader might expect and will not get here> (#T6 has it).

## Wave

1

## Size

M: <one line: why this size>

## Owns

- `src/pages/list/features/add-task/**`
- `e2e/list/add-task/**`

## Uses

- `TaskRepo` from #T1: `add(title: string): Task`, `list(): Task[]`
- `slot:input` from #T1

## Depends on

- #T1: the task store and the input slot

## New dependencies

- `zod@3.23.8`: validates the title

## Notes

Optional background for the implementer and QC; it explains the criteria and adds none.

- **Today:** what happens now, and where you saw it (files, screens). Pointers only.
- **To try it:** what QC needs that the repository does not explain (sample data, a test account by name).
```

## Foundation ticket

Same sections. Its criteria are technical and checkable; each contract of `architecture.contracts` it provides is stated exactly in one criterion, so the factory checks the same shape the slices build on. When the project has a dev server or e2e, it also carries the criteria that let about four worktrees build at once (C1, C4, C5, C6 below; "Run in parallel" in [slicing.md](slicing.md)). Its own tests assert only what later tickets leave unchanged: the shell shows, the slots exist, a contract has its signature; never a state a feature decides, such as an empty list. Each command of `architecture.checks` is named in a criterion (C5, C7 below). With `layout: "pages-features"` (a new repository) it also draws every page of the prototype (C1) and carries the import rule (C7), errors that name the feature (C8) and `CLAUDE.md` (C9); the example below is that case. In an existing repository, leave those three out and follow its structure.

```markdown
## Objective

The shell every slice plugs into: <what it sets up>. It has no feature of its own.

## Acceptance criteria

- **C1** `npm run dev` starts the app on the port in `PORT`; every page of the prototype has its `src/pages/<page>/page.tsx` and its route (here `/` → `src/pages/list/page.tsx`), showing <the shell: header, page frame> and the regions of its slots (`input`, `item-action`, `toolbar`).
- **C2** `src/shared/tasks/repo.ts` exports `TaskRepo` with exactly `list(): Task[]`, `add(title: string): Task`, `update(id: string, patch: Partial<Pick<Task,'title'|'done'>>): Task`, `remove(id: string): void`, `subscribe(fn: () => void): () => void`; `Task` is `{ id: string; title: string; done: boolean; createdAt: number }`.
- **C3** A task written through `TaskRepo` is listed again after the page reloads (localStorage key `todo.tasks.v1`).
- **C4** A feature folder `src/pages/<page>/features/<feature>/index.ts` or `src/features/<feature>/index.ts` exporting `{ id, slot, order, Component, routes, storageKeys, shortcuts }` is rendered in its slot with no other file changed; slots mount in this order: `gate` first, and every other slot only once the gate lets the page through, so a feature's mount code runs after sign-in, again after each sign-in; when two features declare the same route, storage key or shortcut, the registry throws an error naming both, and a test of this ticket shows it.
- **C5** `npm test` runs the unit tests; `npm run e2e` runs the Playwright CLI with the JSON reporter, always starts its own dev server on `PORT` (`reuseExistingServer: false`), opens `BASE_URL`, and clears storage before each test; both pass.
- **C6** Styles are scoped per feature (CSS modules, `*.module.css` inside the feature's folder); the only global CSS is this ticket's `src/app/styles/**`.
- **C7** `npm run lint` and `npm run typecheck` pass, and lint (`eslint-plugin-boundaries` or `no-restricted-imports`) fails when a feature imports from another feature, or a page imports another page's feature; a feature imports only from `src/shared/` and `src/app/`.
- **C8** The registry wraps each feature in its own error boundary, and `src/app/log.ts` is the one logger; an error thrown in a feature, and every log line of it, starts with `[<page>/<feature>]` (`[list/add-task] …`), and the rest of the page keeps working, shown by a test.
- **C9** `CLAUDE.md` states, in under 60 lines: the stack, the commands of `architecture.checks`, the folder layout, the feature-folder shape, the import rule, the test naming `<page>/<feature> · C<n> · …`, and "The repository map is `docs/ARCHITECTURE.md`, generated by the factory; do not edit it by hand."
- **C10** At 1440 and 390 wide, the shell (header, page frame, design tokens and fonts) is built to match `docs/prototypes/<batch id>/index.html` at `#list-empty` in layout, elements, order, labels and messages, states, colours and fonts, with the slots left empty; sample data aside, and not pixel for pixel.

## Out of scope

- Adding, completing, deleting or filtering tasks from the page (#T2–#T5).

## Wave

0

## Size

M: foundation; shell, store and registry contracts, test setup, no feature logic

## Owns

- `CLAUDE.md`
- `src/app/**`
- `src/shared/**`
- `src/pages/list/page.tsx`
- `e2e/support/**`
- `playwright.config.ts`
- `eslint.config.js`

## Uses

none

## Depends on

none

## New dependencies

- `@fontsource/be-vietnam-pro@5.1.0`: the typeface of the design tokens
```

## How to write criteria

- **Numbered across the batch.** The foundation starts at C1, each next ticket continues where the last stopped. An id is never reused, even after a criterion is dropped.
- **One line each**, `- **C5** ...`. Tools read line by line; a second line is lost.
- **Checkable from outside.** Someone holding only the ticket and the product says met or not met without asking you. Where no user sees it (the foundation, a refactor), it is a fact a command or a named file confirms.
- **Every behavior that must hold is a criterion**, the cases that go wrong too (empty, invalid, too long, no permission, offline) when the user expects something specific.
- **One wording per rule.** Say it once, in its criterion; the other sections explain and are not judged.
- **Behavior, not implementation**, except a contract, which is exact because another ticket builds against it.
- **Their words are not narrowed**: "all", "every", "never" and numbers stay as said.
- **Exact copy.** Every label, button text and message in quotes, in the product's language.
- **A UI ticket binds its part of the prototype** in one criterion per page, in the wording above: the slot or part it builds, every state's `#screen`, the path. Only the flow binding when the look is not agreed: "in elements, order, labels and messages, and states, but not in layout, colours or fonts". Never bind more than the ticket builds.
- **Out of scope is explicit**, and points to the ticket that has it.
- **No open questions, no secrets, no real people's data.**
