#!/usr/bin/env bash
# Say whether a person has marked an issue ready for a run. Reads GitHub and changes nothing.
#
#   issue-ready.sh --issue <n>
#
# Run inside the repository. Ready means the label `status: ready` and not
# `status: needs-criteria`. A repository that has no `status: ready` label does not
# use this gate, so there only `status: needs-criteria` on the issue stops a run.
#
# Exit codes: 0 ready · 10 not ready · 64 usage · 69 the labels cannot be read
set -euo pipefail
die() { echo "issue-ready: $1" >&2; exit "$2"; }
READY="status: ready"
MISSING="status: needs-criteria"

[ $# -eq 2 ] && [ "$1" = "--issue" ] || die "usage: issue-ready.sh --issue <n>" 64
ISSUE=$2
printf '%s' "$ISSUE" | grep -Eq '^[1-9][0-9]*$' || die "--issue must be a number" 64

labels=$(gh issue view "$ISSUE" --json labels --jq '.labels[].name') || die "cannot read the labels of #$ISSUE" 69
has() { printf '%s\n' "$1" | grep -Fxq -- "$2"; }

if has "$labels" "$MISSING"; then die "#$ISSUE has \`$MISSING\`: a person sets \`$READY\` in its place once the criteria are agreed" 10; fi
if has "$labels" "$READY"; then exit 0; fi
known=$(gh label list --limit 1000 --json name --jq '.[].name') || die "cannot read the repository's labels" 69
if has "$known" "$READY"; then die "#$ISSUE does not have \`$READY\`: a person sets it once the criteria are agreed" 10; fi
