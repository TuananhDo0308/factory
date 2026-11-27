# Taste: <product>

<!-- Copied by new-ba into <batch>/prototype/taste.md when a direction is chosen, and kept with the prototype.
The next batch of the same project reads it first: docs/design/taste.md when the project has one,
otherwise the newest docs/prototypes/*/taste.md. Replace every <...>; delete this comment. -->

## Direction

- **Users and use:** <who, how often, on what device>
- **The one thing they look at most:** <...>
- **Direction:** <one line, e.g. "ink on warm paper, editorial serif headings, compact rows, one vermilion accent for actions">
- **References and what was taken from each:** <product: the quality; never its look as a whole>
- **Themes:** <light | dark | both, following the system>

## Tokens

| Token | Light | Dark |
|---|---|---|
| `--bg` | <#...> | <#...> |
| `--surface` | | |
| `--text` | | |
| `--text-muted` | | |
| `--accent` | | |
| `--danger` | | |
| `--line` | | |

- **Type:** <display face and weights> / <text face and weights>, from `@fontsource/<slug>`; scale <e.g. 13 / 15 / 18 / 24 / 36>
- **Spacing:** <e.g. 4 / 8 / 12 / 16 / 24 / 40>
- **Radius:** <e.g. 6 for controls, 0 for the page frame>
- **Motion:** <none | on action only, 150–200 ms | ...>

## Banned defaults

Every screenshot is checked against these. The project may add to the list; remove a line only when the user asks for that default on purpose.

| id | Banned | Instead |
|---|---|---|
| B1 | Inter, Roboto, Arial or the system font as the face of the product | A typeface chosen for the direction, embedded |
| B2 | Purple, indigo or blue-to-purple gradients; gradient text; glow | Flat colour from the tokens; one accent with a meaning |
| B3 | A grid of identical rounded cards, each with an icon, a bold title and two lines | Structure that follows the content: a list, a table, a timeline, two panes |
| B4 | Everything centred, a narrow column with empty sides at 1440 | A left edge to read along; the width given to what the product has |
| B5 | Emoji as icons; icons in tinted tiles | Inline SVG in one style, or no icon |
| B6 | Lorem ipsum, "John Doe", "Acme", "Item 1" | Content close to what real users write, in their language |
| B7 | Pastel badges and tinted banners on everything | Colour only where it means something |
| B8 | Shadows on every surface, a card inside a card | One elevation for what floats; lines or space for the rest |
| B9 | Dark mode as inverted light: pure black, grey-on-grey text | A dark surface designed with its own contrast |
| B10 | Oversized padding and type on a working screen | Density that fits daily use |
| B11 | Generic empty states ("No items yet") with a clip-art illustration | An empty state that says what to do first, in the product's words |
| B12 | <project's own> | |
