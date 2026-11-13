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
}
]
