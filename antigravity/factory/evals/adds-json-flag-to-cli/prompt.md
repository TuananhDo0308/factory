---
tags: [factory-eval]
max_turns: 60
timeout_seconds: 1800
tools: [read_file, write_file, edit_file, run_command, invoke_subagent, run_workflow]
---

Use the factory to add a `--json` flag to wordstats.py in this repo. With the flag it should print the same three counts as a single JSON object instead of the text format. The default output must not change, and it needs tests.

Input files: wordstats.py, tests/test_wordstats.py, README.md
