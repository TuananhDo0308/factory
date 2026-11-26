#!/usr/bin/env bash
# Installs the skills the factory team loads, from their own repositories, at
# the commits the factory was written against. Run by a person, or by the
# session after the person agreed: it downloads third-party skills and writes
# them into a skills directory that every Claude Code session reads.
#
#   install-skills.sh [target]     (default target: ~/.claude/skills)
#
# A skill that already exists in the target is left as it is and reported, so
# a newer or edited copy is never overwritten. Afterwards, check with
# skills-ready.sh.
#
# An entry written `name=newname` is installed under the new name, with the
# `name:` line of its SKILL.md changed to match: mattpocock's code-review would
# otherwise take the name of Claude Code's own /code-review command.
#
# Sources:
#   mattpocock/skills (MIT)                tdd, diagnosing-bugs, codebase-design, code-review (as mp-code-review),
#                                          domain-modeling (optional)
#   obra/superpowers (MIT)                 verification-before-completion
#   EricTechPro/super-board (MIT; the skill is Anthropic's, MIT)  pr-security-review
#   antfu/skills (MIT)                     vitest                      (optional)
#   anthropics/knowledge-work-plugins      testing-strategy            (Apache-2.0)
#   currents-dev/playwright-best-practices-skill (MIT)  playwright-best-practices  (optional)
set -eu

target="${1:-$HOME/.claude/skills}"

# repo commit path-in-repo skill...
SOURCES=(
  "mattpocock/skills 5863806dd4e15c63174bee4e7515a4256792ecfa skills/engineering tdd diagnosing-bugs codebase-design code-review=mp-code-review domain-modeling"
  "obra/superpowers 22f0b463e7a5e579904dd6211a520321035526f7 skills verification-before-completion"
  "EricTechPro/super-board d0b7d5a6850614ca809477c1af43d5d7da408726 skills pr-security-review"
  "antfu/skills d524ed287eef22757297827ce42e3cad88abd20c skills vitest"
  "anthropics/knowledge-work-plugins e91a134584eb798bac7fb0379358006a2b63b965 engineering/skills testing-strategy"
  "currents-dev/playwright-best-practices-skill 0b75b5835a87de1fdd202ba965f3bc5a27738fdf . playwright-best-practices"
)

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$target"

for line in "${SOURCES[@]}"; do
  set -- $line
  repo="$1" commit="$2" base="$3"
  shift 3
  dir="$tmp/$(echo "$repo" | tr '/' '_')"
  git init -q "$dir"
  git -C "$dir" fetch -q --depth 1 "https://github.com/$repo.git" "$commit"
  git -C "$dir" checkout -q FETCH_HEAD
  for entry in "$@"; do
    src="${entry%%=*}"
    name="${entry#*=}"
    if [ -e "$target/$name" ]; then
      echo "kept     $name (already in $target)"
    elif [ -s "$dir/$base/$src/SKILL.md" ]; then
      cp -R "$dir/$base/$src" "$target/$name"
      if [ "$src" != "$name" ]; then
        sed "s/^name: $src\$/name: $name/" "$target/$name/SKILL.md" > "$target/$name/SKILL.md.tmp"
        mv "$target/$name/SKILL.md.tmp" "$target/$name/SKILL.md"
      fi
      if [ "$src" != "$name" ]; then
        echo "installed $name from $repo@${commit:0:7} (its $src)"
      else
        echo "installed $name from $repo@${commit:0:7}"
      fi
    else
      echo "missing  $src: not found in $repo@${commit:0:7}" >&2
      exit 1
    fi
  done
done
