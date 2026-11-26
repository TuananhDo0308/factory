// Lessons: mistakes the factory team made in several runs, and what was decided
// about each, oldest first. The invoking session adds an entry when the failure
// logs in runs.js show the same mistake in 3 or more runs (SKILL.md, step 7),
// and records the user's decision. index.html lists them on the Factory page.
// It is a script, not JSON, so the page can load it straight from disk.
//
// An entry is never a fix in itself: an accepted lesson is made later as an
// ordinary change to the skill (a rule in workflow/factory.js with its test, or
// one sentence in a role brief), and whoever makes it sets `status` to 'done'.
//
// Fields:
//   id         short name of the pattern, e.g. 'interface-names-drift'
//   pattern    the mistake, in one sentence, as a role or a step makes it
//   runs       ids of the runs in runs.js where it occurred
//   evidence   a few failure-log problems or blocked reasons that show it
//   proposal   the fix, in one sentence
//   target     where the fix goes: 'factory.js' or 'roles/<role>.md'
//   status     'proposed' | 'accepted' | 'rejected' | 'done'
//   proposed   date it was proposed (YYYY-MM-DD)
//   decided    date of the user's decision, once there is one
//   note       the user's reason, or what the fix changed
window.FACTORY_LESSONS = [
  {
    "id": "test-files-break-whole-suite-checks",
    "pattern": "An implementer's test file passes the spec's own test run but breaks a check over the whole repository: a lint or format error in the test file, or a mock that leaks into other test files.",
    "runs": [
      "2026-11-17-compare-c3-all-sonnet",
      "2026-11-17-issue-125-all-sonnet",
      "2026-11-17-issue-125-default"
    ],
    "evidence": [
      "pnpm lint exits 1 on apps/web/compare-screen.test.ts: Biome's formatter wants the long assert.match call split",
      "bun run lint exits 1: tests/ui/kanban-github.test.tsx:289 react-hooks/rules-of-hooks",
      "tests/ui/project-settings.test.tsx uses mock.module and the mocks leak into other test files: 137 failures"
    ],
    "proposal": "Before reporting, the implementer runs the contract's lint and format checks on its own spec's files (source and test), because the spec's test run does not exercise them and a failure there sends every responsible spec back; the leaking-mock half is covered by the QA cleanup rule deployed in ffc90f1.",
    "target": "roles/implementer.md",
    "status": "done",
    "proposed": "2026-11-18",
    "decided": "2026-11-18",
    "note": "Accepted by the user. Made in commit c514a81: one rule in roles/implementer.md (run the contract's lint and format checks on your own files before reporting); the leaking-mock half is the QA cleanup rule of ffc90f1."
  }
]
