#!/usr/bin/env bash
# Push an approved prototype to the issue's own branch and print the commit.
#
#   publish-prototype.sh --dir <prototype dir> --issue <n> [--remote origin]
#
# Run inside the repository. The branch prototype/issue-<n> holds only index.html
# (a whole page any browser opens), prototype.json and shots/*.png, and shares no
# history with the code, so it cannot be merged by accident. The commit is built
# with a temporary index: the working tree, the index and the current branch are
# not touched. It refuses a page or a manifest with what looks like a secret, because
# what is pushed stays in the history. A second run adds a commit on top; nothing is force-pushed.
#
# Exit codes: 0 ok (commit on stdout) · 64 usage · 70 failed
set -euo pipefail
die() { echo "publish-prototype: $1" >&2; exit "${2:-70}"; }
HERE=$(cd "$(dirname "$0")" && pwd)

DIR="" ISSUE="" REMOTE="origin"
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;;
    --issue) ISSUE="$2"; shift 2 ;;
    --remote) REMOTE="$2"; shift 2 ;;
    *) die "unknown arg $1" 64 ;;
  esac
done
[ -n "$DIR" ] || die "needs --dir and --issue" 64
printf '%s' "$ISSUE" | grep -Eq '^[1-9][0-9]*$' || die "--issue must be the issue's number" 64
DIR=$(cd "$DIR" && pwd)
git rev-parse --git-dir >/dev/null 2>&1 || die "run it inside the repository"
for f in index.html prototype.json; do [ -f "$DIR/$f" ] && [ ! -L "$DIR/$f" ] || die "no $f in $DIR"; done
ls "$DIR"/shots/*.png >/dev/null 2>&1 || die "no shots in $DIR; run check-prototype.mjs first"

node "$HERE/check-prototype.mjs" --secrets "$DIR" || die "not pushed: a secret in it, or it cannot be read"

# What it was drawn from must be there for the factory to compare with.
DRAWN=$(node -e 'const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).drawnFrom; console.log([d.commit, ...d.files].join("\n"))' "$DIR/prototype.json" 2>/dev/null) || die "prototype.json has no drawnFrom; run check-prototype.mjs first"
FROM=$(printf '%s\n' "$DRAWN" | head -n 1)
printf '%s' "$FROM" | grep -Eq '^[0-9a-f]{40,64}$' || die "drawnFrom.commit is not a full commit id"
[ -n "$(git branch -r --list "$REMOTE/*" --contains "$FROM" 2>/dev/null)" ] || die "drawnFrom.commit $FROM is not on a branch of the remote $REMOTE"
printf '%s\n' "$DRAWN" | tail -n +2 | while IFS= read -r f; do
  git cat-file -e "$FROM:$f" 2>/dev/null || die "drawnFrom: $f is not in $FROM"
done

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
# A prototype the user already had is pushed byte for byte.
SOURCE=$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).source ? 1 : 0' "$DIR/prototype.json")
if [ "$SOURCE" = 1 ]; then cp "$DIR/index.html" "$tmp/index.html"
else node "$HERE/check-prototype.mjs" --wrap "$DIR/index.html" > "$tmp/index.html"; fi
BRANCH="prototype/issue-$ISSUE"
export GIT_INDEX_FILE="$tmp/index"
add() { git update-index --add --cacheinfo "100644,$(git hash-object -w --no-filters "$1"),$2"; }
add "$tmp/index.html" index.html
add "$DIR/prototype.json" prototype.json
for f in "$DIR"/shots/*.png; do [ -L "$f" ] || add "$f" "shots/$(basename "$f")"; done
tree=$(git write-tree)
unset GIT_INDEX_FILE

parent=$(git ls-remote "$REMOTE" "refs/heads/$BRANCH" | cut -f1)
if [ -n "$parent" ]; then
  git fetch -q "$REMOTE" "refs/heads/$BRANCH"
  if [ "$(git rev-parse "$parent^{tree}")" = "$tree" ]; then
    sha=$parent
  else
    sha=$(git commit-tree "$tree" -p "$parent" -m "[DOCS] Update the prototype of issue-$ISSUE")
  fi
else
  sha=$(git commit-tree "$tree" -m "[DOCS] Add the prototype of issue-$ISSUE")
fi
[ "$sha" = "$parent" ] || git push -q "$REMOTE" "$sha:refs/heads/$BRANCH" || die "push of $BRANCH failed"
echo "$sha"
