# The batch folder and the plan

## The batch folder

Work in a folder in your scratchpad, one per batch:

| File | What it holds |
|---|---|
| `batch.json` | `id` (lower-case words joined by hyphens, e.g. `todo-v1`), `title` (the epic's), `architecture` (as in the plan below), optional `waveLimitReason`, and `tickets`: `[{ "key": "T1", "title": "..." }]` in any order |
| `epic.md` | The epic's own text: an Objective (what is true when every ticket is merged), the flow a user walks through, the design direction in a line, links to the issues the batch came from. No criteria. `publish-batch.mjs` adds the Tickets list and the Plan block. |
| `T1.md`, `T2.md`… | One ticket body each, by [ticket-template.md](ticket-template.md). Wave, size, owns, uses, depends on and criteria are read from here and nowhere else. |
| `prototype/` | `index.html`, `prototype.json`, `shots/`, when the batch has a prototype ([prototype.md](prototype.md)) |
| `said.md` | The user's words, one line each. Never published. |
| `published.json` | Written by `publish-batch.mjs` and `pull-batch.mjs`: repository, epic, each key's issue number and `updatedAt`, which ticket holds which criterion, the hash. Do not edit it. |
| `plan.json` | Written by `publish-batch.mjs`: the plan as published. |

## The plan

The plan is the one interface between this skill and the factory. Its schema is [plan-schema.json](plan-schema.json); `check-batch.mjs` validates it, and the factory may use the same file with any JSON Schema validator.

The tickets are the source of truth. The plan is built from them (`buildPlan` in `scripts/lib.mjs`), never written by hand: change a ticket and the plan follows. The epic's body holds a copy under `## Plan`, in a fenced `json` block, for people and for the factory to compare against.

```json
{
  "id": "todo-v1",
  "title": "Todo list v1",
  "repo": "owner/name",
  "epic": 10,
  "hash": "sha256:…",
  "architecture": {
    "layout": "pages-features",
    "checks": [{ "name": "test", "command": "npm test" }, { "name": "e2e", "command": "npm run e2e" }, { "name": "lint", "command": "npm run lint" }],
    "stack": "Vite + React + TypeScript, Vitest, Playwright",
    "shared": ["src/app/App.tsx", "src/shared/tasks/types.ts", "src/pages/list/page.tsx"],
    "extensionPoint": "src/pages/<page>/features/<feature>/index.ts, loaded by src/app/registry.ts",
    "contracts": [{ "name": "TaskRepo", "file": "src/shared/tasks/repo.ts", "summary": "list(), add(title), …" }]
  },
  "prototype": { "branch": "prototype/todo-v1", "commit": "…", "path": "docs/prototypes/todo-v1/" },
  "waves": [
    { "wave": 0, "tickets": [{ "issue": 11, "key": "T1", "title": "…", "owns": ["CLAUDE.md", "src/app/**", "src/shared/**", "src/pages/list/page.tsx"], "uses": [], "dependsOn": [], "newDependencies": ["@fontsource/be-vietnam-pro@5.1.0"], "criteria": ["C1", "C2"], "size": "M", "sizeReason": "…" }] },
    { "wave": 1, "tickets": [{ "issue": 12, "key": "T2", "title": "…", "owns": ["src/pages/list/features/add-task/**", "e2e/list/add-task/**"], "uses": ["TaskRepo", "slot:input"], "dependsOn": [11], "newDependencies": [], "criteria": ["C3"], "size": "S", "sizeReason": "…" }] }
  ]
}
```

- A **draft** (before publishing) has no `epic` or `repo`, and names tickets by `key`, with `dependsOn` as `"T1"`.
- `prototype` is there when the batch has one: the factory copies `git archive <commit>` of that branch into `path` once, when it prepares the batch, so every ticket's criteria can name the same file.
- `layout` is `pages-features` when the repository had no code (`scripts/detect-layout.mjs`) and the batch laid it out as [slicing.md](slicing.md) says; `existing` otherwise, and then nothing about structure changes. The factory generates `docs/ARCHITECTURE.md` from the plan only for `pages-features`.
- `checks` is required and not empty: the commands the factory runs as the project's checks. Existing repository: from `package.json`, CI or its docs. New repository: the commands the foundation makes work, each named in a foundation criterion.
- `newDependencies` comes from each ticket's **New dependencies** section (`[]` when it has none). The factory adds the union to `package.json` and installs it once before building; no slice owns `package.json` (only a new repository's foundation, for its scripts and settings).
- A contract's `file` is append-only after wave 0: a later ticket may add to it, never change what is there. The factory relies on this when it widens a ticket's Owns into a contract file.
- `waveLimitReason` is there only when the batch has more than 3 waves.

## The hash

`planHash` in `scripts/lib.mjs`: sha256 over a JSON array of the tickets, sorted by wave then id, each `{ id, wave, owns (sorted), uses (sorted), dependsOn (sorted), newDependencies (sorted), criteria: [[id, text with whitespace collapsed], …] }`, where `id` is `#<issue>` (or the key in a draft). Titles, objectives, out of scope, notes, the prototype section and the size are left out: changing them does not change how the batch can run.

The hash in the epic is the one of the tickets as `check-batch` passed them at publishing. The factory rebuilds the plan from the tickets with `check-batch.mjs --repo <r> --epic <n> --write <file>` (a few seconds, no tokens): `hash: matches` says nobody changed the tickets' contract since; a different hash is reported as "changed after BA", and the run goes on if `check-batch` passes. A revision by this skill updates the hash.

## The epic's body

```markdown
<epic.md, with #T<n> replaced>

## Tickets

Tickets of one wave run in parallel; a ticket starts once what it depends on is merged.

**Wave 0** (foundation)

- #11 (M)

**Wave 1**

- #12 (S)
- #13 (M)

## Plan

Written by new-ba for the factory. …

```json
{ … }
```
```

`pull-batch.mjs` strips the Tickets and Plan sections back off into `epic.md`.
