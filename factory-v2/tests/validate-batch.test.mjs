import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { validateBatch } from "../skills/f-plan/scripts/validate-batch.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

describe("validate-batch", () => {
  it("accepts the todo-app benchmark batch.json cleanly", () => {
    const batch = JSON.parse(readFileSync(join(ROOT, "benchmarks/todo-app/batch.json"), "utf8"));
    const res = validateBatch(batch);
    assert.equal(res.ok, true, `Unexpected errors: ${res.errors.join("; ")}`);
    assert.equal(res.errors.length, 0);
  });

  it("rejects overlapping `owns` within the same parallel wave", () => {
    const res = validateBatch({
      id: "overlap-test",
      tracks: [
        { id: "T1", wave: 1, size: "M", dependsOn: [], owns: ["src/components/**"] },
        { id: "T2", wave: 1, size: "M", dependsOn: [], owns: ["src/components/sidebar.tsx"] },
      ],
    });
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.includes("file overlap")));
  });

  it("allows overlapping `owns` across different sequential waves", () => {
    const res = validateBatch({
      id: "seq-test",
      tracks: [
        { id: "T0", wave: 0, size: "M", dependsOn: [], owns: ["src/app/page.tsx"] },
        { id: "T1", wave: 1, size: "S", dependsOn: ["T0"], owns: ["src/app/page.tsx"] },
      ],
    });
    assert.equal(res.ok, true, res.errors.join("; "));
  });

  it("rejects dependencies in the same or later wave and detects cycles", () => {
    const res = validateBatch({
      id: "cycle-test",
      tracks: [
        { id: "T1", wave: 1, size: "M", dependsOn: ["T2"], owns: ["src/a.ts"] },
        { id: "T2", wave: 1, size: "M", dependsOn: ["T1"], owns: ["src/b.ts"] },
      ],
    });
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.includes("earlier wave")));
    assert.ok(res.errors.some((e) => e.includes("cycle")));
  });

  it("rejects uncovered criteria", () => {
    const res = validateBatch({
      id: "criteria-test",
      criteria: [
        { id: "C1", text: "First" },
        { id: "C2", text: "Second" },
      ],
      tracks: [{ id: "T0", wave: 0, size: "S", dependsOn: [], owns: ["src/a.ts"], criteria: ["C1"] }],
    });
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.includes("C2")));
  });
});
