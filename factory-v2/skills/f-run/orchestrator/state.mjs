// Atomic batch state persistence (`state.json`) for checkpointing & resume.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function batchDir(repoDir, batchId) {
  return join(repoDir, ".factory", "batches", batchId);
}

export function statePath(repoDir, batchId) {
  return join(batchDir(repoDir, batchId), "state.json");
}

export function createInitialState(batch, options = {}) {
  const now = new Date().toISOString();
  const tracks = {};
  for (const t of batch.tracks) {
    tracks[t.id] = {
      id: t.id,
      wave: t.wave,
      size: t.size || "M",
      status: "pending", // pending | building | gating | reviewing | merging | merged | needs-decision
      attempts: 0,
      qcRetries: 0,
      branch: `track/${batch.id}/${t.id}`,
      worktree: null,
      lastError: null,
      blockers: [],
      minorNotes: [],
      question: null,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
      startedAt: null,
      finishedAt: null,
      mergedCommit: null,
    };
  }

  return {
    schemaVersion: 2,
    batchId: batch.id,
    title: batch.title || batch.id,
    engine: options.engine || "claude",
    baseBranch: batch.baseBranch || "main",
    stagingBranch: options.stagingBranch || `factory/${batch.id}`,
    status: "initialized", // initialized | running | paused_wave0 | qc | passed | needs_decision | failed
    wave0Approved: false,
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
    totalCostUsd: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    tracks,
    qc: {
      attempts: 0,
      status: "pending", // pending | running | passed | failed | skipped
      scores: null,
      screenshots: [],
      consoleErrors: [],
      criteria: [],
      failures: [],
      costUsd: 0,
    },
    pr: null,
    events: [],
  };
}

export function loadState(repoDir, batchId) {
  const file = statePath(repoDir, batchId);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8"));
}

export function saveState(repoDir, batchId, state) {
  const file = statePath(repoDir, batchId);
  mkdirSync(dirname(file), { recursive: true });
  state.updatedAt = new Date().toISOString();
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", "utf8");
  renameSync(tmp, file);
}

export function recordEvent(state, type, detail = {}) {
  state.events.push({
    at: new Date().toISOString(),
    type,
    ...detail,
  });
  if (state.events.length > 500) {
    state.events = state.events.slice(-500);
  }
}

export function addUsage(state, trackId, usage) {
  if (!usage) return;
  const cost = Number(usage.costUsd || 0);
  const inp = Number(usage.inputTokens || 0);
  const out = Number(usage.outputTokens || 0);
  state.totalCostUsd = Number((state.totalCostUsd + cost).toFixed(6));
  state.totalInputTokens += inp;
  state.totalOutputTokens += out;
  if (trackId && state.tracks[trackId]) {
    state.tracks[trackId].costUsd = Number((state.tracks[trackId].costUsd + cost).toFixed(6));
    state.tracks[trackId].inputTokens += inp;
    state.tracks[trackId].outputTokens += out;
  } else if (trackId === "__qc__") {
    state.qc.costUsd = Number((state.qc.costUsd + cost).toFixed(6));
  }
}
