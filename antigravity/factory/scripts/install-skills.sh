#!/usr/bin/env bash
# Installs the skills the factory team loads from this repository's own copies
# in third-party/ (its README names their sources, commits and licenses).
# Nothing is downloaded. Run by a person, or by the session after the person
# agreed: it writes third-party skills into a skills directory that every
# Gemini Antigravity session reads.
#
#   install-skills.sh [target]     (default target: ~/.gemini/config/skills)
#
# A skill that already exists in the target is left as it is and reported, so
# a newer or edited copy is never overwritten. Afterwards, check with
# skills-ready.sh.
#
# The copies are found next to the factory skill's real folder, so this works
# when ~/.gemini/config/skills/factory is a link to this repository, and not when
# the folder was copied there on its own.
set -eu

target="${1:-$HOME/.gemini/config/skills}"
scripts="$(cd -P "$(dirname "$0")" && pwd -P)"
source="$scripts/../../third-party"

if [ ! -d "$source" ]; then
  echo "third-party/ not found next to the factory skill; run this from a checkout of the repository" >&2
  exit 1
fi

mkdir -p "$target"

for dir in "$source"/*/; do
  dir="${dir%/}"
  [ -s "$dir/SKILL.md" ] || continue
  name="$(basename "$dir")"
  if [ -e "$target/$name" ] || [ -L "$target/$name" ]; then
    echo "kept     $name (already in $target)"
  else
    cp -R "$dir" "$target/$name"
    echo "installed $name"
  fi
done
