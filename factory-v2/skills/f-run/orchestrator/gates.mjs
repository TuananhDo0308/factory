// 100% deterministic Script Gates (0 LLM tokens):
// Fail-fast order: Owns & Protected -> Anti-Bloat Guard -> Scoped Lint -> Typecheck -> Targeted Tests.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runWithWatchdog } from "./watchdog.mjs";
import { listChangedFilesSince } from "./worktree.mjs";

const DEFAULT_PROTECTED = [
  ".github/workflows/**",
  ".factory/harness.json",
  "eslint.config.*",
  "tsconfig.json",
  "vitest.config.*",
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
];

const IGNORED_GENERATED = [
  "next-env.d.ts",
  "tsconfig.tsbuildinfo",
  ".factory-test.db",
  ".factory-test.db-shm",
  ".factory-test.db-wal",
  ".DS_Store",
  ".next/**",
  "coverage/**",
  "dist/**",
];

const TEST_FILE_RE = /(?:^|\/)(?:__tests__\/.*|.*\.(?:test|spec)\.[cm]?[jt]sx?)$/;
const CODE_FILE_RE = /\.[cm]?[jt]sx?$/;

const BANNED_PATTERNS = [
  {
    id: "fake-dom-class",
    re: /\bclass\s+Dom(?:Node|Element|Document|Event|KeyboardEvent|MouseEvent|InputElement)\b/,
    message: "Hand-rolled fake browser DOM detected; use happy-dom + @testing-library/react instead.",
    testOnly: true,
  },
  {
    id: "ts-ignore",
    re: /@ts-(?:ignore|nocheck)\b/,
    message: "TypeScript suppression (@ts-ignore / @ts-nocheck) is forbidden.",
    testOnly: false,
  },
  {
    id: "eslint-disable-all",
    re: /\/\*\s*eslint-disable\s*\*\//,
    message: "File-wide eslint-disable is forbidden.",
    testOnly: false,
  },
  {
    id: "skipped-test",
    re: /\b(?:it|test|describe)\.(?:skip|only)\s*\(/,
    message: "Skipped or focused tests (.skip / .only) are forbidden.",
    testOnly: true,
  },
];

export function globToRegExp(glob) {
  const norm = glob.replace(/\\/g, "/").replace(/^\.\//, "");
  let out = "^";
  let i = 0;
  while (i < norm.length) {
    const ch = norm[i];
    if (ch === "*" && norm[i + 1] === "*") {
      if (norm[i + 2] === "/") {
        out += "(?:.*/)?";
        i += 3;
      } else {
        out += ".*";
        i += 2;
      }
    } else if (ch === "*") {
      out += "[^/]*";
      i += 1;
    } else if (ch === "?") {
      out += "[^/]";
      i += 1;
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      i += 1;
    }
  }
  out += "$";
  return new RegExp(out);
}

export function matchesAnyGlob(filePath, globs) {
  const norm = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  return (globs || []).some((g) => globToRegExp(g).test(norm));
}

export function isTestFile(filePath) {
  return TEST_FILE_RE.test(filePath.replace(/\\/g, "/"));
}

export function filterMeaningfulChanges(changedFiles, extraIgnored = []) {
  const ignore = [...IGNORED_GENERATED, ...extraIgnored];
  return changedFiles.filter((f) => !matchesAnyGlob(f, ignore));
}

export function checkOwnership(changedFiles, track, harness = {}) {
  const owns = track.owns || [];
  const protectedGlobs = [...DEFAULT_PROTECTED, ...(harness.protectedPaths || [])];
  const allowProtected = track.allowProtected || [];
  const stray = [];
  const protectedHits = [];

  for (const file of changedFiles) {
    if (matchesAnyGlob(file, protectedGlobs) && !matchesAnyGlob(file, allowProtected) && !matchesAnyGlob(file, owns)) {
      protectedHits.push(file);
      continue;
    }
    if (!matchesAnyGlob(file, owns)) {
      stray.push(file);
    }
  }

  return {
    ok: stray.length === 0 && protectedHits.length === 0,
    stray,
    protectedHits,
  };
}

export function checkAntiBloat(worktreeDir, changedFiles, track, harness = {}) {
  const limits = {
    maxComponentLines: harness.antiBloat?.maxComponentLines ?? 350,
    maxSourceLines: harness.antiBloat?.maxSourceLines ?? 450,
    maxTestLines: harness.antiBloat?.maxTestLines ?? 500,
    maxTestToProdRatio: harness.antiBloat?.maxTestToProdRatio ?? 2.2,
    minProdLinesForRatio: harness.antiBloat?.minProdLinesForRatio ?? 120,
  };

  const violations = [];
  let prodLines = 0;
  let testLines = 0;
  let totalAssertions = 0;

  for (const rel of changedFiles) {
    if (!CODE_FILE_RE.test(rel)) continue;
    const abs = join(worktreeDir, rel);
    if (!existsSync(abs)) continue;
    const text = readFileSync(abs, "utf8");
    const lines = text === "" ? 0 : text.split(/\r?\n/).length;
    const test = isTestFile(rel);

    if (test) {
      testLines += lines;
      const asserts = text.match(/\b(?:expect|assert)\s*\(/g);
      totalAssertions += asserts ? asserts.length : 0;
      if (lines > limits.maxTestLines) {
        violations.push(
          `Anti-Bloat: ${rel} has ${lines} lines (limit ${limits.maxTestLines}). Keep tests focused and behavioral.`
        );
      }
    } else {
      prodLines += lines;
      const isUi = rel.endsWith(".tsx") || rel.endsWith(".jsx");
      const cap = isUi ? limits.maxComponentLines : limits.maxSourceLines;
      if (lines > cap) {
        violations.push(
          `Anti-Bloat: ${rel} has ${lines} lines (limit ${cap}). Split into cohesive smaller modules.`
        );
      }
    }

    for (const rule of BANNED_PATTERNS) {
      if (rule.testOnly && !test) continue;
      if (rule.re.test(text)) {
        violations.push(`Anti-Bloat (${rule.id}): ${rel} — ${rule.message}`);
      }
    }
  }

  const isTestOnlyTrack = track.kind === "tests" || (prodLines === 0 && testLines > 0);
  if (!isTestOnlyTrack && prodLines >= limits.minProdLinesForRatio && testLines > prodLines * limits.maxTestToProdRatio) {
    violations.push(
      `Anti-Bloat: Test bloat detected (${testLines} test lines vs ${prodLines} prod lines; ratio ${(testLines / prodLines).toFixed(2)} > ${limits.maxTestToProdRatio}).`
    );
  }

  const expectsTests = (track.owns || []).some((g) => isTestFile(g) || g.includes("test"));
  if (expectsTests && testLines > 0 && totalAssertions === 0) {
    violations.push("Anti-Bloat: Test files contain zero expect()/assert() assertions.");
  }

  return {
    ok: violations.length === 0,
    violations,
    metrics: { prodLines, testLines, totalAssertions },
  };
}

function buildTargetedCommand(template, files) {
  if (!template) return null;
  if (!template.includes("{files}")) return template;
  if (!files.length) return null;
  const quoted = files.map((f) => `"${f.replace(/"/g, '\\"')}"`).join(" ");
  return template.replaceAll("{files}", quoted);
}

export async function runTrackGates({ worktreeDir, baseCommit, track, harness = {}, env = process.env }) {
  const startedAt = Date.now();
  const rawChanged = listChangedFilesSince(worktreeDir, baseCommit);
  const changedFiles = filterMeaningfulChanges(rawChanged, harness.ignoreFiles || []);
  const steps = [];

  // 1. Ownership & Protected Paths (~0.1s)
  const own = checkOwnership(changedFiles, track, harness);
  steps.push({ name: "ownership", ok: own.ok, ms: Date.now() - startedAt });
  if (!own.ok) {
    const msgs = [];
    if (own.protectedHits.length) msgs.push(`Protected files modified: ${own.protectedHits.join(", ")}`);
    if (own.stray.length) msgs.push(`Files modified outside Owns (${(track.owns || []).join(", ")}): ${own.stray.join(", ")}`);
    return {
      ok: false,
      stage: "ownership",
      changedFiles,
      steps,
      error: msgs.join("\n"),
      metrics: null,
    };
  }

  // 2. Anti-Bloat Guard (~0.1s)
  const bloat = checkAntiBloat(worktreeDir, changedFiles, track, harness);
  steps.push({ name: "anti-bloat", ok: bloat.ok, metrics: bloat.metrics });
  if (!bloat.ok) {
    return {
      ok: false,
      stage: "anti-bloat",
      changedFiles,
      steps,
      error: bloat.violations.join("\n"),
      metrics: bloat.metrics,
    };
  }

  // 3. Fast ordered shell checks (Lint changed -> Typecheck -> Targeted unit tests)
  const codeFiles = changedFiles.filter((f) => CODE_FILE_RE.test(f));
  const testFiles = changedFiles.filter((f) => isTestFile(f));

  const commands = [];
  if (harness.commands?.lintChanged && codeFiles.length) {
    commands.push({ name: "lint", cmd: buildTargetedCommand(harness.commands.lintChanged, codeFiles) });
  } else if (harness.commands?.lint) {
    commands.push({ name: "lint", cmd: harness.commands.lint });
  }
  if (harness.commands?.typecheck) {
    commands.push({ name: "typecheck", cmd: harness.commands.typecheck });
  }
  if (harness.commands?.testFiles && testFiles.length) {
    commands.push({ name: "test", cmd: buildTargetedCommand(harness.commands.testFiles, testFiles) });
  } else if (harness.commands?.test) {
    commands.push({ name: "test", cmd: harness.commands.test });
  }

  for (const item of commands) {
    if (!item.cmd) continue;
    const res = await runWithWatchdog(item.cmd, [], {
      cwd: worktreeDir,
      env,
      shell: true,
      idleTimeoutMs: 3 * 60 * 1000,
    });
    steps.push({ name: item.name, ok: res.exitCode === 0, exitCode: res.exitCode, ms: res.durationMs });
    if (res.exitCode !== 0) {
      return {
        ok: false,
        stage: item.name,
        changedFiles,
        steps,
        error: `Gate "${item.name}" failed (exit ${res.exitCode}):\n$ ${item.cmd}\n${res.lastLines}`,
        metrics: bloat.metrics,
      };
    }
  }

  return {
    ok: true,
    stage: "passed",
    changedFiles,
    steps,
    error: null,
    metrics: bloat.metrics,
  };
}

export async function runFullStagingChecks(stagingWorktreeDir, harness = {}, env = process.env) {
  const cmds = [];
  if (harness.commands?.typecheck) cmds.push({ name: "typecheck", cmd: harness.commands.typecheck });
  if (harness.commands?.lint) cmds.push({ name: "lint", cmd: harness.commands.lint });
  if (harness.commands?.test) cmds.push({ name: "test", cmd: harness.commands.test });
  if (harness.commands?.build) cmds.push({ name: "build", cmd: harness.commands.build });

  const results = [];
  for (const item of cmds) {
    const res = await runWithWatchdog(item.cmd, [], {
      cwd: stagingWorktreeDir,
      env,
      shell: true,
      idleTimeoutMs: 5 * 60 * 1000,
    });
    results.push({ name: item.name, ok: res.exitCode === 0, exitCode: res.exitCode, ms: res.durationMs });
    if (res.exitCode !== 0) {
      return {
        ok: false,
        failedStep: item.name,
        results,
        error: `Staging check "${item.name}" failed (exit ${res.exitCode}):\n$ ${item.cmd}\n${res.lastLines}`,
      };
    }
  }
  return { ok: true, failedStep: null, results, error: null };
}
