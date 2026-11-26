// Git worktree isolation + APFS copy-on-write cloning (node_modules, .next/cache, tsbuildinfo).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";

export function git(cwd, args, options = {}) {
  const res = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
  return {
    ok: res.status === 0,
    exitCode: res.status ?? 1,
    stdout: (res.stdout || "").trim(),
    stderr: (res.stderr || "").trim(),
  };
}

export function gitOrThrow(cwd, args) {
  const r = git(cwd, args);
  if (!r.ok) {
    throw new Error(`git ${args.join(" ")} failed (${r.exitCode}): ${r.stderr || r.stdout}`);
  }
  return r.stdout;
}

export function ensureStagingBranch(repoDir, baseBranch, stagingBranch) {
  const exists = git(repoDir, ["rev-parse", "--verify", stagingBranch]);
  if (!exists.ok) {
    gitOrThrow(repoDir, ["branch", stagingBranch, baseBranch]);
  }
  return gitOrThrow(repoDir, ["rev-parse", stagingBranch]);
}

function cowClone(src, dest) {
  if (!existsSync(src) || existsSync(dest)) return false;
  mkdirSync(dirname(dest), { recursive: true });
  if (process.platform === "darwin") {
    const res = spawnSync("cp", ["-cR", src, dest], { encoding: "utf8" });
    if (res.status === 0) return true;
  }
  // Linux btrfs/xfs reflink attempt, otherwise symlink for node_modules
  if (process.platform === "linux") {
    const res = spawnSync("cp", ["--reflink=auto", "-a", src, dest], { encoding: "utf8" });
    if (res.status === 0) return true;
  }
  try {
    symlinkSync(src, dest);
    return true;
  } catch {
    return false;
  }
}

export function worktreesRoot(repoDir, batchId) {
  return join(repoDir, ".factory", "worktrees", batchId);
}

export function createTrackWorktree(repoDir, batchId, trackId, stagingBranch, slotIndex = 0) {
  const wtRoot = worktreesRoot(repoDir, batchId);
  mkdirSync(wtRoot, { recursive: true });
  const wtPath = join(wtRoot, trackId);
  const branchName = `track/${batchId}/${trackId}`;

  // Reuse existing worktree on resume if intact
  if (existsSync(wtPath) && git(wtPath, ["rev-parse", "--is-inside-work-tree"]).ok) {
    return {
      path: wtPath,
      branch: branchName,
      baseCommit: gitOrThrow(wtPath, ["merge-base", stagingBranch, "HEAD"]),
      port: 3101 + slotIndex,
      dbPath: join(wtPath, ".factory-test.db"),
      reused: true,
    };
  }

  // Clean stale worktree registration if needed
  git(repoDir, ["worktree", "prune"]);
  if (existsSync(wtPath)) {
    rmSync(wtPath, { recursive: true, force: true });
  }

  const branchExists = git(repoDir, ["rev-parse", "--verify", branchName]).ok;
  if (branchExists) {
    gitOrThrow(repoDir, ["worktree", "add", wtPath, branchName]);
  } else {
    gitOrThrow(repoDir, ["worktree", "add", "-b", branchName, wtPath, stagingBranch]);
  }

  // APFS copy-on-write clone of node_modules and build caches (<0.3s, 0 extra disk on macOS)
  cowClone(join(repoDir, "node_modules"), join(wtPath, "node_modules"));
  cowClone(join(repoDir, ".next", "cache"), join(wtPath, ".next", "cache"));
  cowClone(join(repoDir, "tsconfig.tsbuildinfo"), join(wtPath, "tsconfig.tsbuildinfo"));

  const baseCommit = gitOrThrow(wtPath, ["rev-parse", "HEAD"]);
  return {
    path: wtPath,
    branch: branchName,
    baseCommit,
    port: 3101 + slotIndex,
    dbPath: join(wtPath, ".factory-test.db"),
    reused: false,
  };
}

export function removeTrackWorktree(repoDir, wtPath, branchName = null) {
  if (wtPath && existsSync(wtPath)) {
    const res = git(repoDir, ["worktree", "remove", "--force", wtPath]);
    if (!res.ok) {
      rmSync(wtPath, { recursive: true, force: true });
      git(repoDir, ["worktree", "prune"]);
    }
  }
  if (branchName) {
    git(repoDir, ["branch", "-D", branchName]);
  }
}

export function listChangedFilesSince(worktreeDir, baseCommit) {
  const tracked = git(worktreeDir, ["diff", "--name-only", baseCommit]);
  const staged = git(worktreeDir, ["diff", "--cached", "--name-only"]);
  const untracked = git(worktreeDir, ["ls-files", "--others", "--exclude-standard"]);
  const set = new Set();
  for (const res of [tracked, staged, untracked]) {
    if (!res.ok || !res.stdout) continue;
    for (const line of res.stdout.split(/\r?\n/)) {
      const f = line.trim().replace(/\\/g, "/");
      if (f) set.add(f);
    }
  }
  return [...set].sort();
}

export function commitOwnedChanges(worktreeDir, files, message) {
  if (!files.length) return null;
  gitOrThrow(worktreeDir, ["add", "--", ...files]);
  const status = git(worktreeDir, ["diff", "--cached", "--name-only"]);
  if (!status.stdout) return null;
  gitOrThrow(worktreeDir, ["commit", "-m", message]);
  return gitOrThrow(worktreeDir, ["rev-parse", "HEAD"]);
}

export function getDiffAgainst(worktreeDir, baseCommit, maxBytes = 60000) {
  const res = git(worktreeDir, ["diff", baseCommit]);
  const diff = res.stdout || "";
  if (diff.length <= maxBytes) return diff;
  return diff.slice(0, maxBytes) + `\n... [diff truncated at ${maxBytes} bytes]`;
}

export function isGitRepo(dir) {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: dir, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
