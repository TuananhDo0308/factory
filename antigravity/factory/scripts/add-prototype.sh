#!/usr/bin/env bash
# Put the prototype a ticket was approved with on the run's branch, before the base is recorded.
#
#   add-prototype.sh --issue <n> --ticket <issue body file> [--accept-changed] [--remote origin]
#
# The commit and the path come from the issue's Prototype section, and its criteria
# must name that path. Run from the repository root, on factory/<run id>. Takes
# index.html and prototype.json, and for a prototype the user brought its shots/,
# from that commit, which nothing can change. Refuses a path outside the pattern and
# a path with uncommitted changes, stops when the files it was drawn from have changed
# since or it was drawn on screens not yet built (unless --accept-changed), and commits those paths and nothing else, staged or
# not; when the branch already holds the same files it commits nothing.
# Prints the commit to use as base.
#
# Exit codes: 0 ok (base on stdout) · 64 usage, or a section that is not complete · 69 not found on the remote
#             70 refused · 75 the screens changed, or were built, after the prototype was drawn
set -euo pipefail
die() { echo "add-prototype: $1" >&2; exit "${2:-70}"; }

ISSUE="" TICKET="" ACCEPT="" REMOTE="origin"
while [ $# -gt 0 ]; do
  case "$1" in
    --issue) ISSUE="$2"; shift 2 ;;
    --ticket) TICKET="$2"; shift 2 ;;
    --accept-changed) ACCEPT=1; shift ;;
    --remote) REMOTE="$2"; shift 2 ;;
    *) die "unknown arg $1" 64 ;;
  esac
done
printf '%s' "$ISSUE" | grep -Eq '^[1-9][0-9]*$' || die "--issue must be a number" 64
[ -f "$TICKET" ] || die "--ticket must be a file with the issue's body" 64
body=$(tr -d '\r' < "$TICKET")
section=$(printf '%s\n' "$body" | awk '/^##+ /{on = ($0 ~ /^##+ Prototype *$/)} on')
field() { printf '%s\n' "$section" | sed -n "s/^- $1: \`\(.*\)\`\$/\1/p" | head -n 1; }
COMMIT=$(field "Commit")
DEST=$(field "Path in the repository")
printf '%s' "$COMMIT" | grep -Eq '^[0-9a-f]{40,64}$' || die "the Prototype section has no full commit id" 64
printf '%s' "$DEST" | grep -Eq "^([A-Za-z0-9_-][A-Za-z0-9._-]*/)+issue-$ISSUE/index\.html\$" || die "path must be <dir>/issue-$ISSUE/index.html" 64
NAMED=$(printf '%s\n' "$body" | grep -E '^[[:space:]]*[-*+][[:space:]]+\*\*C[0-9]' | grep -Eo '[A-Za-z0-9._/-]+/index\.html' | sort -u || true)
[ "$NAMED" = "$DEST" ] || die "the criteria name '$NAMED' and the Prototype section '$DEST'" 64
[ "$(git rev-parse --show-toplevel)" = "$(pwd -P)" ] || die "run it from the repository root"
case "$(git branch --show-current)" in factory/*) ;; *) die "not on a factory/<run id> branch" ;; esac

# The branch first; by commit when the branch moved away or was deleted but the remote still has it.
git cat-file -e "$COMMIT^{commit}" 2>/dev/null ||
  git fetch -q "$REMOTE" "refs/heads/prototype/issue-$ISSUE" 2>/dev/null || true
git cat-file -e "$COMMIT^{commit}" 2>/dev/null || git fetch -q "$REMOTE" "$COMMIT" 2>/dev/null ||
  die "commit $COMMIT is not on $REMOTE (was prototype/issue-$ISSUE deleted?)" 69
for f in index.html prototype.json; do git cat-file -e "$COMMIT:$f" 2>/dev/null || die "no $f in $COMMIT" 69; done

# Drawn on screens that have changed since, or that were still to be built? Building it as
# drawn would take back what they became.
manifest=$(git cat-file blob "$COMMIT:prototype.json" | node -e '
  const m = JSON.parse(require("fs").readFileSync(0, "utf8"));
  console.log([m.source ? "theirs" : "made", m.drawnFrom.commit, (m.drawnFrom.unbuilt || []).join("; ").replace(/\s+/g, " "), ...m.drawnFrom.files].join("\n"));' 2>/dev/null) || die "prototype.json cannot be read"
KIND=$(printf '%s\n' "$manifest" | sed -n 1p)
FROM=$(printf '%s\n' "$manifest" | sed -n 2p)
printf '%s' "$FROM" | grep -Eq '^[0-9a-f]{40,64}$' || die "prototype.json has no full drawnFrom.commit"
UNBUILT=$(printf '%s\n' "$manifest" | sed -n 3p)
stop=""
[ -z "$UNBUILT" ] || stop="drawn on screens that were not built yet: $UNBUILT"
watched=()
while IFS= read -r f; do watched+=(":(top,literal)$f"); done < <(printf '%s\n' "$manifest" | tail -n +4)
if [ ${#watched[@]} -gt 0 ] && [ -z "$ACCEPT" ]; then
  git cat-file -e "$FROM^{commit}" 2>/dev/null || git fetch -q "$REMOTE" "$FROM" 2>/dev/null ||
    die "cannot tell whether the screens changed: $FROM, which the prototype was drawn from, is not on $REMOTE" 75
  changed=$(git diff --name-only "$FROM" HEAD -- "${watched[@]}")
  [ -z "$changed" ] || stop="${stop:+$stop; }changed since the prototype was drawn from $FROM: $(printf '%s' "$changed" | tr '\n' ' ')"
fi
[ -z "$stop" ] || [ -n "$ACCEPT" ] || die "$stop" 75

# No part of the path may be a symlink, or the write could land outside the repository.
p=$DEST
while [ "$p" != "." ]; do [ ! -L "$p" ] || die "$p is a symlink"; p=$(dirname "$p"); done
DIR=$(dirname "$DEST")
[ -z "$(git status --porcelain -- "$DIR")" ] || die "$DIR has uncommitted changes"

# Only these names, however the commit came to be.
names=("index.html" "prototype.json")
if [ "$KIND" = theirs ]; then
  while IFS= read -r f; do
    if printf '%s' "$f" | grep -Eq '^shots/[a-z0-9-]+\.png$'; then names+=("$f"); fi
  done < <(git ls-tree -r --name-only "$COMMIT" -- shots)
  [ ! -L "$DIR/shots" ] || die "$DIR/shots is a symlink"
fi
paths=()
for f in "${names[@]}"; do
  if git check-ignore -q -- "$DIR/$f"; then die "$DIR/$f is ignored by git"; fi
  [ ! -L "$DIR/$f" ] || die "$DIR/$f is a symlink"
  paths+=("$DIR/$f")
done
for f in "${names[@]}"; do
  mkdir -p "$(dirname "$DIR/$f")"
  git cat-file blob "$COMMIT:$f" > "$DIR/$f"
  chmod 644 "$DIR/$f"
done
git add -- "${paths[@]}"
git diff --cached --quiet -- "${paths[@]}" || git commit -q -m "[DOCS] Add the prototype of issue-$ISSUE" -- "${paths[@]}"
git rev-parse HEAD
