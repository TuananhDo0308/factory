#!/usr/bin/env node
// Deterministic batch.json validator (0 LLM tokens):
// Checks: required fields, unique track IDs, wave ordering, DAG acyclicity,
// disjoint `owns` within any potentially concurrent wave, valid sizes, and criterion coverage.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VALID_SIZES = new Set(["S", "M", "L"]);

function normGlob(g) {
  return String(g || "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

function globPrefix(g) {
  const idx = g.search(/[*?[]/);
  return idx === -1 ? g : g.slice(0, idx);
}

export function globsCouldOverlap(a, b) {
  const na = normGlob(a);
  const nb = normGlob(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const pa = globPrefix(na);
  const pb = globPrefix(nb);
  // Exact file vs exact file
  if (pa === na && pb === nb) return na === nb;
  // If one has glob wildcard, check prefix containment
  if (pa !== na && nb.startsWith(pa)) return true;
  if (pb !== nb && na.startsWith(pb)) return true;
  return false;
}

export function validateBatch(batch) {
  const errors = [];
  const warnings = [];

  if (!batch || typeof batch !== "object") {
    return { ok: false, errors: ["batch must be a JSON object"], warnings };
  }
  if (!batch.id || typeof batch.id !== "string") {
    errors.push("batch.id is required (non-empty string)");
  }
  if (!Array.isArray(batch.tracks) || batch.tracks.length === 0) {
    errors.push("batch.tracks must be a non-empty array");
    return { ok: false, errors, warnings };
  }

  const byId = new Map();
  const maxWave = Math.max(...batch.tracks.map((t) => Number(t.wave ?? 0)));
  if (maxWave > 3) {
    warnings.push(`Batch has ${maxWave + 1} waves (waves 0..${maxWave}); consider flattening to <= 3 waves.`);
  }

  for (const t of batch.tracks) {
    if (!t.id || typeof t.id !== "string") {
      errors.push("Every track must have a string id");
      continue;
    }
    if (byId.has(t.id)) {
      errors.push(`Duplicate track id: ${t.id}`);
    }
    byId.set(t.id, t);

    if (typeof t.wave !== "number" || t.wave < 0 || !Number.isInteger(t.wave)) {
      errors.push(`Track ${t.id}: wave must be a non-negative integer`);
    }
    if (t.size && !VALID_SIZES.has(t.size)) {
      errors.push(`Track ${t.id}: invalid size "${t.size}" (must be S, M, or L)`);
    }
    if (!Array.isArray(t.owns) || t.owns.length === 0) {
      errors.push(`Track ${t.id}: owns must be a non-empty array of file paths or globs`);
    }
  }

  // Dependency validity & earlier-wave invariant
  for (const t of batch.tracks) {
    for (const depId of t.dependsOn || []) {
      const dep = byId.get(depId);
      if (!dep) {
        errors.push(`Track ${t.id}: dependsOn unknown track "${depId}"`);
      } else if (dep.wave >= t.wave) {
        errors.push(`Track ${t.id} (wave ${t.wave}) depends on ${depId} (wave ${dep.wave}); dependencies must be in an earlier wave`);
      }
    }
  }

  // Cycle detection (DFS)
  const color = new Map(); // 0=unvisited, 1=visiting, 2=done
  const dfs = (id, stack) => {
    color.set(id, 1);
    const t = byId.get(id);
    for (const dep of t?.dependsOn || []) {
      if (!byId.has(dep)) continue;
      if (color.get(dep) === 1) {
        errors.push(`Dependency cycle detected: ${[...stack, dep].join(" -> ")}`);
      } else if (!color.get(dep)) {
        dfs(dep, [...stack, dep]);
      }
    }
    color.set(id, 2);
  };
  for (const id of byId.keys()) {
    if (!color.get(id)) dfs(id, [id]);
  }

  // Disjoint `owns` within the same wave (concurrent tracks must never overlap files)
  const byWave = new Map();
  for (const t of batch.tracks) {
    if (!byWave.has(t.wave)) byWave.set(t.wave, []);
    byWave.get(t.wave).push(t);
  }
  for (const [wave, tracks] of byWave.entries()) {
    for (let i = 0; i < tracks.length; i++) {
      for (let j = i + 1; j < tracks.length; j++) {
        const a = tracks[i];
        const b = tracks[j];
        for (const ga of a.owns || []) {
          for (const gb of b.owns || []) {
            if (globsCouldOverlap(ga, gb)) {
              errors.push(
                `Wave ${wave} file overlap between ${a.id} ("${ga}") and ${b.id} ("${gb}") — parallel tracks must own disjoint files`
              );
            }
          }
        }
      }
    }
  }

  // Criteria coverage check
  if (Array.isArray(batch.criteria) && batch.criteria.length > 0) {
    const definedIds = new Set();
    for (const c of batch.criteria) {
      if (!c.id || !c.text) {
        errors.push("Each entry in batch.criteria must have id and text");
        continue;
      }
      if (definedIds.has(c.id)) errors.push(`Duplicate criterion id: ${c.id}`);
      definedIds.add(c.id);
    }
    const covered = new Set();
    for (const t of batch.tracks) {
      for (const cid of t.criteria || []) {
        if (!definedIds.has(cid)) {
          errors.push(`Track ${t.id} references unknown criterion "${cid}"`);
        }
        covered.add(cid);
      }
    }
    for (const cid of definedIds) {
      if (!covered.has(cid)) {
        errors.push(`Criterion "${cid}" is not assigned to any track`);
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  const file = process.argv[2];
  if (!file || !existsSync(file)) {
    console.error("Usage: node validate-batch.mjs <path/to/batch.json>");
    process.exit(2);
  }
  const batch = JSON.parse(readFileSync(file, "utf8"));
  const res = validateBatch(batch);
  console.log(JSON.stringify(res, null, 2));
  process.exit(res.ok ? 0 : 1);
}
