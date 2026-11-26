# GEMINI.md

<One paragraph: what this product is, for whom, and where PRODUCT.md, DESIGN.md, DECISIONS.md and the ADRs are.>

## Run

- Install: `<command>`
- Run locally: `<command>` (reads `.env`; copy `.env.example`, which holds test values only)
- Preview: <how a pull request gets a preview URL, or "none">

## Checks

Each exits non-zero on failure; CI runs the same commands.

- Tests: `<command>`
- Types: `<command>`
- Lint: `<command>`
- Build: `<command>`

## Layout

- `<dir>/`: <what lives there>

## Patterns

- <How a new screen, endpoint, model or test is added here, with the file to copy from.>

## Project defaults

Settled for every ticket; a ticket says otherwise only on purpose.

- Lists: <page size, default sort, empty-state rule>
- Dates and numbers: <format, time zone, currency storage and display>
- Errors: <how they are shown to users, how they are logged>
- Forms: <when validation shows, what happens to input after an error>
- Deletion: <soft or hard by default, confirmation rule>
- Names: <language and case of code identifiers, routes, database fields>
- Access: <default role required for a new screen>
