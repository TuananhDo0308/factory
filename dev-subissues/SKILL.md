---
name: dev-subissues
description: Developer step between a ticket and a factory run - read a GitHub issue and the code it touches, and add sub-issues that say how the work divides and where each part sits in the code, so the factory's planner starts with full context. Sub-issues carry context only; the issue's acceptance criteria stay the only thing judged. Use when the user wants an issue or ticket broken down into sub-issues or sub-tasks, wants a technical breakdown before development, or asks for the dev step of the factory.
---

# Dev sub-issues

You are the developer who prepares a ticket for the build. You read one GitHub issue and the code it touches, and add sub-issues under it: how the work divides, and for each part, where it sits in the code, what it must fit with, and what could go wrong. You change neither the code nor the issue's criteria.

What happens downstream decides how you write. The `factory` skill builds the whole issue in one run and one pull request. Its contract is the issue's acceptance criteria `C1..Cn`, and only those are judged. Its planner reads the issue and your sub-issues, then reads the code and decides the specs itself: which files each agent owns, the exact interfaces between them, the order. So your sub-issues are context, not instructions. Their value is what the planner would otherwise have to discover or guess: the right files and patterns, the trap in the existing code, the seam between two parts. A sub-issue that restates the ticket adds nothing; one that is wrong about the code costs the planner time, so check what you write.

## 1. Read the issue and check that it is ready

```bash
gh issue view <n> --json number,title,body,state
gh api --paginate repos/{owner}/{repo}/issues/<n>/sub_issues --jq '[.[] | {number, title, state}]'
```

If the issue already has sub-issues, show them to the user and ask whether to update those or replace them, rather than adding a second set.

Before writing anything, check that the issue can be built as one pull request against its criteria:

- It has acceptance criteria numbered `C1..Cn`, each checkable from outside.
- It is one pull request in size: the criteria belong to one capability that ships alone.
- The code makes it possible as written: nothing in it contradicts how the system works.

If one of these fails, stop and tell the user what is wrong, with a proposed change to the issue. Criteria are the user's agreement with their BA; you do not rewrite them. When the user approves a change, apply it to the issue with `gh issue edit <n> --body-file <file>`.

## 2. Read the code

Find every place the change touches: the modules and files, the functions that will be called or changed, their callers, the tests that cover them and how those tests are laid out and run, and the patterns the codebase uses for this kind of change. Open the files; do not describe code from its file name. Note the commit you read (`git rev-parse --short HEAD`): the code may move before the build, and the planner checks your notes against it.

## 3. Divide the work

Divide where the parts can be built and tested separately: a data change and the code that uses it, a backend and its client, separate modules. Two to five sub-issues is usual. A change that is one coherent piece needs none: say so and write no sub-issues, because a forced split only adds seams where two agents can disagree.

Use [references/subissue-template.md](references/subissue-template.md). The rules that matter most:

- **No criteria of your own.** Each sub-issue names the issue's criteria it serves (`C2`, `C4`). Between them, the sub-issues serve every criterion. If you find a behavior the issue should require and does not, propose it to the user as a new criterion of the issue (step 1); written only in a sub-issue it would never be checked.
- **Concrete about the code.** Paths, function names and the existing pattern to follow, as they are at the commit you read. Hints about which files a part touches are welcome, but the planner assigns files, so do not try to make them exclusive.
- **Pin the seams.** Where one part uses what another creates, describe what crosses between them as it can be seen from outside: names, inputs and outputs, data shapes, errors. Both parts are built by agents who cannot see each other's work.
- **Order.** Say which sub-issues depend on which.
- **Risks.** Write down what you would warn a colleague about: a caller that relies on current behavior, a type that is not what it looks like, a test that is slow or flaky, a migration.

Write in the language of the issue.

## 4. Agree, then create

Show the user the sub-issues in full and ask them to approve, change or drop each one. Creating issues publishes them, so create nothing before that.

Then create each one and attach it to the issue as a GitHub sub-issue. The link takes the new issue's internal id, not its number:

```bash
bash <this skill>/../factory/scripts/factory-issue.sh create --title "<title>" --body-file <file in your scratchpad>   # prints the new issue's URL
id=$(gh api repos/{owner}/{repo}/issues/<m> --jq .id)                    # <m> is the new issue's number
gh api -X POST repos/{owner}/{repo}/issues/<n>/sub_issues -F sub_issue_id="$id"
```

Create them in dependency order, so each **Depends on** can name real numbers. The script labels them `factory`, like their parent, so they never mix with issues people write by hand. Check the result with the `sub_issues` call from step 1.

When the issue depends on other issues (its **Depends on**), record that on GitHub too, so the dispatcher builds them in order and code can check there is no cycle:

```bash
bash <this skill>/../factory/scripts/factory-issue.sh depends --issue <n> --on <m>   # <n> is blocked by <m>
```

## Report

List the sub-issues with their numbers, which criteria each serves, and their order; say that every criterion is served, or that you proposed changes to the issue and which. Then say what comes next: `factory` on issue #<n> builds it in one run and one pull request.
