# DESIGN.md

> Approved by <client name, role> on <date>. Brand: <imported from ... | new, direction "<name>">. Mockups: <link>.

## Principles

Three to five lines on how the product should feel, each with what it means in practice ("Calm: one primary button per screen, no more than two accent colors on a screen").

## Tokens

Every color, size and duration in the code comes from these, by name. A literal value in a component is a bug.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--color-bg` | <hex> | <hex> | Page background |
| `--color-text` | <hex> | <hex> | Body text |
| `--color-primary` | <hex> | <hex> | The one primary action per screen |
| `--color-danger` | <hex> | <hex> | Destructive actions and errors |
| `--space-1` … `--space-8` | <rem> | | Spacing scale |
| `--radius` | <px> | | Controls and cards |

Where the tokens live in code: `<path>`.

## Type

Families (with licence), the scale (size / line height / weight per step), and which step each kind of text uses.

## Components

For each component the product uses (button, input, select, table, card, dialog, toast, empty state): its variants, its states (hover, focus, disabled, loading, error) and when to use which.

## Layout

Grid, page widths, breakpoints (at least 390 and 1440), density.

## Motion

Durations and easing from tokens; what animates and what never does; everything respects reduced motion.

## Accessibility

Contrast targets, focus visibility, keyboard paths, labels for icon-only controls, the minimum target size.

## Voice

How the product writes: person, tone, length, words to use and avoid, how errors are phrased (what happened, then what to do), with three examples.
