# Repository Map (`AGENTS.md`)

Node.js 22+ native TypeScript API starter (`node --test` + strict `tsc --noEmit`).

## Commands

- Typecheck: `npm run typecheck`
- Tests: `npm test` (or `node --test <files>`)

## Exemplars

- Handler / service: `src/health.ts`
- Test style: `src/health.test.ts`

## Principles

1. Keep pure domain functions cleanly separated from HTTP transport.
2. Validate external input explicitly at boundaries and return clear typed errors.
3. Keep modules concise (≤ 350 lines) and tests behavioral via public interfaces.
