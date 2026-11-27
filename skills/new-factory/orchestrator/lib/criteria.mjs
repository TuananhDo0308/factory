// 4b: every criterion of the ticket has at least one test with its id in the
// name, and that test asserts something. Text only: nothing runs, well under a second.

export const isTestFile = (f) => /(?:^|\/)(?:tests?|__tests__|spec|e2e)\/|\.(?:test|spec)\.[\w]+$|_test\.[\w]+$|(?:^|\/)test_[^/]*\.py$/.test(f);

const ASSERT_JS = /\bexpect\s*[.(]|\bassert\b|\.should\b|\bt\.(?:is|true|false|deepEqual|equal|throws|ok)\b/;
const ASSERT_PY = /^\s*assert\b|\bself\.assert\w+\(|\bpytest\.raises\b/m;

// The id as a whole token: C5 matches "C5 ..." and "@C5", not "C50" or "C5.1".
const idRegex = (id) => new RegExp(`(?<![A-Za-z0-9.])${id.replace(/\./g, '\\.')}(?![0-9]|\\.[0-9])`, 'i');

// From an opening "(", the index after its matching ")", skipping strings and comments.
function callEnd(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') i = text.indexOf('\n', i) === -1 ? text.length : text.indexOf('\n', i);
    else if (c === '/' && text[i + 1] === '*') i = text.indexOf('*/', i + 2) === -1 ? text.length : text.indexOf('*/', i + 2) + 1;
    else if (c === '"' || c === "'" || c === '`') {
      for (i++; i < text.length && text[i] !== c; i++) if (text[i] === '\\') i++;
    } else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i + 1;
  }
  return text.length;
}

// The tests of a file: [{ title, body, skipped }].
export function testsIn(file, text) {
  const out = [];
  if (file.endsWith('.py')) {
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      const m = /^(\s*)(?:async\s+)?def\s+(test\w*)\s*\(/.exec(line) || /^(\s*)class\s+(Test\w*)/.exec(line);
      if (!m) return;
      const indent = m[1].length;
      let j = i + 1;
      while (j < lines.length && (lines[j].trim() === '' || lines[j].search(/\S/) > indent)) j++;
      const doc = /^\s*(?:"""|''')(.*)/.exec(lines[i + 1] || '')?.[1] || '';
      out.push({ title: `${m[2].replace(/_/g, ' ')} ${doc}`, body: lines.slice(i + 1, j).join('\n'), skipped: /@pytest\.mark\.skip/.test(lines[i - 1] || '') });
    });
    return out;
  }
  const decl = /\b(test|it|describe|Deno\.test)((?:\.\w+)*)\s*\(\s*(['"`])((?:\\.|(?!\3).)*)\3/g;
  for (let m; (m = decl.exec(text)); ) {
    const open = text.indexOf('(', m.index + m[1].length + m[2].length);
    const end = callEnd(text, open);
    out.push({ title: m[4], body: text.slice(m.index + m[0].length, end), skipped: /\.(?:skip|todo|fixme)\b/.test(m[2]), group: m[1] === 'describe' });
  }
  return out;
}

// files: [{ path, text }] (the ticket's test files). ids: the ticket's criteria.
// Returns { problems: [string], found: { C5: [{ file, title }] } }.
export function criteriaTests(files, ids) {
  const found = Object.fromEntries(ids.map((id) => [id, []]));
  const weak = Object.fromEntries(ids.map((id) => [id, []]));
  for (const f of files) {
    const assertRe = f.path.endsWith('.py') ? ASSERT_PY : ASSERT_JS;
    for (const t of testsIn(f.path, f.text)) {
      if (t.skipped) continue;
      for (const id of ids) {
        if (!idRegex(id).test(t.title)) continue;
        (assertRe.test(t.body) ? found : weak)[id].push({ file: f.path, title: t.title.trim() });
      }
    }
  }
  const problems = [];
  for (const id of ids) {
    if (found[id].length) continue;
    if (weak[id].length) problems.push(`${id}: the test "${weak[id][0].title}" in ${weak[id][0].file} has no assertion (expect/assert)`);
    else problems.push(`${id}: no test has ${id} in its name; every criterion needs at least one test named with its id and a real assertion`);
  }
  return { problems, found };
}
