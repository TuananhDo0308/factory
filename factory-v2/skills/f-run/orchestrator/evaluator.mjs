// Fast Blind Evaluator & QC Runner:
// 1. Starts built app on staging worktree on a dedicated port.
// 2. Captures 4 live screenshots (1440/390 x light/dark), overflow metrics, and console/page errors (~15s).
// 3. Runs Blind Evaluator agent with holdout.md + approved prototype screenshots + live screenshots -> 4 Anthropic UI/UX scores (>=4/5).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAgent } from "./adapters/index.mjs";
import { runWithWatchdog } from "./watchdog.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROLES_DIR = join(__dirname, "..", "roles");
const SCHEMAS_DIR = join(__dirname, "..", "schemas");

async function waitForUrl(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

export async function captureLiveApp({ url, outDir, repoDir }) {
  mkdirSync(outDir, { recursive: true });
  const captureScript = `
    const { chromium } = require("playwright");
    const path = require("path");
    const fs = require("fs");
    (async () => {
      const url = process.env.EVAL_URL;
      const outDir = process.env.EVAL_OUT_DIR;
      const browser = await chromium.launch({ headless: true });
      const consoleErrors = [];
      const pageErrors = [];
      const failedRequests = [];
      const shots = [];
      const combos = [
        { name: "desktop-1440-light", width: 1440, height: 900, colorScheme: "light" },
        { name: "desktop-1440-dark", width: 1440, height: 900, colorScheme: "dark" },
        { name: "mobile-390-light", width: 390, height: 844, colorScheme: "light" },
        { name: "mobile-390-dark", width: 390, height: 844, colorScheme: "dark" },
      ];
      for (const c of combos) {
        const ctx = await browser.newContext({
          viewport: { width: c.width, height: c.height },
          colorScheme: c.colorScheme,
        });
        const page = await ctx.newPage();
        page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
        page.on("pageerror", (e) => pageErrors.push(e.message));
        page.on("requestfailed", (r) => failedRequests.push(r.url() + ": " + (r.failure()?.errorText || "failed")));
        await page.goto(url, { waitUntil: "networkidle", timeout: 25000 });
        const overflow = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        const filePath = path.join(outDir, c.name + ".png");
        await page.screenshot({ path: filePath, fullPage: true });
        shots.push({
          name: c.name,
          path: filePath,
          hasHorizontalOverflow: overflow.scrollWidth > overflow.clientWidth + 1,
          ...overflow,
        });
        await ctx.close();
      }
      await browser.close();
      fs.writeFileSync(
        path.join(outDir, "capture.json"),
        JSON.stringify({ shots, consoleErrors, pageErrors, failedRequests }, null, 2)
      );
    })().catch((err) => { console.error(err.stack || err.message); process.exit(1); });
  `;

  const res = await runWithWatchdog(process.execPath, ["-e", captureScript], {
    cwd: repoDir,
    env: { ...process.env, EVAL_URL: url, EVAL_OUT_DIR: outDir },
    idleTimeoutMs: 45_000,
    hardTimeoutMs: 60_000,
  });

  const reportPath = join(outDir, "capture.json");
  if (res.exitCode !== 0 || !existsSync(reportPath)) {
    return {
      ok: false,
      error: `Live capture failed (exit ${res.exitCode}):\n${res.lastLines}`,
      shots: [],
      consoleErrors: [],
      pageErrors: [],
      failedRequests: [],
    };
  }
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  return { ok: true, ...report };
}

export function evaluateVerdict(evalData, capture = null) {
  const failures = [];
  const scores = evalData?.scores || {};
  const axes = ["designQuality", "originality", "craft", "functionality"];
  for (const axis of axes) {
    const val = Number(scores[axis] ?? 0);
    if (val < 4) {
      failures.push({
        kind: "visual-rubric",
        axis,
        score: val,
        problem: `UI/UX score "${axis}" is ${val}/5 (must be >= 4/5). ${evalData?.visualCritique || ""}`.trim(),
      });
    }
  }

  for (const c of evalData?.criteria || []) {
    if (c.status !== "met") {
      failures.push({
        kind: "criterion",
        criterion: c.id,
        problem: c.evidence || `Criterion ${c.id} was marked ${c.status}`,
      });
    }
  }

  if (capture) {
    for (const s of capture.shots || []) {
      if (s.hasHorizontalOverflow) {
        failures.push({
          kind: "overflow",
          problem: `Horizontal overflow detected on ${s.name}: scrollWidth=${s.scrollWidth} > clientWidth=${s.clientWidth}`,
        });
      }
    }
    if ((capture.consoleErrors || []).length > 0 || (capture.pageErrors || []).length > 0) {
      failures.push({
        kind: "console-error",
        problem: `Runtime browser errors detected: ${[...(capture.consoleErrors || []), ...(capture.pageErrors || [])].slice(0, 5).join(" | ")}`,
      });
    }
  }

  return {
    passed: failures.length === 0 && evalData?.verdict === "pass",
    failures,
  };
}

export function mapFailuresToTracks(failures, batch) {
  const byCriterion = new Map();
  for (const t of batch.tracks) {
    for (const cid of t.criteria || []) {
      if (!byCriterion.has(cid)) byCriterion.set(cid, []);
      byCriterion.get(cid).push(t.id);
    }
  }

  const routed = new Map();
  const uiTracks = batch.tracks.filter((t) =>
    (t.owns || []).some((g) => g.includes("components") || g.includes("app/") || g.endsWith(".tsx"))
  );
  const fallbackTrack = uiTracks[uiTracks.length - 1]?.id || batch.tracks[batch.tracks.length - 1]?.id;

  for (const f of failures) {
    const owners = f.criterion ? byCriterion.get(f.criterion) || [] : [];
    const target = owners[owners.length - 1] || fallbackTrack;
    if (!target) continue;
    if (!routed.has(target)) routed.set(target, []);
    routed.get(target).push(f.problem);
  }
  return routed;
}

export async function runBlindEvaluator({
  stagingWorktreeDir,
  batchDirPath,
  batch,
  harness,
  engine,
  port = 3199,
  attempt = 1,
  skipServer = false,
  log = () => {},
}) {
  const evalDir = join(batchDirPath, "qc", `round-${attempt}`);
  mkdirSync(evalDir, { recursive: true });
  const url = `http://127.0.0.1:${port}`;
  let serverProc = null;
  let capture = null;

  try {
    const hasUi = Boolean(harness.hasUi || batch.hasUi);
    if (hasUi && !skipServer && harness.commands?.start) {
      log(`[qc] starting staging server on ${url}...`);
      serverProc = spawn(harness.commands.start, [], {
        cwd: stagingWorktreeDir,
        env: { ...process.env, PORT: String(port), BASE_URL: url, NODE_ENV: "production" },
        shell: true,
        detached: process.platform !== "win32",
        stdio: "ignore",
      });
      const ready = await waitForUrl(url, 30_000);
      if (!ready) {
        return {
          ok: false,
          passed: false,
          error: `Staging server failed to become ready at ${url} within 30s.`,
          failures: [{ kind: "server", problem: `Server did not listen on ${url}` }],
          usage: null,
        };
      }

      log("[qc] capturing 4 live screenshots (1440/390 x light/dark)...");
      capture = await captureLiveApp({ url, outDir: evalDir, repoDir: stagingWorktreeDir });
    }

    // Optional Playwright E2E suite on staging
    let e2eSummary = "No E2E command configured.";
    if (harness.commands?.e2e && !skipServer) {
      log(`[qc] running E2E suite: ${harness.commands.e2e}`);
      const e2e = await runWithWatchdog(harness.commands.e2e, [], {
        cwd: stagingWorktreeDir,
        env: { ...process.env, PORT: String(port), BASE_URL: url },
        shell: true,
        idleTimeoutMs: 4 * 60 * 1000,
      });
      e2eSummary = `exitCode=${e2e.exitCode}\n${e2e.lastLines}`;
    }

    const holdoutPath = join(batchDirPath, "holdout.md");
    const holdoutText = existsSync(holdoutPath) ? readFileSync(holdoutPath, "utf8") : "(No holdout scenarios provided)";
    const roleBrief = readFileSync(join(ROLES_DIR, "evaluator.md"), "utf8");
    const approvedShots = ["approved-1440.png", "approved-390.png"]
      .map((f) => join(batchDirPath, "prototype", f))
      .filter((p) => existsSync(p));

    const criteriaList = (batch.criteria || [])
      .map((c) => `- ${c.id}: ${c.text}`)
      .join("\n");

    const prompt = [
      roleBrief,
      "",
      `## Live App URL\n${url}`,
      "",
      `## Acceptance Criteria\n${criteriaList || "(See tracks)"}`,
      "",
      `## Holdout Scenarios (Blind Verification)\n${holdoutText}`,
      "",
      `## Approved Prototype Screenshots\n${approvedShots.length ? approvedShots.join("\n") : "(None)"}`,
      "",
      `## Captured Live Screenshots & Telemetry\n${capture ? JSON.stringify(capture, null, 2) : "(No browser capture)"}`,
      "",
      `## E2E Runner Output\n${e2eSummary}`,
    ].join("\n");

    const res = await runAgent({
      engine,
      role: "evaluator",
      size: "M",
      prompt,
      cwd: stagingWorktreeDir,
      schemaPath: join(SCHEMAS_DIR, "eval-out.json"),
      readOnly: true,
      maxBudgetUsd: 2.0,
    });

    if (!res.ok) {
      return {
        ok: false,
        passed: false,
        error: res.error,
        failures: [{ kind: "evaluator-error", problem: res.error }],
        usage: res.usage,
      };
    }

    const judged = evaluateVerdict(res.data, capture);
    writeFileSync(join(evalDir, "eval-result.json"), JSON.stringify({ ...res.data, judged }, null, 2));

    return {
      ok: true,
      passed: judged.passed,
      data: res.data,
      capture,
      failures: judged.failures,
      usage: res.usage,
    };
  } finally {
    if (serverProc && serverProc.pid) {
      try {
        if (process.platform !== "win32") process.kill(-serverProc.pid, "SIGTERM");
        else serverProc.kill("SIGTERM");
      } catch {
        // already stopped
      }
    }
  }
}
