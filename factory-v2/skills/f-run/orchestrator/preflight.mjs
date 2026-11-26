// 15-second fail-fast Preflight before spawning ANY agent.
// Prevents wasting 40 minutes only to fail on missing Playwright browser or missing test DOM.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runWithWatchdog } from "./watchdog.mjs";
import { git, isGitRepo } from "./worktree.mjs";

export function loadHarness(repoDir) {
  const file = join(repoDir, ".factory", "harness.json");
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8"));
}

export async function runPreflight(repoDir, batch, options = {}) {
  const errors = [];
  const warnings = [];

  // 1. Git repository & base branch
  if (!isGitRepo(repoDir)) {
    errors.push(`Not a git repository: ${repoDir}`);
    return { ok: false, errors, warnings, harness: null };
  }
  const baseBranch = batch.baseBranch || "main";
  if (!git(repoDir, ["rev-parse", "--verify", baseBranch]).ok) {
    errors.push(`Base branch "${baseBranch}" does not exist in ${repoDir}.`);
  }

  // 2. Harness config
  const harness = loadHarness(repoDir) || { commands: {}, hasUi: false };

  // 3. UI project checks: happy-dom / jsdom + RTL + Playwright Chromium launch probe
  const hasUi = Boolean(harness.hasUi || batch.hasUi);
  const pkgPath = join(repoDir, "package.json");
  if (hasUi && existsSync(pkgPath) && !options.skipUiChecks) {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if (!deps["happy-dom"] && !deps["jsdom"]) {
      errors.push(
        "UI project is missing happy-dom or jsdom in package.json (agents would otherwise hand-roll fake DOMs). Run /f-init or install happy-dom."
      );
    }
    if (!deps["@testing-library/react"] && (deps.react || deps.next)) {
      warnings.push("Missing @testing-library/react in devDependencies; UI component tests may be weaker.");
    }
  }

  // 4. Playwright Chromium smoke probe (only when QC enabled and hasUi)
  if (hasUi && !options.skipQc && !options.skipBrowserProbe) {
    const probeScript = `
      const { chromium } = require("playwright");
      (async () => {
        const b = await chromium.launch({ headless: true });
        await b.close();
      })().catch((e) => { console.error(e.message); process.exit(1); });
    `;
    const res = await runWithWatchdog(process.execPath, ["-e", probeScript], {
      cwd: repoDir,
      idleTimeoutMs: 20_000,
      hardTimeoutMs: 25_000,
    });
    if (res.exitCode !== 0) {
      errors.push(
        `Playwright Chromium preflight failed (fix before spending tokens on Build):\n${res.lastLines || "Cannot launch playwright chromium"}`
      );
    }
  }

  return { ok: errors.length === 0, errors, warnings, harness };
}
