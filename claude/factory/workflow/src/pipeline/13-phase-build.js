// --- Build, with the loop back from QA -----------------------------------------
// Each spec runs its own chain, like a card on super-board's board: the
// implementer writes the tests first and then the code, then QA checks the
// spec. When QA sends failures back, the spec returns to Build: a fresh session
// of its implementer acts on them, and a fresh QA checks it again, until QA
// passes it or it has been sent back `maxRebuilds` times. The chains of one
// level run in parallel. Barrier per level on purpose: the next level depends
// on everything in this one.
//
// `failures` and `source` are set when the spec comes back from review.
// Returns { ok: true } when QA passes the spec, or { stop, reason }.
async function chain(spec, failures, source) {
  let pending = failures || null
  let from = source || ''
  while (true) {
    const n = state.sentBack[spec.id] || 0
    progress.build[spec.id] = { impl: 'run', test: 'wait' }
    if (pending) {
      const fixed = await rebuildSpec(spec, pending, from, contract, specs, n)
      const problem = settle({ role: 'rebuild', spec, allowed: specFiles(spec) }, fixed, { rebuild: n })
      const changed = testsChanged(fixed && fixed.filesChanged, spec)
      if (changed.length > 0) {
        state.testsChangedInRebuild.push({ rebuild: n, spec: spec.id, files: changed })
        log(`${spec.id}, rebuild ${n}: the implementer changed test file(s) ${changed.join(', ')}.`)
      }
      if (problem) return { stop: 'failed', reason: problem }
    } else {
      const built = await buildSpec(spec, contract)
      const problem = settle({ role: 'implementer', spec, allowed: specFiles(spec) }, built, {})
      if (problem) return { stop: 'blocked', reason: problem }
    }
    progress.build[spec.id] = { impl: 'ok', test: 'run' }
    record('Build', 'running')

    const checked = await qaSpec(spec, contract, n)
    const qaProblem = settle({ role: 'qa', spec, allowed: spec.testFiles || [] }, checked, n > 0 ? { rebuild: n } : {})
    if (qaProblem) return { stop: 'blocked', reason: qaProblem }
    const found = (checked.failures || []).map(f => ({ kind: 'qa', file: normPath(f.file), line: f.line, spec: spec.id, problem: f.problem }))
    if (found.length === 0) {
      progress.build[spec.id] = { impl: 'ok', test: 'ok' }
      return { ok: true }
    }
    state.failureLog.push(...failureEntries([{ spec, failures: found }], { stage: 'qa', round: n, sentBack: n < maxRebuilds }))
    if (n >= maxRebuilds) {
      progress.build[spec.id] = { impl: 'ok', test: 'fail' }
      return { stop: 'failed', reason: `${spec.id}: QA still sends back ${found.length} failure(s) after ${n} rebuild(s).` }
    }
    state.sentBack[spec.id] = n + 1
    log(`${spec.id}: QA sent back ${found.length} failure(s); back to Build (${n + 1}/${maxRebuilds}).`)
    progress.repairs = [...progress.repairs, { tag: `${spec.id} from QA`, text: `${found.length} failure(s), back to Build (${n + 1}/${maxRebuilds})`, state: 'ok' }]
    pending = found
    from = 'its QA agent'
  }
}

// Runs chains in parallel and turns their results into the reason to stop, if any.
async function runChains(jobs) {
  const results = await parallel(jobs.map(j => () => chain(j.spec, j.failures, j.source)))
  const stops = jobs.map((j, i) => (results[i] ? results[i] : { stop: 'blocked', reason: `${j.spec.id}: its build did not finish.` })).filter(r => r.stop)
  if (stops.length === 0) return null
  return { outcome: stops.some(r => r.stop === 'blocked') ? 'blocked' : 'failed', reason: stops.map(r => r.reason).join(' | ') }
}

phase('Build')
for (const level of levels) {
  for (const spec of level) progress.build[spec.id] = { impl: 'run', test: 'wait' }
  record('Build', 'running')
  const stopped = await runChains(level.map(spec => ({ spec })))
  if (stopped) return stop(stopped.outcome, `The build could not be completed. ${stopped.reason}`)
}
