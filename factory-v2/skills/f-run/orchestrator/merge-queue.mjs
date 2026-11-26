// Serialized Pre-Merge Verification Queue:
// Rebase track onto staging -> verify typecheck & unit tests BEFORE advancing staging.
// staging NEVER receives a broken commit (eliminates risky revert/revert-the-revert chains).
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runWithWatchdog } from "./watchdog.mjs";
import { git, gitOrThrow, worktreesRoot } from "./worktree.mjs";

export function ensureStagingWorktree(repoDir, batchId, stagingBranch) {
  const root = worktreesRoot(repoDir, batchId);
  mkdirSync(root, { recursive: true });
  const stPath = join(root, "_staging");
  if (existsSync(stPath) && git(stPath, ["rev-parse", "--is-inside-work-tree"]).ok) {
    return stPath;
  }
  git(repoDir, ["worktree", "prune"]);
  if (existsSync(stPath)) rmSync(stPath, { recursive: true, force: true });
  gitOrThrow(repoDir, ["worktree", "add", stPath, stagingBranch]);
  return stPath;
}

export class MergeQueue {
  constructor({ repoDir, batchId, stagingBranch, harness = {}, log = () => {} }) {
    this.repoDir = repoDir;
    this.batchId = batchId;
    this.stagingBranch = stagingBranch;
    this.harness = harness;
    this.log = log;
    this.stagingWorktree = ensureStagingWorktree(repoDir, batchId, stagingBranch);
    this._tail = Promise.resolve();
  }

  enqueue(trackId, worktreeDir, trackBranch, env = process.env) {
    const job = this._tail.then(() => this._process(trackId, worktreeDir, trackBranch, env));
    this._tail = job.catch(() => {});
    return job;
  }

  async _process(trackId, worktreeDir, trackBranch, env) {
    this.log(`[merge-queue] processing ${trackId} (${trackBranch} -> ${this.stagingBranch})`);

    // 1. Rebase track onto newest staging inside track worktree
    const rebase = git(worktreeDir, ["rebase", this.stagingBranch]);
    if (!rebase.ok) {
      git(worktreeDir, ["rebase", "--abort"]);
      return {
        ok: false,
        stage: "rebase-conflict",
        error: `Rebase onto ${this.stagingBranch} conflicted:\n${rebase.stderr || rebase.stdout}`,
      };
    }

    // 2. Fast Pre-Merge Verification (typecheck + unit tests) BEFORE advancing staging
    const verifyCmds = [];
    if (this.harness.commands?.typecheck) {
      verifyCmds.push({ name: "pre-merge-typecheck", cmd: this.harness.commands.typecheck });
    }
    if (this.harness.commands?.test) {
      verifyCmds.push({ name: "pre-merge-test", cmd: this.harness.commands.test });
    }

    for (const item of verifyCmds) {
      const res = await runWithWatchdog(item.cmd, [], {
        cwd: worktreeDir,
        env,
        shell: true,
        idleTimeoutMs: 4 * 60 * 1000,
      });
      if (res.exitCode !== 0) {
        return {
          ok: false,
          stage: item.name,
          error: `Pre-merge check "${item.name}" failed after rebasing onto ${this.stagingBranch}:\n$ ${item.cmd}\n${res.lastLines}`,
        };
      }
    }

    // 3. Only now merge cleanly into staging (--no-ff preserves clear track boundary)
    const merge = git(this.stagingWorktree, [
      "merge",
      "--no-ff",
      "-m",
      `factory(${this.batchId}): merge ${trackId}`,
      trackBranch,
    ]);
    if (!merge.ok) {
      git(this.stagingWorktree, ["merge", "--abort"]);
      return {
        ok: false,
        stage: "merge-failed",
        error: `Merge into ${this.stagingBranch} failed:\n${merge.stderr || merge.stdout}`,
      };
    }

    const mergedCommit = gitOrThrow(this.stagingWorktree, ["rev-parse", "HEAD"]);
    this.log(`[merge-queue] merged ${trackId} at ${mergedCommit.slice(0, 8)}`);
    return { ok: true, mergedCommit };
  }
}
