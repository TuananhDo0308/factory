// 4b: the committed diff since the ticket's base, against what the ticket owns.
// Pure functions; the git part (changes, package.json at both ends) is passed in.
import path from 'node:path';

// "src/x/" is the folder src/x/**; "./a" is "a". Same reading as new-ba's check-batch.
export const normalizeGlob = (g) => g.trim().replace(/^\.\//, '').replace(/\/+$/, (m) => (m ? '/**' : ''));

function globRegex(glob) {
  let re = '';
  const g = normalizeGlob(glob);
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') {
      const slash = g[i + 2] === '/';
      re += slash ? '(?:.*/)?' : '.*';
      i += slash ? 2 : 1;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export const matches = (file, glob) => globRegex(glob).test(file);
export const owned = (file, globs) => globs.some((g) => matches(file, g));

// The ticket's own test places, owned without being listed: e2e/<issue>/** and,
// next to each owned file, its .test/.spec twin and a __tests__ folder.
export function testOwns(t) {
  const out = [`e2e/${t.issue}/**`];
  if (t.key) out.push(`e2e/${t.key.toLowerCase()}/**`);
  for (const g of t.owns) {
    if (/[*?]/.test(g)) continue;
    const ext = path.extname(g);
    if (!ext) continue;
    const dir = path.dirname(g) === '.' ? '' : `${path.dirname(g)}/`;
    const base = path.basename(g, ext);
    if (/\.(?:test|spec)$/.test(base)) continue;
    out.push(`${dir}${base}.test.*`, `${dir}${base}.spec.*`, `${dir}__tests__/${base}.*`, `${dir}test_${base}.*`, `${dir}${base}_test.*`);
  }
  return out;
}

export const effectiveOwns = (t) => [...new Set([...t.owns, ...testOwns(t), ...(t.extraOwns || [])])];

// Never judged: caches, placeholders and what checks write.
const IGNORED = /(?:^|\/)(?:__pycache__\/|\.gitkeep$|\.DS_Store$|node_modules\/|\.nf-cache\/|test-results\/|playwright-report\/|blob-report\/|\.playwright-mcp\/|coverage\/|\.pytest_cache\/|[^/]*\.tsbuildinfo$|[^/]*\.pyc$)/;
export const LOCKFILES = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'npm-shrinkwrap.json', 'bun.lockb']);
export const ignoredPath = (f) => IGNORED.test(f);

const depsOf = (pkg) => ({ ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}), ...(pkg?.optionalDependencies || {}), ...(pkg?.peerDependencies || {}) });

// Dependency changes in package.json that were not declared: [{ name, from, to }].
export function undeclaredDependencies(before, after, declared) {
  const a = depsOf(before);
  const b = depsOf(after);
  const ok = new Map(declared.map((d) => [d.slice(0, d.lastIndexOf('@')), d.slice(d.lastIndexOf('@') + 1)]));
  const out = [];
  for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (a[name] === b[name]) continue;
    if (ok.has(name) && ok.get(name) === b[name]) continue;
    out.push({ name, from: a[name] ?? null, to: b[name] ?? null });
  }
  return out;
}

// changes: [{ status, path, from? }] from git diff --name-status -M.
// Returns [{ file, kind: 'outside' | 'dependency', message }].
export function ownsProblems(changes, owns, { pkgBefore = null, pkgAfter = null, declared = [] } = {}) {
  const out = [];
  const touched = new Set();
  for (const c of changes) {
    for (const f of c.status === 'R' ? [c.from, c.path] : [c.path]) touched.add(f);
  }
  for (const f of touched) {
    if (ignoredPath(f) || LOCKFILES.has(path.basename(f)) && !f.includes('/')) continue;
    if (f === 'package.json') {
      for (const d of undeclaredDependencies(pkgBefore, pkgAfter, declared)) out.push({ file: f, kind: 'dependency', message: `package.json changes ${d.name} (${d.from ?? 'absent'} -> ${d.to ?? 'removed'}), which no ticket of this batch declared under "New dependencies"` });
      continue;
    }
    if (!owned(f, owns)) {
      const c = changes.find((x) => x.path === f || x.from === f);
      const how = c?.status === 'D' ? 'deletes' : c?.status === 'R' ? (c.from === f ? `renames away (to ${c.path})` : `renames into (from ${c.from})`) : c?.status === 'A' ? 'adds' : 'changes';
      out.push({ file: f, kind: 'outside', message: `${how} ${f}, which the ticket does not own` });
    }
  }
  return out;
}
