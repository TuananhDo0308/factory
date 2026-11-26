#!/usr/bin/env node
// Classifies repository readiness for /f-plan:
// - greenfield: empty or no source/package manifest yet
// - brownfield-uninit: existing codebase without .factory/harness.json
// - initialized: has .factory/harness.json (also returns product/design summary to detect mismatches!)
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const IGNORE_ENTRIES = new Set([".git", ".DS_Store", ".gitignore", "README.md", "LICENSE", ".factory"]);

export function detectRepo(repoDir) {
  const dir = resolve(repoDir);
  if (!existsSync(dir)) {
    return { mode: "missing", repoDir: dir, files: [], harness: null, existingProduct: null };
  }

  const entries = readdirSync(dir).filter((e) => !IGNORE_ENTRIES.has(e));
  const harnessPath = join(dir, ".factory", "harness.json");
  const agentsPath = join(dir, "AGENTS.md");
  const designPath = join(dir, ".factory", "design.md");
  const legacyProductPath = join(dir, ".factory", "product.md");
  const legacyDesignPath = join(dir, ".factory", "design", "DESIGN.md");

  let existingProduct = null;
  for (const p of [designPath, legacyProductPath, legacyDesignPath, agentsPath]) {
    if (existsSync(p)) {
      const firstHeading = readFileSync(p, "utf8")
        .split(/\r?\n/)
        .find((l) => l.trim().startsWith("# "));
      if (firstHeading) {
        existingProduct = firstHeading.replace(/^#\s+/, "").trim();
        break;
      }
    }
  }

  if (existsSync(harnessPath)) {
    const harness = JSON.parse(readFileSync(harnessPath, "utf8"));
    return {
      mode: "initialized",
      repoDir: dir,
      entries,
      harness,
      hasAgentsMd: existsSync(agentsPath),
      hasDesignMd: existsSync(designPath) || existsSync(legacyDesignPath),
      existingProduct,
    };
  }

  const hasCode = entries.some((e) =>
    ["package.json", "pyproject.toml", "Cargo.toml", "go.mod", "src", "app", "lib"].includes(e)
  );

  return {
    mode: hasCode ? "brownfield-uninit" : "greenfield",
    repoDir: dir,
    entries,
    harness: null,
    hasAgentsMd: existsSync(agentsPath),
    hasDesignMd: existsSync(designPath) || existsSync(legacyDesignPath),
    existingProduct,
  };
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  const target = process.argv[2] || process.cwd();
  console.log(JSON.stringify(detectRepo(target), null, 2));
}
