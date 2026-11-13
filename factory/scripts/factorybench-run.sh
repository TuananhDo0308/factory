#!/usr/bin/env bash
# Runs the factory once on one issue and reports it to FactoryBench as one attempt.
# The wrapper sends the attempt's lifecycle (started, pr.linked, finished); Claude Code sends its own
# tokens, cost, tool calls and subagents over OTLP; the wrapper names each subagent after its stage and role.
# Reporting never blocks or fails the run.
#
# usage: factorybench-run.sh "<task>" <owner/repo> <issue> [repository directory, default: .]
#
# Settings, from the environment or from ~/.factorybench/env (KEY=value lines, kept out of any repository):
#   FACTORYBENCH_URL    base URL, without /v1/events. Unset: the factory runs unreported.
#   FACTORYBENCH_TOKEN  this factory's token.
# Optional:
#   CLAUDE_ARGS         extra arguments for `claude` (e.g. "--model opus"). A model given here is added
#                       to factory_config_version, since it can change results.
#   PR_URL              the pull request of this attempt, if the wrapper cannot find it in the report.
#   FACTORYBENCH_SPOOL  where events that could not be sent are kept (default ~/.factorybench/spool.jsonl).
#   FACTORYBENCH_RUNS   where the run's output stream is kept (default ~/.factorybench/runs). Local only.
set -uo pipefail

task=${1:?task}; work_repo=${2:?owner/repo}; issue=${3:?issue number}; dir=${4:-$PWD}
dir=$(cd "$dir" && pwd) || exit 2
skill=$(cd "$(dirname "$0")/.." && pwd -P)

fb_home=${FACTORYBENCH_HOME:-$HOME/.factorybench}
if [ -f "$fb_home/env" ]; then
  while IFS='=' read -r k v; do
    case $k in FACTORYBENCH_URL|FACTORYBENCH_TOKEN) [ -n "${!k:-}" ] || export "$k=$v" ;; esac
  done < "$fb_home/env"
fi
url=${FACTORYBENCH_URL:-}; url=${url%/}
token=${FACTORYBENCH_TOKEN:-}
spool=${FACTORYBENCH_SPOOL:-$fb_home/spool.jsonl}
runs=${FACTORYBENCH_RUNS:-$fb_home/runs}
mkdir -p "$runs" "$(dirname "$spool")"

# post <file with a JSON array of events> [suffix for its scratch files, so two senders don't share them]:
# 0 accepted, 1 rejected by FactoryBench, 2 not delivered
post() {
  local code res="$runs/.response${2:-}" err="$runs/.curlerr${2:-}"
  code=$(curl -sS -m 8 -o "$res" -w '%{http_code}' -X POST "$url/v1/events" \
    -H "Authorization: Bearer $token" -H 'Content-Type: application/json' --data-binary @"$1" 2>"$err") || code=000
  case $code in
    2*) [ "$(jq -r '.rejected // [] | length' "$res" 2>/dev/null || echo 0)" = 0 ] && return 0
        echo "factorybench: rejected by FactoryBench: $(cat "$res")" >&2; return 1 ;;
    400|409|422) echo "factorybench: rejected by FactoryBench ($code): $(cat "$res" 2>/dev/null)" >&2; return 1 ;;
    *) echo "factorybench: not sent ($code): $(cat "$err" "$res" 2>/dev/null | head -c 300)" >&2; return 2 ;;
  esac
}

# emit <type> <key> <payload json>. The event id is <attempt>:<key>, so a resend is a harmless duplicate.
emit() {
  [ -n "$url" ] || return 0
  local event
  event=$(jq -nc --arg t "$1" --arg a "$att" --arg k "$2" --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --argjson p "$3" \
    '{spec: "factorybench/v1", id: ($a + ":" + $k), type: $t, ts: $ts, attempt_id: $a, payload: $p}') || return 0
  printf '[%s]\n' "$event" > "$runs/.event"
  post "$runs/.event"
  [ $? -eq 2 ] && printf '%s\n' "$event" >> "$spool"
  return 0
}

# resend what an earlier run could not deliver
flush() {
  [ -n "$url" ] && [ -s "$spool" ] || return 0
  jq -sc . "$spool" > "$runs/.flush" 2>/dev/null || return 0
  post "$runs/.flush"
  [ $? -eq 2 ] || : > "$spool"
  return 0
}

att="cc-$(uuidgen | tr 'A-Z' 'a-z')"
stream="$runs/$att.jsonl"

# everything that could change results: the skill's commit (and whether it has local edits), Claude Code, the model
skill_rev=$(git -C "$skill" rev-parse --short HEAD 2>/dev/null || echo unknown)
# local edits, untracked files included, but not the run history the factory itself appends to
dirty_paths=$(git -C "$skill" status --porcelain --untracked-files=all -- . ':!dashboard/runs.js' 2>/dev/null)
if [ -n "$dirty_paths" ]; then
  skill_rev="$skill_rev.dirty-$( { git -C "$skill" diff HEAD -- . ':!dashboard/runs.js'
    git -C "$skill" ls-files --others --exclude-standard -z -- . | (cd "$(git -C "$skill" rev-parse --show-toplevel)" && xargs -0 cat 2>/dev/null)
  } | shasum | cut -c1-7)"
fi
cfg="factory@$skill_rev+claude-code@$(claude --version | awk '{print $1}')"
model=$(printf '%s\n' "${CLAUDE_ARGS:-}" | sed -n 's/.*--model[ =]\([^ ]*\).*/\1/p')
[ -z "$model" ] || cfg="$cfg+$model"

finished=
finish() {
  [ -z "$finished" ] || return 0
  finished=1
  emit attempt.finished finished "$1"
}
trap 'finish "{\"status\":\"cancelled\",\"reason\":\"interrupted\"}"; exit 130' INT TERM
trap 'finish "{\"status\":\"failed\",\"reason\":\"wrapper exited early\"}"' EXIT

# The factory files every run in dashboard/runs.js when it ends; the record it adds is where the gates come from.
runs_js="$skill/dashboard/runs.js"
count_runs() { node -e 'global.window={};require(process.argv[1]);console.log((window.FACTORY_RUNS||[]).length)' "$runs_js" 2>/dev/null || echo 0; }
runs_before=$(count_runs)

flush
started=$(jq -nc --arg r "$work_repo" --argjson i "$issue" --arg c "$cfg" --arg b "$(git -C "$dir" rev-parse --short HEAD 2>/dev/null)" \
  '{work_item: {repo: $r, issue: $i}, factory_config_version: $c, role: "full"} + (if $b == "" then {} else {base_commit: $b} end)')
emit attempt.started started "$started"
echo "factorybench: attempt $att ($cfg)" >&2

prompt="/factory $task

End your report with one last line, exactly: FACTORY_OUTCOME: passed, FACTORY_OUTCOME: failed or FACTORY_OUTCOME: blocked."

otel=()
if [ -n "$url" ]; then
  otel=(CLAUDE_CODE_ENABLE_TELEMETRY=1 OTEL_LOGS_EXPORTER=otlp OTEL_EXPORTER_OTLP_PROTOCOL=http/json
    "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=$url/v1/logs"
    "OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer $token"
    "OTEL_RESOURCE_ATTRIBUTES=factorybench.attempt=$att")
fi
# OTLP gives each subagent only an id and a generic type. Name it after its stage and role ("Build: test S1")
# while the run goes, from the workflow progress in the stream (scripts/factorybench-agents.jq).
: > "$stream"
labeler=
if [ -n "$url" ]; then
  tail -n +1 -F "$stream" 2>/dev/null > >(jq -nRc --unbuffered --arg a "$att" -f "$skill/scripts/factorybench-agents.jq" 2>/dev/null \
    | while IFS= read -r ev; do
        printf '[%s]\n' "$ev" > "$runs/.agent-event"
        post "$runs/.agent-event" .agents
        [ $? -eq 2 ] && printf '%s\n' "$ev" >> "$spool"
      done) &
  labeler=$!
fi
# shellcheck disable=SC2086
# The factory's workflow runs in the background; without CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0, `claude -p`
# stops background tasks 10 minutes after its last turn and exits mid-run.
(cd "$dir" && env -u OTEL_EXPORTER_OTLP_COMPRESSION -u OTEL_LOG_USER_PROMPTS -u OTEL_LOG_TOOL_DETAILS -u OTEL_LOG_RAW_API_BODIES \
  CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 ${otel[@]+"${otel[@]}"} \
  claude -p "$prompt" --output-format stream-json --verbose --add-dir "$skill" \
    --allowedTools Read Glob Grep Skill Write Edit Bash Agent Workflow ${CLAUDE_ARGS:-}) > "$stream" 2> >(tee "$runs/$att.stderr" >&2)
echo "factorybench: claude exit $?; stream in $stream" >&2
# Stop the live labeler and send every label once more in one batch: one the tail had not sent yet is
# delivered, the rest are duplicates FactoryBench ignores.
if [ -n "$labeler" ]; then
  kill "$labeler" 2>/dev/null
  jq -nRc --arg a "$att" -f "$skill/scripts/factorybench-agents.jq" < "$stream" 2>/dev/null | jq -sc . > "$runs/.agents" 2>/dev/null
  if [ "$(jq length "$runs/.agents" 2>/dev/null || echo 0)" -gt 0 ]; then
    post "$runs/.agents"
    [ $? -eq 2 ] && jq -c '.[]' "$runs/.agents" >> "$spool"
  fi
fi

# How the attempt ended is not in the telemetry: take it from the last result line (none = killed or crashed).
result=$(jq -sc 'map(select(.type == "result")) | last' "$stream" 2>/dev/null || echo null)
report=$(jq -r '.result // ""' <<<"$result" 2>/dev/null)
outcome=$(printf '%s\n' "$report" | sed -n 's/.*FACTORY_OUTCOME: *\([a-z]*\).*/\1/p' | tail -1)

pr=${PR_URL:-$(printf '%s\n' "$report" | grep -oE 'https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/pull/[0-9]+' | tail -1)}
[ -z "$pr" ] || emit pr.linked pr "$(jq -nc --arg u "$pr" '{pr_url: $u}')"

# One gate per stage the run reached (spec, build, check, review, criteria, first-pass), from the record
# the factory filed for this run; nothing is sent if it filed none.
if [ "$(count_runs)" -gt "$runs_before" ]; then
  node -e 'global.window={};require(process.argv[1]);const r=window.FACTORY_RUNS;console.log(JSON.stringify(r[r.length-1]))' "$runs_js" 2>/dev/null \
    | jq -c -f "$skill/scripts/factorybench-gates.jq" 2>/dev/null | jq -c '.[]' 2>/dev/null \
    | while IFS= read -r g; do emit gate "$(jq -r .key <<<"$g")" "$(jq -c .payload <<<"$g")"; done
fi

if grep -q 'Background tasks still running' "$runs/$att.stderr" 2>/dev/null; then
  # the harness stopped the factory: not a verdict on the factory's work
  finish '{"status":"cancelled","reason":"headless session stopped the factory workflow before it finished"}'
elif [ "$result" = null ] || [ -z "$result" ]; then
  finish '{"status":"failed","reason":"no result line"}'
elif [ "$(jq -r '.is_error' <<<"$result")" = true ]; then
  finish "$(jq -c '{status: "failed", reason: (.subtype // "error")}' <<<"$result")"
elif [ "$outcome" = passed ]; then
  finish '{"status":"completed"}'
else
  finish "$(jq -nc --arg o "${outcome:-not reported}" '{status: "failed", reason: ("factory outcome: " + $o)}')"
fi
printf '%s\n' "$report"
echo "factorybench: attempt $att reported, outcome ${outcome:-not reported}${pr:+, $pr}" >&2
[ "$outcome" = passed ]
