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
]
