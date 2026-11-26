#!/usr/bin/env node
// Software Factory v2 — Zero-dependency Parallel Node Orchestrator.
// Code owns the skeleton (preflight, worktrees, APFS clone, fail-fast gates, Anti-Bloat,
// Pre-Merge Verification Queue, state.json resume, watchdog).
// Agents own judgment only (Builder, Reviewer, Blind Evaluator).
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { runAgent } from "./adapters/index.mjs";
import { mapFailuresToTracks, runBlindEvaluator } from "./evaluator.mjs";
import { runFullStagingChecks, runTrackGates } from "./gates.mjs";
import { MergeQueue } from "./merge-queue.mjs";
import { runPreflight } from "./preflight.mjs";
import {
  addUsage,
  batchDir,
  createInitialState,
  loadState,
  recordEvent,
  saveState,
} from "./state.mjs";
import { notifyMac, runWithWatchdog } from "./watchdog.mjs";
import {
  commitOwnedChanges,
  createTrackWorktree,
  ensureStagingBranch,
  getDiffAgainst,
  git,
  removeTrackWorktree,
} from "./worktree.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROLES_DIR = join(__dirname, "..", "roles");
const SCHEMAS_DIR = join(__dirname, "..", "schemas");

function readOptional(filePath, maxBytes = 12000) {
  if (!filePath || !existsSync(filePath)) return "";
  const txt = readFileSync(filePath, "utf8");
  return txt.length <= maxBytes ? txt : txt.slice(0, maxBytes) + "\n... [truncated]";
}

function buildStaticPrefix(roleFile, repoDir, harness) {
  // Keeping this prefix byte-identical across builders maximizes Claude/Gemini prompt cache hits!
  const brief = readFileSync(join(ROLES_DIR, roleFile), "utf8");
  const agentsMd = readOptional(join(repoDir, "AGENTS.md"), 8000);
  const designMd = readOptional(join(repoDir, ".factory", "design.md"), 4000);
  const exemplars = (harness.exemplars || [])
    .slice(0, 2)
    .map((rel) => `### Exemplar: ${rel}\n\`\`\`\n${readOptional(join(repoDir, rel), 4000)}\n\`\`\``)
    .join("\n\n");

  return [
    brief,
    agentsMd ? `## Repository Map (AGENTS.md)\n${agentsMd}` : "",
    designMd ? `## Design System (.factory/design.md)\n${designMd}` : "",
    exemplars ? `## Code Exemplars (Match This Quality & Style)\n${exemplars}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildBuilderPrompt({ staticPrefix, batch, track, batchDirPath, feedback = null, attempt = 1 }) {
  const criteriaById = new Map((batch.criteria || []).map((c) => [c.id, c.text]));
  const criteriaLines = (track.criteria || [])
    .map((id) => `- ${id}: ${criteriaById.get(id) || "(see objective)"}`)
    .join("\n");

  const protoPath = track.prototypeFile ? join(batchDirPath, "prototype", track.prototypeFile) : null;
  const protoSnippet = protoPath ? readOptional(protoPath, 6000) : "";

  const parts = [
    staticPrefix,
    "---",
    `## Your Track: ${track.id} (Wave ${track.wave}, Size ${track.size || "M"}, Attempt ${attempt})`,
    `Objective: ${track.objective || track.title || track.id}`,
    `Allowed files (Owns — edit NOTHING else): ${(track.owns || []).join(", ")}`,
    track.contracts?.length ? `Contracts to use / follow:\n${track.contracts.map((c) => `- ${c}`).join("\n")}` : "",
    `Acceptance Criteria:\n${criteriaLines || "- Deliver track objective cleanly with tests."}`,
    protoSnippet ? `## Approved Prototype Reference\n\`\`\`\n${protoSnippet}\n\`\`\`` : "",
    feedback
      ? `## Failures From Previous Attempt (Fix Root Cause — Prefer Simplifying Over Patching)\n${feedback}`
      : "",
  ].filter(Boolean);

  return parts.join("\n\n");
}

function buildReviewerPrompt({ batch, track, worktreeDir, baseCommit, changedFiles }) {
  const brief = readFileSync(join(ROLES_DIR, "reviewer.md"), "utf8");
  const criteriaById = new Map((batch.criteria || []).map((c) => [c.id, c.text]));
  const criteriaLines = (track.criteria || [])
    .map((id) => `- ${id}: ${criteriaById.get(id) || ""}`)
    .join("\n");
  const diff = getDiffAgainst(worktreeDir, baseCommit, 55000);
  const securityNote =
    track.size === "L"
      ? "\nSECURITY PASS REQUIRED (Size L): check authz/authn, injection, secrets, XSS, unsafe state mutations."
      : "";

  return [
    brief,
    securityNote,
    `## Track Under Review: ${track.id} (${track.objective || track.title || ""})`,
    `Changed files: ${changedFiles.join(", ")}`,
    `Criteria:\n${criteriaLines}`,
    `## Diff Against Track Base\n\`\`\`diff\n${diff}\n\`\`\``,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function shouldSkipReviewer(track) {
  if (track.skipReview === true) return true;
  if (track.size === "S" && track.wave >= 2 && track.kind === "wiring") return true;
  return false;
}

function formatReport(state, batch) {
  const lines = [
    `# Factory v2 Report — ${batch.title || batch.id}`,
    "",
    `- **Status:** \`${state.status}\``,
    `- **Engine:** \`${state.engine}\``,
    `- **Staging Branch:** \`${state.stagingBranch}\``,
    `- **Total Cost:** \$${state.totalCostUsd.toFixed(4)} (${state.totalInputTokens} in / ${state.totalOutputTokens} out)`,
    "",
    "## Tracks",
    "| Track | Wave | Size | Status | Attempts | Cost |",
    "|---|---|---|---|---|---|",
  ];

  for (const t of batch.tracks) {
    const st = state.tracks[t.id];
    lines.push(
      `| ${t.id} | ${t.wave} | ${t.size || "M"} | \`${st.status}\` | ${st.attempts} | \$${st.costUsd.toFixed(4)} |`
    );
  }

  if (state.qc?.scores) {
    const s = state.qc.scores;
    lines.push(
      "",
      "## Blind Evaluator UI/UX Scores (4 Axes)",
      `- Design Quality: **${s.designQuality}/5**`,
      `- Originality / Fit: **${s.originality}/5**`,
      `- Craft: **${s.craft}/5**`,
      `- Functionality: **${s.functionality}/5**`
    );
  }

  const waiting = Object.values(state.tracks).filter((t) => t.status === "needs-decision");
  if (waiting.length) {
    lines.push("", "## Needs Decision (Human Action Required)");
    for (const w of waiting) {
      lines.push(`- **${w.id}**: ${w.question || w.lastError}`);
    }
  }

  const minors = Object.values(state.tracks).flatMap((t) =>
    (t.minorNotes || []).map((n) => `- (${t.id}) ${n}`)
  );
  if (minors.length) {
    lines.push("", "## Minor Notes (Non-blocking)", ...minors);
  }

  return lines.join("\n") + "\n";
}

export async function runBatchOrchestrator(options) {
  const {
    repoDir: rawRepoDir,
    batchId,
    engine = "claude",
    concurrency = 3,
    maxRetries = 2,
    pauseWave0 = false,
    skipQc = false,
    skipBrowserProbe = false,
    skipUiChecks = false,
    push = false,
    openPr = false,
    resume = false,
    log = (msg) => console.log(msg),
  } = options;

  const repoDir = resolve(rawRepoDir);
  const bDir = batchDir(repoDir, batchId);
  const batchFile = join(bDir, "batch.json");
  if (!existsSync(batchFile)) {
    throw new Error(`Batch file not found: ${batchFile}`);
  }
  const batch = JSON.parse(readFileSync(batchFile, "utf8"));

  // Stage 0: 15-second fail-fast Preflight
  log(`[preflight] checking ${repoDir}...`);
  const pre = await runPreflight(repoDir, batch, { skipQc, skipBrowserProbe, skipUiChecks });
  for (const w of pre.warnings) log(`[preflight][warn] ${w}`);
  if (!pre.ok) {
    const err = `Preflight failed:\n- ${pre.errors.join("\n- ")}`;
    log(`[preflight][FAIL] ${err}`);
    return { ok: false, status: "preflight_failed", error: err, state: null };
  }
  const harness = pre.harness;

  // Load or initialize state.json
  let state = resume ? loadState(repoDir, batchId) : null;
  if (!state) {
    state = createInitialState(batch, { engine });
  } else {
    state.engine = engine;
    // Reset in-flight tracks from crashed process back to pending (keeping branch & worktree!)
    for (const st of Object.values(state.tracks)) {
      if (["building", "gating", "reviewing", "merging"].includes(st.status)) {
        st.status = "pending";
      }
    }
    recordEvent(state, "resumed");
  }

  state.status = "running";
  ensureStagingBranch(repoDir, state.baseBranch, state.stagingBranch);
  saveState(repoDir, batchId, state);

  const mergeQueue = new MergeQueue({
    repoDir,
    batchId,
    stagingBranch: state.stagingBranch,
    harness,
    log,
  });

  const builderStaticPrefix = buildStaticPrefix("builder.md", repoDir, harness);
  const trackById = new Map(batch.tracks.map((t) => [t.id, t]));

  // Slot allocator for parallel worker pool (with pipeline overlapping!)
  const freeSlots = Array.from({ length: Math.max(1, concurrency) }, (_, i) => i);
  const slotWaiters = [];
  const acquireSlot = () =>
    freeSlots.length > 0
      ? Promise.resolve(freeSlots.shift())
      : new Promise((res) => slotWaiters.push(res));
  const releaseSlot = (slot) => {
    if (slotWaiters.length > 0) slotWaiters.shift()(slot);
    else freeSlots.push(slot);
  };

  async function executeTrack(track, externalFeedback = null) {
    const st = state.tracks[track.id];
    const startedAt = Date.now();
    if (!st.startedAt) st.startedAt = new Date().toISOString();

    let feedback = externalFeedback || st.lastError || null;
    const maxAttempts = Math.max(1, maxRetries + 1); // initial build + maxRetries fix rounds

    while (st.attempts < maxAttempts) {
      const slot = await acquireSlot();
      let slotReleased = false;
      const freeNow = () => {
        if (!slotReleased) {
          slotReleased = true;
          releaseSlot(slot);
        }
      };

      try {
        const wt = createTrackWorktree(repoDir, batchId, track.id, state.stagingBranch, slot);
        st.worktree = wt.path;
        st.attempts += 1;
        st.status = "building";
        recordEvent(state, "track_build_start", { trackId: track.id, attempt: st.attempts, slot });
        saveState(repoDir, batchId, state);

        const trackEnv = {
          ...process.env,
          PORT: String(wt.port),
          DATABASE_URL: `file:${wt.dbPath}`,
        };

        // 1. Builder Agent
        log(`[${track.id}] build attempt ${st.attempts}/${maxAttempts} (slot ${slot})...`);
        const prompt = buildBuilderPrompt({
          staticPrefix: builderStaticPrefix,
          batch,
          track,
          batchDirPath: bDir,
          feedback,
          attempt: st.attempts,
        });
        const buildRes = await runAgent({
          engine,
          role: "builder",
          size: track.size || "M",
          trackId: track.id,
          attempt: st.attempts,
          prompt,
          cwd: wt.path,
          schemaPath: join(SCHEMAS_DIR, "builder-out.json"),
          readOnly: false,
          maxBudgetUsd: track.size === "L" ? 4.0 : 2.5,
          env: trackEnv,
        });
        addUsage(state, track.id, buildRes.usage);

        if (!buildRes.ok) {
          feedback = `Builder failed:\n${buildRes.error}`;
          st.lastError = feedback;
          saveState(repoDir, batchId, state);
          freeNow();
          continue;
        }

        // 2. Deterministic Fail-Fast Script Gates (Owns + Anti-Bloat + Lint + Typecheck + Targeted Tests)
        st.status = "gating";
        saveState(repoDir, batchId, state);
        log(`[${track.id}] running deterministic script gates...`);
        const gateRes = await runTrackGates({
          worktreeDir: wt.path,
          baseCommit: wt.baseCommit,
          track,
          harness,
          env: trackEnv,
        });

        if (!gateRes.ok) {
          log(`[${track.id}] gate failed at ${gateRes.stage}`);
          feedback = gateRes.error;
          st.lastError = feedback;
          recordEvent(state, "track_gate_failed", { trackId: track.id, stage: gateRes.stage });
          saveState(repoDir, batchId, state);
          freeNow();
          continue;
        }

        // Checkpoint commit owned changes inside worktree
        commitOwnedChanges(
          wt.path,
          gateRes.changedFiles,
          `factory(${batchId}): ${track.id} attempt ${st.attempts}`
        );

        // Pipeline Overlapping: release build slot once Gates pass and Reviewer starts!
        freeNow();

        // 3. Reviewer Agent (fresh context, read-only, BLOCKER only; skipped for tiny wiring tracks)
        if (!shouldSkipReviewer(track)) {
          st.status = "reviewing";
          saveState(repoDir, batchId, state);
          log(`[${track.id}] running blind code & test reviewer...`);
          const revPrompt = buildReviewerPrompt({
            batch,
            track,
            worktreeDir: wt.path,
            baseCommit: wt.baseCommit,
            changedFiles: gateRes.changedFiles,
          });
          const revRes = await runAgent({
            engine,
            role: "reviewer",
            size: track.size || "M",
            trackId: track.id,
            attempt: st.attempts,
            prompt: revPrompt,
            cwd: wt.path,
            schemaPath: join(SCHEMAS_DIR, "review-out.json"),
            readOnly: true,
            maxBudgetUsd: track.size === "L" ? 2.5 : 1.5,
          });
          addUsage(state, track.id, revRes.usage);

          if (!revRes.ok) {
            feedback = `Reviewer error:\n${revRes.error}`;
            st.lastError = feedback;
            saveState(repoDir, batchId, state);
            continue;
          }

          const blockers = revRes.data?.blockers || [];
          st.minorNotes = revRes.data?.minorNotes || [];
          if (revRes.data?.verdict !== "pass" || blockers.length > 0) {
            log(`[${track.id}] reviewer found ${blockers.length} blocker(s)`);
            st.blockers = blockers;
            feedback = blockers
              .map((b) => `- [${b.category || "blocker"}] ${b.file || ""}: ${b.problem}${b.fix ? ` (Fix: ${b.fix})` : ""}`)
              .join("\n");
            st.lastError = feedback;
            recordEvent(state, "track_review_blockers", { trackId: track.id, count: blockers.length });
            saveState(repoDir, batchId, state);
            continue;
          }
        } else {
          log(`[${track.id}] skipping reviewer (small wiring track)`);
        }

        // 4. Pre-Merge Verification Queue into staging (staging stays green 100%)
        st.status = "merging";
        saveState(repoDir, batchId, state);
        const mergeRes = await mergeQueue.enqueue(track.id, wt.path, wt.branch, trackEnv);
        if (!mergeRes.ok) {
          log(`[${track.id}] merge-queue rejected (${mergeRes.stage}); staging untouched`);
          feedback = mergeRes.error;
          st.lastError = feedback;
          recordEvent(state, "track_merge_rejected", { trackId: track.id, stage: mergeRes.stage });
          saveState(repoDir, batchId, state);
          continue;
        }

        // Success! Clean up track worktree (staging holds the merged work)
        removeTrackWorktree(repoDir, wt.path, wt.branch);
        st.worktree = null;
        st.status = "merged";
        st.mergedCommit = mergeRes.mergedCommit;
        st.lastError = null;
        st.blockers = [];
        st.durationMs += Date.now() - startedAt;
        st.finishedAt = new Date().toISOString();
        recordEvent(state, "track_merged", { trackId: track.id, commit: mergeRes.mergedCommit });
        saveState(repoDir, batchId, state);
        return true;
      } finally {
        freeNow();
      }
    }

    // Exceeded max retries -> needs-decision (keep branch & worktree, do NOT fail sibling tracks!)
    st.status = "needs-decision";
    st.question = `Track ${track.id} failed after ${st.attempts} attempt(s). Last issue: ${(st.lastError || "unknown").slice(0, 400)}`;
    st.durationMs += Date.now() - startedAt;
    st.finishedAt = new Date().toISOString();
    recordEvent(state, "track_needs_decision", { trackId: track.id, reason: st.question });
    saveState(repoDir, batchId, state);
    notifyMac("Factory v2: Needs Decision", `${track.id} stopped after ${st.attempts} attempts.`);
    return false;
  }

  // DAG Wave / Dependency Scheduler (runs up to `concurrency` ready tracks in parallel)
  async function runReadyTracksLoop() {
    const running = new Map();

    const isBlockedByDep = (track) =>
      (track.dependsOn || []).some((dep) => state.tracks[dep]?.status === "needs-decision");

    const isReady = (track) => {
      const st = state.tracks[track.id];
      if (!st || st.status !== "pending") return false;
      if (isBlockedByDep(track)) return false;
      // Optional pause after Wave 0 before starting Wave 1+
      if (pauseWave0 && !state.wave0Approved && track.wave > 0) return false;
      return (track.dependsOn || []).every((dep) => state.tracks[dep]?.status === "merged");
    };

    while (true) {
      const ready = batch.tracks.filter((t) => isReady(t) && !running.has(t.id));
      for (const track of ready) {
        const p = executeTrack(track).finally(() => running.delete(track.id));
        running.set(track.id, p);
      }

      if (running.size === 0) break;
      await Promise.race(running.values());
    }
  }

  await runReadyTracksLoop();

  // Handle Early Visual Check pause after Wave 0
  const wave0Tracks = batch.tracks.filter((t) => t.wave === 0);
  const wave0Done = wave0Tracks.length > 0 && wave0Tracks.every((t) => state.tracks[t.id].status === "merged");
  const hasLaterWaves = batch.tracks.some((t) => t.wave > 0 && state.tracks[t.id].status === "pending");
  if (pauseWave0 && !state.wave0Approved && wave0Done && hasLaterWaves) {
    state.status = "paused_wave0";
    recordEvent(state, "paused_after_wave0");
    saveState(repoDir, batchId, state);
    notifyMac("Factory v2: Wave 0 Ready", "Review Wave 0 visual shell, then rerun with --resume.");
    const reportPath = join(bDir, "report.md");
    writeFileSync(reportPath, formatReport(state, batch), "utf8");
    return { ok: true, status: "paused_wave0", state, reportPath };
  }

  // Check if any track went to needs-decision
  const anyNeedsDecision = Object.values(state.tracks).some((t) => t.status === "needs-decision");
  if (anyNeedsDecision) {
    state.status = "needs_decision";
    state.finishedAt = new Date().toISOString();
    saveState(repoDir, batchId, state);
    const reportPath = join(bDir, "report.md");
    writeFileSync(reportPath, formatReport(state, batch), "utf8");
    return { ok: false, status: "needs_decision", state, reportPath };
  }

  // Phase 5: Full Staging Build/Checks + Blind Evaluator QC (with max 2 QC fix rounds)
  state.status = "qc";
  saveState(repoDir, batchId, state);

  const maxQcRounds = skipQc ? 0 : 2;
  let qcPassed = skipQc;
  if (skipQc) {
    state.qc.status = "skipped";
  }

  for (let round = 1; round <= maxQcRounds; round++) {
    log(`[staging] running full staging checks (round ${round}/${maxQcRounds})...`);
    const fullCheck = await runFullStagingChecks(mergeQueue.stagingWorktree, harness);
    if (!fullCheck.ok) {
      log(`[staging] full check failed at ${fullCheck.failedStep}`);
      state.qc.status = "failed";
      state.qc.failures = [{ kind: "staging-check", problem: fullCheck.error }];
      saveState(repoDir, batchId, state);
      // Route staging build failure to last merged track
      const lastTrack = batch.tracks[batch.tracks.length - 1];
      const st = state.tracks[lastTrack.id];
      st.status = "pending";
      st.attempts = 0; // fresh repair budget for QC round
      const fixed = await executeTrack(lastTrack, fullCheck.error);
      if (!fixed) break;
      continue;
    }

    state.qc.attempts = round;
    state.qc.status = "running";
    saveState(repoDir, batchId, state);

    const evalRes = await runBlindEvaluator({
      stagingWorktreeDir: mergeQueue.stagingWorktree,
      batchDirPath: bDir,
      batch,
      harness,
      engine,
      attempt: round,
      skipServer: engine === "mock" || skipBrowserProbe,
      log,
    });
    addUsage(state, "__qc__", evalRes.usage);

    state.qc.scores = evalRes.data?.scores || null;
    state.qc.criteria = evalRes.data?.criteria || [];
    state.qc.failures = evalRes.failures || [];
    state.qc.screenshots = (evalRes.capture?.shots || []).map((s) => s.path);
    state.qc.consoleErrors = evalRes.capture?.consoleErrors || [];

    if (evalRes.passed) {
      state.qc.status = "passed";
      qcPassed = true;
      recordEvent(state, "qc_passed", { round, scores: state.qc.scores });
      saveState(repoDir, batchId, state);
      break;
    }

    state.qc.status = "failed";
    recordEvent(state, "qc_failed", { round, count: (evalRes.failures || []).length });
    saveState(repoDir, batchId, state);

    if (round >= maxQcRounds) break;

    // Route QC failures directly to the owning track(s)
    const routed = mapFailuresToTracks(evalRes.failures || [], batch);
    for (const [tid, problems] of routed.entries()) {
      const tr = trackById.get(tid);
      if (!tr) continue;
      const st = state.tracks[tid];
      st.status = "pending";
      st.attempts = 0;
      st.qcRetries += 1;
      await executeTrack(tr, `Blind QC Round ${round} failures:\n- ${problems.join("\n- ")}`);
    }
    if (Object.values(state.tracks).some((t) => t.status === "needs-decision")) {
      break;
    }
  }

  // Final outcome
  const stillNeedsDecision = Object.values(state.tracks).some((t) => t.status === "needs-decision");
  state.status = stillNeedsDecision ? "needs_decision" : qcPassed ? "passed" : "failed";
  state.finishedAt = new Date().toISOString();
  saveState(repoDir, batchId, state);

  const reportPath = join(bDir, "report.md");
  writeFileSync(reportPath, formatReport(state, batch), "utf8");

  // Optional push & PR creation ONLY when passed
  if (state.status === "passed" && (push || openPr)) {
    const pushRes = git(repoDir, ["push", "-u", "origin", state.stagingBranch]);
    if (pushRes.ok && openPr) {
      const prRes = await runWithWatchdog(
        "gh",
        [
          "pr",
          "create",
          "--base",
          state.baseBranch,
          "--head",
          state.stagingBranch,
          "--title",
          batch.title || batch.id,
          "--body-file",
          reportPath,
        ],
        { cwd: repoDir, idleTimeoutMs: 60_000 }
      );
      if (prRes.exitCode === 0) {
        state.pr = { url: prRes.stdout.trim() };
        saveState(repoDir, batchId, state);
      }
    }
  }

  // Clean up staging worktree on clean pass
  if (state.status === "passed") {
    removeTrackWorktree(repoDir, mergeQueue.stagingWorktree);
  }

  log(`[done] batch ${batchId} finished with status="${state.status}" (cost \$${state.totalCostUsd.toFixed(4)})`);
  return { ok: state.status === "passed", status: state.status, state, reportPath };
}

// CLI Entrypoint
if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  const { values } = parseArgs({
    options: {
      repo: { type: "string", default: process.cwd() },
      batch: { type: "string" },
      engine: { type: "string", default: "claude" },
      concurrency: { type: "string", default: "3" },
      "max-retries": { type: "string", default: "2" },
      "pause-wave0": { type: "boolean", default: false },
      "approve-wave0": { type: "boolean", default: false },
      "skip-qc": { type: "boolean", default: false },
      "skip-browser-probe": { type: "boolean", default: false },
      push: { type: "boolean", default: false },
      pr: { type: "boolean", default: false },
      resume: { type: "boolean", default: false },
    },
  });

  if (!values.batch) {
    console.error("Usage: node index.mjs --repo <dir> --batch <batch-id> [--engine claude|antigravity] [--concurrency 3] [--resume]");
    process.exit(2);
  }

  if (values["approve-wave0"]) {
    const existing = loadState(resolve(values.repo), values.batch);
    if (existing) {
      existing.wave0Approved = true;
      saveState(resolve(values.repo), values.batch, existing);
    }
  }

  const res = await runBatchOrchestrator({
    repoDir: values.repo,
    batchId: values.batch,
    engine: values.engine,
    concurrency: Number(values.concurrency),
    maxRetries: Number(values["max-retries"]),
    pauseWave0: values["pause-wave0"],
    skipQc: values["skip-qc"],
    skipBrowserProbe: values["skip-browser-probe"],
    push: values.push,
    openPr: values.pr,
    resume: values.resume || values["approve-wave0"],
  });

  process.exit(res.ok ? 0 : 1);
}
