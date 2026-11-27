// Step 5/6: a check fails after merging. Run only the failing test files, halving
// the list of merges since the last green point, to find the merge that broke it.

// points: merges in order, the last one is HEAD and known to fail. fails(i) runs
// the failing tests at points[i] and resolves true when they fail; fails(-1) is the
// last green point. Returns the index of the first failing merge, or null when the
// failure is not caused inside this range (it already failed before, or HEAD passes now).
export async function findCulprit(points, fails) {
  if (points.length === 0) return null;
  if (!(await fails(points.length - 1))) return null;
  let lo = -1; // passes
  let hi = points.length - 1; // fails
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (await fails(mid)) hi = mid;
    else lo = mid;
  }
  if (lo === -1 && (await fails(-1))) return null;
  return hi;
}

// Which tests to rerun at each point: the failing files of each failed check, or the
// whole check when it gave no file (typecheck, build, a runner with no report).
export function rerunPlan(results) {
  const failed = results.filter((x) => !x.ok);
  const files = {};
  for (const r of failed) if (['unit', 'e2e'].includes(r.name) && r.failedFiles?.length) files[r.name] = r.failedFiles;
  return { names: failed.map((r) => r.name), files };
}
