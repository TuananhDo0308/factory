#!/usr/bin/env node
// Sets up a clean sandbox repo from Golden Template `nextjs-shadcn` + loads the Todo App parallel batch.
// Usage: node benchmarks/run-todo-benchmark.mjs <sandbox-dir> [--engine claude|antigravity] [--run]
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { bootstrapFromTemplate } from "../skills/f-plan/scripts/bootstrap.mjs";
import { runBatchOrchestrator } from "../skills/f-run/orchestrator/index.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    engine: { type: "string", default: "claude" },
    concurrency: { type: "string", default: "3" },
    "pause-wave0": { type: "boolean", default: false },
    run: { type: "boolean", default: false },
  },
});

const sandboxDir = resolve(positionals[0] || "/tmp/factory-v2-todo-benchmark");
console.log(`[benchmark] bootstrapping clean repo at ${sandboxDir}...`);
bootstrapFromTemplate(sandboxDir, "nextjs-shadcn");

const batchDest = join(sandboxDir, ".factory", "batches", "2026-11-26-todo-app");
mkdirSync(batchDest, { recursive: true });
cpSync(join(ROOT, "benchmarks", "todo-app"), batchDest, { recursive: true });

if (!existsSync(join(sandboxDir, ".git"))) {
  const g = (...args) => execFileSync("git", args, { cwd: sandboxDir, stdio: "inherit" });
  g("init", "-b", "main");
  g("add", ".");
  g("commit", "-m", "chore: bootstrap Factory v2 nextjs-shadcn template");
}

console.log(`[benchmark] sandbox ready at ${sandboxDir}`);
if (!values.run) {
  console.log(
    `\nRun live benchmark with:\n  node ${join(ROOT, "skills/f-run/orchestrator/index.mjs")} --repo ${sandboxDir} --batch 2026-11-26-todo-app --engine ${values.engine} --concurrency ${values.concurrency}`
  );
  process.exit(0);
}

const res = await runBatchOrchestrator({
  repoDir: sandboxDir,
  batchId: "2026-11-26-todo-app",
  engine: values.engine,
  concurrency: Number(values.concurrency),
  pauseWave0: values["pause-wave0"],
});
process.exit(res.ok ? 0 : 1);
