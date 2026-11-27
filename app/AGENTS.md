# AGENTS.md — Software Factory

## Framework & UI Rules

- **Next.js 16**: Always consult the bundled version-matched docs in `node_modules/next/dist/docs/` before writing App Router, Server Action, caching, or Route Handler code.
- **shadcn/ui ONLY (Base UI `base-nova` preset)**:
  - NEVER manually create or edit component source files in `src/components/ui/`. Always install via `pnpm dlx shadcn@latest add <component> -y`.
  - NEVER override component colors, borders, or typography via `className`. Use `className` for layout/positioning only (`w-full`, `flex-1`, `gap-*`, `size-*`). All theming lives in semantic CSS variables in `src/app/globals.css`.
  - This project uses `@base-ui/react` (`base: "base"` in `components.json`): use `render={<... />}` instead of `asChild` on trigger primitives.
  - Use `FieldGroup` + `Field` + `FieldLabel` for forms, `InputGroup` for inputs with addons, `Empty` for empty states, `Separator` instead of `<hr>`, `Badge` for status tags, `data-icon="inline-start"` on button icons (no `size-*` on icons inside shadcn components).
- **Design Language**: Mirror `app.factory.ai/sessions` — Inter (UI, Vietnamese subset) + JetBrains Mono (`tabular-nums`), pure white / cool-neutral light mode, obsidian `#111111` / `#161616` dark mode, hairline 1px borders, Factory Signature Orange `#EE6018` primary accent.
- **Prisma 7 + PostgreSQL (`@prisma/adapter-pg`)**: Run `pnpm db:generate && pnpm db:push` after editing `prisma/schema.prisma`.
