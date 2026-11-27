#!/usr/bin/env bash
# Push a batch's prototype to its own branch and print the commit.
#
#   publish-prototype.sh --dir <prototype dir> --name <batch id> [--remote origin]
#
# Run inside a clone of the repository (publish-batch.mjs runs it with --git as cwd).
# The branch prototype/<batch id> holds only index.html (a whole page any browser
# opens), prototype.json, taste.md when there is one, and shots/*.png, shares no history with the code, and is
# built with a temporary index: the working tree, the index and the current branch
# are not touched. A second run adds a commit on top; nothing is force-pushed.
#
# Exit codes: 0 ok (commit on stdout) · 64 usage · 70 failed
set -euo pipefail
die() { echo "publish-prototype: $1" >&2; exit "${2:-70}"; }
HERE=$(cd "$(dirname "$0")" && pwd)

DIR="" NAME="" REMOTE="origin"
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;;
    --name) NAME="$2"; shift 2 ;;
    --remote) REMOTE="$2"; shift 2 ;;
    *) die "unknown arg $1" 64 ;;
  esac
done
[ -n "$DIR" ] || die "needs --dir and --name" 64
printf '%s' "$NAME" | grep -Eq '^[a-z0-9][a-z0-9-]*$' || die "--name is the batch id: lower-case words joined by hyphens" 64
DIR=$(cd "$DIR" && pwd)
git rev-parse --git-dir >/dev/null 2>&1 || die "run it inside a clone of the repository"
for f in index.html prototype.json; do [ -f "$DIR/$f" ] && [ ! -L "$DIR/$f" ] || die "no $f in $DIR"; done
ls "$DIR"/shots/*.png >/dev/null 2>&1 || die "no shots in $DIR; run check-prototype.mjs first"

node "$HERE/scan-secrets.mjs" "$DIR/index.html" "$DIR/prototype.json" >/dev/null || die "not pushed: a secret or real data in it"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
node "$HERE/check-prototype.mjs" --wrap "$DIR/index.html" > "$tmp/index.html"
BRANCH="prototype/$NAME"
export GIT_INDEX_FILE="$tmp/index"
add() { git update-index --add --cacheinfo "100644,$(git hash-object -w --no-filters "$1"),$2"; }
add "$tmp/index.html" index.html
add "$DIR/prototype.json" prototype.json
[ -f "$DIR/taste.md" ] && [ ! -L "$DIR/taste.md" ] && add "$DIR/taste.md" taste.md
for f in "$DIR"/shots/*.png; do [ -L "$f" ] || add "$f" "shots/$(basename "$f")"; done
tree=$(git write-tree)
unset GIT_INDEX_FILE

parent=$(git ls-remote "$REMOTE" "refs/heads/$BRANCH" | cut -f1)
if [ -n "$parent" ]; then
  git fetch -q "$REMOTE" "refs/heads/$BRANCH"
  if [ "$(git rev-parse "$parent^{tree}")" = "$tree" ]; then
    sha=$parent
  else
    sha=$(git commit-tree "$tree" -p "$parent" -m "Update the prototype of $NAME")
  fi
else
  sha=$(git commit-tree "$tree" -m "Add the prototype of $NAME")
fi
[ "$sha" = "$parent" ] || git push -q "$REMOTE" "$sha:refs/heads/$BRANCH" || die "push of $BRANCH failed"
echo "$sha"
