// The files of the fixture project: a tiny zero-dependency Node app whose checks
// look like a real one's (typecheck, lint, build, unit with a jest-format report,
// e2e that starts its own server on PORT and writes a Playwright-format report).
export const projectFiles = {
  'package.json': JSON.stringify(
    {
      name: 'fixture',
      private: true,
      type: 'module',
      scripts: { typecheck: 'node scripts/typecheck.mjs', lint: 'node scripts/lint.mjs', build: 'node scripts/build.mjs', test: 'node scripts/unit.mjs', e2e: 'node scripts/e2e.mjs', dev: 'node server.mjs' },
    },
    null,
    2,
  ),
  '.factory/project.json': JSON.stringify({ checks: { unit: { script: 'test', cmd: 'npm run test', report: 'jest' } } }, null, 2),
  'README.md': '# fixture\n',
  'scripts/files.mjs': `import fs from 'node:fs';
import path from 'node:path';
export function find(dir, re) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? (d.name === 'node_modules' ? [] : find(p, re)) : re.test(p) ? [p] : [];
  });
}
export const fileArgs = (argv) => argv.filter((a) => !a.startsWith('-'));
export const optArg = (argv, name) => argv.find((a) => a.startsWith(name + '='))?.slice(name.length + 1);
`,
  'scripts/typecheck.mjs': `import { spawnSync } from 'node:child_process';
import { find } from './files.mjs';
let bad = 0;
for (const f of [...find('src', /\\.mjs$/), ...find('e2e', /\\.mjs$/)]) {
  const r = spawnSync(process.execPath, ['--check', f], { stdio: 'inherit' });
  if (r.status !== 0) bad++;
}
process.exit(bad ? 1 : 0);
`,
  'scripts/lint.mjs': `process.exit(0);\n`,
  'scripts/build.mjs': `import fs from 'node:fs';
if (fs.existsSync('src/app.mjs')) {
  const app = await import(new URL('../src/app.mjs', import.meta.url));
  await app.load();
}
console.log('build ok');
`,
  'scripts/unit.mjs': `import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileArgs, find } from './files.mjs';
const argv = process.argv.slice(2);
const out = argv.find((a) => a.startsWith('--outputFile='))?.split('=')[1];
const files = fileArgs(argv).length ? fileArgs(argv) : find('src', /\\.test\\.mjs$/);
const results = files.map((f) => {
  const r = spawnSync(process.execPath, ['--test', f], { encoding: 'utf8' });
  process.stdout.write(r.stdout + r.stderr);
  return { name: path.resolve(f), status: r.status === 0 ? 'passed' : 'failed', assertionResults: [] };
});
if (out) fs.writeFileSync(out, JSON.stringify({ testResults: results }));
process.exit(results.some((r) => r.status === 'failed') ? 1 : 0);
`,
  'scripts/e2e.mjs': `import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileArgs, find } from './files.mjs';
const argv = process.argv.slice(2);
const port = process.env.PORT;
if (!port) { console.error('PORT is not set'); process.exit(1); }
const files = fileArgs(argv).length ? fileArgs(argv) : find('e2e', /\\.spec\\.mjs$/);
const server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: port }, stdio: 'ignore' });
const base = 'http://localhost:' + port;
let up = false;
for (let i = 0; i < 100 && !up; i++) {
  try { up = (await fetch(base)).ok; } catch { await new Promise((r) => setTimeout(r, 50)); }
}
const suites = [];
let failed = !up;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', f], { encoding: 'utf8', env: { ...process.env, BASE_URL: base } });
  process.stdout.write(r.stdout);
  const specs = [];
  for (const line of r.stdout.split('\\n')) {
    const m = /^\\s*(not )?ok \\d+ - (.+?)(?:\\s+#.*)?$/.exec(line);
    if (m && !m[2].endsWith('.mjs')) specs.push({ title: m[2], ok: !m[1], file: f, tests: [{ results: [{ status: m[1] ? 'failed' : 'passed' }] }] });
  }
  if (r.status !== 0) failed = true;
  suites.push({ title: f, file: f, specs });
}
server.kill();
if (process.env.PLAYWRIGHT_JSON_OUTPUT_NAME) fs.writeFileSync(process.env.PLAYWRIGHT_JSON_OUTPUT_NAME, JSON.stringify({ config: { rootDir: process.cwd() }, suites }));
process.exit(failed ? 1 : 0);
`,
  'server.mjs': `import http from 'node:http';
import fs from 'node:fs';
const port = Number(process.env.PORT || 4999);
http.createServer(async (req, res) => {
  let routes = [];
  if (fs.existsSync('src/app.mjs')) {
    try { routes = (await (await import(new URL('./src/app.mjs?' + Date.now(), import.meta.url))).load()).map((f) => f.route); } catch (e) { res.writeHead(500); res.end(String(e)); return; }
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, routes }));
}).listen(port);
`,
};

// The foundation's files, as the fake implementer of the foundation writes them.
export const foundationFiles = {
  'src/registry.mjs': `export function collect(features) {
  const seen = new Map();
  for (const f of features) {
    if (seen.has(f.route)) throw new Error('route ' + f.route + ' declared by ' + seen.get(f.route) + ' and ' + f.id);
    seen.set(f.route, f.id);
  }
  return features;
}
`,
  'src/app.mjs': `import fs from 'node:fs';
import path from 'node:path';
import { collect } from './registry.mjs';
export async function load() {
  const dir = new URL('./features/', import.meta.url);
  const names = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
  const features = [];
  for (const n of names) features.push((await import(new URL(n + '/index.mjs', dir))).default);
  return collect(features);
}
`,
  'src/registry.test.mjs': `import test from 'node:test';
import assert from 'node:assert/strict';
import { collect } from './registry.mjs';
import { load } from './app.mjs';
test('C1 the registry throws on a route declared twice', () => {
  assert.throws(() => collect([{ id: 'a', route: 'x' }, { id: 'b', route: 'x' }]), /declared by a and b/);
});
test('C2 every feature folder loads with no clash', async () => {
  const all = await load();
  assert.ok(Array.isArray(all));
});
`,
};

export function featureFiles(name, route, ids) {
  return {
    [`src/features/${name}/index.mjs`]: `export default { id: '${name}', route: '${route}', run: (x) => '${name}:' + x };\n`,
    [`src/features/${name}/index.test.mjs`]: `import test from 'node:test';
import assert from 'node:assert/strict';
import f from './index.mjs';
${ids.map((id) => `test('${id} ${name} answers', () => { assert.equal(f.run(1), '${name}:1'); });`).join('\n')}
`,
    [`e2e/${name}.spec.mjs`]: `import test from 'node:test';
import assert from 'node:assert/strict';
test('${ids[0]} ${name} is served', async () => {
  const r = await (await fetch(process.env.BASE_URL)).json();
  assert.ok(r.routes.includes('${route}'));
});
`,
  };
}
