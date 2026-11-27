import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deriveEpicStatus,
  EPIC_PHASES,
  epicIssueKey,
  epicNumberFromKey,
  epicPhaseIndex,
  mapTicketStatus,
  normalizeCriteria,
  normalizeDependsOn,
  parseSyncTicket,
  repoFullName,
  summarizeAgentsByTicket,
  ticketIssueKey,
  ticketNumberFromKey,
  ticketOfAgent,
} from "../src/lib/epics.ts";
import { findModelChoice, formatModelLabel, MODEL_OPTIONS } from "../src/lib/models.ts";
import { detectSkillFromPrompt, SESSION_SKILLS, toBaPrompt } from "../src/lib/skills.ts";

describe("epics/sync ticket status mapping (contract table)", () => {
  const cases = [
    [undefined, "ready"],
    ["", "ready"],
    ["pending", "ready"],
    ["ready", "ready"],
    ["running", "in_progress"],
    ["reopened", "in_progress"],
    ["waiting", "blocked"],
    ["blocked", "blocked"],
    ["needs-decision", "needs_human"],
    ["merged", "passed"],
  ];
  for (const [input, expected] of cases) {
    it(`maps ${JSON.stringify(input)} to ${expected}`, () => {
      assert.equal(mapTicketStatus(input), expected);
    });
  }

  it("is case- and space-insensitive and falls back to ready for unknown values", () => {
    assert.equal(mapTicketStatus("  MERGED "), "passed");
    assert.equal(mapTicketStatus("Needs-Decision"), "needs_human");
    assert.equal(mapTicketStatus("something-new"), "ready");
    assert.equal(mapTicketStatus(42), "ready");
  });
});

describe("parseSyncTicket", () => {
  it("normalises a full ticket from new-ba", () => {
    const t = parseSyncTicket({
      number: 42,
      key: "T1",
      title: "Export a replay as JSON",
      url: "https://github.com/o/r/issues/42",
      body: "## Goal",
      criteria: [{ id: "c1", text: "A button" }, "C2: A file downloads"],
      size: "m",
      wave: 0,
      dependsOn: [41, "#40", "40"],
      status: "ready",
      rounds: 0,
    });
    assert.deepEqual(t, {
      number: 42,
      key: "T1",
      title: "Export a replay as JSON",
      url: "https://github.com/o/r/issues/42",
      body: "## Goal",
      criteria: [
        { id: "C1", text: "A button" },
        { id: "C2", text: "A file downloads" },
      ],
      size: "M",
      wave: 0,
      dependsOn: ["#41", "#40"],
      status: "ready",
      statusGiven: true,
      rounds: 0,
      decision: undefined,
    });
  });

  it("keeps a status-only update minimal and records that the status was given", () => {
    const t = parseSyncTicket({ number: 43, status: "needs-decision", rounds: 4, decision: { question: "Which?", reason: "4 rounds" } });
    assert.equal(t.status, "needs_human");
    assert.equal(t.statusGiven, true);
    assert.equal(t.rounds, 4);
    assert.deepEqual(t.decision, { question: "Which?", reason: "4 rounds" });
    assert.equal(t.title, undefined);
    assert.equal(t.criteria, undefined);
    assert.equal(t.dependsOn, undefined);
  });

  it("marks an absent status as not given (a text refresh never moves a ticket back to Ready)", () => {
    const t = parseSyncTicket({ number: 44, title: "x" });
    assert.equal(t.status, "ready");
    assert.equal(t.statusGiven, false);
  });

  it("rejects tickets without a usable number", () => {
    assert.equal(parseSyncTicket({ title: "x" }), null);
    assert.equal(parseSyncTicket({ number: 0 }), null);
    assert.equal(parseSyncTicket(null), null);
    assert.equal(parseSyncTicket("42"), null);
    assert.equal(parseSyncTicket({ number: "42" }).number, 42);
  });
});

describe("deriveEpicStatus", () => {
  it("is ready with no tickets and in progress while a run is active", () => {
    assert.equal(deriveEpicStatus([], false), "ready");
    assert.equal(deriveEpicStatus([], true), "in_progress");
  });
  it("is passed only when every ticket merged", () => {
    assert.equal(deriveEpicStatus(["passed", "passed"], false), "passed");
    assert.equal(deriveEpicStatus(["passed", "passed"], true), "passed");
  });
  it("prefers in_progress while a run is active", () => {
    assert.equal(deriveEpicStatus(["passed", "needs_human"], true), "in_progress");
  });
  it("needs a human when a ticket needs a decision after the run", () => {
    assert.equal(deriveEpicStatus(["passed", "needs_human", "blocked"], false), "needs_human");
  });
  it("is blocked when tickets are blocked or failed after the run", () => {
    assert.equal(deriveEpicStatus(["passed", "blocked"], false), "blocked");
    assert.equal(deriveEpicStatus(["failed", "ready"], false), "blocked");
  });
  it("is ready when nothing ran yet", () => {
    assert.equal(deriveEpicStatus(["ready", "ready"], false), "ready");
  });
});

describe("issue keys", () => {
  it("round-trips ticket and epic keys", () => {
    assert.equal(ticketIssueKey(42), "#42");
    assert.equal(epicIssueKey(41), "epic-41");
    assert.equal(ticketNumberFromKey("#42"), 42);
    assert.equal(ticketNumberFromKey("I3"), null);
    assert.equal(epicNumberFromKey("epic-41"), 41);
    assert.equal(epicNumberFromKey("#41"), null);
  });
});

describe("ticketOfAgent", () => {
  it("reads the ticket from an orchestrator record id", () => {
    assert.equal(ticketOfAgent("003-implementer-12"), 12);
    assert.equal(ticketOfAgent("010-reviewer-7", ""), 7);
  });
  it("prefers the agent name", () => {
    assert.equal(ticketOfAgent("003-implementer-12", "#15 implementer · build"), 15);
  });
  it("returns null for agents of no ticket", () => {
    assert.equal(ticketOfAgent("020-qc", "qc · final"), null);
    assert.equal(ticketOfAgent("orchestrator", "BA"), null);
    assert.equal(ticketOfAgent("S1-impl-2", ""), null);
  });
});

describe("repoFullName", () => {
  it("uses githubFullName, then parses the GitHub URL", () => {
    assert.equal(repoFullName({ githubFullName: "o/r" }), "o/r");
    assert.equal(repoFullName({ githubFullName: null, githubUrl: "https://github.com/o/r.git" }), "o/r");
    assert.equal(repoFullName({ githubUrl: "git@github.com:o/r-2.git" }), "o/r-2");
    assert.equal(repoFullName({ githubFullName: "", githubUrl: "" }), null);
  });
});

describe("normalizers", () => {
  it("parses criteria from text", () => {
    assert.deepEqual(normalizeCriteria("C1: one\n\nsecond"), [
      { id: "C1", text: "one" },
      { id: "C3", text: "second" },
    ]);
  });
  it("normalises dependsOn numbers to ticket keys without duplicates", () => {
    assert.deepEqual(normalizeDependsOn([42, "42", "#43"]), ["#42", "#43"]);
    assert.deepEqual(normalizeDependsOn("42, 43"), ["#42", "#43"]);
    assert.deepEqual(normalizeDependsOn(undefined), []);
  });
});

describe("epic phases", () => {
  it("lists the v2 phases in order and indexes them", () => {
    assert.deepEqual([...EPIC_PHASES], ["Plan", "Prepare", "Build", "Final", "Report"]);
    assert.equal(epicPhaseIndex("build"), 2);
    assert.equal(epicPhaseIndex("Report"), 4);
    assert.equal(epicPhaseIndex("Spec"), 0);
  });
});

describe("summarizeAgentsByTicket", () => {
  const agent = (agentKey, name, inputTokens, outputTokens, cacheReadTokens, costUsd) => ({
    agentKey,
    name,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    costUsd,
  });
  it("groups by ticket, sums each group's usage, and keeps no-ticket agents last", () => {
    const groups = summarizeAgentsByTicket([
      agent("020-qc", "qc · final", 5, 5, 0, 0.5),
      agent("003-implementer-12", "#12 implementer · build", 100, 50, 1000, 1.25),
      agent("004-reviewer-12", "#12 reviewer · review", 10, 5, 0, 0.25),
      agent("005-implementer-9", "#9 implementer · build", 1, 1, 1, 0.01),
    ]);
    assert.deepEqual(
      groups.map((g) => [g.ticket, g.agents.length, g.inputTokens, g.outputTokens, g.cacheReadTokens, g.costUsd]),
      [
        [9, 1, 1, 1, 1, 0.01],
        [12, 2, 110, 55, 1000, 1.5],
        [null, 1, 5, 5, 0, 0.5],
      ],
    );
  });
  it("adds up exactly to the agents' totals (nothing counted twice)", () => {
    const agents = [
      agent("001-implementer-1", "", 3, 4, 5, 0.1),
      agent("002-implementer-2", "", 6, 7, 8, 0.2),
      agent("003-qc", "", 1, 1, 1, 0.3),
    ];
    const groups = summarizeAgentsByTicket(agents);
    const sum = (k) => groups.reduce((s, g) => s + g[k], 0);
    assert.equal(sum("inputTokens"), 10);
    assert.equal(sum("outputTokens"), 12);
    assert.equal(sum("cacheReadTokens"), 14);
    assert.ok(Math.abs(sum("costUsd") - 0.6) < 1e-9);
  });
});

describe("Claude-only models", () => {
  it("offers only opus, sonnet and haiku", () => {
    for (const m of MODEL_OPTIONS) assert.match(m.value, /^(opus|sonnet|haiku)(:(low|medium|high|xhigh|max))?$/);
  });
  it("normalises bare and full model ids", () => {
    assert.equal(findModelChoice("opus").value, "opus:high");
    assert.equal(findModelChoice("sonnet:high").value, "sonnet:high");
    assert.equal(findModelChoice("claude-haiku-4-5").value, "haiku");
    assert.equal(findModelChoice(undefined).value, "opus:high");
    assert.equal(findModelChoice("gpt-4").value, "opus:high");
    assert.equal(formatModelLabel("opus:max"), "Claude Opus · Max");
    assert.equal(formatModelLabel("claude-sonnet-4-6"), "Claude Sonnet");
  });
});

describe("BA-only session skill", () => {
  it("has /new-ba as the only skill", () => {
    assert.deepEqual(
      SESSION_SKILLS.map((s) => [s.slash, s.mode]),
      [["/new-ba", "ba"]],
    );
  });
  it("prefixes a request with /new-ba exactly once", () => {
    assert.equal(toBaPrompt("Export a replay"), "/new-ba Export a replay");
    assert.equal(toBaPrompt("/new-ba Export a replay"), "/new-ba Export a replay");
    assert.equal(toBaPrompt("/ba  Export"), "/new-ba Export");
    assert.equal(toBaPrompt(""), "/new-ba");
  });
  it("does not treat other slash commands as /new-ba", () => {
    assert.equal(detectSkillFromPrompt("/factory build it"), null);
    assert.equal(detectSkillFromPrompt("/new-bar x"), null);
  });
});
