# Design System — Clean Neutral Workspace

> Default aesthetic direction for Factory v2 `nextjs-shadcn` apps (Linear / Vercel / Things-inspired minimal workspace). Update this heading and palette during `/f-plan` when the user chooses a distinct brand direction.

## Visual Principles

1. **Content-first above the fold:** Primary workspace content (lists, tables, cards) occupies ≥ 60% of the initial viewport. Keep creation/filter bars compact (single-line quick-add that expands on demand).
2. **Restrained hierarchy:** One primary button per screen (`variant="default"`). Use `variant="ghost"` icon buttons (`lucide-react`, 16px) for repeated row/sidebar actions.
3. **Crisp surfaces & spacing:** Neutral light/dark surfaces with subtle 1px borders (`border-border`), generous whitespace, consistent 4px spacing scale, and zero horizontal overflow at 390px and 1440px.

## Reusable UI Primitives (`@/components/ui/`)

- `Button` (`default`, `secondary`, `outline`, `ghost`, `destructive`; sizes `sm`, `default`, `icon`)
- `Input`, `Textarea`, `Select`, `Checkbox`
- `Card` (`CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`)
- `Badge` (`default`, `secondary`, `outline`, `destructive`, `success`, `warning`)
- `Dialog` (accessible modal with Escape + backdrop + focus management)
- `Tabs`, `Separator`
