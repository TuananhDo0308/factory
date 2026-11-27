# Software Factory ↔ factory v2 contract

Software Factory (web app + `sf daemon`) runs only **factory v2** (`factory_v2/skills/new-ba`, `factory_v2/skills/new-factory`) and only on **Claude Code** (`claude`). Antigravity / Gemini and the old Factory skills (`/factory`, `/factory clarify`, `/factory init`, `/ba-ticket`, `/dev-subissues`, `/ui-refine-loop`, `/pr-judge`, missions, automations) are gone.

The runner mechanism stays as it is: a daemon on any machine logs in with a device code, heartbeats `/api/v1/runners/heartbeat`, polls its `RunnerCommand`s, and reports with `/api/v1/runs/*`. People on other machines watch the same runs live.

## Flow

1. **BA session** (`FactoryRun.mode = "ba"`). The user chats with Claude running `/new-ba <request>` in the project's local clone. Turns are `claude -p` and `claude -p --resume <session>`; questions come back as an `sf-questions` block and are answered in the UI (the existing questions dock / `RunInteraction`). When new-ba publishes, the daemon reads the epic from GitHub and calls `POST /api/v1/epics/sync`, so the epic and its tickets appear on the Kanban board.
2. **Epic run** (`FactoryRun.mode = "epic"`). The user presses **Run epic** on an epic. The web app creates a `FactoryRun` and a `RunnerCommand` `run_epic`. The daemon runs `node <new-factory>/orchestrator/run.mjs --repo <owner/name> --epic <n> --dir <clone>` directly (no Claude wrapper), tails `.factory/runs/epic-<n>/state.json` and every agent's `logs/agents/*.jsonl`, and reports agents, steps, tokens, cost, ticket status, alarms and decisions.
3. **Needs a decision.** A ticket with `status: "needs-decision"` becomes a `RunInteraction` (`type: "decision"`, `payload: { epic, issue, question, reason }`). Answering it in the UI enqueues `run_epic` again with `retry: [issue]` and `note: <answer>` (a new `FactoryRun`, same epic).

## Runner commands (web → daemon)

| type | payload |
|---|---|
| `start_run` | `{ mode: "ba", engine: "claude", model, prompt, localPath, attachments? }` |
| `resume_run` / `answer_interaction` | as today (BA turns only) |
| `pause_run` | as today (BA only) |
| `run_epic` | `{ mode: "epic", repo: "owner/name", epic: number, localPath, retry?: number[], note?: string, createStaging?: boolean }` |
| `sync_context`, `create_project` | as today |

All other command types are removed. `engine` is always `"claude"`; models are `opus`, `sonnet`, `haiku` (optionally `model:effort`, effort in `low|medium|high|xhigh|max`).

## Daemon → web

Existing endpoints, unchanged in shape:

- `POST /api/v1/runs/agent` — `{ run, agentKey, name, role, model, status, activity, preserveExistingName? }`.
- `POST /api/v1/runs/step` — `{ run, step, phase, status, role, agent, agentName, model, label, summary, inputTokens, outputTokens, cacheReadTokens, costUsd, durationMs, idempotent?, data: { kind, ... } }`. Tokens and cost on a step are **increments** added to the agent and the run. The daemon never sends the same tokens twice.
- `POST /api/v1/runs/finish` — `{ run, outcome: "passed"|"failed"|"blocked", summary }`.
- `POST /api/v1/runs/interaction` — `{ run, type, title, prompt, agentKey, payload }`.

For an epic run, agents are the orchestrator's agent records: `agentKey` = the record id (`003-implementer-12`), `role` in `implementer|reviewer|diagnoser|qc`, `name` like `#12 implementer · build`. Phases: `Plan`, `Prepare`, `Build`, `Final`, `Report`.

Step `data.kind` values the UI shows: `tool_call` (`{ tool, input }`), `assistant_message`, `turn_metrics` (`{ costUsd, durationMs }`), `lifecycle`, `ticket` (`{ issue, status, rounds }`), `alarm` (`{ issue, step, reason, handled }`), `epic` (`{ epic, repo, url }`).

New endpoint:

### `POST /api/v1/epics/sync`

```json
{
  "projectId": "…", "repo": "<local path>",
  "run": "<runKey, optional>",
  "epic": { "number": 41, "title": "…", "url": "https://github.com/o/r/issues/41", "repo": "o/r" },
  "tickets": [
    { "number": 42, "key": "T1", "title": "…", "url": "…", "body": "…",
      "criteria": [{ "id": "C1", "text": "…" }], "size": "M", "wave": 0,
      "dependsOn": [42], "status": "ready", "rounds": 0,
      "decision": { "question": "…", "reason": "…" } }
  ]
}
```

Every field of a ticket but `number` is optional: a status-only update sends `{ number, status, rounds }`. The server upserts one `ProjectIssue` per ticket (`issueKey = "#<number>"`, `githubIssueNumber`, `githubIssueUrl`, `syncMode = "github"`, `epicNumber`) and one for the epic (`issueKey = "epic-<n>"`, `tier = "epic"`). Ticket status from v2:

| v2 `status` | `ProjectIssue.status` |
|---|---|
| absent / `pending` / `ready` | `ready` |
| `running`, `reopened` | `in_progress` |
| `waiting`, `blocked` | `blocked` |
| `needs-decision` | `needs_human` |
| `merged` | `passed` |
