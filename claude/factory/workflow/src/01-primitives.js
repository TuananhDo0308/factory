function normPath(p) {
  return String(p || '').trim().replace(/^\.\//, '').replace(/\/+$/, '')
}

function isBlank(v) {
  return v === undefined || v === null || String(v).trim() === ''
}

// Every spec has an implementer. `filesOwned` are its source files and
// `testFiles` the tests it writes first; a spec may have only one of the two.
// A spec with test files also gets a QA agent after the build.
function hasCode(spec) {
  return Array.isArray(spec.filesOwned) && spec.filesOwned.length > 0
}

function hasTests(spec) {
  return Array.isArray(spec.testFiles) && spec.testFiles.length > 0
}

// All the files of one spec: what its implementer may change.
function specFiles(spec) {
  return [...(spec.filesOwned || []), ...(spec.testFiles || [])].map(normPath)
}
