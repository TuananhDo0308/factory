#!/usr/bin/env bash
# Resolves the skills the factory team loads to installed SKILL.md files, for the
# `skills` arg of the workflow. Run by the invoking session before each run.
#
#   skills-ready.sh <repo>
#
# Prints one JSON object { "<name>": "<absolute path to SKILL.md>" } on stdout:
# every required skill, every optional skill that is installed (agents load
# those only when their rule applies; a missing one is left out, not an error),
# plus every skill the repository itself has under .agents/skills or .gemini/skills
# (a spec may name one of those instead of its kind's skills).
# A name is looked up in <repo>/.agents/skills, <repo>/.gemini/skills,
# ~/.gemini/config/skills, ~/.gemini/antigravity/skills, ~/.gemini/skills,
# then ~/.agents/skills; a symlink counts when it leads to a non-empty SKILL.md.
# Exit 0 when every required skill resolves. Exit 10 when some do not: the
# missing names go to stderr, one per line, and nothing is printed on stdout.
# Nothing is installed or changed; install-skills.sh does that.
#
# REQUIRED and OPTIONAL must match the SKILLS registry in workflow/factory.py
# (required_skills() and optional_skills()); tests/skills.test.mjs checks that.
set -u

REQUIRED="codebase-design diagnosing-bugs mp-code-review pr-security-review tdd testing-strategy verification-before-completion"
OPTIONAL="domain-modeling playwright-best-practices vitest"

repo="${1:-}"
if [ -z "$repo" ] || [ ! -d "$repo" ]; then
  echo "usage: skills-ready.sh <repo>" >&2
  exit 64
fi
repo="$(cd "$repo" && pwd)"
home="${FACTORY_SKILLS_HOME:-$HOME}"

resolve() {
  local name="$1" dir
  for dir in \
    "$repo/.agents/skills" \
    "$repo/.gemini/skills" \
    "$home/.gemini/config/skills" \
    "$home/.gemini/antigravity/skills" \
    "$home/.gemini/skills" \
    "$home/.agents/skills"; do
    if [ -s "$dir/$name/SKILL.md" ]; then
      echo "$dir/$name/SKILL.md"
      return 0
    fi
  done
  return 1
}

json_string() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '"%s"' "$s"
}

entries=()
missing=()
seen=" "
for name in $REQUIRED; do
  if path="$(resolve "$name")"; then
    entries+=("$(json_string "$name"): $(json_string "$path")")
    seen="$seen$name "
  else
    missing+=("$name")
  fi
done

if [ "${#missing[@]}" -gt 0 ]; then
  printf '%s\n' "${missing[@]}" >&2
  exit 10
fi

for name in $OPTIONAL; do
  if path="$(resolve "$name")"; then
    entries+=("$(json_string "$name"): $(json_string "$path")")
    seen="$seen$name "
  fi
done

for dir in "$repo/.agents/skills" "$repo/.gemini/skills"; do
  if [ -d "$dir" ]; then
    for file in "$dir"/*/SKILL.md; do
      [ -s "$file" ] || continue
      name="$(basename "$(dirname "$file")")"
      case "$seen" in *" $name "*) continue ;; esac
      entries+=("$(json_string "$name"): $(json_string "$file")")
      seen="$seen$name "
    done
  fi
done

printf '{'
for i in "${!entries[@]}"; do
  [ "$i" -gt 0 ] && printf ', '
  printf '%s' "${entries[$i]}"
done
printf '}\n'
