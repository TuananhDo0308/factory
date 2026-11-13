// Finished Factory runs, oldest first; index.html shows the newest on top. The
// invoking session appends one object here after each run (see SKILL.md). The
// run in progress is not here: the workflow writes it to live.js, in the same
// shape. It is a script, not JSON, so the page can load it straight from disk.
//
// Fields:
//   id               short unique name of the run
//   title            what the run was asked to do
//   caseName         eval case name, if the run was an eval
//   sample           true for an illustration; left out of the benchmark
//   note             free text shown under the run picker
//   outcome          'running' | 'passed' | 'failed' | 'blocked'
//   reason           why it ended that way
//   phase            phase the run was in: Spec | Build | Check | Review | Repair
//   seconds          wall-clock time, added by the session
//   agents           team agents started (recorder agents are not counted)
//   repairRounds, maxRepairRounds
//   specLine         summary of the plan, e.g. '3 spec(s) · 2 level(s)'
//   specs            [{ id, title, impl, test, implNote, testNote, waitFor }]
//                    impl / test: 'ok' | 'run' | 'wait' | 'none' (no such agent)
//   check            { text, state }
//   review           [{ tag, text, state, label }]  (defaults to one per reviewer)
//   repairs          [{ round, text, state }]
//   criteria         [{ id, text, status }]  status: 'met' | 'not_met' | 'unknown' | ''
//   grades           { '01': 'pass' | 'fail', ... } for the graders of adds-json-flag-to-cli
window.FACTORY_RUNS = [
  {
    "id": "2026-11-12-wordstats-json",
    "title": "Add a --json flag to wordstats",
    "outcome": "passed",
    "reason": "All checks pass and every criterion is met.",
    "phase": "Review",
    "agents": 6,
    "repairRounds": 0,
    "maxRepairRounds": 2,
    "specLine": "1 spec(s) · 1 level(s)",
    "specs": [
      {
        "id": "S1",
        "title": "Add --json output flag to wordstats.py",
        "impl": "ok",
        "test": "ok",
        "waitFor": "",
        "testNote": "Self-check 1: nothing changed"
      }
    ],
    "check": {
      "text": "test: exit 0",
      "state": "ok"
    },
    "review": [
      {
        "tag": "whole change",
        "text": "4/4 criteria met",
        "state": "ok"
      }
    ],
    "repairs": [],
    "criteria": [
      {
        "id": "C1",
        "text": "`python3 wordstats.py --json FILE` prints exactly one JSON object on stdout with the integer keys `lines`, `words` and `chars`, holding the same counts the text format reports, and exits with 0.",
        "status": "met"
      },
      {
        "id": "C2",
        "text": "Without `--json`, the output and exit codes are unchanged: `lines: N\\nwords: N\\nchars: N\\n` for a readable file, and exit code 1 with nothing on stdout for a missing file.",
        "status": "met"
      },
      {
        "id": "C3",
        "text": "New tests under `tests/` exercise `--json` through `wordstats.main`, and `python3 -m unittest discover -s tests` passes with the existing tests still in place.",
        "status": "met"
      },
      {
        "id": "C4",
        "text": "README.md documents the `--json` flag.",
        "status": "met"
      }
    ],
    "caseName": "adds-json-flag-to-cli",
    "seconds": 163,
    "grades": {},
    "note": "End-to-end run on the current factory. It first stopped as blocked after Check because untracked __pycache__ files were not in ignoreFiles, then resumed with them ignored; 163 s is the workflow time of both parts. The session reran the check itself: 13 tests, OK."
  },
  {
    "id": "2026-11-13-wordstats-json-worktree",
    "title": "Add a --json flag to wordstats (tester in a worktree)",
    "outcome": "passed",
    "reason": "All checks pass and every criterion is met.",
    "phase": "Review",
    "agents": 6,
    "repairRounds": 0,
    "maxRepairRounds": 2,
    "specLine": "1 spec(s) · 1 level(s)",
    "specs": [
      {
        "id": "S1",
        "title": "Add --json output to wordstats CLI",
        "impl": "ok",
        "test": "ok",
        "waitFor": "",
        "testNote": "Self-check 1: nothing changed"
      }
    ],
    "check": {
      "text": "test: exit 0",
      "state": "ok"
    },
    "review": [
      {
        "tag": "whole change",
        "text": "4/4 criteria met",
        "state": "ok"
      }
    ],
    "repairs": [],
    "criteria": [
      {
        "id": "C1",
        "text": "`python3 wordstats.py --json FILE` prints exactly one JSON object on stdout with the integer keys `lines`, `words` and `chars`, holding the same counts the text format reports, and exits with 0.",
        "status": "met"
      },
      {
        "id": "C2",
        "text": "Without `--json`, the output and exit codes are unchanged: `lines: N\\nwords: N\\nchars: N\\n` for a readable file, and exit code 1 with nothing on stdout for a missing file.",
        "status": "met"
      },
      {
        "id": "C3",
        "text": "New tests under `tests/` exercise `--json` through `wordstats.main`, and `python3 -m unittest discover -s tests` passes with the existing tests still in place.",
        "status": "met"
      },
      {
        "id": "C4",
        "text": "README.md documents the `--json` flag.",
        "status": "met"
      }
    ],
    "caseName": "adds-json-flag-to-cli",
    "seconds": 155,
    "note": "First run with the tester in its own git worktree. Graders not run."
  },
  {
    "id": "2026-11-13-wordstats-json-flag",
    "title": "Add a --json flag to wordstats",
    "outcome": "passed",
    "reason": "All checks pass and every criterion is met.",
    "phase": "Review",
    "agents": 5,
    "repairRounds": 0,
    "maxRepairRounds": 2,
    "specLine": "1 spec(s) · 1 level(s)",
    "specs": [
      {
        "id": "S1",
        "title": "Add --json output flag to wordstats CLI",
        "impl": "ok",
        "test": "ok",
        "waitFor": "",
        "testNote": "Self-check 1: nothing changed"
      }
    ],
    "check": {
      "text": "test: exit 0",
      "state": "ok"
    },
    "review": [
      {
        "tag": "whole change",
        "text": "5/5 criteria met",
        "state": "ok"
      }
    ],
    "repairs": [],
    "criteria": [
      {
        "id": "C1",
        "text": "`python3 wordstats.py --json FILE` (and `wordstats.main([\"--json\", FILE])`) exits with 0 and prints to stdout exactly one JSON object followed by a newline, and nothing else. Parsed with `json.loads`, it equals a dict with exactly the keys `lines`, `words` and `chars`, each an integer equal to the count the text format reports for the same file (e.g. a file containing `a b\\nc\\n` gives {\"lines\": 2, \"words\": 3, \"chars\": 6}).",
        "status": "met"
      },
      {
        "id": "C2",
        "text": "Without `--json`, output and exit codes are unchanged: for a readable file stdout is exactly `lines: N\\nwords: N\\nchars: N\\n` with exit code 0; the existing tests in tests/test_wordstats.py remain in place and pass unmodified in meaning.",
        "status": "met"
      },
      {
        "id": "C3",
        "text": "With `--json` and a file that cannot be opened, the behavior matches the non-JSON error path: exit code 1, nothing on stdout, an `error: ...` message on stderr.",
        "status": "met"
      },
      {
        "id": "C4",
        "text": "New unittest tests under `tests/` exercise `--json` through `wordstats.main` (successful output parsed as JSON, and the missing-file case), and `python3 -m unittest discover -s tests` passes.",
        "status": "met"
      },
      {
        "id": "C5",
        "text": "README.md mentions the `--json` flag.",
        "status": "met"
      }
    ],
    "seconds": 284,
    "note": "Rerun of a blocked first run: the tester could not write under .git/factory-worktrees (permission system classed the path as sensitive), so the rerun used a worktrees directory outside the repository and the same spec. Seconds cover both runs."
  },
{
  "id": "2026-11-13-task-start-date-scylla",
  "title": "Task start date and timeline drag-to-create (issue #110)",
  "outcome": "passed",
  "reason": "All checks pass and every criterion is met after 1 repair round(s).",
  "phase": "Review",
  "agents": 34,
  "repairRounds": 1,
  "maxRepairRounds": 2,
  "specLine": "4 spec(s) · 3 level(s)",
  "specs": [
    {
      "id": "S1",
      "title": "startDate column, domain validation and REST API",
      "impl": "ok",
      "test": "ok",
      "implNote": "",
      "testNote": "",
      "waitFor": ""
    },
    {
      "id": "S2",
      "title": "startDate in server actions, MCP create_task/update_task, and mcp.md docs",
      "impl": "ok",
      "test": "ok",
      "implNote": "",
      "testNote": "",
      "waitFor": ""
    },
    {
      "id": "S3",
      "title": "Client task model, editor hook and drawer Start date picker",
      "impl": "ok",
      "test": "ok",
      "implNote": "",
      "testNote": "",
      "waitFor": ""
    },
    {
      "id": "S4",
      "title": "Timeline start-date bars, drag-to-create, and final full-repo verification",
      "impl": "ok",
      "test": "ok",
      "implNote": "",
      "testNote": "",
      "waitFor": ""
    }
  ],
  "check": {
    "text": "db-push, typecheck, lint, format, test: all exit 0 (644 tests pass)",
    "state": "ok"
  },
  "review": [
    {
      "tag": "whole",
      "text": "all criteria met; 2 minor findings",
      "state": "ok",
      "label": "Reviewer"
    },
    {
      "tag": "S1",
      "text": "0 minor finding(s)",
      "state": "ok",
      "label": "Spec reviewer"
    },
    {
      "tag": "S2",
      "text": "0 minor finding(s)",
      "state": "ok",
      "label": "Spec reviewer"
    },
    {
      "tag": "S3",
      "text": "1 minor finding(s)",
      "state": "ok",
      "label": "Spec reviewer"
    },
    {
      "tag": "S4",
      "text": "0 minor finding(s)",
      "state": "ok",
      "label": "Spec reviewer"
    }
  ],
  "repairs": [
    {
      "round": 1,
      "text": "typecheck failed on two new test files (missing status in seed helpers); testers corrected them, no source change",
      "state": "ok"
    }
  ],
  "criteria": [
    {
      "id": "C1",
      "text": "",
      "status": "met"
    },
    {
      "id": "C2",
      "text": "",
      "status": "met"
    },
    {
      "id": "C3",
      "text": "",
      "status": "met"
    },
    {
      "id": "C4",
      "text": "",
      "status": "met"
    },
    {
      "id": "C5",
      "text": "",
      "status": "met"
    },
    {
      "id": "C6",
      "text": "",
      "status": "met"
    },
    {
      "id": "C7",
      "text": "",
      "status": "met"
    },
    {
      "id": "C8",
      "text": "",
      "status": "met"
    },
    {
      "id": "C9",
      "text": "",
      "status": "met"
    },
    {
      "id": "C10",
      "text": "",
      "status": "met"
    },
    {
      "id": "C11",
      "text": "",
      "status": "met"
    },
    {
      "id": "C12",
      "text": "",
      "status": "met"
    },
    {
      "id": "C13",
      "text": "",
      "status": "met"
    }
  ],
  "seconds": 2024,
  "note": "Three workflow invocations of one run (wf_4cf28f7b-28a): (1) blocked, the tester could not write under .git/factory-worktrees (path classed as sensitive); (2) resumed with worktrees outside the repo, blocked falsely because the S2 implementer reported absolute paths and filesOutsideAssignment compared raw strings; (3) resumed after making that check strip the repo prefix, passed. Dashboard was not used live (live.js held another run's state). Agent count is from the final invocation."
},
{
  "id": "2026-11-13-e2e-share",
  "title": "e2e: --json flag with linked .venv",
  "outcome": "passed",
  "reason": "All checks pass and every criterion is met.",
  "phase": "Review",
  "agents": 6,
  "repairRounds": 0,
  "maxRepairRounds": 2,
  "specLine": "1 spec(s) · 1 level(s)",
  "specs": [
    {
      "id": "S1",
      "title": "--json output flag for wordstats",
      "impl": "ok",
      "test": "ok",
      "waitFor": "",
      "testNote": "Self-check 1: nothing changed"
    }
  ],
  "check": {
    "text": "test: exit 0",
    "state": "ok"
  },
  "review": [
    {
      "tag": "whole change",
      "text": "4/4 criteria met",
      "state": "ok"
    }
  ],
  "repairs": [],
  "criteria": [
    {
      "id": "C1",
      "text": "`.venv/bin/python wordstats.py --json FILE` prints exactly one JSON object to stdout with the keys \"lines\", \"words\" and \"chars\" and integer values equal to wordstats.stats() of the file's text, and exits 0. `wordstats.main([\"--json\", path])` behaves the same and returns 0.",
      "status": "met"
    },
    {
      "id": "C2",
      "text": "Without --json the output and exit code are byte-for-byte what they were before this change, for both a readable file and the existing error cases; every existing test in tests/test_wordstats.py passes unchanged.",
      "status": "met"
    },
    {
      "id": "C3",
      "text": "New tests in tests/ cover --json: the printed text parses as JSON, has exactly the three keys with the expected values for a known input, and the text format is not printed.",
      "status": "met"
    },
    {
      "id": "C4",
      "text": "README.md documents the --json flag in one or two lines.",
      "status": "met"
    }
  ],
  "seconds": 241,
  "note": "End-to-end check of the worktree changes on a copy of adds-json-flag-to-cli with an ignored .venv and .env: the check ran through .venv/bin/python, both were linked into the tester worktree next to the repo, and the tester ran its tests there (10 failing for the missing flag, as expected). Seconds include filing."
}
]
