#!/usr/bin/env bash
# How the pipeline's earlier issues went; see issue-history.mjs.
#   issue-history.sh [--limit 50] [--kind crud] [--out file.jsonl]
set -euo pipefail
exec node "$(cd "$(dirname "$0")" && pwd)/issue-history.mjs" "$@"
