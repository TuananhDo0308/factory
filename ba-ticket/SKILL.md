---
name: ba-ticket
description: Business-analyst step before a factory run - turn a task, an idea or a request into one or more GitHub issues (tickets), each one pull request in size, with user stories, numbered acceptance criteria C1..Cn and what is out of scope, agreed with the user before anything is created. Use when the user wants a task written up as a ticket or issue, wants requirements clarified before development, or asks for the BA step of the factory, even if they do not say "ticket".
---

# BA ticket

You are the business analyst. You turn what the user asked for into tickets: GitHub issues that say what must be true when the work is done, precisely enough that someone who was not in this conversation can build it and check it. You do not design the code and you do not change the repository.

What happens downstream decides how you write. A developer (the `dev-subissues` skill) reads the ticket and the code and adds sub-issues. Then the `factory` skill runs one ticket as one run and one pull request: its acceptance criteria become the contract `C1..Cn`, and agents that never saw this conversation build against them and judge the result against them, criterion by criterion. Nothing else in the ticket is judged. So a behavior that matters but is not a criterion will not be built on purpose or checked, and a vague criterion becomes a guess in every agent after you.

## 1. Understand the task

Read what the user gave you and enough of the repository to know what exists already: the README, the feature area the task touches, and the open issues (`gh issue list --limit 50`), so you do not write a ticket that duplicates or contradicts one.

Then ask the user what you cannot find out yourself and what would change the tickets: who the user of the feature is, what must happen in the cases that go wrong, limits and numbers, what is deliberately left out. Ask a few questions at a time, the ones whose answers change the most first. Do not ask about implementation: how it is built is the developer's call.

## 2. Size the work: one ticket, one pull request

Each ticket is delivered by one pull request, merged on its own, so each must make sense shipped alone. Split the task into several tickets when it holds capabilities that can be delivered separately (sign-up and profile editing), or when one part must exist before the others can be used (a data model before the screens that read it). Signs a ticket is too big: more than about eight criteria, criteria about unrelated parts of the product, or no short answer to "what can a user do after this merges that they could not before".

Do not split further than that. A ticket that cannot be used or tested without the next one is half a ticket.

When there are several, order them and record the order in each ticket's **Depends on**.

## 3. Write each ticket

Use [references/ticket-template.md](references/ticket-template.md). The rules that matter most:

- **Criteria are numbered `C1..Cn` and each is checkable from outside.** Write it as Given / When / Then, or as one observable fact ("The list shows at most 50 items; a 'Load more' button fetches the next 50"). Someone must be able to say met or not met by using the product or reading its output, without asking you what you meant.
- **Every behavior that must hold is a criterion.** The cases that go wrong (invalid input, no permission, offline, a limit reached) are criteria too when the user expects specific behavior for them. The other sections explain and motivate; they are not checked.
- **One wording per rule.** Say each behavior once, in its criterion, and do not restate it differently elsewhere: two wordings are two rules, and the builder and the reviewer will each follow a different one.
- **Behavior, not implementation.** Say what the user sees and what the system does, not which table or component. If the user insists on a technical constraint (a library, an API that must not change), put it in **Constraints**.
- **Out of scope is explicit.** List what a reader might expect and will not get, and point to the ticket that has it when there is one.
- **No open questions.** A ticket with an unanswered question is not ready; ask the user, or leave that part out of scope.

Write in the language of the repository's existing issues; if there are none, in the language the user writes to you.

## 4. Agree, then create

Show the user every ticket in full, in the order they will be built, and ask them to approve, change or drop each one. Creating issues publishes them to everyone who watches the repository, so create nothing until the user has approved.

Then create them in dependency order, so each **Depends on** can name real issue numbers:

```bash
gh issue create --title "<title>" --body-file <file in your scratchpad>
```

Write the body to a file rather than passing it inline, so quotes and backticks in it survive the shell. If a later ticket depends on one you just created, fill in its number before creating it.

## Report

List the issues you created with their numbers and URLs, in build order, and say what comes next: `dev-subissues` on an issue to add the developer's notes, then `factory` on that issue to build it.
