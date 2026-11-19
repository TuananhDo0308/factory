---
name: brand-design
description: Design step of the factory pipeline - settle a product's look with the client before tickets are written, either by importing the brand they already have or by building a new identity with them (Claude Design works well for directions and mockups), then bring it into the repository as DESIGN.md plus tokens the code imports, and mockups of every MVP screen in every state for the tickets to link. Use after client intake when someone asks for a brand, a design system, a style guide, mockups or "the look" of a product, or wants to restyle an existing one, even if they do not name this skill.
---

# Brand design

You settle how the product looks and speaks before anything is built, with the client, and leave it in a form agents can follow. The person at the keyboard is a designer, BA or PM; the client approves. You do not write product code.

Why this matters: an implementer with no design invents one, a different one per spec. A reviewer cannot judge "looks right" without something to compare to. So the look must be decided by people, written as tokens and rules the code uses, and drawn as mockups each ticket links.

## 1. Read

`PRODUCT.md` (users, journeys, look and voice, references), `DECISIONS.md`, `CLAUDE.md` (the stack decides the form tokens take), and any existing `DESIGN.md` or styles in the code.

## 2. Existing brand or a new one

Ask the client which it is.

- **Existing.** Collect the logo files, colors, fonts (and their licences), any guideline document, and screenshots of their current products. Extract what is there; do not improve it unasked. Ask about the gaps the guidelines leave: error and success colors, dark mode, a type scale, spacing, how dense screens should be.
- **New, or a restyle.** From the references and the voice in `PRODUCT.md`, make two or three distinct directions, each with a palette, a type pairing, a sample screen from the MVP and one sentence on the feeling it aims for. Claude Design is a good place to build and show these, and the client can comment on them there. The client chooses one direction; refine it with them until they approve. Keep what they rejected and why: it is a decision too.

## 3. Write the system into the repository

On a branch:

- `DESIGN.md` from [references/design-template.md](references/design-template.md): the principles in a few lines, then colors, type, spacing, radius, elevation, motion, the components and their states, dark mode, accessibility rules and the voice of the copy. Each rule says what to do, so an agent can follow it without judgment.
- **Tokens the code imports**, in the stack's own form (CSS variables, a Tailwind theme, a theme object). A color or size that is not a token is not allowed in the code; `DESIGN.md` says so, and reviewers can check it.
- When the design lives in Claude Design, bring its tokens and decisions into these files: an agent building the product reads the repository, not the design tool.

## 4. Mock every MVP screen in every state

For each screen of each MVP journey in `PRODUCT.md`: the normal state, empty, loading, error, many items, a narrow screen (390 px) and a wide one (1440 px), with the real copy, not lorem ipsum. Give each screen a stable link (a Claude Design page, an image committed under `docs/mockups/`), because each ticket's **UI and states** links them and the readiness check refuses a visible change without one.

## 5. The client approves

Show the client the system and the mockups and ask them to approve or change them. Record the approval (who, when) at the top of `DESIGN.md`, add the rules they settled to `DECISIONS.md`, and open a pull request with `DESIGN.md`, the tokens and any mockups committed to the repository.

## Report

The direction chosen (or the brand imported), the pull request, the links to the mockups by screen, what the client changed or rejected, anything still open, and what comes next: `ba-ticket` for the MVP journeys, linking these mockups. Later polish of a built screen is `ui-refine-loop`'s job, not a new design.
