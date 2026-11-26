# Checklists by kind

What to settle with the user before a ticket of each kind is ready. Each item is a decision a builder would otherwise have to guess, which is why a factory run stops to ask about it. Go through the items for the ticket's kind and for `all`. An item the user answers becomes a criterion or a line in the ticket; one that does not apply goes into **Out of scope**, said on purpose.

Grow this file from history, not from imagination: when the same kind of question stops runs or comes back as a bug in 3 or more of the last 10 `factory` issues (`factory/scripts/issue-history.sh` shows them), propose a new item to the user, and add it once they agree. Write an item as a question anyone could answer, never as one client's answer.

## all

- Who uses this, and who must not be able to?
- What does the user see when it goes wrong: invalid input, no permission, no network, the server fails?
- What are the limits: sizes, counts, lengths, rates, time-outs?
- Is there any existing behavior this changes, and who relies on it?
- Exact text of every new label, button, message and error.

## crud

- Which fields, which are required, and the rules for each (length, format, unique)?
- Is deleting permanent, recoverable (for how long), or not allowed? Is there a confirmation?
- Who may create, read, edit and delete, separately?
- What happens when two people edit the same record?
- Is there a history or audit trail of changes?

## form

- Validation per field, and when it shows: as the user types, on leaving the field, on submit?
- What happens to what the user typed after an error, and after leaving the page?
- What does success look like: a message, a redirect, both?
- Can it be submitted twice by accident?

## list

- Default sort order, and which sorts and filters the user can choose?
- How many items per page, and paging or "load more" or infinite scroll?
- What the empty list says, and what a search with no results says?
- What does each row show, and what does clicking it do?

## auth

- Sign-in methods, and what happens on a wrong password (how many tries, then what)?
- How long a session lasts, and what happens when it expires mid-task?
- Password rules and reset flow, if passwords exist.
- Roles, and what each role can see and do.

## payment

- Currencies, amounts, taxes and rounding.
- What the user sees when a payment fails, is pending, or is refunded.
- What happens if the user closes the page during payment.
- Receipts: who gets them, and what they contain.

## integration

- What happens when the other service is slow, down or returns an error?
- Retries: how many, and who is told when it gives up?
- Where the credentials come from, per environment.
- What data goes out, and is any of it personal?

## report

- Exact columns or figures, with how each is calculated.
- Date ranges, time zone and the cut-off for "today".
- Export formats, and the largest export allowed.

## ui

- Link to the approved mockup of every screen, in every state it can be in.
- Narrow screen (390 px) and wide screen (1440 px) behavior.
- Light and dark mode, if the product has both.
- Keyboard use and what a screen reader announces for new controls.

## bug

- Steps to reproduce, what happens, and what should happen instead.
- Since when, and on which environments, browsers or devices.
- Is any data already wrong, and must it be repaired?
