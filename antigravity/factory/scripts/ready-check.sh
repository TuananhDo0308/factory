#!/usr/bin/env bash
# The mechanical readiness check of one issue; see ready-check.mjs.
#   ready-check.sh <issue number> [--json]
set -euo pipefail
exec node "$(cd "$(dirname "$0")" && pwd)/ready-check.mjs" "$@"
