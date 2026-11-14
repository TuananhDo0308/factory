# Names each subagent of the factory's workflow after the stage and role it ran in, and gives it a FactoryBench
# phase. Claude Code's OTLP telemetry gives a subagent only its id and a generic type, and its tokens get a phase
# only from OTEL_RESOURCE_ATTRIBUTES, which is one value for the whole `claude` process. The workflow's progress
# in the stream-json output (workflow_agent entries) has the id, the label ("build S1", "reviewer", ...) and the
# phase title ("Build", "Review", ...). Run with -nR: reads raw stream lines (a partial line from a live tail is
# skipped) and prints one FactoryBench activity event per agent id, the first time that id shows up.
#
# The event has no tool, so it is not counted as a tool call. Its ts is the agent's start, earlier than any of
# its OTLP events, and FactoryBench keeps the first type it sees for an agent, so "Build: build S1" wins over
# the generic type; a FactoryBench that reads `phase` from activity gives it to the agent's OTLP tokens. Fields it
# does not read stay in the raw event. The key is fixed per agent id, so a resend is a duplicate.
#
# The labels are set in factory/workflow/factory.js; keep `role` in step with them. An unknown label gets no
# role and no phase (unknown, not a guess).
def ts: (. / 1000 | floor | strftime("%Y-%m-%dT%H:%M:%S")) + "." + ((. % 1000) + 1000 | tostring | .[1:]) + "Z";
def after($n): split(" ") | .[$n:] | join(" ") | sub(" \\(.*\\)$"; "");
# label -> {role, phase, spec?, level?}. phase is FactoryBench's: implement, verify or review.
def role:
  if test("^planner( |$)") then {role: "planner", phase: "implement"}
  elif startswith("build ") then {role: "implementer", phase: "implement", spec: after(1)}
  elif startswith("qa ") then {role: "qa", phase: "verify", spec: after(1)}
  elif startswith("rebuild ") then {role: "implementer", phase: "implement", spec: after(2), round: (split(" ")[1] | tonumber? // null)}
  elif test("^checker( |$)") then {role: "checker", phase: "verify"}
  elif test("^reviewer( |$)") then {role: "reviewer", phase: "review"}
  elif startswith("review ") then {role: "spec-reviewer", phase: "review", spec: after(1)}
  elif startswith("record ") then {role: "recorder"}
  else {} end
  + ((capture("\\(level (?<l>[0-9]+)\\)") | {level: (.l | tonumber)}) // {});
foreach (inputs | fromjson? | select(.type == "system" and .subtype == "task_progress")
         | .workflow_progress[]? | select(.type == "workflow_agent" and (.agentId // "") != "" and .startedAt != null)) as $w
  ({seen: {}, out: null};
   if .seen[$w.agentId] then .out = null else .seen[$w.agentId] = true | .out = $w end;
   .out // empty)
| ((.label // "") | role) as $r
| {spec: "factorybench/v1", id: ($a + ":agent:" + .agentId), type: "activity", ts: (.startedAt | ts), attempt_id: $a,
   payload: ({agent: "\(.phaseTitle // "?"): \(.label // "?")", agent_id: .agentId,
              summary: "stage \(.phaseTitle // "?"), \(.label // "?")\(if (.attempt // 1) > 1 then ", try \(.attempt)" else "" end)",
              stage: .phaseTitle, label: .label, model: .model, try: (.attempt // 1)}
             + $r | with_entries(select(.value != null)))}
