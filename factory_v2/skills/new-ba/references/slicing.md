# Slicing a batch

Steps 2–6 of the skill: how to read the code, cut slices, give them their files, pull out the foundation and order the waves. The test of a good cut: every ticket of a wave can be built by someone who has never heard of the others, from the foundation's contracts alone, and merged without touching a line another ticket touched.

## Read the architecture (existing repository)

1. **The modules.** List the top-level folders under the source root and what each holds, a line each. Open the entry point (`main.tsx`, `app.py`, `cmd/`), the router and the store or database layer.
2. **The hot files**: the ones most features change. Look for them by name (routes, `App`, store, schema, migrations, `i18n`, global CSS, config, a central `index.ts` of exports) and by history:

   ```bash
   git log --since=6.months --name-only --pretty=format: | grep -v '^$' | sort | uniq -c | sort -rn | head -20
   ```

   A file near the top that is not a test is a hot file.
3. **The extension points**: how a feature can be added without editing a hot file. A plugin or feature registry, a folder the router globs, a DI container, a `components/` convention, an event bus. When there is none, the foundation can add one (below).
4. **The checks**: the commands the repository runs as its checks, from `package.json` scripts, CI (`.github/workflows/`) or its docs: test, e2e, lint, typecheck, build.
5. Write `architecture` in `batch.json`: `layout: "existing"`, `checks` (`[{ "name": "test", "command": "npm test" }, …]`), `stack` (one line), `shared` (the hot files the batch would touch), `extensionPoint` (one line, or `""`).

Read only as far as the cut needs; you are not planning the code. **Follow the repository's own structure**: its folders, its names, where it keeps its tests. Add no `src/app`, `pages/`, error boundary, import rule, `CLAUDE.md` or feature-folder template, and propose no restructuring; a slice owns the files and folders where the repository already puts that kind of code.

## Choose the architecture (new repository)

A repository is new when it has no code yet: no commit, or only `README`, `LICENSE`, `.gitignore`, `.github/` and `docs/`. Ask the script, never guess:

```bash
node <skill>/scripts/detect-layout.mjs <repository root>     # {"layout":"pages-features"|"existing", "codeFiles": n, ...}
```

`existing` sends you back to the section above. `pages-features` means the batch lays the repository out so that **an error names the folder to fix**, and every feature still builds in parallel. Ask nothing the user has already settled (a stack in another of their repositories, a stated preference); otherwise propose the smallest skeleton that runs: for a web app, Vite + React + TypeScript, Vitest, Playwright. Then:

```
src/
  app/                  shell, router, registry, error boundary      (foundation)
  shared/               types, contracts, shared UI                   (foundation; after wave 0 only added to)
  pages/<page>/
    page.tsx            the page's frame and its slots                (foundation)
    features/<feature>/ one feature of this page = one ticket
  features/<feature>/   a feature on several pages (search, sign-in)
e2e/<page>/<feature>/   e2e tests at the same path
docs/
CLAUDE.md
```

**Pages outside, features inside.** A page is a screen of the prototype; the foundation draws every page (`page.tsx`, its slots and its route), so every feature is wave 1. A new page becomes a ticket of its own only when it is added to a batch already published.

**Every feature folder has the same shape:**

- `index.ts` declares `id`, `slot`, `order`, `Component`, `routes`, `storageKeys`, `shortcuts`; the registry in `src/app/` loads every `index.ts` by itself (`import.meta.glob('../pages/*/features/*/index.ts')` and `../features/*/index.ts`), so adding a feature edits no shared file;
- `ui/` components, `logic/` pure functions, `data/` reading and writing through the contracts of `shared/`;
- tests beside the code they test;
- `README.md`, about five lines: what it does, its issue number, its criteria, the contracts it uses.

A slice owns its feature folder and its e2e folder: `src/pages/list/features/add-task/**` and `e2e/list/add-task/**`. `check-batch` refuses a slice that owns anything else, `src/app/**`, `src/shared/**` or a `page.tsx` included, and a foundation that does not own `CLAUDE.md`, `src/app/**` and the `page.tsx` of every page.

**The checks** are the commands the foundation makes work, each with a foundation criterion: typically `npm test`, `npm run e2e`, `npm run lint`, `npm run typecheck`. Write them into `architecture.checks`; the factory runs exactly those. Set `layout: "pages-features"`.

In another stack, use what it does naturally for the same split: Next.js `app/<route>/` with `_features/<feature>/`, Django one app per page with a `features` package, a Go `internal/pages/<page>/<feature>` package with `init()` registration.

## Cut the slices

A slice is one thing a user can do, start to end, and test from outside: "add a task", "filter tasks by status", "export orders to CSV". It holds everything that behavior needs: its part of the screen, its logic, its use of storage, its tests.

| Cut by behavior (right) | Cut by layer (wrong) |
|---|---|
| add a task · mark done · delete · filter | data model · store · list screen · actions |
| sign up · reset password · edit profile | user table · auth API · auth screens |

A layer cut makes a chain where each ticket waits for the last, and none can be tested by a user alone. Signs a slice is too big: more than about eight criteria, criteria about unrelated parts of the product, no one-line answer to "what can a user do after this merges". Signs it is too small: it cannot be seen or tested without another slice (then merge them), or it is one criterion that changes one string (fine as S, but consider joining it to the slice that shows that screen).

## Give each slice its Owns

- A slice owns its feature folder: `src/pages/list/features/add-task/**` in a new repository (above), or where the repository puts that kind of code in an existing one. Its unit tests live inside it; its e2e tests in its own e2e folder (`e2e/list/add-task/**`), or the repository's own place for them.
- Write each path in backticks, one per line; a folder as `dir/**`. No braces.
- Owns always has room for the ticket's tests: its folder (`dir/**`), its test files, or an `e2e/` path. `check-batch` refuses a ticket without, because the factory would stop it at its Owns check.
- No slice owns `package.json` or the lockfile. In a new repository the foundation owns `package.json`, because it writes the scripts (`dev`, `test`, `e2e`…) and settings; even then its packages go under **New dependencies**, never into `package.json` by hand. A package a ticket needs goes under its **New dependencies** as `name@version`; the factory adds them all to `package.json` and installs them once before building, and `check-batch` refuses two versions of one package. Nobody owns the lockfile: the factory makes it again after each merge.
- For each slice, also write down the shared files it would have to change. That list is the input of the next step.

## Pull out the foundation

For each shared file, count the slices that need to change it. Whatever two or more need moves to the foundation ticket, as a contract:

| What the slices need | The contract the foundation provides |
|---|---|
| The same data | the type (`Task`) and a store or repository interface (`TaskRepo`), with its storage key or table |
| A place on a shared screen | a slot in the shell, rendered from the registry |
| To be found by the app | the registry and the feature interface |
| To run tests | the test runner, the e2e setup (server start, a fixture to seed data, a reset between tests) |
| To look the same | design tokens, fonts, base styles |
| Navigation, storage, shortcuts | the registry: each feature declares its routes, storage keys and shortcuts in its own `index.ts`; the registry gathers them and throws on a name declared twice |

Each contract goes into `architecture.contracts` as `{ name, file, summary }`, and the summary is exact: names, signatures, data shapes, error behavior, storage keys. For a slot, the registry or a shared store it also states the **lifecycle**, because two slices can each be right alone and break each other once merged: when each slot mounts (at page load, or only once a gate such as sign-in has answered), in which order features mount and run, what a feature may do when it mounts (set list state, read the store) and when that runs again, and which slot may hold back or replace the others (a gate). The foundation has a criterion that states the same, so the factory checks it. A slice lists the contracts it builds on under **Uses**, with what it calls.

**Before you write the foundation, answer each of these for the batch.** Every answer that two slices depend on is a contract with its criterion; a question that does not apply is skipped on purpose. In the first real run both fresh readers found their gaps exactly here, and each round of fixes cost minutes:

- **Who draws the shared parts of a shared screen**: the list itself, group headings, counts, the empty state, the frame of a detail view. One owner each, named in the slot's contract, never "the slices".
- **One element in two places** (a row's meta line and the same data in a detail pane): one component with its variants in the foundation, or two slots, each with an owner.
- **Where actions sit**: the order of the buttons in a row or a toolbar, by a field the slot contract defines.
- **Shared state**: whether the slices share one store instance, how a change made by one slice reaches what another slice shows (subscribe, re-render), and who owns a timer that redraws (a due time that turns overdue every minute).
- **One rule that two slices apply** (a title's length and trimming, a date field and its format, a validator): one function or component in the foundation, or one slice owns it and the other waits a wave. Never both, in one wave, each from its own reading.
- **Errors from the server**: one client wrapper; what an expired session (401) does, kept apart from a first visit with no session; what a network failure shows, and where.
- **Values that identify** (an email, a username): normalised how (case, spaces) and where, once.
- **Widths between 390 and 1440**: the breakpoint where the layout changes, as one token.
- **Test data**: the fields of the e2e fixture or seed that every slice's tests need, so none adds its own.

The foundation holds no feature logic: the store can add a task, but no screen adds one. Its criteria are technical and checkable (the app starts and shows the shell; the tests and e2e run; `TaskRepo` has exactly these methods; a value written through it is there after a reload). Past about eight criteria, feature logic has crept in.

The foundation's own tests assert only what later tickets leave unchanged: the shell shows, the slots exist, a contract has its signature. A state a feature decides (an empty list, what a slot holds) belongs to that feature's tests; asserted in the foundation, the next wave breaks a merged ticket's test.

### With `pages-features`

The foundation also carries, as criteria (see the foundation ticket in [ticket-template.md](ticket-template.md)):

- **every page of the prototype**: its `page.tsx`, its slots and its route, so no feature waits for a page;
- **the import rule**: a feature imports only from `shared/` and `app/`, never from another feature; a page never imports another page's features. Checked by lint (ESLint `no-restricted-imports` or `eslint-plugin-boundaries`, or the stack's equivalent), whose command is in `architecture.checks`;
- **errors that name the feature**: the registry wraps each feature in its own error boundary, and one shared logger; every error and log line starts with `[<page>/<feature>]`, shown by a test;
- **a short `CLAUDE.md`**: the stack, the commands of `architecture.checks`, the folder layout, the feature-folder shape, the import rule, the test naming `<page>/<feature> · C<n> · …`, and the line "The repository map is `docs/ARCHITECTURE.md`, generated by the factory; do not edit it by hand."

### Run in parallel

The factory builds about four tickets at once, each in its own worktree on its own port, and checks this when it prepares the batch. When the project has a dev server or e2e, the foundation carries these as criteria (`check-batch` refuses a batch with e2e whose foundation names no `PORT`):

- the dev server and e2e read `PORT` and `BASE_URL` from the environment;
- e2e always starts its own server, never reuses one already running (`reuseExistingServer: false` or the equivalent);
- e2e runs with the Playwright CLI and writes its results with the JSON reporter;
- CSS is scoped per feature (CSS modules or a per-feature prefix); the only global CSS is the foundation's;
- each feature declares its own routes, storage keys and shortcuts in its own folder (its `index.ts`); the registry gathers them and fails on a name declared twice, with a foundation test that shows it. No slice edits a shared file to register a name, and a clash after merging shows up in that test.

**One foundation, run once, unless it is large.** Every other ticket waits for the foundation, so its length is the batch's: in the first real run a single L foundation took 13 of 37 minutes. When it would be L, or holds more than about six criteria across a server and a screen, split it into two wave-0 tickets that are truly apart, such as a backend (schema, stores, auth, API registry) and a frontend shell (pages, slots, web store, styles), built at the same time. Split only when each part can be checked alone (the frontend against the API contracts with the network stubbed, the backend by its API tests), with the contracts between them stated exactly, and only when `check-batch` confirms their Owns do not overlap; the e2e setup that starts the whole app goes with the part that owns the dev server. The "half a ticket" rule (a ticket that cannot be used alone is half a ticket) does not apply to the foundation: it exists to be built on.

A contract that already exists in the repository is still listed, with its current file; no ticket owns it, and `check-batch` says so as a `look:`.

**Contract files are append-only after wave 0.** A later ticket may add to a contract file (a new method, a new slot, a new type), never change or remove what is there, because merged tickets are built against it. The factory relies on this when a ticket needs its Owns widened into a contract file. A slice that needs an existing contract changed is a new foundation change, not a slice.

## Order the waves

- **Wave 0**: the foundation. Depends on nothing.
- **Wave 1**: every slice that needs only the foundation. Most slices belong here.
- **Wave 2**: a slice that needs another slice's behavior: "undo delete" needs delete; "edit a task" may need the add form. It lists that slice under **Depends on**. Prefer merging the two when they are small.
- **Two slices still sharing a file merge into one ticket.** Queueing them in two waves works, but the second waits for nothing it needs; merging keeps them parallel with the rest.
- **At most 3 waves.** A fourth is allowed only with `waveLimitReason` in `batch.json`, and the report says the code is too tightly coupled to split further.

The factory starts a ticket as soon as everything it depends on is merged, whatever its wave; waves are for people to read. So **Depends on must be complete**: every ticket whose behavior or contract this one uses. Two tickets of different waves that own the same file must be linked by Depends on, directly or through another ticket, or the factory may run them at once. `check-batch` refuses both mistakes.

## Size

| | When | The factory |
|---|---|---|
| `S` | Copy, config, a small bug: at most 3 criteria, no new screen, no auth, money or migration | one agent does all, no reviewer (an S whose diff touches a shared file is raised to M) |
| `M` | A normal feature. The default | one implementer, one reviewer |
| `L` | A complex new screen, many criteria, or anything touching auth, money, migrations or security, however small | a stronger model, a strong reviewer and a security review |

Take the higher of size and risk. The foundation is usually M; L when it holds a migration or auth. Write it as the first line of **Size** with a one-line reason: `M: one form in an existing slot, error cases included`. `check-batch` computes the floor the factory will accept (criteria count, a screen in the prototype, risk words in the criteria and paths) and refuses a size below it.

## Worked example: a todo app

Request: add tasks, mark them done, delete them, filter all / active / done, survive a reload. A new repository, so `pages-features`, with one page, `list`.

| Ticket | Wave | Owns | Uses | Depends on |
|---|---|---|---|---|
| T1 Foundation: shell, router and registry with an error boundary per feature, `Task` and `TaskRepo` (localStorage), the `list` page with slots `input`, `item-action`, `toolbar`, list rendering with a filter hook, Vitest, Playwright and lint with the import rule, tokens and fonts, `CLAUDE.md` | 0 | `CLAUDE.md`, `src/app/**`, `src/shared/**`, `src/pages/list/page.tsx`, `e2e/support/**`, `playwright.config.ts`, `eslint.config.js` | none | none |
| T2 Add a task | 1 | `src/pages/list/features/add-task/**`, `e2e/list/add-task/**` | `TaskRepo`, `slot:input` | #T1 |
| T3 Mark done | 1 | `src/pages/list/features/toggle-done/**`, `e2e/list/toggle-done/**` | `TaskRepo`, `slot:item-action` | #T1 |
| T4 Delete | 1 | `src/pages/list/features/delete-task/**`, `e2e/list/delete-task/**` | `TaskRepo`, `slot:item-action` | #T1 |
| T5 Filter | 1 | `src/pages/list/features/filter/**`, `e2e/list/filter/**` | `slot:toolbar`, `ListFilter` | #T1 |

`architecture.checks`: `npm test`, `npm run e2e`, `npm run lint`, `npm run typecheck`, each named in a criterion of T1.

Two slots in one row (T3 and T4 both fill `item-action`) are fine: each owns its own folder, and the registry orders them by a field the contract defines. The list itself, which every slice shows, is the foundation's; the filter plugs in through a `ListFilter` contract instead of editing the list. Five tickets, two waves, four of them in parallel. An error in the delete button reads `[list/delete-task] …`, and the fix is in `src/pages/list/features/delete-task/`.
