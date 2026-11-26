# Repository Map (`AGENTS.md`)

Next.js 16 (App Router) + React 19 + TypeScript strict + Tailwind CSS v4 + `shadcn/ui` primitives + `lucide-react` + Vitest (`happy-dom` + `@testing-library/react`).

## Commands

- Dev server: `npm run dev` (respects `PORT`)
- Typecheck: `npm run typecheck`
- Lint: `npm run lint` (or `npx eslint --max-warnings 0 <files>`)
- Unit / UI tests: `npm test` (or `npx vitest run <files>`)
- Production build: `npm run build`

## Structure

- `src/app/` — Next.js App Router pages and global CSS tokens (`globals.css`)
- `src/components/ui/` — Pre-built accessible UI primitives (`Button`, `Input`, `Textarea`, `Badge`, `Card`, `Dialog`, `Checkbox`, `Select`, `Separator`, `Tabs`). Reuse these instead of raw styled HTML controls.
- `src/components/` — Product UI components (keep ≤ 300 lines each)
- `src/lib/` — Pure TypeScript domain logic and stores (keep ≤ 350 lines each)
- `.factory/design.md` — Visual direction and semantic tokens

## Exemplars (Match This Quality & Style)

- Component style: `src/components/exemplar-card.tsx`
- Behavioral UI test style: `src/components/exemplar-card.test.tsx`

## Coding Principles

1. Reuse `@/components/ui/*` primitives and `lucide-react` icons for crisp, uniform UI.
2. Keep main workspace content dominant above the fold; keep secondary/repeated row actions compact (icon buttons or menus).
3. Use semantic CSS token classes (`bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`, `text-destructive`) so light and dark modes work seamlessly.
4. Keep pure domain logic in `src/lib/` cleanly separated from React components in `src/components/`.
5. Write concise behavioral tests with `@testing-library/react` + `@testing-library/user-event` in `happy-dom` (target ≤ 400 lines per test file).
