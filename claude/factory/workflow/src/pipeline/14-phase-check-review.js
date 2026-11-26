// --- Check and review; failures go back to Build ---------------------------
let round = 0
let rebuilt = null
while (true) {
  phase('Check')
  record('Check', 'running')
  const tdd = tddTargets(rebuilt ? specs.filter(s => rebuilt.has(s.id)) : specs)
  const check = await runChecks(contract, specs, round, tdd)
  if (!check) return stop('blocked', 'The checker did not return a result.')
  state.check = check

  let stray = filesOutsideOwnership(check.changedFiles, specs, input.ignoreFiles)
  let touched = protectedFiles(check.changedFiles, input.protectedPaths, allowProtected)
  if (stray.length > 0 || touched.length > 0) {
    const flagged = [...new Set([...stray, ...touched])]
    const verified = await verifyChangedFiles(flagged, round)
    if (verified && Array.isArray(verified.changedFiles)) {
      const prevSet = new Set((check.changedFiles || []).map(normPath).filter(Boolean))
      const nextList = verified.changedFiles.map(normPath).filter(Boolean)
      const nextSet = new Set(nextList)
      const changed = prevSet.size !== nextSet.size || [...prevSet].some(f => !nextSet.has(f))
      if (changed) {
        log(`Checker changedFiles re-verified against git (${prevSet.size} -> ${nextSet.size} file(s)); using verified list.`)
        check.changedFiles = nextList
      }
      stray = filesOutsideOwnership(check.changedFiles, specs, input.ignoreFiles)
      touched = protectedFiles(check.changedFiles, input.protectedPaths, allowProtected)
    }
  }
  const caches = (check.changedFiles || []).map(normPath).filter(f => !ownedFiles(specs).has(f) && GENERATED.some(e => matchesIgnore(f, e)))
  if (caches.length > 0) log(`Not counted as changes: ${caches.length} generated cache file(s) (${caches.join(', ')}).`)
  if (stray.length > 0) {
    return stop('blocked', `Files were changed that no spec owns: ${stray.join(', ')}. Either the specs were incomplete or an agent went outside its assignment.`)
  }
  if (touched.length > 0) {
    return stop('blocked', `Protected files were changed: ${touched.join(', ')}. They hold the checks the run is judged by; undo the change, or allow it with "allowProtected" if the task is about them.`)
  }

  // The gate: a change that fails a check goes straight back to Build with the
  // checker's output, and no reviewer or QC agent is started on it. Reviewing
  // code that does not pass its own checks costs agents and finds what the
  // checks already found.
  for (const f of flakyChecks(contract, check)) {
    if (!state.flaky.some(x => x.name === f.name)) state.flaky.push(f)
    log(`Flaky: check "${f.name}" failed, then passed when run again; not sent back, reported.`)
  }
  const proof = isBlank(contract.testFileCommand) ? { failures: [], unproven: [] } : tddFailures(tdd, check.baseRuns)
  for (const id of proof.unproven) if (!state.tddUnproven.includes(id)) state.tddUnproven.push(id)
  const red = [...checkFailures(contract, check), ...migrationFailures(contract, check), ...proof.failures]
  if (red.length > 0) {
    log(`Gate: ${red.length} check(s) failed; no reviewer runs this round.`)
    state.failures = red
    state.standards = standardsReport(contract.standards, check, [])
  } else {
    // With several specs and a risk above low, every spec gets its own
    // reviewer, alongside the reviewer of the whole change. QC uses the product
    // beside them. None depends on another, so they run together.
    phase('Review')
    const reviewedSpecs = specs.length > 1 && (ROUTING[state.risk.risk] || ROUTING.medium).specReviews ? specs : []
    record('Review', 'running')
    const reviews = await parallel([
      () => runReview(contract, check, specs, round),
      ...reviewedSpecs.map(spec => () => runSpecReview(spec, contract, check, round)),
      ...(qcOn ? [() => runQc(contract, round)] : []),
    ])
    const review = reviews[0]
    if (!review) return stop('blocked', 'The reviewer did not return a result.')
    const specReviews = reviewedSpecs.map((spec, i) => ({ spec, review: reviews[i + 1] }))
    const absent = specReviews.filter(r => !r.review).map(r => r.spec.id)
    if (absent.length > 0) return stop('blocked', `The reviewer of ${absent.join(', ')} did not return a result.`)
    state.review = review
    state.specReviews = specReviews.map(r => ({ spec: r.spec.id, ...r.review }))

    let qc = null
    if (qcOn) {
      qc = reviews[reviewedSpecs.length + 1]
      if (!qc) return stop('blocked', 'The QC agent did not return a result.')
      state.qc.push({ round, ...qc })
      if (qc.status !== 'done') return stop('blocked', `QC could not run the product: ${qc.blockedReason || 'no reason given'}`)
      const leftover = (qc.filesChanged || []).map(repoPath).filter(Boolean)
      if (leftover.length > 0) return stop('blocked', `QC changed files in the repository, which it may not do: ${leftover.join(', ')}`)
    }

    state.failures = evaluate(contract, check, review, specReviews, qc)
    state.standards = standardsReport(contract.standards, check, [review, ...specReviews.map(r => r.review)])
    if (state.failures.length === 0) {
      state.merge = escalation(check.changedFiles, state.risk, state.testsChangedInRebuild, input.escalate)
      const merge = state.merge.decision === 'auto' ? 'It may be merged without a person.' : `A person must accept it before it is merged: ${state.merge.reasons.join('; ')}.`
      const notes = [
      ...(state.flaky.length ? [`Flaky, fix the test: ${state.flaky.map(f => f.name).join(', ')}.`] : []),
      ...(state.tddUnproven.length ? [`Not shown to fail on the base code (no base run): ${state.tddUnproven.join(', ')}.`] : []),
    ].join(' ')
    return stop('passed', `All checks pass, every criterion is met${qcOn ? ' and QC saw it work' : ' (QC was turned off)'}${round > 0 ? `, after ${round} return(s) to Build` : ''}. ${merge}${notes ? ` ${notes}` : ''}`)
    }
  }

  // The specs the failures concern go back to Build, each to a fresh session of
  // its implementer and then to QA again, as a card goes back to Ready.
  const groups = routeFailures(state.failures, specs)
  const spent = groups.filter(g => (state.sentBack[g.spec.id] || 0) >= maxRebuilds).map(g => g.spec.id)
  state.failureLog.push(...failureEntries(groups, { stage: 'review', round: round + 1, sentBack: spent.length === 0 }))
  if (spent.length > 0) {
    return stop('failed', `${state.failures.length} failure(s) remain, and ${spent.join(', ')} ha${spent.length === 1 ? 's' : 've'} already been sent back to Build ${maxRebuilds} time(s).`)
  }
  round++
  state.repairRounds = round
  for (const g of groups) state.sentBack[g.spec.id] = (state.sentBack[g.spec.id] || 0) + 1
  rebuilt = new Set(groups.map(g => g.spec.id))
  const who = groups.map(g => g.spec.id).join(', ')
  log(`${state.failures.length} failure(s) from check, review and QC; back to Build: ${who}.`)
  progress.repairs = [...progress.repairs, { tag: `review ${round}`, text: `${state.failures.length} failure(s), back to Build: ${who}`, state: 'run' }]
  phase('Build')
  record('Build', 'running')
  const stopped = await runChains(groups.map(g => ({ spec: g.spec, failures: g.failures, source: 'the checker, the reviewers and QC' })))
  if (stopped) return stop(stopped.outcome, `A spec sent back to Build could not be completed. ${stopped.reason}`)
  progress.repairs = progress.repairs.map(r => (r.tag === `review ${round}` ? { ...r, state: 'ok' } : r))
}
