import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { setMockHandler } from "../skills/f-run/orchestrator/adapters/mock.mjs";
import { runBatchOrchestrator } from "../skills/f-run/orchestrator/index.mjs";
import { loadState, saveState } from "../skills/f-run/orchestrator/state.mjs";

function initTempGitRepo(harness = {}) {
  const dir = mkdtempSync(join(tmpdir(), "factory-v2-orch-"));
  const runGit = (...args) =>
    execFileSync("git", args, { cwd: dir, stdio: "pipe", encoding: "utf8" }).trim();

  runGit("init", "-b", "main");
  runGit("config", "user.email", "test@factory.local");
  runGit("config", "user.name", "Factory Test");

  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, ".factory"), { recursive: true });
  writeFileSync(join(dir, "AGENTS.md"), "# Test Repo\nKeep code clean.\n");
  writeFileSync(
    join(dir, ".factory/harness.json"),
    JSON.stringify({ schemaVersion: 2, hasUi: false, commands: {}, ...harness }, null, 2)
  );
  writeFileSync(join(dir, "src/index.js"), "export const version = 1;\n");
  runGit("add", ".");
  runGit("commit", "-m", "initial commit");
  return { dir, runGit };
}

function writeBatch(repoDir, batch) {
  const bDir = join(repoDir, ".factory/batches", batch.id);
  mkdirSync(bDir, { recursive: true });
  writeFileSync(join(bDir, "batch.json"), JSON.stringify(batch, null, 2));
  writeFileSync(join(bDir, "holdout.md"), "# Holdout\nH1: verify everything works.\n");
}

describe("Factory v2 Parallel Orchestrator (real Git worktrees)", () => {
  it("runs Wave 0 -> 3 parallel Wave 1 tracks -> Wave 2 wiring (skipping reviewer) -> Blind Evaluator PASS", async () => {
    const { dir, runGit } = initTempGitRepo();
    const batch = {
      id: "parallel-happy",
      title: "Parallel Happy Path",
      baseBranch: "main",
      hasUi: false,
      criteria: [
        { id: "C1", text: "Foundation types" },
        { id: "C2", text: "Feature A" },
        { id: "C3", text: "Feature B" },
        { id: "C4", text: "Feature C" },
        { id: "C5", text: "Wiring" },
      ],
      tracks: [
        { id: "T0", wave: 0, size: "M", dependsOn: [], owns: ["src/types.js"], criteria: ["C1"] },
        { id: "T1", wave: 1, size: "M", dependsOn: ["T0"], owns: ["src/a.js", "src/a.test.js"], criteria: ["C2"] },
        { id: "T2", wave: 1, size: "M", dependsOn: ["T0"], owns: ["src/b.js", "src/b.test.js"], criteria: ["C3"] },
        { id: "T3", wave: 1, size: "M", dependsOn: ["T0"], owns: ["src/c.js", "src/c.test.js"], criteria: ["C4"] },
        { id: "T4", wave: 2, size: "S", kind: "wiring", dependsOn: ["T1", "T2", "T3"], owns: ["src/index.js"], criteria: ["C5"] },
      ],
    };
    writeBatch(dir, batch);

    let activeBuilders = 0;
    let peakConcurrency = 0;
    const reviewedTracks = [];

    setMockHandler(async ({ role, trackId, cwd }) => {
      if (role === "builder") {
        activeBuilders += 1;
        peakConcurrency = Math.max(peakConcurrency, activeBuilders);
        await new Promise((r) => setTimeout(r, 80));
        if (trackId === "T0") writeFileSync(join(cwd, "src/types.js"), "export const KIND = 'todo';\n");
        if (trackId === "T1") {
          writeFileSync(join(cwd, "src/a.js"), "export const a = () => 'A';\n");
          writeFileSync(join(cwd, "src/a.test.js"), "assert(true); expect(1).toBe(1);\n");
        }
        if (trackId === "T2") {
          writeFileSync(join(cwd, "src/b.js"), "export const b = () => 'B';\n");
          writeFileSync(join(cwd, "src/b.test.js"), "expect(2).toBe(2);\n");
        }
        if (trackId === "T3") {
          writeFileSync(join(cwd, "src/c.js"), "export const c = () => 'C';\n");
          writeFileSync(join(cwd, "src/c.test.js"), "expect(3).toBe(3);\n");
        }
        if (trackId === "T4") {
          writeFileSync(join(cwd, "src/index.js"), "export { a } from './a.js'; export { b } from './b.js'; export { c } from './c.js';\n");
        }
        activeBuilders -= 1;
        return { ok: true, data: { status: "done", summary: `built ${trackId}`, filesChanged: [], testsAdded: [] } };
      }
      if (role === "reviewer") {
        reviewedTracks.push(trackId);
        return { ok: true, data: { verdict: "pass", blockers: [], minorNotes: [] } };
      }
      if (role === "evaluator") {
        return {
          ok: true,
          data: {
            verdict: "pass",
            scores: { designQuality: 5, originality: 4, craft: 5, functionality: 5 },
            visualCritique: "Clean layout.",
            criteria: batch.criteria.map((c) => ({ id: c.id, status: "met", evidence: "verified" })),
          },
        };
      }
      return { ok: false, error: `unexpected role ${role}` };
    });

    try {
      const res = await runBatchOrchestrator({
        repoDir: dir,
        batchId: batch.id,
        engine: "mock",
        concurrency: 3,
        maxRetries: 2,
        log: () => {},
      });

      assert.equal(res.ok, true);
      assert.equal(res.status, "passed");
      assert.equal(peakConcurrency, 3, `Expected 3 concurrent Wave 1 builders, saw ${peakConcurrency}`);
      assert.ok(!reviewedTracks.includes("T4"), "Wave 2 size-S wiring track should skip reviewer");

      // Verify all files landed cleanly on staging branch while main stayed untouched!
      const stagingFiles = runGit("ls-tree", "-r", "--name-only", "factory/parallel-happy").split("\n");
      for (const f of ["src/types.js", "src/a.js", "src/b.js", "src/c.js", "src/index.js"]) {
        assert.ok(stagingFiles.includes(f), `Missing ${f} on staging`);
      }
      const mainFiles = runGit("ls-tree", "-r", "--name-only", "main").split("\n");
      assert.ok(!mainFiles.includes("src/a.js"), "main branch must remain untouched");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("isolates a needs-decision track while sibling track completes, then resumes cleanly", async () => {
    const { dir } = initTempGitRepo();
    const batch = {
      id: "resume-isolation",
      title: "Isolation & Resume",
      baseBranch: "main",
      hasUi: false,
      criteria: [
        { id: "C1", text: "Track A" },
        { id: "C2", text: "Track B" },
      ],
      tracks: [
        { id: "TA", wave: 0, size: "M", dependsOn: [], owns: ["src/a.js"], criteria: ["C1"] },
        { id: "TB", wave: 0, size: "M", dependsOn: [], owns: ["src/b.js"], criteria: ["C2"] },
      ],
    };
    writeBatch(dir, batch);

    let allowTbPass = false;
    setMockHandler(async ({ role, trackId, cwd }) => {
      if (role === "builder") {
        if (trackId === "TA") {
          writeFileSync(join(cwd, "src/a.js"), "export const a = 1;\n");
        } else {
          // Fail Anti-Bloat on first run via @ts-ignore until allowTbPass is true
          writeFileSync(
            join(cwd, "src/b.js"),
            allowTbPass ? "export const b = 2;\n" : "// @ts-ignore\nexport const b = 2;\n"
          );
        }
        return { ok: true, data: { status: "done", summary: trackId, filesChanged: [], testsAdded: [] } };
      }
      if (role === "reviewer") {
        return { ok: true, data: { verdict: "pass", blockers: [], minorNotes: [] } };
      }
      if (role === "evaluator") {
        return {
          ok: true,
          data: {
            verdict: "pass",
            scores: { designQuality: 4, originality: 4, craft: 4, functionality: 5 },
            visualCritique: "Good.",
            criteria: [
              { id: "C1", status: "met", evidence: "ok" },
              { id: "C2", status: "met", evidence: "ok" },
            ],
          },
        };
      }
      return { ok: false, error: "unexpected" };
    });

    try {
      const first = await runBatchOrchestrator({
        repoDir: dir,
        batchId: batch.id,
        engine: "mock",
        concurrency: 2,
        maxRetries: 1,
        log: () => {},
      });

      assert.equal(first.ok, false);
      assert.equal(first.status, "needs_decision");
      assert.equal(first.state.tracks.TA.status, "merged", "Sibling TA must still finish and merge!");
      assert.equal(first.state.tracks.TB.status, "needs-decision");

      // Human resolves TB and resumes
      allowTbPass = true;
      const st = loadState(dir, batch.id);
      st.tracks.TB.status = "pending";
      st.tracks.TB.attempts = 0;
      saveState(dir, batch.id, st);

      const resumed = await runBatchOrchestrator({
        repoDir: dir,
        batchId: batch.id,
        engine: "mock",
        concurrency: 2,
        maxRetries: 1,
        resume: true,
        log: () => {},
      });

      assert.equal(resumed.ok, true);
      assert.equal(resumed.status, "passed");
      assert.equal(resumed.state.tracks.TA.attempts, 1, "TA must NOT be rebuilt on resume");
      assert.equal(resumed.state.tracks.TB.status, "merged");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("routes Blind Evaluator <4/5 UI score back to owning track and passes after fix", async () => {
    const { dir } = initTempGitRepo();
    const batch = {
      id: "qc-routing",
      title: "QC Routing Test",
      baseBranch: "main",
      hasUi: false,
      criteria: [{ id: "C1", text: "Clean UI" }],
      tracks: [{ id: "T0", wave: 0, size: "M", dependsOn: [], owns: ["src/ui.tsx"], criteria: ["C1"] }],
    };
    writeBatch(dir, batch);

    let evalCalls = 0;
    let sawQcFeedback = false;

    setMockHandler(async ({ role, prompt, cwd }) => {
      if (role === "builder") {
        if (prompt.includes("Blind QC Round 1 failures")) sawQcFeedback = true;
        writeFileSync(join(cwd, "src/ui.tsx"), `export const UI = () => "${sawQcFeedback ? "clean" : "cluttered"}";\n`);
        return { ok: true, data: { status: "done", summary: "ui", filesChanged: ["src/ui.tsx"], testsAdded: [] } };
      }
      if (role === "reviewer") {
        return { ok: true, data: { verdict: "pass", blockers: [], minorNotes: [] } };
      }
      if (role === "evaluator") {
        evalCalls += 1;
        if (evalCalls === 1) {
          return {
            ok: true,
            data: {
              verdict: "fail",
              scores: { designQuality: 3, originality: 4, craft: 4, functionality: 5 },
              visualCritique: "Form crushes list above the fold.",
              criteria: [{ id: "C1", status: "not_met", evidence: "designQuality < 4" }],
            },
          };
        }
        return {
          ok: true,
          data: {
            verdict: "pass",
            scores: { designQuality: 5, originality: 4, craft: 5, functionality: 5 },
            visualCritique: "Clean compact quick-add.",
            criteria: [{ id: "C1", status: "met", evidence: "all good" }],
          },
        };
      }
      return { ok: false, error: "unexpected" };
    });

    try {
      const res = await runBatchOrchestrator({
        repoDir: dir,
        batchId: batch.id,
        engine: "mock",
        concurrency: 1,
        maxRetries: 2,
        log: () => {},
      });
      assert.equal(res.ok, true);
      assert.equal(evalCalls, 2);
      assert.equal(sawQcFeedback, true);
      const report = readFileSync(res.reportPath, "utf8");
      assert.ok(report.includes("Design Quality: **5/5**"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("supports --pause-wave0 Early Visual Check and resumes Wave 1 after approval", async () => {
    const { dir } = initTempGitRepo();
    const batch = {
      id: "wave0-pause",
      title: "Wave 0 Pause",
      baseBranch: "main",
      hasUi: false,
      criteria: [
        { id: "C1", text: "Shell" },
        { id: "C2", text: "Feature" },
      ],
      tracks: [
        { id: "T0", wave: 0, size: "M", dependsOn: [], owns: ["src/shell.js"], criteria: ["C1"] },
        { id: "T1", wave: 1, size: "M", dependsOn: ["T0"], owns: ["src/feat.js"], criteria: ["C2"] },
      ],
    };
    writeBatch(dir, batch);

    setMockHandler(async ({ role, trackId, cwd }) => {
      if (role === "builder") {
        writeFileSync(join(cwd, trackId === "T0" ? "src/shell.js" : "src/feat.js"), "export const x = 1;\n");
        return { ok: true, data: { status: "done", summary: trackId, filesChanged: [], testsAdded: [] } };
      }
      if (role === "reviewer") return { ok: true, data: { verdict: "pass", blockers: [], minorNotes: [] } };
      return {
        ok: true,
        data: {
          verdict: "pass",
          scores: { designQuality: 5, originality: 5, craft: 5, functionality: 5 },
          visualCritique: "ok",
          criteria: [
            { id: "C1", status: "met", evidence: "ok" },
            { id: "C2", status: "met", evidence: "ok" },
          ],
        },
      };
    });

    try {
      const paused = await runBatchOrchestrator({
        repoDir: dir,
        batchId: batch.id,
        engine: "mock",
        pauseWave0: true,
        log: () => {},
      });
      assert.equal(paused.status, "paused_wave0");
      assert.equal(paused.state.tracks.T0.status, "merged");
      assert.equal(paused.state.tracks.T1.status, "pending");

      // Approve Wave 0 & resume
      const st = loadState(dir, batch.id);
      st.wave0Approved = true;
      saveState(dir, batch.id, st);

      const done = await runBatchOrchestrator({
        repoDir: dir,
        batchId: batch.id,
        engine: "mock",
        pauseWave0: true,
        resume: true,
        log: () => {},
      });
      assert.equal(done.ok, true);
      assert.equal(done.status, "passed");
      assert.equal(done.state.tracks.T1.status, "merged");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps staging clean when Pre-Merge Queue check fails after rebase, then recovers on retry", async () => {
    // Check command passes on Track B alone, fails when both src/a.js and incompatible src/b.js exist
    const checkCmd = `node -e "const fs=require('fs'); if(fs.existsSync('src/a.js')&&fs.existsSync('src/b.js')&&fs.readFileSync('src/b.js','utf8').includes('CONFLICT_SEMANTIC')) process.exit(1);"`;
    const { dir, runGit } = initTempGitRepo({ commands: { test: checkCmd } });
    const batch = {
      id: "premerge-guard",
      title: "Pre-Merge Guard",
      baseBranch: "main",
      hasUi: false,
      criteria: [
        { id: "C1", text: "A" },
        { id: "C2", text: "B" },
      ],
      tracks: [
        { id: "TA", wave: 0, size: "M", dependsOn: [], owns: ["src/a.js"], criteria: ["C1"] },
        { id: "TB", wave: 0, size: "M", dependsOn: [], owns: ["src/b.js"], criteria: ["C2"] },
      ],
    };
    writeBatch(dir, batch);

    let tbAttempts = 0;
    setMockHandler(async ({ role, trackId, cwd, prompt }) => {
      if (role === "builder") {
        if (trackId === "TA") {
          writeFileSync(join(cwd, "src/a.js"), "export const a = 1;\n");
        } else {
          tbAttempts += 1;
          await new Promise((r) => setTimeout(r, 120)); // Ensure TA merges into staging first
          const fixed = prompt.includes("Pre-merge check");
          writeFileSync(
            join(cwd, "src/b.js"),
            fixed ? "export const b = 2;\n" : "export const b = 'CONFLICT_SEMANTIC';\n"
          );
        }
        return { ok: true, data: { status: "done", summary: trackId, filesChanged: [], testsAdded: [] } };
      }
      if (role === "reviewer") return { ok: true, data: { verdict: "pass", blockers: [], minorNotes: [] } };
      return {
        ok: true,
        data: {
          verdict: "pass",
          scores: { designQuality: 5, originality: 5, craft: 5, functionality: 5 },
          visualCritique: "ok",
          criteria: [
            { id: "C1", status: "met", evidence: "ok" },
            { id: "C2", status: "met", evidence: "ok" },
          ],
        },
      };
    });

    try {
      const res = await runBatchOrchestrator({
        repoDir: dir,
        batchId: batch.id,
        engine: "mock",
        concurrency: 2,
        maxRetries: 2,
        log: () => {},
      });
      assert.equal(res.ok, true);
      assert.equal(tbAttempts, 2, "TB should fail pre-merge check once and succeed on attempt 2");
      const finalB = runGit("show", "factory/premerge-guard:src/b.js");
      assert.ok(!finalB.includes("CONFLICT_SEMANTIC"), "staging must only ever receive the clean fix");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
