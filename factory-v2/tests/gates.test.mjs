import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { detectRepo } from "../skills/f-plan/scripts/detect-repo.mjs";
import { checkAntiBloat, checkOwnership } from "../skills/f-run/orchestrator/gates.mjs";

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), "factory-v2-gates-"));
}

describe("checkOwnership", () => {
  it("allows files matching Owns globs and rejects stray or protected files", () => {
    const track = { owns: ["src/components/todo-*.tsx", "src/lib/todo-store.ts"] };
    const good = checkOwnership(["src/components/todo-sidebar.tsx", "src/lib/todo-store.ts"], track);
    assert.equal(good.ok, true);

    const bad = checkOwnership(["src/components/todo-sidebar.tsx", "src/app/page.tsx", "package.json"], track);
    assert.equal(bad.ok, false);
    assert.deepEqual(bad.stray, ["src/app/page.tsx"]);
    assert.deepEqual(bad.protectedHits, ["package.json"]);
  });
});

describe("checkAntiBloat", () => {
  it("blocks hand-rolled fake DOM classes, @ts-ignore, and oversized test files", () => {
    const dir = makeTempDir();
    try {
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src/app.tsx"), "export function App() { return <div />; }\n");
      writeFileSync(
        join(dir, "src/app.test.tsx"),
        [
          "class DomNode { nodeType = 1; }",
          "// @ts-ignore",
          "it.skip('x', () => { expect(1).toBe(1); });",
          ...Array.from({ length: 520 }, (_, i) => `// line ${i}`),
        ].join("\n")
      );

      const res = checkAntiBloat(dir, ["src/app.tsx", "src/app.test.tsx"], { owns: ["src/**"] });
      assert.equal(res.ok, false);
      assert.ok(res.violations.some((v) => v.includes("fake-dom-class")));
      assert.ok(res.violations.some((v) => v.includes("ts-ignore")));
      assert.ok(res.violations.some((v) => v.includes("skipped-test")));
      assert.ok(res.violations.some((v) => v.includes("limit 500")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("blocks extreme test-to-prod LOC ratio on feature tracks", () => {
    const dir = makeTempDir();
    try {
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src/mod.ts"), Array.from({ length: 130 }, (_, i) => `export const v${i} = ${i};`).join("\n"));
      writeFileSync(
        join(dir, "src/mod.test.ts"),
        ["expect(1).toBe(1);", ...Array.from({ length: 350 }, (_, i) => `// t${i}`)].join("\n")
      );
      const res = checkAntiBloat(dir, ["src/mod.ts", "src/mod.test.ts"], { owns: ["src/**"] });
      assert.equal(res.ok, false);
      assert.ok(res.violations.some((v) => v.includes("Test bloat")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("passes clean cohesive code and behavioral tests", () => {
    const dir = makeTempDir();
    try {
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src/todo.tsx"), "export function Todo() { return <div>ok</div>; }\n");
      writeFileSync(join(dir, "src/todo.test.tsx"), "expect(true).toBe(true);\n");
      const res = checkAntiBloat(dir, ["src/todo.tsx", "src/todo.test.tsx"], { owns: ["src/**"] });
      assert.equal(res.ok, true, res.violations.join("; "));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("detectRepo", () => {
  it("distinguishes greenfield, brownfield-uninit, and initialized repos with product mismatch info", () => {
    const dir = makeTempDir();
    try {
      assert.equal(detectRepo(dir).mode, "greenfield");

      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "existing-app" }));
      assert.equal(detectRepo(dir).mode, "brownfield-uninit");

      mkdirSync(join(dir, ".factory"), { recursive: true });
      writeFileSync(join(dir, ".factory/harness.json"), JSON.stringify({ schemaVersion: 2, hasUi: true }));
      writeFileSync(join(dir, ".factory/design.md"), "# Blue Hour Freediving\n");
      const init = detectRepo(dir);
      assert.equal(init.mode, "initialized");
      assert.equal(init.existingProduct, "Blue Hour Freediving");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
