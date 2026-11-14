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
//                    impl: the implementer; test: the QA agent (the tester in
//                    runs before the implementer-tdd branch)
//                    impl / test: 'ok' | 'run' | 'wait' | 'fail' | 'none' (no such agent)
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
},
{
  "id": "2026-11-13-xfb-pilot-contract",
  "title": "xfb #2.1: monorepo, contract, outcome",
  "outcome": "passed",
  "reason": "All checks pass and every criterion is met.",
  "phase": "Review",
  "agents": 11,
  "repairRounds": 0,
  "maxRepairRounds": 2,
  "specLine": "2 spec(s) · 2 level(s)",
  "specs": [
    {
      "id": "S1",
      "title": "Workspace tooling and core attempt outcomes",
      "impl": "ok",
      "test": "ok",
      "waitFor": "",
      "testNote": "Self-check 1: nothing changed"
    },
    {
      "id": "S2",
      "title": "Event contract and stage-record schemas",
      "impl": "ok",
      "test": "ok",
      "waitFor": "S1",
      "testNote": "Self-check 1: nothing changed"
    }
  ],
  "check": {
    "text": "install: exit 0 · test: exit 0 · typecheck: exit 0 · lint: exit 0",
    "state": "ok"
  },
  "review": [
    {
      "tag": "whole change",
      "text": "9/9 criteria met",
      "state": "ok"
    },
    {
      "tag": "S1",
      "text": "5/5 criteria met",
      "state": "ok"
    },
    {
      "tag": "S2",
      "text": "5/5 criteria met",
      "state": "ok"
    }
  ],
  "repairs": [],
  "criteria": [
    {
      "id": "C1",
      "text": "The repository root is a pnpm workspace (pnpm-workspace.yaml covering packages/* and apps/*) with a committed pnpm-lock.yaml and a root package.json (private, \"type\": \"module\", engines node >=26) whose scripts are: `test` (runs `node --test` over every `*.test.ts` file under packages/ and apps/, executed directly by Node's native type stripping with no build step), `typecheck` (`tsc --noEmit` over the whole repository) and `lint` (Biome check). All four contract checks exit 0 from the repository root after a fresh `pnpm install --frozen-lockfile`.",
      "status": "met"
    },
    {
      "id": "C2",
      "text": "TypeScript configuration is strict and sets `erasableSyntaxOnly` (no enums, namespaces or parameter properties anywhere), and source files import each other with explicit `.ts` extensions so Node 26 runs them unbuilt. Biome is configured in biome.json at the root.",
      "status": "met"
    },
    {
      "id": "C3",
      "text": "Every third-party package (zod, typescript, @biomejs/biome, @types/node) is declared in the ROOT package.json only, so it resolves from the root node_modules for every file in the repository; workspace packages (packages/contract, packages/core) each have their own package.json (names `@xfb/contract` and `@xfb/core`, private, type module, an `exports` entry pointing at their .ts source) and declare no third-party dependencies of their own. packages/core does not import packages/contract in this slice.",
      "status": "met"
    },
    {
      "id": "C4",
      "text": "packages/contract exports a zod schema for the event envelope, shared by both versions: `{ spec, id, type, ts, attempt_id, payload }`, where `spec` is the literal \"factorybench/v1\" or \"xfb/v1\", `id` is a non-empty string (the sender's idempotency key, by convention `<attempt_id>:<key>`), `ts` is an ISO-8601 UTC timestamp string, `attempt_id` a non-empty string and `payload` an object. It also exports a function that validates one unknown value as an event and returns either the typed event or a list of errors in which every error names the offending field by its path (for example `payload.passed`), so a rejected event can be stored with an error naming the field.",
      "status": "met"
    },
    {
      "id": "C5",
      "text": "For spec \"factorybench/v1\", the accepted types are exactly `attempt.started`, `activity`, `usage`, `gate`, `pr.linked`, `attempt.finished` and any type starting with `human.`; another type is rejected with an error on field `type`. Known payload fields are checked, and unknown payload fields are kept (passthrough), because that schema is owned by another team: `gate` requires `name` (string) and `passed` (boolean), optional `reason` (string); `attempt.finished` requires `status` in completed|failed|cancelled, optional `reason`; `pr.linked` requires `pr_url` (string); `attempt.started` has optional `factory_config_version`, `base_commit`, `role` (strings) and `work_item` (object); `activity` requires `agent_id` (string); `usage` and `human.*` payloads accept any object.",
      "status": "met"
    },
    {
      "id": "C6",
      "text": "For spec \"xfb/v1\", the accepted types are exactly `factory.contract`, `factory.snapshot`, `factory.verdict`, `agent.transcript`, `bench.stage`, `bench.grade`, `git.followup`; another type is rejected with an error on field `type`. In this slice their payloads are any object, except `bench.stage`, whose payload must be a valid stage record (C7). Both specs' type lists are exported as constants.",
      "status": "met"
    },
    {
      "id": "C7",
      "text": "packages/contract exports a zod schema for a stage record (the content of a `stage.json`): `stage` is one of `1-prepare`, `2-agent`, `3-collect`, `4-grade` (the names exported as a constant, in order); `attempt_id` string; `status` one of `ok`, `failed`, `skipped`; `started_at` and `finished_at` ISO-8601 strings; `inputs` and `outputs` objects; and `error`, required when status is `failed` and forbidden otherwise, shaped `{ kind: 'infra' | 'agent', message: string, evidence: string, hint?: string }` where `evidence` is the path of the file to open.",
      "status": "met"
    },
    {
      "id": "C8",
      "text": "packages/core/outcome.ts exports the five outcomes as a constant (`resolved`, `unresolved`, `no_change`, `agent_error`, `infra_error`) and pure functions with no file, network, database or clock access: (a) a benchmark outcome from `{ error?: { kind: 'infra' | 'agent' }, diffEmpty: boolean, hiddenTestsPassed?: boolean }`; (b) a real-track outcome from `{ error?: { kind: 'infra' | 'agent' }, diffEmpty: boolean, factoryOutcome: 'passed' | 'failed' | 'blocked', reverted?: boolean }`; (c) whether an outcome counts as a pass in statistics (only `resolved`) and whether it is excluded from statistics (only `infra_error`). Precedence in both (a) and (b): an infra error gives `infra_error`, else an agent error gives `agent_error`, else an empty diff gives `no_change`; then benchmark: hidden tests passed gives `resolved`, failed gives `unresolved`, and an unknown hidden-test result (undefined) with no error is an infra problem and gives `infra_error`, never a pass or fail; real: Factory `passed` and not reverted gives `resolved`, anything else (`failed`, `blocked`, or passed then reverted) gives `unresolved`.",
      "status": "met"
    },
    {
      "id": "C9",
      "text": "There are `node --test` tests for C4-C8 that exercise behaviour through the packages' public exports: valid and invalid events of every listed type, an unknown type for each spec, an unknown `spec`, error paths naming the field, passthrough of unknown factorybench payload fields, a stage record with and without `error` against each status, and every row of the outcome precedence in C8. Test fixtures are small made-up events only.",
      "status": "met"
    }
  ],
  "seconds": 916,
  "note": "XS Factory Bench issue #2, slice 1. Rerun by the session: all four checks exit 0 (142 tests). A hand-written stub package was left in the repository node_modules/@xfb/contract (likely written by a tester through the linked node_modules); removed and reinstalled, checks still pass."
},
{
  "id": "2026-11-13-xfb-pilot-transcript",
  "title": "xfb #2.2: core/transcript",
  "outcome": "passed",
  "reason": "All checks pass and every criterion is met.",
  "phase": "Review",
  "agents": 15,
  "repairRounds": 0,
  "maxRepairRounds": 2,
  "specLine": "3 spec(s) · 3 level(s)",
  "specs": [
    {
      "id": "S1",
      "title": "Transcript parser and usage helpers",
      "impl": "ok",
      "test": "ok",
      "waitFor": "",
      "testNote": "Self-check 1: nothing changed"
    },
    {
      "id": "S2",
      "title": "Stream-json parser",
      "impl": "ok",
      "test": "ok",
      "waitFor": "S1",
      "testNote": "Self-check 1: nothing changed"
    },
    {
      "id": "S3",
      "title": "Roles, agent tree and the @xfb/core/transcript entry",
      "impl": "ok",
      "test": "ok",
      "waitFor": "S1, S2",
      "testNote": "Self-check 1: nothing changed"
    }
  ],
  "check": {
    "text": "install: exit 0 · test: exit 0 · typecheck: exit 0 · lint: exit 0",
    "state": "ok"
  },
  "review": [
    {
      "tag": "whole change",
      "text": "9/9 criteria met",
      "state": "ok"
    },
    {
      "tag": "S1",
      "text": "5/5 criteria met",
      "state": "ok"
    },
    {
      "tag": "S2",
      "text": "2/2 criteria met",
      "state": "ok"
    },
    {
      "tag": "S3",
      "text": "4/4 criteria met",
      "state": "ok"
    }
  ],
  "repairs": [],
  "criteria": [
    {
      "id": "C1",
      "text": "Everything lives under packages/core/transcript/ and is exported from @xfb/core through a new `./transcript` entry in packages/core/package.json (imported as `@xfb/core/transcript`). The code is pure: every function takes file contents as strings or already-parsed values, and nothing reads files, the network, the environment or the clock. No new third-party dependency.",
      "status": "met"
    },
    {
      "id": "C2",
      "text": "A transcript parser takes the text of one Claude Code transcript (JSON Lines: a session's `<session>.jsonl` or an agent's `agent-<id>.jsonl`) and returns: `sessionId` and `agentId` (from the lines' `sessionId` / `agentId` fields; agentId undefined for a main session), first and last `timestamp`, the API requests and the tool calls. Lines that are blank are skipped; lines that are not valid JSON are not fatal and are returned as a list of their 1-based line numbers; lines of types other than `assistant` and `user` (for example `attachment`, `api-request`, `api-request-blob`, `api-request-shape`, `system`) are ignored.",
      "status": "met"
    },
    {
      "id": "C3",
      "text": "API requests come from `assistant` lines. Claude Code writes one line per content block, so several lines share one `message.id`, each repeating the usage: requests are deduplicated by `message.id`, keeping the usage of the LAST line with that id. Each request has `messageId`, `requestId` (the line's `requestId`, if any), `model` (`message.model`), `ts`, and `usage` with four non-overlapping classes: `input` (`input_tokens`), `output` (`output_tokens`), `cacheRead` (`cache_read_input_tokens`), `cacheWrite` (`cache_creation_input_tokens`), plus `cacheWrite5m` / `cacheWrite1h` from `cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens` when present. A message whose model is `<synthetic>` is not an API request and is excluded. A message with no `usage` object is kept with `usage` undefined (unknown is missing, not zero), and any total that includes such a request is flagged incomplete instead of counting it as 0.",
      "status": "met"
    },
    {
      "id": "C4",
      "text": "Tool calls come from `tool_use` content blocks of assistant lines (`id`, `name`, the line's `timestamp`) and are matched with `tool_result` blocks in `user` lines by `tool_use_id`, giving `isError` true or false from the result's `is_error`, or undefined when no result was found. Tool inputs and result contents are NOT kept in the returned records (they hold private data); only id, name, ts and isError. A tool_use id repeated across lines is one call.",
      "status": "met"
    },
    {
      "id": "C5",
      "text": "A stream-json parser takes the text of `claude -p --output-format stream-json --verbose` output (JSON Lines) and returns: from the `system`/`init` line, `sessionId`, `model` and `claudeCodeVersion` (`claude_code_version`); the main session's API requests (from `assistant` lines, same dedupe and usage rules as C3, each also carrying `parentToolUseId` from `parent_tool_use_id`, null for the main thread) and tool calls (same rules as C4); every `result` line in order, each as `{ subtype, isError (is_error), totalCostUsd (total_cost_usd), numTurns (num_turns), durationMs (duration_ms), modelUsage }` where `modelUsage` maps model id to `{ input (inputTokens), output (outputTokens), cacheRead (cacheReadInputTokens), cacheWrite (cacheCreationInputTokens), costUsd (costUSD) }`; workflows from `system`/`task_started` lines that have a `workflow_name` (`{ taskId, runId, workflowName, toolUseId }`) with the `status` of their later `system`/`task_notification` line with the same `task_id` (undefined while none); and workflow agents from the `workflow_progress` arrays of `system`/`task_progress` lines, keeping entries with `type: \"workflow_agent\"` and a non-empty `agentId`, one per agentId with the fields of its latest entry: `agentId`, `runId` (the task_progress line's `run_id`), `label`, `phase` (`phaseTitle`), `model`, `state`, `attempt`, `startedAt` (milliseconds since epoch in the input, returned as an ISO-8601 string; undefined if absent). The prompt text (`promptPreview`, `prompt`) is never returned. Invalid JSON lines are reported by line number as in C2.",
      "status": "met"
    },
    {
      "id": "C6",
      "text": "A role function maps a Factory workflow agent label to `{ role, spec?, level?, round?, pass? }`, following the labels written in /Users/macbookpro/Downloads/claude-factory-skills-main/factory/workflow/factory.js: `planner` and `planner (revision)` -> planner; `build <spec>` -> implementer; `test <spec>` -> tester; `self-check <n> <spec>` -> tester with pass n; `repair <round> <spec> tests` -> tester with round; `checker` / `checker (round <n>)` -> checker; `reviewer` / `reviewer (round <n>)` -> reviewer; `review <spec>` / `review <spec> (round <n>)` -> spec-reviewer; `fixer (round <n>)` -> fixer; `worktrees (level <n>)` and `gather tests (level <n>)` -> helper with level; `record <anything>` -> recorder. A trailing ` (round <n>)` or ` (level <n>)` sets round or level. Any other label returns `{ role: undefined }` (unknown, never a guess).",
      "status": "met"
    },
    {
      "id": "C7",
      "text": "An agent-tree builder takes `{ session: <main session transcript text>, agents: [{ agentId, meta?: <agent-<id>.meta.json text>, transcript: <agent-<id>.jsonl text>, workflowRunId?: string }], journals?: [{ workflowRunId, text: <journal.jsonl text> }] }` and returns one root node for the main session plus one node per agent, each with `id`, `parentId` (null for the root), `kind` (`session`, `subagent` or `workflow-agent`: an agent with a workflowRunId is a workflow agent), `label` (meta `description`, else the journal `started` line's `label` for that agentId), `phase` (meta `workflowPhase`, else the journal's `phase`), the role fields of C6 from the label (workflow agents only), `workflowRunId`, `agentType` (meta `agentType`), `model` (the most-used model of its requests), and totals: usage summed over its deduplicated requests (with the incomplete flag of C3), request count, tool-call count, tool-error count, first and last timestamp. Parent rule: when meta has `toolUseId`, the parent is the node whose transcript contains a tool_use with that id; otherwise, or when no node contains it, the parent is the root. Malformed meta JSON does not throw: the node is kept without meta fields and the problem is listed in a returned `problems` array naming the agentId.",
      "status": "met"
    },
    {
      "id": "C8",
      "text": "Usage helpers: (a) sum usage by model over any list of requests, returning per model the four classes, request count and the incomplete flag; (b) compare such per-model token totals with a result's `modelUsage` (C5), returning one row per model found on either side with, per class, the transcript value, the reported value and their difference; a model missing on one side has that side undefined (not 0) and the difference undefined. This is what answers the pilot's question whether transcript totals match what Claude Code reports.",
      "status": "met"
    },
    {
      "id": "C9",
      "text": "`node --test` tests cover C2-C8 through the public `@xfb/core/transcript` exports, using small MADE-UP JSONL fixtures shaped like the real records (in the test files or in files beside them under packages/core/transcript/): dedupe by message.id keeping the last usage, `<synthetic>` exclusion, missing usage flagged incomplete, invalid and blank lines, tool results matched / missing / is_error true, no tool input or prompt text in any output, stream-json init, several result lines, workflow task started then notified, workflow_agent entries updated across task_progress lines, every label form of C6 plus an unknown label, tree parenting by toolUseId and the fallback to root, journal fallback for label and phase, malformed meta, and the per-model comparison including a model present on only one side. No fixture contains real prompts, real paths from this machine, or personal data.",
      "status": "met"
    }
  ],
  "seconds": 1324,
  "note": "XS Factory Bench issue #2, slice 2. Rerun by the session: all four checks exit 0 (257 tests); no private paths or names in the fixtures."
},
{
  "id": "2026-11-13-xfb-pilot-bench",
  "title": "xfb #2.3: bench pipeline and CLI",
  "outcome": "passed",
  "reason": "All checks pass and every criterion is met after 1 repair round(s).",
  "phase": "Repair",
  "agents": 32,
  "repairRounds": 1,
  "maxRepairRounds": 2,
  "specLine": "5 spec(s) · 3 level(s)",
  "specs": [
    {
      "id": "S1",
      "title": "Foundation: BenchError, grader interface, CLI package, adapters, task reader, run-stage",
      "impl": "ok",
      "test": "ok",
      "waitFor": "",
      "testNote": "Self-check 1: nothing changed"
    },
    {
      "id": "S2",
      "title": "Stages 1-prepare and 4-grade",
      "impl": "ok",
      "test": "ok",
      "waitFor": "S1",
      "testNote": "Self-check 2: nothing changed"
    },
    {
      "id": "S3",
      "title": "Arms, stage 2-agent and stage 3-collect",
      "impl": "ok",
      "test": "ok",
      "waitFor": "S1",
      "testNote": "Self-check 1: nothing changed"
    },
    {
      "id": "S4",
      "title": "Directories, attempt orchestration, outcome and run loop",
      "impl": "ok",
      "test": "ok",
      "waitFor": "S1",
      "testNote": "Self-check 1: nothing changed"
    },
    {
      "id": "S5",
      "title": "xfb CLI: entry, run/show/stage commands and end-to-end tests",
      "impl": "ok",
      "test": "ok",
      "waitFor": "S2, S3, S4",
      "testNote": "Self-check 1: nothing changed"
    }
  ],
  "check": {
    "text": "install: exit 0 · test: exit 0 · typecheck: exit 0 · lint: exit 0",
    "state": "ok"
  },
  "review": [
    {
      "tag": "whole change",
      "text": "11/11 criteria met",
      "state": "ok"
    },
    {
      "tag": "S1",
      "text": "4/4 criteria met",
      "state": "ok"
    },
    {
      "tag": "S2",
      "text": "3/3 criteria met",
      "state": "ok"
    },
    {
      "tag": "S3",
      "text": "3/3 criteria met",
      "state": "ok"
    },
    {
      "tag": "S4",
      "text": "3/3 criteria met",
      "state": "ok"
    },
    {
      "tag": "S5",
      "text": "3/3 criteria met",
      "state": "ok"
    }
  ],
  "repairs": [
    {
      "round": 1,
      "text": "4 failure(s) sent to fixer",
      "state": "ok"
    }
  ],
  "criteria": [
    {
      "id": "C1",
      "text": "Layout follows docs/architecture.md: apps/cli (package `@xfb/cli`, private, type module, a `bin` entry `xfb` pointing at a .ts file with a `#!/usr/bin/env node` shebang, run unbuilt by Node 26) with bench/pipeline/{1-prepare,2-agent,3-collect,4-grade,run-stage}.ts, bench/arms/{factory,baseline}.ts, adapters/ (the only place with side effects: exec, git, files, clock) and commands/ (one file per subcommand, glue only). The CLI depends on @xfb/contract and @xfb/core as workspace packages. Any new third-party package (for example a TOML parser) is declared in the root package.json only. `BenchError` (fields `kind`: 'infra' | 'agent', `stage`, `attemptId`, `message`, `evidence` (path of the file to open), `hint?`) and the grader interface types live in packages/core (pure, no I/O) and are exported from @xfb/core. No file is created under grader/.",
      "status": "met"
    },
    {
      "id": "C2",
      "text": "Every external command goes through the exec adapter, which appends one JSON line per command to the current stage's `commands.jsonl`: command, args, cwd, start and end time, duration, exit code or signal, whether it timed out, and the last lines of stdout and stderr (stdout/stderr may also be streamed to a named file, as 2-agent does). Environment variables are not logged (they may hold secrets). Only `run-stage.ts` catches errors: it runs one stage, writes `<attempt>/<stage>/stage.json` that validates against @xfb/contract's stage record schema (status ok / failed / skipped, timings, inputs, outputs, and on failure `error: {kind, message, evidence, hint}` taken from the BenchError), and records any non-BenchError exception as `kind: 'infra'` with the stack in a file referenced by `evidence`. Error messages start with the stage name in brackets, e.g. `[3-collect] ...`. A stage after a failed stage is written as `skipped`.",
      "status": "met"
    },
    {
      "id": "C3",
      "text": "Directories: tasks are read from `--tasks <dir>` (default env `XFB_TASKS_DIR`, else `~/Documents/xs-factory-bench-tasks`); clones and attempt records live under the work dir (env `XFB_WORK_DIR`, default `~/.xfb-work`), with attempt records at `<work>/runs/<run-id>/attempts/<task>__<arm>__t<n>/` (attempt.json plus the four stage folders with the files listed in docs/architecture.md) and the agent's clone in a separate directory under `<work>` that never contains the task's `tests/` or `solution/`. The runner refuses (infra error, clear message) to use a tasks dir or work dir that is inside this repository, and refuses a work dir inside the tasks dir or vice versa. docs/architecture.md is updated in the same change to say attempt records live under the work dir, not `runs/` in the repository (hidden-test output must stay out of this repository, which Factory agents may read).",
      "status": "met"
    },
    {
      "id": "C4",
      "text": "Task format read by the runner (the layout of docs/architecture.md): `<task-id>/task.toml` with at least `id`, `base_commit`, and optional `time_limit_minutes` and `budget_usd`; `instruction.md`; `repo.bundle`; `tests/` with `test.sh`; `solution/solution.diff`. A missing or invalid file is an infra BenchError naming the file. The runner only reads these files; validating a task fully (`xfb task check`) is out of scope.",
      "status": "met"
    },
    {
      "id": "C5",
      "text": "1-prepare makes a fresh clone of `repo.bundle` into the attempt's clone dir, checks out `base_commit` on a branch, removes every remote, every other branch and tag, expires the reflog and prunes, and then verifies that no commit other than the base and its ancestors is reachable (`git rev-list --all` equals `git rev-list <base>`); any failure is an infra BenchError whose evidence is 1-prepare/commands.jsonl. It records the base commit in its outputs.",
      "status": "met"
    },
    {
      "id": "C6",
      "text": "2-agent runs the arm in the clone with `claude -p <prompt> --output-format stream-json --verbose --model <model> --max-budget-usd <budget>` plus the arm's extra args, with env `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`, stdout saved to 2-agent/stream.jsonl and stderr to 2-agent/stderr.log, and a timeout from the task's time limit (default 60 minutes). The claude executable is configurable (`--claude <path>`, default `claude`) so tests can use a fake. The `factory` arm's prompt is `/factory ` followed by instruction.md and a last line asking the session to end its report with exactly `FACTORY_OUTCOME: passed|failed|blocked`; the `baseline` arm's prompt is instruction.md alone and it adds `--disallowedTools Skill Workflow`. Both add `--permission-mode bypassPermissions` (the clone is disposable and outside this repository). Outcome of the stage: stderr containing `Background tasks still running` is an infra error (the harness stopped the run); a timeout, a non-zero exit, no `result` line, or a result with `is_error` true (including a budget stop) is an agent error; otherwise ok.",
      "status": "met"
    },
    {
      "id": "C7",
      "text": "3-collect writes 3-collect/final.diff (every change in the clone against the base commit, including new untracked files and commits the session made); usage.json built with @xfb/core/transcript: the main session's parsed stream-json (requests, tool calls, results, workflows, workflow agents), and, when the session's transcript directory is found under `~/.claude/projects/*/<sessionId>/` (projects root configurable for tests), the agent tree with per-agent totals and the per-model comparison of transcript tokens against the last result's modelUsage; when it is not found, usage.json says so (missing, not zero). factory-verdict.json holds the outcome parsed from the last `FACTORY_OUTCOME:` line of the last result text (factory arm only; `null` when absent). Factory's verdict is process data only and is never used as the attempt outcome.",
      "status": "met"
    },
    {
      "id": "C8",
      "text": "4-grade loads the grader from `<repo root>/grader/index.ts` through the grader interface in packages/core: `grade({ attemptId, taskDir, diffFile, checkoutDir, logFile })` resolving to `{ passed: boolean, failToPass: {name, passed}[], passToPass: {name, passed}[] }`, where checkoutDir is a NEW clone made by 4-grade (not the agent's clone). When grader/index.ts does not exist, the stage fails as an infra error whose hint says the grader is human-owned and not written yet (issue #1). The grader result is written to 4-grade/grade.json; the grader's output goes to 4-grade/test-output.log. The grader module location can be injected for tests; tests never create grader/.",
      "status": "met"
    },
    {
      "id": "C9",
      "text": "attempt.json holds the attempt id, task, arm, trial, model, the recorded Factory revision (the skill directory's git short commit plus a `.dirty-<hash>` suffix when it has uncommitted changes, `?` when unknown; skill dir configurable, default `~/.claude/skills/factory`), Claude Code version (`claude --version`), and the outcome computed by @xfb/core/outcome's benchmark rule from the first failed stage's error kind, whether final.diff is empty and the grade's `passed` (undefined when 4-grade did not produce one).",
      "status": "met"
    },
    {
      "id": "C10",
      "text": "Commands: `xfb run --tasks <dir> --task <id>... --arms factory,baseline --trials <n> --model <id> [--run-id <id>] [--claude <path>]` runs every task x arm x trial in sequence, never stops the whole run because one attempt failed, and prints one line per attempt with its outcome; `--model` is required. `xfb show <attempt dir>` prints the attempt's identity, each stage's status and duration, and for the first failed stage its error message, evidence path and hint, then the outcome. `xfb stage <attempt dir> <stage>` reruns one stage (and recomputes the outcome in attempt.json) from the files already on disk, so 3-collect or 4-grade can be redone without running the agent again. Unknown commands or missing arguments print usage and exit non-zero.",
      "status": "met"
    },
    {
      "id": "C11",
      "text": "`node --test` tests cover C2-C10 without spending money or touching the real ~/.claude, ~/.xfb-work or tasks directory: unit tests with a fake exec adapter, and at least one end-to-end test that builds a tiny made-up task in a temp dir (a git repo bundled with `git bundle`, a trivial instruction, a test.sh), runs `xfb run` (or the pipeline function behind it) with a fake claude executable that edits a file and prints canned stream-json, an injected fake grader and temp work/projects dirs, and checks the attempt folder layout, every stage.json against the schema, final.diff, usage.json and the outcome; plus cases for the missing grader (infra_error), a fake claude that exits non-zero (agent_error), stderr with `Background tasks still running` (infra_error), an empty diff (no_change), a bundle containing a commit after the base (1-prepare removes it or fails), and the refusal of a work dir inside the repository. Tests write only under the OS temp dir.",
      "status": "met"
    }
  ],
  "seconds": 3190,
  "note": "XS Factory Bench issue #2, slice 3. First pass blocked: a separate session of the owner wrote grader/ and pnpm-workspace.yaml into the working tree during the run; resumed with those in ignoreFiles (cached agents replayed). Passed after 1 repair round. Rerun by the session: all four checks exit 0 (568 tests, grader tests included). Seconds span both passes, including the pause between them."
},
{
  "id": "2026-11-14-xfb-pricing-normalize",
  "title": "xfb #3.1: pricing and normalize",
  "outcome": "passed",
  "reason": "All checks pass and every criterion is met after 1 repair round(s).",
  "phase": "Repair",
  "agents": 17,
  "repairRounds": 1,
  "maxRepairRounds": 2,
  "specLine": "2 spec(s) · 2 level(s)",
  "specs": [
    {
      "id": "S1",
      "title": "Dated price tables and the pricing function",
      "impl": "ok",
      "test": "ok",
      "waitFor": "",
      "testNote": "Self-check 1: nothing changed"
    },
    {
      "id": "S2",
      "title": "normalize: raw events to derived records, with golden cases",
      "impl": "ok",
      "test": "ok",
      "waitFor": "S1",
      "testNote": "Self-check 1: nothing changed"
    }
  ],
  "check": {
    "text": "test: exit 0 · typecheck: exit 0 · lint: exit 0",
    "state": "ok"
  },
  "review": [
    {
      "tag": "whole change",
      "text": "7/7 criteria met",
      "state": "ok"
    },
    {
      "tag": "S1",
      "text": "3/3 criteria met",
      "state": "ok"
    },
    {
      "tag": "S2",
      "text": "5/5 criteria met",
      "state": "ok"
    }
  ],
  "repairs": [
    {
      "round": 1,
      "text": "5 failure(s) sent to fixer, S1 tester",
      "state": "ok"
    }
  ],
  "criteria": [
    {
      "id": "C1",
      "text": "`pricing/prices/2026-11-14.json` exists and holds, per model id, USD prices per million tokens for `input`, `output`, `cache_write_5m`, `cache_write_1h` and `cache_read`, plus top-level `effective_date: \"2026-11-14\"` and a `source` string. Rows (input/output/cache_write_5m/cache_write_1h/cache_read): claude-fable-5-2 and claude-mythos-5-2 8/40/10/16/0.20; claude-fable-5-1 and claude-mythos-5-1 10/50/12.5/20/0.25; claude-fable-5 and claude-mythos-5 10/50/12.5/20/1.00; claude-opus-5-5 4/20/5/8/0.20; claude-opus-5, claude-opus-4-8, claude-opus-4-7, claude-opus-4-6 5/25/6.25/10/0.50; claude-sonnet-5-5 2/10/2.5/4/0.10; claude-sonnet-5 2/10/2.5/4/0.20; claude-sonnet-4-6 3/15/3.75/6/0.30; claude-haiku-5-5 0.10/0.50/0.125/0.20/0.01 with an optional `long_context` tier {threshold_input_tokens: 100000, input: 0.50, output: 2.50, cache_write_5m: 0.625, cache_write_1h: 1.00, cache_read: 0.05}; claude-haiku-4-5 1/5/1.25/2/0.10. The file is valid against the price-table schema exported by packages/core/pricing.ts, and a test checks that.",
      "status": "met"
    },
    {
      "id": "C2",
      "text": "`packages/core/pricing.ts` (exported as `@xfb/core/pricing`) is pure (no files, network, env or clock; tables are passed in as arguments) and provides: a zod schema for one price table; selection of the table in effect at an event timestamp (the table with the latest `effective_date` on or before the timestamp's UTC date; none when every table is later); and pricing of one request's usage (the existing `Usage` type of @xfb/core/transcript: input, output, cacheRead, cacheWrite, optional cacheWrite5m/cacheWrite1h) for a model id at a timestamp, returning `{ costUsd, provenance, priceVersion, unpricedReason }` where provenance is `estimated` when priced from a table and `unpriced` when it cannot be priced (costUsd then undefined, never 0, and unpricedReason says why). Model ids match exactly, or after removing a trailing `-YYYYMMDD` date suffix. Cache writes are priced from cacheWrite5m and cacheWrite1h; when cacheWrite > 0 and that split is missing or does not add up to cacheWrite, the request is unpriced (reason names the missing split). The long_context tier applies to a request whose input + cacheRead + cacheWrite exceeds the threshold. Unknown model or no table in effect gives unpriced. Results are rounded to no more than 1e-9 USD error (use integer micro-dollar math or document the rounding).",
      "status": "met"
    },
    {
      "id": "C3",
      "text": "`packages/core/normalize/` (exported as `@xfb/core/normalize`) is pure and exports a type for a stored raw event `{ seq, source, personId, spec, id, attemptId, type, ts, receivedAt, payload, rejected }` (seq: insertion order number; rejected: list of `{path, message}` field errors or null) and a function `normalize(events, { priceTables })` returning derived records: `attempts`, `agentRuns`, `usage`, `gates`, `stages`, `grades` and `rejected`. Events are deduplicated by (personId, id), keeping the lowest seq; rejected events go only into `rejected` (with personId, id, type, receivedAt and their errors) and feed no other table; accepted events are applied in order of ts, then seq. Output arrays are sorted deterministically, so the same set of events given in any order yields a deep-equal result.",
      "status": "met"
    },
    {
      "id": "C4",
      "text": "Derived records from factorybench/v1 events: one `attempts` record per (personId, attemptId) with track (`benchmark` when the attempt has any bench.stage or bench.grade event, else `real`), startedAt (from attempt.started), finishedAt and status and reason (from attempt.finished), factoryConfigVersion and baseCommit (from attempt.started), prUrls (from pr.linked), eventCount and rejectedCount; unknown values are left undefined, not 0 or empty string. `agentRuns`: one per (personId, attemptId, agent_id) seen in activity or usage events, with parentAgentId (payload `parent_agent_id`, if given), role (payload `role`, if given), firstTs, lastTs and activityCount. `usage`: one record per usage event with attemptId, agentId (payload `agent_id`, if given), model (payload `model`), ts, the four token classes (+ optional 5m/1h split from payload `cache_creation` `{ephemeral_5m_input_tokens, ephemeral_1h_input_tokens}` if given), and cost: provenance `reported` with that cost when payload `cost_usd` is a number, otherwise the result of C2's pricing (`estimated` or `unpriced`), plus priceVersion. `gates`: name, passed, reason, ts per gate event. human.* events count toward eventCount only.",
      "status": "met"
    },
    {
      "id": "C5",
      "text": "Derived records from xfb/v1 benchmark events: `stages`, one per (personId, attemptId, stage name) from bench.stage payloads (the existing stage.json schema of @xfb/contract): stage, status, startedAt, finishedAt, durationMs if present and errorKind/errorMessage when the record has an error; a later event (by ts, then seq) for the same stage replaces the earlier one. `grades`, one per (personId, attemptId) from bench.grade payloads: passed (boolean if present), failToPass and passToPass arrays of {name, passed} when present; a malformed field is left undefined rather than throwing. Other xfb/v1 types (factory.*, agent.transcript, git.followup) count toward eventCount but produce no records in this change.",
      "status": "met"
    },
    {
      "id": "C6",
      "text": "Golden tests: `testdata/golden/<case>/events.json` (an array of stored raw events) and `expected.json` (the exact normalize output, with the 2026-11-14 price table passed in) for at least these cases: `duplicate-ids` (the same id sent twice by one person, and the same id by two different people, which are not duplicates), `out-of-order` (events whose seq order differs from ts order), `rejected-event` (a rejected event stored with its errors that appears only in `rejected`), `nested-subagents` (activity and usage for a parent agent and two levels of subagents linked by parent_agent_id), and `pricing` (a reported cost, an estimated cost, an unknown model, a cache write without the 5m/1h split, and a model id with a date suffix). A `node --test` file under packages/core/normalize/ runs every case directory it finds and deep-compares; a mismatch names the case. The JSON files pass `biome check`.",
      "status": "met"
    },
    {
      "id": "C7",
      "text": "Unit tests under packages/core cover every rule of C2-C5 that the golden cases do not; packages/core/package.json exports `./pricing` and `./normalize`; docs/architecture.md (the \"Built so far\" sentence and the repository layout if it changes) and the status paragraph of CLAUDE.md say that pricing.ts, the 2026-11-14 price table, normalize and the golden cases exist; README.md (Vietnamese) is updated where it lists what exists. `pnpm test`, `pnpm typecheck` and `pnpm lint` all exit 0.",
      "status": "met"
    }
  ],
  "seconds": 1568,
  "note": "XS Factory Bench issue #3, slice 1. Passed after 1 repair round (a tester's miscounted model-id assertion, corrected by the tester; no code change). Rerun by the session: test (753), typecheck and lint exit 0."
},
{
  "id": "2026-11-14-xfb-db-replay",
  "title": "xfb #3.2: database and replay",
  "outcome": "failed",
  "reason": "Repair round 1 could not be carried out. fixer: The only failure, `pnpm test` exiting 1, comes from apps/cli/bench/pipeline/run-stage.test.ts:350-363. That test requires apps/cli/package.json dependencies to be exactly {@xfb/contract, @xfb/core, @xfb/grader}. apps/cli/package.json also has '@xfb/db': 'workspace:*'. The base commit 6879ce3 added that line, so the test already failed before this change. I checked with `git show 6879ce3`: it changed apps/cli/package.json and left the test as it was. Neither file is in the map. The test file is not mine to change, and apps/cli/package.json is not among the source files I may change. Removing the dependency would also be wrong: C6 needs the CLI to import @xfb/db (apps/cli/replay.ts and apps/cli/commands/replay.ts), and the base commit added the dep for exactly that. No source file I own can fix this. One of two changes is needed. Either the expectation at lines 359-363 of apps/cli/bench/pipeline/run-stage.test.ts gains '@xfb/db': 'workspace:*' (the reviewer's recommended fix; it is a stale assertion, not a code defect), or the map gives that test file to a tester or the run's owner to correct. Then `pnpm test` should exit 0: the other 861 tests pass, and typecheck and lint already exit 0.",
  "phase": "Repair",
  "agents": 17,
  "repairRounds": 1,
  "maxRepairRounds": 2,
  "specLine": "3 spec(s) · 2 level(s)",
  "specs": [
    {
      "id": "S1",
      "title": "normalize: dedupe among accepted events only",
      "impl": "ok",
      "test": "ok",
      "waitFor": "",
      "testNote": "Self-check 1: nothing changed"
    },
    {
      "id": "S2",
      "title": "packages/db: schema, migrations, intake and replay",
      "impl": "ok",
      "test": "ok",
      "waitFor": "",
      "testNote": "Self-check 2: tests corrected"
    },
    {
      "id": "S3",
      "title": "xfb replay command and docs",
      "impl": "ok",
      "test": "ok",
      "waitFor": "S2",
      "testNote": "Self-check 1: nothing changed"
    }
  ],
  "check": {
    "text": "test: exit 1 · typecheck: exit 0 · lint: exit 0",
    "state": "fail"
  },
  "review": [
    {
      "tag": "whole change",
      "text": "6/7 criteria met, 1 blocking finding(s)",
      "state": "fail"
    },
    {
      "tag": "S1",
      "text": "1/1 criteria met",
      "state": "ok"
    },
    {
      "tag": "S2",
      "text": "4/4 criteria met",
      "state": "ok"
    },
    {
      "tag": "S3",
      "text": "1/2 criteria met",
      "state": "fail"
    }
  ],
  "repairs": [
    {
      "round": 1,
      "text": "4 failure(s) sent to fixer",
      "state": "run"
    }
  ],
  "criteria": [
    {
      "id": "C1",
      "text": "packages/core/normalize changes its dedupe rule: events are deduplicated by (personId, id) among ACCEPTED events only (lowest seq wins); every rejected event is listed in `rejected` and never hides an accepted event with the same id; an empty id is never a duplicate. A golden case `rejected-then-resent` (a rejected event followed by a corrected resend with the same id from the same person: the resend is applied and the rejected one is listed) is added, existing golden cases and unit tests are updated only where this rule changes their result, and the module's comments say the new rule.",
      "status": "met"
    },
    {
      "id": "C2",
      "text": "packages/db (package `@xfb/db`, its package.json already exists with workspace deps on @xfb/contract and @xfb/core and must keep them; all third-party packages it uses, drizzle-orm 0.45.4, pg 8.23.1, @electric-sql/pglite 0.5.12, drizzle-kit 0.31.11, are already in the root package.json and must not be added elsewhere) has a Drizzle schema (drizzle-orm/pg-core) with: table `events` with columns seq (identity primary key, insertion order), source, person_id, spec, id, attempt_id, type, ts (text, as received), received_at (timestamptz), payload (jsonb), raw (jsonb, the whole body as received, set only for rejected events) and rejected (jsonb list of {path, message}, null when accepted); a unique index on (person_id, id) restricted to accepted events with a non-empty id; and one derived table per record type of @xfb/core/normalize (attempts, agent_runs, usage, gates, stages, grades, rejected_events) whose columns hold every field of that record (nullable where the field is optional; arrays such as prUrls, failToPass and passToPass as jsonb).",
      "status": "met"
    },
    {
      "id": "C3",
      "text": "Migrations are SQL files generated by drizzle-kit into packages/db/migrations/ (with drizzle's meta journal) from packages/db/drizzle.config.ts, and a `migrate(db)` function applies them to a fresh database for both drivers. `openDb(url)` returns a Drizzle database for a `postgres://` or `postgresql://` url (node-postgres Pool) or for `memory:` (in-memory PGlite) or `pglite:<absolute dir>` (PGlite on disk), plus a `close()`; any other url throws an error that names the accepted forms. Nothing in packages/db reads environment variables or the clock: the caller passes urls and times in.",
      "status": "met"
    },
    {
      "id": "C4",
      "text": "`ingestEvents(db, { personId, receivedAt, events })` takes an array of raw request bodies (unknown values), validates each with `validateEvent` of @xfb/contract, stores accepted events (a resend of an accepted (person_id, id) is not stored again and counts as a duplicate) and stores every rejected one with its field errors (id, type, ts, attempt_id stored when they are strings, else empty string; payload stored when it is a plain object, else {}; raw holds the whole body; source `contract`). It returns `{ accepted, duplicates, rejected, results }` where results has one entry per input index: `{ index, status: 'accepted' | 'duplicate' | 'rejected', errors? }`, errors naming the field path (for example `payload.status`). person_id always comes from the argument, never from the body.",
      "status": "met"
    },
    {
      "id": "C5",
      "text": "`replay(db, { priceTables })` reads every row of `events` in seq order, maps rows to the stored-event type of @xfb/core/normalize, runs normalize and, in one transaction, empties every derived table and inserts the result, returning the number of rows written per table. `readDerived(db)` reads the derived tables back into the exact shape normalize returns (null columns become absent fields, the same deterministic order). Tests (PGlite in memory) show: for every golden case in testdata/golden, ingesting its accepted events and running replay gives `readDerived` deep-equal to `normalize` of the same stored rows; sending the same event twice stores one row; an event with a schema error is rejected with an error naming the field and appears in rejected_events; emptying the derived tables (or corrupting a row) and running replay again gives exactly the same derived data as before; replay twice in a row is idempotent.",
      "status": "met"
    },
    {
      "id": "C6",
      "text": "`xfb replay [--db <url>] [--prices <dir>]` in apps/cli: the database url comes from --db, else env XFB_DATABASE_URL, else env DATABASE_URL, else it is a usage error (exit 2) saying so; price tables are read from every `*.json` in --prices (default: the repository's pricing/prices/ resolved from the CLI module's own location), each validated with the price-table schema of @xfb/core/pricing (an invalid file is an error naming the file); it runs migrate then replay and prints one line per derived table with its row count, exit 0. File reads go through apps/cli/adapters/files.ts; the command file in apps/cli/commands/ is glue only; USAGE in main.ts lists the command. A test runs it against a `pglite:` directory under the OS temp dir with a seeded events table and checks the output and exit code.",
      "status": "met"
    },
    {
      "id": "C7",
      "text": "docs/architecture.md (Built so far, and the layout/data-model text if it changes), the status paragraph of CLAUDE.md and README.md (Vietnamese, where it lists what exists) say packages/db, migrations, intake, replay and `xfb replay` exist. `pnpm test`, `pnpm typecheck` and `pnpm lint` exit 0, and no test needs a running Postgres server, network access or a file outside the OS temp dir.",
      "status": "not_met"
    }
  ],
  "seconds": 1876,
  "note": "XS Factory Bench issue #3, slice 2. Failed only on a stale assertion in apps/cli/bench/pipeline/run-stage.test.ts (exact apps/cli dependency list) that the session's own pre-run commit broke by adding @xfb/db; C1-C6 judged met. The work was committed on the run branch and finished by a follow-up run (2026-11-14-xfb-db-deps-test)."
},
{
  "id": "2026-11-14-xfb-db-deps-test",
  "title": "xfb #3.2: CLI dependency test",
  "outcome": "passed",
  "reason": "All checks pass and every criterion is met.",
  "phase": "Review",
  "agents": 4,
  "repairRounds": 0,
  "maxRepairRounds": 2,
  "specLine": "1 spec(s) · 1 level(s)",
  "specs": [
    {
      "id": "S1",
      "title": "CLI package layout test expects the @xfb/db dependency",
      "impl": "none",
      "test": "ok",
      "waitFor": "",
      "testNote": "Self-check 1: nothing changed"
    }
  ],
  "check": {
    "text": "test: exit 0 · typecheck: exit 0 · lint: exit 0",
    "state": "ok"
  },
  "review": [
    {
      "tag": "whole change",
      "text": "2/2 criteria met",
      "state": "ok"
    }
  ],
  "repairs": [],
  "criteria": [
    {
      "id": "C1",
      "text": "The test 'apps/cli/package.json declares @xfb/cli with the xfb bin and workspace deps only' in apps/cli/bench/pipeline/run-stage.test.ts expects exactly the dependencies {@xfb/contract, @xfb/core, @xfb/db, @xfb/grader}, each 'workspace:*', and still checks the package name, the xfb bin and that there are no third-party dependencies, as it did before.",
      "status": "met"
    },
    {
      "id": "C2",
      "text": "No other file changes; `pnpm test`, `pnpm typecheck` and `pnpm lint` exit 0.",
      "status": "met"
    }
  ],
  "seconds": 246,
  "note": "Follow-up of 2026-11-14-xfb-db-replay: one spec written by the session (tests only), updating the stale dependency assertion. First attempt blocked because the hand-written spec lacked the tests field. Rerun by the session: test (862), typecheck and lint exit 0."
},
{
  "id": "2026-11-14-xfb-api-ingest",
  "title": "xfb #3.3: ingest API",
  "outcome": "passed",
  "reason": "All checks pass and every criterion is met after 1 repair round(s).",
  "phase": "Repair",
  "agents": 31,
  "repairRounds": 1,
  "maxRepairRounds": 2,
  "specLine": "5 spec(s) · 3 level(s)",
  "specs": [
    {
      "id": "S1",
      "title": "people, api_tokens and artifacts in packages/db",
      "impl": "ok",
      "test": "ok",
      "waitFor": "",
      "testNote": "Self-check 2: nothing changed"
    },
    {
      "id": "S2",
      "title": "NUL-safe intake and normalize ignoring non-contract sources",
      "impl": "ok",
      "test": "ok",
      "waitFor": "",
      "testNote": "Self-check 1: nothing changed"
    },
    {
      "id": "S3",
      "title": "apps/api: createApp, ingest routes, artifact store and server",
      "impl": "ok",
      "test": "ok",
      "waitFor": "S1, S2",
      "testNote": "Self-check 1: nothing changed"
    },
    {
      "id": "S4",
      "title": "xfb token create",
      "impl": "ok",
      "test": "ok",
      "waitFor": "S1, S3",
      "testNote": "Self-check 1: nothing changed"
    },
    {
      "id": "S5",
      "title": "Docs: architecture, CLAUDE.md and README status",
      "impl": "ok",
      "test": "none",
      "waitFor": "",
      "testNote": ""
    }
  ],
  "check": {
    "text": "test: exit 0 · typecheck: exit 0 · lint: exit 0",
    "state": "ok"
  },
  "review": [
    {
      "tag": "whole change",
      "text": "8/8 criteria met",
      "state": "ok"
    },
    {
      "tag": "S1",
      "text": "2/2 criteria met",
      "state": "ok"
    },
    {
      "tag": "S2",
      "text": "2/2 criteria met",
      "state": "ok"
    },
    {
      "tag": "S3",
      "text": "6/6 criteria met",
      "state": "ok"
    },
    {
      "tag": "S4",
      "text": "2/2 criteria met",
      "state": "ok"
    },
    {
      "tag": "S5",
      "text": "1/1 criteria met",
      "state": "ok"
    }
  ],
  "repairs": [
    {
      "round": 1,
      "text": "9 failure(s) sent to fixer, S3 tester",
      "state": "ok"
    }
  ],
  "criteria": [
    {
      "id": "C1",
      "text": "packages/db gains tables `people` (id text primary key, github_login text unique not null, created_at timestamptz), `api_tokens` (id text primary key, person_id references people, token_hash text unique not null, label text, created_at timestamptz, revoked_at timestamptz null, last_used_at timestamptz null) and `artifacts` (id text primary key, person_id, attempt_id text, kind text, sha256 text, size_bytes bigint/integer, location text, created_at timestamptz; unique (person_id, sha256)), in a new drizzle-kit migration added after the existing one (the existing 0000 migration file is not edited). Exported functions, which never read env, clock or randomness (ids, hashes and times are passed in): `ensurePerson(db, { id, githubLogin, createdAt })` (returns the existing person for that login, else inserts), `createToken(db, { id, personId, tokenHash, label, createdAt })`, `revokeToken(db, { id, personId, revokedAt })`, `findPersonByTokenHash(db, tokenHash, usedAt)` (returns `{ personId, tokenId }` for a non-revoked token and sets last_used_at, else undefined), `listTokens(db, personId)` (never returns hashes), and `recordArtifact(db, {...})` (returns `{ artifact, duplicate }`, duplicate true when (person_id, sha256) already exists, keeping the first row).",
      "status": "met"
    },
    {
      "id": "C2",
      "text": "ingestEvents never throws on a body it can store: a string anywhere in a body that contains U+0000 (which Postgres text and jsonb cannot hold) makes that event rejected with an error whose path names the field and whose message says it contains a NUL character, and its raw is stored with each U+0000 replaced by U+FFFD; a rejected body that is JSON null is stored with raw as the jsonb value null, distinguishable from an accepted row (raw IS NULL). @xfb/core/normalize ignores every stored event whose source is not `contract` (it appears in no derived table and no count), with a golden case `non-contract-source` showing an otlp event next to contract events.",
      "status": "met"
    },
    {
      "id": "C3",
      "text": "apps/api exports `createApp(deps)` returning a Hono app, where deps holds `db` (a @xfb/db Db), `priceTables`, `now(): Date`, `newId(): string`, and an artifact store `{ put(sha256, bytes): Promise<string /* location */> }`; the app itself reads no env, clock, randomness or files except through deps. Every /v1 route requires `Authorization: Bearer <token>`; the token is hashed with SHA-256 (hex) and looked up with findPersonByTokenHash; a missing, unknown or revoked token gives 401 JSON `{ error }`. `GET /healthz` gives 200 `{ ok: true }` without auth; `GET /v1/me` gives `{ personId, githubLogin }`. person_id always comes from the token, never from a body. Route handlers catch unexpected errors, log them through a `log(entry)` dep, and answer 500 JSON `{ error, errorId }`; they never answer 2xx for something that was not stored.",
      "status": "met"
    },
    {
      "id": "C4",
      "text": "`POST /v1/events` accepts a JSON array of events or a single event object (treated as an array of one), up to 1000 events and 5 MB (larger gives 413); a body that is not JSON, or JSON that is neither an object nor an array, gives 400 with an error saying so. It calls ingestEvents with receivedAt = now(), then, when at least one event was accepted, runs replay with the price tables, and answers 200 `{ accepted, duplicates, rejected, results }` exactly as ingestEvents returned. Tests show: the same event sent twice is stored once (second response counts it as a duplicate); a factorybench/v1 event and an xfb/v1 event are both accepted; an event with a schema error is rejected with an error naming the field (for example payload.status) and is stored in events and rejected_events; derived tables reflect accepted events after the call.",
      "status": "met"
    },
    {
      "id": "C5",
      "text": "`POST /v1/artifacts?kind=<transcript|diff|log|other>&attempt_id=<id>` takes the raw request body (any content type, up to 50 MB, larger gives 413; empty body or unknown kind gives 400), computes its SHA-256, compares it with header `x-xfb-sha256` when that header is given (mismatch gives 400 and nothing stored), stores the bytes through the artifact store and records the row; it answers 200 `{ id, sha256, sizeBytes, duplicate }`, and an upload of bytes the same person already uploaded is a duplicate that returns the first row's id without storing again. A filesystem artifact store `createFileArtifactStore(dir)` in apps/api writes content-addressed files at `<dir>/<first 2 hex>/<sha256>` (write to a temp file then rename) and returns that path relative to dir.",
      "status": "met"
    },
    {
      "id": "C6",
      "text": "`POST /v1/logs` accepts an OTLP/HTTP JSON ExportLogsServiceRequest (`resourceLogs[].resource.attributes`, `resourceLogs[].scopeLogs[].logRecords[]` with `timeUnixNano`, `attributes`, `body`). Before anything is stored, attributes with keys `user.email`, `user.account_uuid`, `user.account_id` and `organization.id` are removed from the resource and from every log record. Each log record becomes one row in events with source `otlp`, spec `otlp`, type = the record's `event.name` attribute (else `otlp.log`), ts from timeUnixNano as ISO-8601 (else receivedAt), attempt_id = the `session.id` attribute (else empty string), id = SHA-256 hex of the scrubbed record together with its scrubbed resource attributes (so a resend is a duplicate), payload `{ resource: <scrubbed resource attributes>, record: <scrubbed record> }`, rejected null. It answers 200 with `{}` when all records were stored or duplicates, or `{ partialSuccess: { rejectedLogRecords, errorMessage } }` for records it could not take; a body that is not an object with a resourceLogs array gives 400. A test sends a record carrying all four personal attributes at both levels and shows none of them, nor their values, appear anywhere in the stored row.",
      "status": "met"
    },
    {
      "id": "C7",
      "text": "apps/api/server.ts (the only file in apps/api that reads env, clock, randomness or files) reads PORT (default 8787), DATABASE_URL (required; exits 1 with a message naming it when missing), XFB_ARTIFACTS_DIR (required likewise) and the price tables from the repository's pricing/prices/*.json (validated with the @xfb/core/pricing schema), runs migrate, and serves createApp with @hono/node-server. `xfb token create --login <github login> [--label <text>] [--db <url>]` in apps/cli (db url from --db, else XFB_DATABASE_URL, else DATABASE_URL, else usage error exit 2) migrates, ensures the person, creates a token `xfb_` + 32 random bytes in base64url, stores only its SHA-256 hex hash, and prints the token once with a line saying it cannot be shown again; USAGE in apps/cli/main.ts lists it; a test runs it against a `pglite:` dir under the OS temp dir and then shows the printed token authenticates against createApp (GET /v1/me) and that the database holds only the hash. The root package.json gains a script `api` that starts apps/api/server.ts.",
      "status": "met"
    },
    {
      "id": "C8",
      "text": "docs/architecture.md (Built so far; data model text for the new tables and the otlp events), the status paragraph of CLAUDE.md and README.md (Vietnamese) say apps/api, the three ingest routes, tokens and `xfb token create` exist. Existing package layout tests keep passing (apps/cli/package.json is not changed; all third-party packages, including hono 4.13.14 and @hono/node-server 2.1.5, stay declared in the root package.json only; apps/api/package.json keeps its workspace deps). `pnpm test`, `pnpm typecheck` and `pnpm lint` exit 0; no test needs a network, a Postgres server or files outside the OS temp dir.",
      "status": "met"
    }
  ],
  "seconds": 25935,
  "note": "XS Factory Bench issue #3, slice 3. Passed after 1 repair round (test-fixture defaults fixed by the testers; no source change). Rerun by the session: test (1025), typecheck and lint exit 0."
},
{
  "id": "2026-11-14-xfb-web-auth",
  "title": "xfb #3.4: login, Settings, web shell",
  "outcome": "passed",
  "reason": "All checks pass and every criterion is met after 1 repair round(s).",
  "phase": "Repair",
  "agents": 31,
  "repairRounds": 1,
  "maxRepairRounds": 2,
  "specLine": "5 spec(s) · 4 level(s)",
  "specs": [
    {
      "id": "S1",
      "title": "sessions table and db functions",
      "impl": "ok",
      "test": "ok",
      "waitFor": "",
      "testNote": "Self-check 1: nothing changed"
    },
    {
      "id": "S2",
      "title": "GitHub OAuth, cookie sessions and /api token routes in createApp",
      "impl": "ok",
      "test": "ok",
      "waitFor": "S1",
      "testNote": "Self-check 1: nothing changed"
    },
    {
      "id": "S3",
      "title": "server.ts: env, real GitHub client and web static serving",
      "impl": "ok",
      "test": "ok",
      "waitFor": "S2",
      "testNote": "Self-check 1: nothing changed"
    },
    {
      "id": "S4",
      "title": "apps/web dashboard shell with login and Settings",
      "impl": "ok",
      "test": "ok",
      "waitFor": "",
      "testNote": "Self-check 1: nothing changed"
    },
    {
      "id": "S5",
      "title": "Railway deployment files and docs",
      "impl": "ok",
      "test": "ok",
      "waitFor": "S2, S3, S4",
      "testNote": "Self-check 1: nothing changed"
    }
  ],
  "check": {
    "text": "test: exit 0 · typecheck: exit 0 · lint: exit 0 · build-web: exit 0",
    "state": "ok"
  },
  "review": [
    {
      "tag": "whole change",
      "text": "7/7 criteria met",
      "state": "ok"
    },
    {
      "tag": "S1",
      "text": "1/1 criteria met",
      "state": "ok"
    },
    {
      "tag": "S2",
      "text": "2/2 criteria met",
      "state": "ok"
    },
    {
      "tag": "S3",
      "text": "1/1 criteria met",
      "state": "ok"
    },
    {
      "tag": "S4",
      "text": "1/1 criteria met",
      "state": "ok"
    },
    {
      "tag": "S5",
      "text": "2/2 criteria met",
      "state": "ok"
    }
  ],
  "repairs": [
    {
      "round": 1,
      "text": "7 failure(s) sent to fixer",
      "state": "ok"
    }
  ],
  "criteria": [
    {
      "id": "C1",
      "text": "packages/db gains a `sessions` table (id text primary key holding the SHA-256 hex of the session token, person_id references people, created_at timestamptz, expires_at timestamptz) in a new drizzle-kit migration after 0001 (earlier migration files unchanged), and functions that read no env, clock or randomness: `createSession(db, { id, personId, createdAt, expiresAt })`, `findSession(db, id, now)` (returns `{ personId, githubLogin }` only when not expired, else undefined) and `deleteSession(db, id)`.",
      "status": "met"
    },
    {
      "id": "C2",
      "text": "createApp's deps gain `randomToken(): string` (a fresh unguessable token), `auth` = `{ github?: { clientId, authorizeUrl(state, redirectUri): string, exchangeCode(code, redirectUri): Promise<string /* access token */>, getLogin(accessToken): Promise<string> }, publicUrl: string, teamAllowlist: ReadonlySet<string> /* lowercase GitHub logins */ }`. `GET /auth/github/login` sets an HttpOnly SameSite=Lax cookie `xfb_oauth_state` and redirects (302) to github.authorizeUrl with redirect_uri `<publicUrl>/auth/github/callback`. `GET /auth/github/callback?code&state` rejects (400) a missing code or a state that differs from the cookie, exchanges the code, gets the login, answers 403 with a page saying the login is not on the team allowlist when its lowercase form is not in teamAllowlist (no person, no session created), otherwise ensures the person, creates a session (token from randomToken, stored hashed, 30-day expiry) and sets cookie `xfb_session` (HttpOnly, SameSite=Lax, Path=/, Secure when publicUrl is https) and redirects to `/`. `POST /auth/logout` deletes the session and clears the cookie. When `auth.github` is absent every /auth/github route answers 503 saying GitHub login is not configured. Tests use a fake github object.",
      "status": "met"
    },
    {
      "id": "C3",
      "text": "Session routes for the dashboard, all requiring a valid, unexpired `xfb_session` cookie (else 401 JSON `{ error }`): `GET /api/session` → `{ personId, githubLogin }`; `GET /api/tokens` → the person's tokens `[{ id, label, createdAt, revokedAt, lastUsedAt }]` with no hash; `POST /api/tokens` with JSON `{ label }` → 201 `{ id, label, createdAt, token }` where token is `xfb_` + randomToken() and only its SHA-256 hex is stored, so the token is shown only in this response and then works as a Bearer token on /v1 routes; `DELETE /api/tokens/:id` → 204 and the token stops working on /v1 (401), while another person's token id gives 404 and is untouched. POST and DELETE under /api require header `x-xfb-csrf: 1` (else 403), to stop cross-site form posts. Bearer tokens are not accepted on /api routes and session cookies are not accepted on /v1 routes.",
      "status": "met"
    },
    {
      "id": "C4",
      "text": "apps/web is a Vite + React 19 app (index.html, src/main.tsx, TanStack Router with code-based routes and TanStack Query) with: `/login` (a button that navigates to /auth/github/login, and the 403 explanation when shown after a refused login); a layout with the signed-in GitHub login, a Log out action (POST /auth/logout with the CSRF header) and navigation; `/` (Overview placeholder that says the views come in later issues); `/settings` (list of the person's tokens with label, created, last used ('?' when never used... shown as 'never'), revoked state; a form to create a token with a label that shows the new token once with a copy button and a warning that it will not be shown again; a Revoke button per active token with a confirm step). Any route redirects to /login when /api/session answers 401. Text from the server is rendered as plain text (no dangerouslySetInnerHTML). A typed client `apps/web/src/api.ts` (plain .ts, no JSX) wraps the session and token routes with an injectable fetch and throws an error carrying the HTTP status; node:test tests cover it with a fake fetch. `pnpm build:web` (root script running vite build for apps/web) writes apps/web/dist, which .gitignore ignores; `pnpm typecheck` type-checks the .tsx files too (tsconfig changes allowed) and `pnpm lint` checks them.",
      "status": "met"
    },
    {
      "id": "C5",
      "text": "apps/api/server.ts additionally reads GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET (both or neither; when neither, auth.github is omitted and the server still serves ingest), XFB_PUBLIC_URL (required when GitHub is configured), XFB_TEAM_ALLOWLIST (comma-separated logins, trimmed, lowercased) and XFB_WEB_DIST (default: apps/web/dist in the repository); it implements the github object with fetch against github.com/login/oauth/authorize, github.com/login/oauth/access_token and api.github.com/user, uses node:crypto for randomToken, and serves the built web files with the SPA fallback (index.html for any GET outside /v1, /api, /auth and /healthz that is not a file), only when that directory exists. Server-only code paths that call GitHub are not run by tests.",
      "status": "met"
    },
    {
      "id": "C6",
      "text": "Deployment files, not run: a `Dockerfile` (node 26 base image, pnpm through corepack, `pnpm install --frozen-lockfile`, `pnpm build:web`, starts `pnpm api`, listens on $PORT), a `.dockerignore` (node_modules, dist, .git, runs), and `railway.json` (Dockerfile builder, healthcheck path /healthz, restart on failure). `docs/deploy.md` explains, step by step, how to deploy on Railway: one service from this repository, a Postgres database (DATABASE_URL), a volume mounted with XFB_ARTIFACTS_DIR on it, the GitHub OAuth app and its callback URL `<XFB_PUBLIC_URL>/auth/github/callback`, every env var with its meaning, PR preview environments, and creating the first token with `xfb token create` against the Railway database or through Settings.",
      "status": "met"
    },
    {
      "id": "C7",
      "text": "docs/architecture.md (Built so far, plus auth and deployment text where it changes), the status paragraph of CLAUDE.md and README.md (Vietnamese) say login, sessions, Settings, apps/web and the deployment files exist and that deployment itself is still to be done by the owner. Existing package layout tests keep passing; all third-party packages stay in the root package.json (no new ones are added; react, react-dom, @tanstack/react-router, @tanstack/react-query, vite, @vitejs/plugin-react, @types/react and @types/react-dom are already there). `pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm build:web` exit 0; no test needs a network, a browser, a Postgres server or files outside the OS temp dir.",
      "status": "met"
    }
  ],
  "seconds": 2974,
  "note": "XS Factory Bench issue #3, slice 4. Passed after 1 repair round (docs/deploy.md did not name xfb token create). Rerun by the session: test (1201), typecheck, lint and build:web exit 0."
}
]
