import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  computeAgyResultTokenDelta,
  copyUncommittedFactoryArtifacts,
  readLocalPlanForSync,
  readPerRunStateFile,
} from "../cli/sf.ts";

describe("Antigravity multi-turn token accounting", () => {
  it("eliminates quadratic double-counting across resumed multi-turn conversations", () => {
    // Reproduces the exact 4-turn conversation (6f0f9cff) where legacy code inflated
    // root input tokens from 200,318 -> 530,391 (+ 167,660 child = 698,051 instead of 367,978).
    const turns = [
      {
        turnReported: { inputTokens: 70_728, outputTokens: 6_870, cacheReadTokens: 12_000 },
        resultUsage: { inputTokens: 70_728, outputTokens: 6_870, cacheReadTokens: 12_000 },
      },
      {
        turnReported: { inputTokens: 2_804, outputTokens: 3_183, cacheReadTokens: 4_000 },
        resultUsage: { inputTokens: 73_532, outputTokens: 10_053, cacheReadTokens: 16_000 },
      },
      {
        turnReported: { inputTokens: 112_281, outputTokens: 43_496, cacheReadTokens: 50_000 },
        resultUsage: { inputTokens: 185_813, outputTokens: 53_549, cacheReadTokens: 66_000 },
      },
      {
        turnReported: { inputTokens: 14_505, outputTokens: 18_000, cacheReadTokens: 8_000 },
        resultUsage: { inputTokens: 200_318, outputTokens: 71_549, cacheReadTokens: 74_000 },
      },
    ];

    let prior = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
    let dbTotalIn = 0;
    let dbTotalOut = 0;
    let dbTotalCache = 0;

    for (const turn of turns) {
      dbTotalIn += turn.turnReported.inputTokens;
      dbTotalOut += turn.turnReported.outputTokens;
      dbTotalCache += turn.turnReported.cacheReadTokens;

      const delta = computeAgyResultTokenDelta({
        resultUsage: turn.resultUsage,
        priorCumulative: prior,
        turnReported: turn.turnReported,
      });

      assert.equal(delta.remIn, 0);
      assert.equal(delta.remOut, 0);
      assert.equal(delta.remCache, 0);

      dbTotalIn += delta.remIn;
      dbTotalOut += delta.remOut;
      dbTotalCache += delta.remCache;
      prior = delta.nextCumulative;
    }

    assert.equal(dbTotalIn, 200_318);
    assert.equal(dbTotalOut, 71_549);
    assert.equal(dbTotalCache, 74_000);
    assert.deepEqual(prior, { inputTokens: 200_318, outputTokens: 71_549, cacheReadTokens: 74_000 });
  });

  it("still captures genuinely unreported residual tokens when result.usage exceeds steps", () => {
    const delta = computeAgyResultTokenDelta({
      priorCumulative: { inputTokens: 50_000, outputTokens: 5_000, cacheReadTokens: 10_000 },
      turnReported: { inputTokens: 12_000, outputTokens: 1_500, cacheReadTokens: 2_000 },
      resultUsage: { inputTokens: 66_500, outputTokens: 7_200, cacheReadTokens: 12_500 },
    });

    assert.equal(delta.remIn, 4_500);
    assert.equal(delta.remOut, 700);
    assert.equal(delta.remCache, 500);
    assert.deepEqual(delta.nextCumulative, {
      inputTokens: 66_500,
      outputTokens: 7_200,
      cacheReadTokens: 12_500,
    });
  });
});

describe("Uncommitted .factory/ artifact sync & per-run state isolation", () => {
  it("copies uncommitted plans, prototypes, and mockups into isolated git worktree", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "sf-base-"));
    const workDir = mkdtempSync(join(tmpdir(), "sf-wt-"));
    try {
      mkdirSync(join(baseDir, ".factory", "plans"), { recursive: true });
      mkdirSync(join(baseDir, ".factory", "prototypes", "task-list-i1"), { recursive: true });
      mkdirSync(join(baseDir, ".factory", "design", "mockups"), { recursive: true });

      writeFileSync(join(baseDir, ".factory", "plans", "I1.json"), '{"issueKey":"I1"}\n');
      writeFileSync(
        join(baseDir, ".factory", "prototypes", "task-list-i1", "index.html"),
        "<h1>Proto</h1>",
      );
      writeFileSync(join(baseDir, ".factory", "design", "mockups", "screen.html"), "<main/>");

      const copied = copyUncommittedFactoryArtifacts(baseDir, workDir);
      assert.equal(copied.length, 3);
      assert.equal(
        readFileSync(join(workDir, ".factory", "plans", "I1.json"), "utf8"),
        '{"issueKey":"I1"}\n',
      );
      assert.equal(
        readFileSync(join(workDir, ".factory", "prototypes", "task-list-i1", "index.html"), "utf8"),
        "<h1>Proto</h1>",
      );
      assert.equal(
        readFileSync(join(workDir, ".factory", "design", "mockups", "screen.html"), "utf8"),
        "<main/>",
      );
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("reads isolated per-run state.json without cross-run collisions", () => {
    const repoDir = mkdtempSync(join(tmpdir(), "sf-runs-"));
    try {
      const r1Dir = join(repoDir, ".factory", "runs", "2026-11-26-i1-aaaa");
      const r2Dir = join(repoDir, ".factory", "runs", "2026-11-26-i2-bbbb");
      mkdirSync(r1Dir, { recursive: true });
      mkdirSync(r2Dir, { recursive: true });

      writeFileSync(
        join(r1Dir, "state.json"),
        JSON.stringify({
          id: "2026-11-26-i1-aaaa",
          outcome: "passed",
          reason: "All checks passed",
          merge: { decision: "auto" },
          risk: { level: "low" },
        }),
      );
      writeFileSync(
        join(r2Dir, "state.json"),
        JSON.stringify({
          id: "2026-11-26-i2-bbbb",
          outcome: "blocked",
          reason: "Missing DB env",
        }),
      );

      const s1 = readPerRunStateFile([repoDir], "2026-11-26-i1-aaaa");
      const s2 = readPerRunStateFile([repoDir], "2026-11-26-i2-bbbb");
      assert.equal(s1?.outcome, "passed");
      assert.equal(s1?.mergeDecision, "auto");
      assert.equal(s1?.risk, "low");
      assert.equal(s2?.outcome, "blocked");
      assert.equal(s2?.reason, "Missing DB env");
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it("extracts clarified plan criteria from .factory/plans/<issueKey>.json for Kanban auto-sync", () => {
    const repoDir = mkdtempSync(join(tmpdir(), "sf-plan-"));
    try {
      mkdirSync(join(repoDir, ".factory", "plans"), { recursive: true });
      writeFileSync(
        join(repoDir, ".factory", "plans", "I1.json"),
        JSON.stringify({
          issueKey: "I1",
          title: "Interactive task list",
          objective: "Render filterable task list with empty & error states",
          criteria: [
            { id: "C1", text: "Tasks render from /api/tasks with status badge" },
            { id: "C2", text: "Empty state shows clear CTA" },
          ],
          specs: [{ id: "S1", title: "Task list UI" }],
        }),
      );

      const synced = readLocalPlanForSync(repoDir, "I1", Date.now() - 5000);
      assert.equal(synced.length, 1);
      assert.equal(synced[0].issueKey, "I1");
      assert.equal(synced[0].title, "Interactive task list");
      assert.equal(Array.isArray(synced[0].criteria), true);
      assert.equal(synced[0].criteria.length, 2);
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });
});
