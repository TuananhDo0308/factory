#!/usr/bin/env node
// Bootstraps a greenfield repo from a pre-configured Golden Template (e.g. nextjs-shadcn).
// Uses APFS copy-on-write for node_modules when pre-installed in the template (<2s startup).
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, "..", "..", "..", "templates");

export function bootstrapFromTemplate(targetDir, templateName = "nextjs-shadcn") {
  const src = join(TEMPLATES_DIR, templateName);
  if (!existsSync(src)) {
    const available = existsSync(TEMPLATES_DIR) ? readdirSync(TEMPLATES_DIR) : [];
    throw new Error(`Unknown template "${templateName}". Available: ${available.join(", ")}`);
  }

  const dest = resolve(targetDir);
  mkdirSync(dest, { recursive: true });

  for (const entry of readdirSync(src)) {
    const s = join(src, entry);
    const d = join(dest, entry);
    if (entry === "node_modules") {
      if (!existsSync(d)) {
        if (process.platform === "darwin") {
          const r = spawnSync("cp", ["-cR", s, d], { encoding: "utf8" });
          if (r.status === 0) continue;
        }
        cpSync(s, d, { recursive: true });
      }
      continue;
    }
    if (entry === ".next" || entry === ".git") continue;
    cpSync(s, d, { recursive: true, force: false });
  }

  return { ok: true, template: templateName, targetDir: dest, hasNodeModules: existsSync(join(dest, "node_modules")) };
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  const target = process.argv[2];
  const tpl = process.argv[3] || "nextjs-shadcn";
  if (!target) {
    console.error("Usage: node bootstrap.mjs <target-dir> [template-name]");
    process.exit(2);
  }
  console.log(JSON.stringify(bootstrapFromTemplate(target, tpl), null, 2));
}
