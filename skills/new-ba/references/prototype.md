# Prototype

One prototype for the whole flow of the batch. The user clicks through it before anything is built, the factory copies it into the repository, and each UI ticket's criteria bind the part of it that ticket builds. Most wrong tickets are found here, and a prototype that looks like every other AI app gets every other AI app built.

| The batch changes | Prototype |
|---|---|
| Screens a user sees | Theirs, or one you make, below |
| A screen, by a change words can say exactly (a label, an order, one more control of a kind already there) | None; the criteria name the exact words and place |
| A command, an API, a message, or nothing a user sees | None; a sample session in **Notes** when it helps |

## When the user has one

It is their design: evidence of what they want, not yours to improve.

1. Open all of it (a file or URL in a browser, every control and state; every image; Figma through its connector). When you cannot open a link, ask for exported screens.
2. Take its meaning into the criteria. Ask about what it leaves out (empty, error, limits) and where it contradicts the request.
3. Never edit it. Prepare a copy in `<batch>/prototype/`: their `index.html` byte for byte, or a plain page showing each picture from `shots/` in an element with `data-screen="<id>"`; `prototype.json` with `"source"` (and `"images": true` plus each screen's `"text"` for pictures); `shots/<id>-<desktop|mobile>-<light|dark>.png`.
4. Check it with `--existing` (below). Then "Bind it to the criteria".

## Choose a direction

In step 1, when you make the prototype and the product has no look yet. When it has one (its own UI, a design system, an earlier batch's `taste.md`), that look wins and this section is skipped.

1. **Ask for references.** In one `AskUserQuestion`: products or pages they find striking, and for each the one quality they like (the calm density of Linear, the type of Stripe Press, the colour of Arc). A screenshot counts. Take the qualities they named, never the product's look as a whole: it stays another company's.
2. **Otherwise, draw directions.** Two or three that differ on real axes, not three tints of one layout:
   - layout model: a sidebar and a work area · one wide canvas · a board of columns · list and detail side by side;
   - type: an editorial serif display with a quiet sans · one strong grotesk · a mono-flavoured technical face;
   - colour stance: ink on paper with one accent · a deep, dark surface · a bold colour field;
   - density: roomy for occasional use · compact for all-day use.

   Each is the screen users see most, in its normal state, with real content, as one HTML file. Shoot them and give the user the comparison page (as a private Artifact when the tool exists, otherwise its full path):

   ```bash
   node <skill>/scripts/shoot.mjs --out <batch>/directions --widths 1440,390 --playwright <pw> <batch>/directions/a.html <batch>/directions/b.html <batch>/directions/c.html
   ```

   Then ask which, with `AskUserQuestion`: one option per direction with a one-line description, the one you recommend first; "a mix" goes in Other.
3. **Write it down** in `<batch>/prototype/taste.md`, from [taste-template.md](taste-template.md): the direction, its tokens, and the project's list of banned defaults. It travels with the prototype into the repository, and the next batch reads it first.

## Build it

Work in `<batch>/prototype/`. `index.html` is content only (no doctype, `<html>` or `<body>`; the scripts add them), self-contained: styles and scripts inline, no request to any server. Give it a short `<title>`.

- **One source for every screen**: tokens, frame, components and sample data once; the screens reuse them. The UI tickets will build one product, so the prototype is one product.
- **A screen per state** in the criteria: the normal case, empty, invalid input, a limit reached, loading when it is visible. Each opened by `#<id>` (on load and on `hashchange`) on the element with `data-screen="<id>"`, shown alone. A bar marked "Prototype, sample data" lists the screens.
- **Slots marked.** The part each slice builds carries `data-slot="<name>"`, the same name as its `slot:<name>` contract; a screen that is wholly one ticket's carries `data-change`. The shell around the slots is the foundation's.
- **It works.** Forms validate, lists filter, items add and delete, on state in memory, with mouse and keyboard. A user walks the whole flow without the address bar. A control outside the batch is drawn disabled, never dead.
- **It holds at 1440 and 390 wide**, and in dark mode when the direction has one.
- **Nothing extra.** A control no criterion asks for is a promise nobody agreed to.

## Make it not generic

The check below catches the mechanical defaults; this is what a script cannot see. Before you draw, write in a comment at the top of `<style>`: who uses it, how often, and the one thing they look at most.

- **The content leads.** The thing users look at fifty times a day is the largest, clearest thing on the screen. Everything else is quieter.
- **Use the width.** At 1440, a narrow centred column with empty sides wastes the screen: give the room to a second pane, a summary, a detail, a timeline, whatever the product actually has. At 390, the same hierarchy in one column.
- **A chosen typeface**, embedded, with a scale of four or five sizes, tabular figures for numbers, and the product's language covered (Vietnamese needs the `vietnamese` subset):

  ```bash
  node <skill>/scripts/embed-font.mjs --family "Be Vietnam Pro" --weights 400,600 --subsets latin,vietnamese --prefix <scratchpad>/fonts
  ```

  The foundation ticket names the same `@fontsource/<slug>` package, so the build uses the same face.
- **Colour from tokens.** Neutrals tinted towards the direction, one accent that means something (the action, the state), contrast 4.5:1 or more. Dark mode designed for its own surface, not inverted.
- **Real or near-real content.** The names, lengths and numbers real users would write, in their language, including the awkward ones: the very long title, the zero, the empty field. Invent it; never copy a real person's data.
- **Details that make it a product**: empty states that say what to do first, exact microcopy, visible focus and hover, counts and dates in local format, keyboard hints where people work fast.
- **Icons as inline SVG**, drawn in one style, or none.
- **One moment of its own**, where the product's job is (finishing a task, a payment going through), strong once and calm the fiftieth time. No hero, slogan or motion nobody asked for. Each motion the user wants is a criterion, with a `prefers-reduced-motion` end state.

What "generic" looked like: a todo prototype of 2026 put a 740px column in the middle of a 1440 screen, a serif heading over the system font, one orange accent, rows split by hairlines, and nothing else. Every element was correct and any app could have had it.

## Check it

The script blocks the network, opens every screen at 1440 and 390 in each theme, presses every button, measures contrast, checks that every criterion of every UI ticket is on a screen or excused in `notShown`, takes the screenshots, and names the generic defaults it can see (default fonts, purple gradients, emoji, filler names, a narrow column at 1440). It needs Playwright and axe-core in the scratchpad, never in the repository:

```bash
npm install --prefix <scratchpad>/pw playwright axe-core
PLAYWRIGHT_SKIP_BROWSER_GC=1 npx --prefix <scratchpad>/pw playwright install chromium
node <skill>/scripts/check-prototype.mjs --dir <batch>/prototype --batch <batch> --playwright <scratchpad>/pw --themes light,dark [--only <id,id>] [--existing]
```

Fix every `problem:`. A `look:` about a generic default is fixed, or kept for a reason you can say.

It opens six pages at once and stops itself after `--timeout` seconds (300) with a problem; `progress:` lines show how far it got. Make every fix a report asks for first, then run it once; a run after each small fix adds up. While you fix one or two screens, `--only <id,id>` checks just those and keeps the other screenshots; before a review and before publishing, run it on every screen.

Then walk the flow with Playwright, clicking and typing from the first screen: for each UI ticket, its main path and one case that goes wrong. The script has pressed every button already; this is for what a press cannot show (typing, a sequence of steps). A step you cannot carry out is a fault in the prototype or in the criterion; find out which.

## Design review

It runs in the review round of step 10, in the same message as the batch reader, once the prototype is checked. Start one new agent (never a fork) with [design-reviewer.md](design-reviewer.md) as its brief, the `shots/` folder, `taste.md` and the epic's flow; nothing of your reasoning. Fix what it ranks P1 and P2 together with what the reader found, check again once, and give the new screenshots to a new reviewer in the second round. At most two rounds; what is still open goes in the report.

Then let the user try it: as a private Claude Artifact when the tool exists (publish `index.html` as a plain page; later changes to the same link), otherwise `node <skill>/scripts/check-prototype.mjs --wrap <batch>/prototype/index.html > <batch>/prototype/open-me.html` and give its full path. What they correct goes back into the criteria and the prototype until the two agree.

## Bind it to the criteria

The factory copies the prototype into the repository at `docs/prototypes/<batch id>/` (`docs/ba/prototypes/<batch id>/` when there is a `docs/ba/`), so every criterion names that one path. Each UI ticket gets one criterion per page it builds on, naming its slot, every state's screen, and what binds:

```
- **C8** At 1440 and 390 wide, the `input` slot is built to match `docs/prototypes/todo-v1/index.html` at `#list` and `#list-empty` in layout, elements, order, labels and messages, states, colours and fonts; sample data aside, and not pixel for pixel.
```

Keep that wording; the check asks for it. When only the flow is agreed, the middle reads "in elements, order, labels and messages, and states, but not in layout, colours or fonts". The foundation binds the shell with the slots empty. What happens (a button's effect, a filter's rule, a message's trigger) stays a criterion of its own, in words that stand without the picture.

Then read each screen once more: anything on it the user does not want built must go, because now it will be. `publish-batch.mjs` pushes the prototype to `prototype/<batch id>` and adds to each UI ticket a Prototype section with its screens.
