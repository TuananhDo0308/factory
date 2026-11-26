#!/usr/bin/env bash
# Creates and links the GitHub issues of the factory pipeline, so that every
# issue the BA and dev skills write carries the same labels and links, whoever
# runs them. Run from inside the repository the issues belong to.
#
#   factory-issue.sh labels
#       Creates the pipeline's labels if they are missing (safe to rerun).
#   factory-issue.sh create --title T --body-file F [--kind K]
#       Creates an issue labelled `factory` (and `kind/K`); prints its URL.
#   factory-issue.sh depends --issue N --on M
#       Records on GitHub that issue N is blocked by issue M.
#
# Labels:
#   factory      the issue belongs to the pipeline; only these are ever built
#   kind/<kind>  the checklist it was written against (ba-ticket/references/checklists.md)
#   ready        a person decided it can be built; set by hand, never by an agent
#   needs-info   a run or the readiness check stopped with questions on it
#   factory-review  a pull request a run opened and left for a person to accept
set -euo pipefail

die() { echo "factory-issue: $*" >&2; exit 2; }

ensure_label() { # name color description
  gh label create "$1" --color "$2" --description "$3" >/dev/null 2>&1 || true
}

labels() {
  ensure_label factory 5319e7 "Written for the factory pipeline"
  ensure_label ready 0e8a16 "Checked and approved: the factory may build it"
  ensure_label needs-info d93f0b "Stopped with questions; see the Q lines"
  ensure_label factory-review fbca04 "Opened by a factory run; waiting for a person to accept"
}

cmd=${1:-}; shift || true
case "$cmd" in
  labels)
    labels
    ;;
  create)
    title='' body='' kind=''
    while [ $# -gt 0 ]; do
      case "$1" in
        --title) title=$2; shift 2 ;;
        --body-file) body=$2; shift 2 ;;
        --kind) kind=$2; shift 2 ;;
        *) die "unknown option $1" ;;
      esac
    done
    [ -n "$title" ] || die "--title is required"
    [ -f "$body" ] || die "--body-file must name a file"
    labels
    set -- --label factory
    if [ -n "$kind" ]; then
      case "$kind" in *[!a-z0-9-]*) die "--kind must be lower-case letters, digits or '-'" ;; esac
      ensure_label "kind/$kind" c5def5 "Checklist: $kind"
      set -- "$@" --label "kind/$kind"
    fi
    gh issue create --title "$title" --body-file "$body" "$@"
    ;;
  depends)
    issue='' on=''
    while [ $# -gt 0 ]; do
      case "$1" in
        --issue) issue=$2; shift 2 ;;
        --on) on=$2; shift 2 ;;
        *) die "unknown option $1" ;;
      esac
    done
    [ -n "$issue" ] && [ -n "$on" ] || die "--issue and --on are required"
    [ "$issue" != "$on" ] || die "an issue cannot depend on itself"
    id=$(gh api "repos/{owner}/{repo}/issues/$on" --jq .id)
    if ! gh api -X POST "repos/{owner}/{repo}/issues/$issue/dependencies/blocked_by" -F issue_id="$id" >/dev/null; then
      die "GitHub refused the dependency #$issue <- #$on. Add it by hand in the issue's Relationships panel; the readiness check also reads the issue's 'Depends on' section."
    fi
    echo "#$issue is blocked by #$on"
    ;;
  *)
    die "usage: factory-issue.sh labels | create --title T --body-file F [--kind K] | depends --issue N --on M"
    ;;
esac
