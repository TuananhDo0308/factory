function validateSpecs(specs, contract, available, guarded) {
  const problems = []
  if (!Array.isArray(specs) || specs.length === 0) return ['No specs were returned.']

  const ids = new Set()
  for (const s of specs) {
    if (isBlank(s.id)) { problems.push('A spec has no id.'); continue }
    if (ids.has(s.id)) problems.push(`Spec id ${s.id} is used more than once.`)
    ids.add(s.id)
    for (const field of ['title', 'goal', 'tests']) {
      if (isBlank(s[field])) problems.push(`Spec ${s.id}: "${field}" is empty.`)
    }
    if (!hasCode(s) && !hasTests(s)) problems.push(`Spec ${s.id}: owns no files.`)
    if (hasCode(s)) {
      if (isBlank(s.changes)) problems.push(`Spec ${s.id}: "changes" is empty.`)
      if (!Array.isArray(s.doneWhen) || s.doneWhen.length === 0) problems.push(`Spec ${s.id}: has no "doneWhen" checklist.`)
    }
    if (!Array.isArray(s.criteria) || s.criteria.length === 0) problems.push(`Spec ${s.id}: is responsible for no criterion.`)
    if (!SKILLS.kinds.includes(s.kind)) problems.push(`Spec ${s.id}: "kind" must be one of ${SKILLS.kinds.join(', ')}.`)
    for (const name of s.skills || []) {
      if (SKILLS.interactive.includes(name)) problems.push(`Spec ${s.id}: skill ${name} waits on a person, and nobody answers during a run.`)
      else if (available && !available.includes(name)) problems.push(`Spec ${s.id}: skill ${name} is not installed for this run.`)
    }
  }

  const known = new Set(contract.criteria.map(c => c.id))
  const covered = new Set()
  for (const s of specs) {
    for (const c of s.criteria || []) {
      if (!known.has(c)) problems.push(`Spec ${s.id}: names criterion ${c}, which is not in the contract.`)
      covered.add(c)
    }
  }
  for (const c of contract.criteria) {
    if (!covered.has(c.id)) problems.push(`Criterion ${c.id} is not covered by any spec.`)
  }

  // One owner per file across specs; inside a spec, a file is either source or test.
  const owner = new Map()
  for (const s of specs) {
    const kinds = new Map()
    for (const [kind, files] of [['filesOwned', s.filesOwned], ['testFiles', s.testFiles]]) {
      for (const raw of files || []) {
        const f = normPath(raw)
        if (!f) { problems.push(`Spec ${s.id}: has an empty file path.`); continue }
        if (kinds.has(f) && kinds.get(f) !== kind) problems.push(`Spec ${s.id}: file ${f} is listed in both filesOwned and testFiles; a file is either source or test.`)
        kinds.set(f, kind)
        if (owner.has(f) && owner.get(f) !== s.id) {
          problems.push(`File ${f} is owned by both ${owner.get(f)} and ${s.id}; a file may have one owner only.`)
        }
        owner.set(f, s.id)
        if (guarded && guarded(f)) {
          problems.push(`Spec ${s.id}: owns ${f}, which is protected: the checks a run is judged by may not change in it. Reach the criterion without it, or the caller must allow it with "allowProtected".`)
        }
      }
    }
  }

  for (const s of specs) {
    for (const d of s.dependsOn || []) {
      if (d === s.id) problems.push(`Spec ${s.id}: depends on itself.`)
      else if (!ids.has(d)) problems.push(`Spec ${s.id}: depends on ${d}, which does not exist.`)
    }
  }
  if (problems.length === 0 && buildLevels(specs) === null) {
    problems.push('The "dependsOn" links form a cycle, so there is no order in which the specs can be built.')
  }
  return problems
}

// Groups specs into levels: every spec in a level depends only on earlier
// levels, so one level can be built in parallel. Returns null on a cycle.
function buildLevels(specs) {
  const done = new Set()
  let remaining = specs.slice()
  const levels = []
  while (remaining.length > 0) {
    const ready = remaining.filter(s => (s.dependsOn || []).every(d => done.has(d)))
    if (ready.length === 0) return null
    levels.push(ready)
    for (const s of ready) done.add(s.id)
    remaining = remaining.filter(s => !done.has(s.id))
  }
  return levels
}

function ownedFiles(specs) {
  const set = new Set()
  for (const s of specs) for (const f of specFiles(s)) set.add(f)
  return set
}

// Agents sometimes report absolute paths; files are compared relative to the repository.
function repoPath(p) {
  const root = String(args.repo || '').replace(/\/+$/, '')
  const f = normPath(p)
  return root && f.startsWith(`${root}/`) ? f.slice(root.length + 1) : f
}

// Files one agent says it changed that are not in the list it was given. The
// checker's list cannot tell who changed a file, so this is the per-agent check.
function filesOutsideAssignment(filesChanged, allowed) {
  const mine = new Set((allowed || []).map(repoPath))
  return (filesChanged || []).map(repoPath).filter(f => f && !mine.has(f))
}

// The test files of a spec that one agent says it changed.
function testsChanged(filesChanged, spec) {
  const tests = new Set((spec.testFiles || []).map(repoPath))
  return [...new Set((filesChanged || []).map(repoPath).filter(f => tests.has(f)))]
}
