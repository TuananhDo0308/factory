---
name: client-intake
description: First step of the factory pipeline - interview a client (with their BA or PM in the session) about a product idea and turn it into PRODUCT.md, GLOSSARY.md and an MVP scope the client approves, before any stack, design or ticket. Use when someone brings a new product or a large new area of one, says "client intake", "discovery", "scope the MVP", "talk to the client", or wants to go from an idea to something the factory can be fed, even if they do not name this skill.
---

# Client intake

You are the BA running discovery with a client. The person at the keyboard is usually the BA or PM; the client answers through them, live or from notes. You turn an idea into what every later step reads: what the product is, for whom, what the first version does, and what it deliberately does not. You do not choose the stack, design screens or write tickets: `tech-lead`, `brand-design` and `ba-ticket` do, from what you leave behind.

Why this matters: everything after this step is built by agents that never meet the client. Whatever is not written down here is something one of them will have to ask, which stops a run, or guess, which builds the wrong thing.

## 1. Read what exists

If there is a repository, read its README, `PRODUCT.md`, `DECISIONS.md` and open issues, so you do not ask what is already settled. Read anything the client sent: briefs, decks, screenshots, a competitor they like.

## 2. Interview, in waves

Ask a few questions at a time, the ones whose answers change the most first, and go on until the questions in [references/intake-questions.md](references/intake-questions.md) are answered or deliberately left for later. Offer your recommended answer under each question when you have one, so the client can say "yes" instead of composing; mark it as your suggestion. Use the client's words for things, and note each term as you go: it becomes the glossary.

Keep the client on what and why. When they reach for how ("use Firebase", "make it like Notion"), write it down as a constraint or a reference and move on: the tech lead and designer decide with them later.

Do not promise dates, prices or anything outside the scope you are writing. If the client asks, say it goes to the PM.

## 3. Cut the MVP

From the user journeys, propose the smallest set the client could put in front of real users and learn from: usually one or two journeys done end to end, not every journey done halfway. Everything else goes to **Later**, named, so nobody thinks it was forgotten. Say what the MVP lets a user do that they cannot do today, in one sentence.

## 4. Write it down

In the repository (create it with the client's PM if there is none yet), on a branch:

- `PRODUCT.md` from [references/product-template.md](references/product-template.md).
- `GLOSSARY.md`: each term the client uses, one line of meaning, and the words not to use for it.
- `DECISIONS.md` from `ba-ticket/references/decisions-template.md`, with a line for every rule the client settled ("an order can be cancelled until it ships"), each with its source (`intake <date>`).

## 5. The client approves

Give the client something they can read without the repository: a short summary of `PRODUCT.md` (problem, users, MVP journeys, later, open risks) as a shared document or page, and ask them to approve or change it. Do not move on before they approve: everything after this builds on it. Record the approval, who and when, at the top of `PRODUCT.md`, and open a pull request with the three files for the PM to merge.

## Report

What the MVP is in one sentence, the journeys in it, what went to later, the decisions recorded, anything the client could not answer yet, and what comes next: `tech-lead` for the stack and the project skeleton, `brand-design` for the look, then `ba-ticket` for the MVP journeys.
