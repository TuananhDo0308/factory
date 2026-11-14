# <Short name of this part>

Part of #<issue>. Written against commit <short sha>.

## Serves

<The issue's criteria this part delivers, by id: C1, C3.> These are the issue's criteria; this sub-issue adds none.

## What this part does

Two or three sentences.

## Where it sits in the code

- `<path>`: <what is there now, and what this part changes or adds there>.
- The pattern to follow: <an existing function, module or test to imitate, with its path>.
- Tests: <where the tests for this area live, how they create their data, and the command that runs them>.

## Seams with other parts

- Provides to #<sub-issue>: <name, inputs and outputs, data shape, errors, as seen from outside>.
- Uses from #<sub-issue>: <the same, for what it needs>.
- Or "none".

## Depends on

- #<sub-issue>, or "none".

## Risks

- <A caller that relies on current behavior, a misleading type, a slow or flaky test, a migration, anything you would warn a colleague about.>
