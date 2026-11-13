# Turns the factory's last recorded run state (dashboard/live.js, the object after `window.FACTORY_LIVE =`)
# into FactoryBench gate payloads: [{key, payload: {name, passed, reason?}}]. Keys are fixed per gate, so a
# resend is a duplicate. A stage the run never reached gets no gate (unknown is missing, not failed).
def order: {"Spec": 1, "Build": 2, "Check": 3, "Review": 4, "Repair": 5}[.] // 0;
def gate($name; $passed; $reason):
  {key: ("gate:" + $name), payload: ({name: $name, passed: $passed} + (if $reason == "" or $passed then {} else {reason: $reason} end))};
. as $r
| ($r.phase | order) as $at
| ($r.outcome != "passed" and $r.outcome != "running") as $stopped
| [ # spec: the planner produced specs that code accepted
    (if $at >= 1 then gate("spec"; ($at > 1 or ($stopped | not)) and (($r.specs // []) | length > 0);
       if $at == 1 then $r.reason else "" end) else empty end),
    # build: every implementer and tester finished without breaking file ownership
    (if $at >= 2 then gate("build"; $at > 2 or ($stopped | not); if $at == 2 then $r.reason else "" end) else empty end),
    # check: the contract's checks, as last run (after any repairs)
    (if $at >= 3 and ($r.check.state // "") != "" then gate("check"; $r.check.state == "ok"; $r.check.text // "") else empty end),
    # review: every reviewer's last verdict
    (if $at >= 4 and (($r.review // []) | length > 0) then
       gate("review"; all($r.review[]; .state == "ok"); [$r.review[] | select(.state != "ok") | "\(.tag): \(.text)"] | join("; "))
     else empty end),
    # criteria: every acceptance criterion judged met
    (if $at >= 4 and (($r.criteria // []) | length > 0) then
       ([$r.criteria[] | select(.status == "met")] | length) as $met
       | gate("criteria"; $met == ($r.criteria | length); "\($met)/\($r.criteria | length) met")
     else empty end),
    # first-pass: passed without needing the fixer
    (if $at >= 4 then gate("first-pass"; ($r.repairRounds // 0) == 0; "\($r.repairRounds) repair round(s)") else empty end)
  ]
