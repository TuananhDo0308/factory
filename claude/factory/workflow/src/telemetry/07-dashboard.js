const PROBLEM_CHARS = 300
function failureEntries(groups, at) {
  const entries = new Map()
  for (const g of groups || []) {
    for (const f of g.failures || []) {
      let e = entries.get(f)
      if (!e) {
        const problem = String(f.problem || '').trim()
        e = { stage: at.stage, round: at.round, kind: f.kind, specs: [] }
        if (!isBlank(f.file)) e.file = normPath(f.file)
        if (f.line !== undefined && f.line !== null && f.line !== '') e.line = f.line
        if (f.kind === 'criterion' || f.kind === 'qc') e.criterion = f.id
        if (f.kind === 'check') e.check = f.name
        if (f.kind === 'standard') e.rule = f.id
        e.problem = problem.length > PROBLEM_CHARS ? `${problem.slice(0, PROBLEM_CHARS - 1)}…` : problem
        e.sentBack = Boolean(at.sentBack)
        entries.set(f, e)
      }
      if (!e.specs.includes(g.spec.id)) e.specs.push(g.spec.id)
    }
  }
  return [...entries.values()]
}

// One reviewer's result in a few words, for the dashboard.
function reviewLine(review) {
  const criteria = review.criteria || []
  const met = criteria.filter(c => c.status === 'met').length
  const blocking = (review.findings || []).filter(f => f.severity === 'blocking').length
  return {
    text: `${met}/${criteria.length} criteria met${blocking > 0 ? `, ${blocking} blocking finding(s)` : ''}`,
    state: met === criteria.length && blocking === 0 ? 'ok' : 'fail',
  }
}

// What the QA agent of one spec found, in a few words, for the dashboard.
function qaLine(report) {
  if (!report) return ''
  const gaps = report.gaps || []
  const written = gaps.filter(g => g.written).length
  const failing = (report.failures || []).length
  return `QA: ${gaps.length} gap(s), ${written} test(s) added${failing > 0 ? `, ${failing} sent back` : ''}`
}

// What the QC agent of one round found, in a few words, for the dashboard.
function qcLine(qc) {
  const criteria = qc.criteria || []
  const count = s => criteria.filter(c => c.status === s).length
  const failing = criteria.length - count('pass') - count('not_observable')
  return {
    text: `${count('pass')}/${criteria.length} criteria pass when used${count('not_observable') > 0 ? `, ${count('not_observable')} not observable` : ''}${failing > 0 ? `, ${failing} fail` : ''}`,
    state: failing === 0 && criteria.length > 0 ? 'ok' : 'fail',
  }
}

// The run as the dashboard shows it, built from the raw state so that what is
// displayed is decided here and not by the agent that writes the file.
// `run` is { id, title, agents, maxRepairRounds }; `progress` is { phase,
// outcome, levels, build: { <spec id>: { impl, test } }, repairs }. For a spec,
// `impl` is its implementer and `test` its QA agent; `repairs` lists every time
// work went back to Build, as { tag, text, state }.
function runRecord(run, contract, state, progress) {
  const specs = state.specs || []
  const failed = new Set((state.failures || []).filter(f => f.kind === 'criterion' || f.kind === 'qc').map(f => f.id))
  const qc = (state.qc || []).slice(-1)[0]
  const results = state.check ? state.check.results || [] : []
  return {
    id: run.id,
    title: run.title,
    outcome: progress.outcome,
    // What the workflow itself decided. The invoking session may later change `outcome` when its
    // own run of the checks disagrees; this field keeps the workflow's verdict next to it.
    workflowOutcome: progress.outcome,
    reason: state.reason,
    phase: progress.phase,
    agents: run.agents,
    repairRounds: state.repairRounds,
    maxRepairRounds: run.maxRepairRounds,
    specLine: specs.length > 0 && progress.levels ? `${specs.length} spec(s) · ${progress.levels} level(s)` : '',
    specs: specs.map(s => {
      const build = progress.build[s.id] || {}
      const built = (state.builds || []).find(b => b.spec === s.id)
      const qa = (state.qa || []).filter(q => q.spec === s.id).pop()
      const tdd = built ? (built.tdd || []).filter(t => (t.tests || []).length > 0).length : 0
      return {
        id: s.id,
        title: s.title,
        kind: s.kind,
        goal: s.goal,
        criteria: [...(s.criteria || [])],
        filesOwned: [...(s.filesOwned || [])],
        testFiles: [...(s.testFiles || [])],
        impl: build.impl || 'wait',
        test: build.test || 'wait',
        waitFor: (s.dependsOn || []).join(', '),
        implNote: built && hasTests(s) ? `Test-first: ${tdd}/${(s.criteria || []).length} criteria` : '',
        testNote: qaLine(qa),
      }
    }),
    check: state.check
      ? {
          text: results.map(r => `${r.name}: exit ${r.exitCode}`).join(' · ') || 'no checks to run',
          state: results.every(r => r.exitCode === 0 || r.rerunExitCode === 0) ? 'ok' : 'fail',
        }
      : { text: contract.checks.map(c => c.command).join(' · ') },
    review: state.review
      ? [
          { tag: 'whole change', ...reviewLine(state.review) },
          ...(state.specReviews || []).map(r => ({ tag: r.spec, ...reviewLine(r) })),
          ...(qc ? [{ tag: 'qc', ...qcLine(qc) }] : []),
        ]
      : [],
    repairs: progress.repairs,
    criteria: contract.criteria.map(c => ({ id: c.id, text: c.text, status: state.review ? (failed.has(c.id) ? 'not_met' : 'met') : '' })),
    failureLog: state.failureLog || [],
    // How the review was routed, and whether a person must accept a passing run.
    risk: state.risk ? { level: state.risk.risk, surfaces: state.risk.surfaces, raisedBy: state.risk.raisedBy } : null,
    merge: state.merge || null,
    // Questions the planner stopped on, flaky checks, and specs whose tests
    // could not be shown to fail on the base code.
    questions: (state.questions || []).map(q => ({ question: q.question, criteria: q.criteria })),
    flaky: (state.flaky || []).map(f => f.name),
    tddUnproven: state.tddUnproven || [],
    ...(!isBlank(run.repo) ? { repo: String(run.repo).replace(/\/+$/, '') } : {}),
    ...(!isBlank(run.issueKey) ? { issueKey: String(run.issueKey).trim() } : {}),
    ...(Number.isInteger(run.issueNumber) ? { issueNumber: run.issueNumber } : {}),
  }
}
