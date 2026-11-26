// Files changed in the repository that no spec owns, that were not already
// dirty before the run started and that are not generated caches.
function filesOutsideOwnership(changedFiles, specs, ignoreFiles) {
  const owned = ownedFiles(specs)
  const ignore = [...GENERATED, ...FACTORY_ARTIFACTS, ...(ignoreFiles || [])]
  return (changedFiles || []).map(normPath).filter(f => f && !owned.has(f) && !ignore.some(e => matchesIgnore(f, e)))
}

// The checker's result for one contract check: the result with the check's
// name, else the one whose command is the check's command. The checker copies
// names back, and a name it shortens (a run once lost "ci-tests: Run unit
// tests" to "ci-tests") must not turn a check that ran into one "not run".
// undefined when neither matches.
function resultFor(results, check) {
  const list = results || []
  const squash = s => String(s || '').replace(/\s+/g, ' ').trim()
  return list.find(r => r.name === check.name)
    || list.find(r => squash(r.name) === squash(check.name))
    || list.find(r => squash(r.command) === squash(check.command))
}

// The failures of the contract's checks alone: a check not run, or not exiting 0.
function checkFailures(contract, check) {
  const failures = []
  for (const c of contract.checks) {
    const r = resultFor(check.results, c)
    if (!r) failures.push({ kind: 'check', name: c.name, problem: `Check "${c.name}" (${c.command}) was not run.` })
    else if (r.exitCode !== 0 && r.rerunExitCode === 0) continue // flaky: see flakyChecks
    else if (r.exitCode !== 0) {
      const f = { kind: 'check', name: c.name, problem: `Check "${c.name}" (${c.command}) exited with ${r.exitCode}.`, outputTail: r.outputTail }
      const culprits = (r.culprits || []).map(repoPath).filter(Boolean)
      if (culprits.length > 0) {
        f.culprits = culprits
        f.problem += ` Its failing tests pass alone; they fail after ${culprits.join(', ')}, which leaves state behind.`
        if (!isBlank(r.culpritEvidence)) f.culpritEvidence = r.culpritEvidence
      }
      failures.push(f)
    }
  }
  return failures
}

// Checks that failed and then passed when the checker ran them again as
// written: flaky, not broken by the change. They do not send anything back to
// Build (a rebuild cannot fix a test that fails at random) but are reported, so
// a person can fix the test.
function flakyChecks(contract, check) {
  return contract.checks
    .map(c => ({ c, r: resultFor(check.results, c) }))
    .filter(({ r }) => r && r.exitCode !== 0 && r.rerunExitCode === 0)
    .map(({ c, r }) => ({ name: c.name, command: c.command, outputTail: r.outputTail }))
}

// The specs whose tests must be shown to fail without the change: a feature,
// a bug fix or a UX change is built test-first, so its new tests, run against
// the base code, must fail. A test that passes there tests nothing the change
// added. Refactors, tests for existing code and docs pass there by design.
const TDD_KINDS = ['feature', 'bug', 'ux']
function tddTargets(specs) {
  return (specs || []).filter(s => TDD_KINDS.includes(s.kind) && (s.testFiles || []).length > 0)
}

const BASE_RUN_SKIP_RE = /^(?:n\/?a|not\s+run|skipped|none|-)$/i
const BASE_RUN_CRASH_RE = /(?:ERR_MODULE_NOT_FOUND|Cannot find module|MODULE_NOT_FOUND|ImportError|ModuleNotFoundError|ERR_ASSERTION|AssertionError|SyntaxError|ReferenceError|Traceback \(most recent call last\)|(?:^|\n)\s*[✖✘]\s|(?:^|\n)\s*FAIL\s)/m

// The checker's base runs, as failures: a spec whose tests passed on the base
// code goes back to Build. A spec with no base run is only noted (the runner
// may not run there); `unproven` lists them for the report.
function tddFailures(targets, baseRuns) {
  const runs = new Map((baseRuns || []).map(r => [r.spec, r]))
  const failures = []
  const unproven = []
  for (const s of targets) {
    const r = runs.get(s.id)
    if (!r) unproven.push(s.id)
    else if (r.exitCode === 0) {
      const tail = String(r.outputTail || '').trim()
      if (tail && BASE_RUN_SKIP_RE.test(tail)) {
        unproven.push(s.id)
        continue
      }
      if (tail && BASE_RUN_CRASH_RE.test(tail)) {
        // Checker accidentally captured cleanup's `$? == 0` after a real base-test failure.
        continue
      }
      failures.push({ kind: 'tdd', spec: s.id, problem: `The tests of ${s.id} (${(r.files || s.testFiles).join(', ')}) pass on the base code, without the change: they do not test what the change adds. Write tests that fail without it, for each criterion.` })
    }
  }
  return { failures, unproven }
}

// A change with a migration must migrate up, down and up again on the test
// database, when the project says how (contract.migration). A failing step, or
// a migration that was not tried, goes back to the spec that owns the migration.
function migrationFailures(contract, check) {
  const m = contract.migration
  const files = (check.changedFiles || []).map(normPath).filter(f => SENSITIVE.migration.some(p => matchesGlob(f, p)))
  if (!m || files.length === 0) return []
  const ran = check.migration
  if (!ran || !ran.ran) return [{ kind: 'check', name: 'migration', culprits: files, problem: `The change adds or edits a migration (${files.join(', ')}), but it was not run up, down and up again.` }]
  return (ran.steps || []).filter(st => st.exitCode !== 0).map(st => ({ kind: 'check', name: 'migration', culprits: files, outputTail: st.outputTail, problem: `Migration step \`${st.command}\` exited with ${st.exitCode}.` }))
}

// What the QC agent found, as failures: a criterion it saw fail when it used
// the product, or one it did not judge. `not_observable` (the criterion is
// about the code, not about what a user sees) passes, as no run could show it.
function qcFailures(contract, qc) {
  const failures = []
  const judged = new Map((qc.criteria || []).map(c => [c.id, c]))
  for (const c of contract.criteria) {
    const j = judged.get(c.id)
    if (!j) failures.push({ kind: 'qc', id: c.id, problem: `Criterion ${c.id} was not judged by QC.` })
    else if (j.status !== 'pass' && j.status !== 'not_observable') {
      failures.push({ kind: 'qc', id: c.id, problem: `Criterion ${c.id} fails when the product is used. Scenario: ${j.scenario} Expected: ${j.expected} Observed: ${j.observed}` })
    }
  }
  // A screen the change must not break (design.baseline) that looks different
  // from before, beyond the change it intends, is a regression.
  for (const b of (contract.design && contract.design.baseline) || []) {
    const j = (qc.baseline || []).find(x => x.screen === b.screen)
    if (!j) failures.push({ kind: 'regression', screen: b.screen, problem: `Screen "${b.screen}" (${b.route}) was not compared with how it looked before the change.` })
    else if (j.status === 'regressed') failures.push({ kind: 'regression', screen: b.screen, problem: `Screen "${b.screen}" (${b.route}) changed in ways the ticket does not ask for: ${(j.differences || []).join('; ') || 'no difference named'}. Before: ${(b.before || []).join(', ')}; after: ${j.after}` })
  }
  // Serious and critical accessibility problems on a screen this change makes.
  for (const a of qc.a11y || []) {
    const sc = ((contract.design && contract.design.screens) || []).find(x => x.screen === a.screen)
    if (!sc) continue
    const bad = (a.violations || []).filter(v => v.impact === 'serious' || v.impact === 'critical')
    for (const id of bad.length ? sc.criteria || [] : []) failures.push({ kind: 'qc', id, problem: `Screen "${sc.screen}" has ${bad.length} serious accessibility problem(s): ${bad.map(v => `${v.id} (${v.impact}, ${v.nodes} element(s))${v.help ? `: ${v.help}` : ''}`).join('; ')}.` })
  }
  // A screen with an approved mockup must look like it. A difference goes to
  // the specs responsible for the screen's criteria, like a failed criterion.
  const compared = new Map((qc.screens || []).map(sc => [sc.screen, sc]))
  for (const sc of (contract.design && contract.design.screens) || []) {
    const j = compared.get(sc.screen)
    const first = (sc.criteria || [])[0]
    if (!j) failures.push({ kind: 'qc', id: first, problem: `Screen "${sc.screen}" was not compared with its mockup ${sc.mockup}.` })
    else if (j.status !== 'match') {
      for (const id of sc.criteria || []) failures.push({ kind: 'qc', id, problem: `Screen "${sc.screen}" does not match its mockup ${sc.mockup}: ${(j.differences || []).join('; ') || 'no difference named'}. Screenshot: ${j.screenshot}` })
    }
  }
  return failures
}

// --- Coding standards -------------------------------------------------------
const STANDARD_ENFORCED = ['tool', 'review']
const STANDARD_SEVERITIES = ['blocking', 'minor']

function standardsProblems(contract) {
  const st = contract && contract.standards
  if (!st) return []
  const rules = st.rules
  if (!Array.isArray(rules) || rules.length === 0) return ['standards: no rules; leave "standards" out, or give its rules.']
  const problems = []
  const checks = new Set(((contract && contract.checks) || []).map(c => c.name))
  const seen = new Set()
  for (const [i, r] of rules.entries()) {
    const name = !r || isBlank(r.id) ? `rule ${i + 1}` : r.id
    if (!r || !/^S\d+$/.test(String(r.id || ''))) problems.push(`standards: ${name} needs an id S1, S2, ...`)
    else if (seen.has(r.id)) problems.push(`standards: ${r.id} is given twice.`)
    else seen.add(r.id)
    if (!r || isBlank(r.text)) problems.push(`standards: ${name} has no text.`)
    if (!r || !STANDARD_SEVERITIES.includes(r.severity)) problems.push(`standards: ${name} must be blocking or minor.`)
    if (!r || !STANDARD_ENFORCED.includes(r.enforced)) problems.push(`standards: ${name} must be enforced by tool or review.`)
    else if (r.enforced === 'tool' && !checks.has(r.check)) {
      const list = checks.size > 0 ? [...checks].join(', ') : 'none'
      problems.push(`standards: ${name} is kept by a tool, but its check "${r.check || ''}" is not one of the contract's checks (${list}).`)
    }
  }
  return problems
}

function standardsFailures(standards, review, spec) {
  const rules = new Map((((standards && standards.rules) || []).filter(r => r.enforced === 'review')).map(r => [r.id, r]))
  const out = []
  for (const j of (review && review.standards) || []) {
    const r = rules.get(j.id)
    if (!r || j.status !== 'fail' || r.severity !== 'blocking') continue
    const item = {
      kind: 'standard',
      id: r.id,
      file: normPath(j.file || ''),
      line: j.line,
      problem: `Coding standard ${r.id} is broken: ${r.text} ${j.evidence || ''}`.trim(),
    }
    if (spec) item.spec = spec.id
    out.push(item)
  }
  return out
}

function standardsReport(standards, check, reviews) {
  if (!standards || !Array.isArray(standards.rules)) return []
  const out = []
  const checkResults = (check && check.results) || []
  const validReviews = (reviews || []).filter(Boolean)
  for (const r of standards.rules) {
    const base = { id: r.id, text: r.text, severity: r.severity, enforced: r.enforced }
    if (r.enforced === 'tool') {
      const res = checkResults.find(x => x.name === r.check)
      if (!res) {
        out.push({ ...base, status: 'not_judged', evidence: `check "${r.check}" did not run` })
        continue
      }
      const ok = res.exitCode === 0 || res.rerunExitCode === 0
      const rerun = res.rerunExitCode !== undefined && res.rerunExitCode !== null ? `, ${res.rerunExitCode} on its rerun` : ''
      out.push({ ...base, status: ok ? 'pass' : 'fail', evidence: `${r.check} exited ${res.exitCode}${rerun}` })
      continue
    }
    const judged = validReviews.flatMap(v => (v.standards || []).filter(j => j.id === r.id))
    const fails = judged.filter(j => j.status === 'fail')
    if (fails.length > 0) {
      const ev = fails.map(j => `${j.file || '?'}${j.line ? `:${j.line}` : ''} ${j.evidence || ''}`.trim()).join('; ')
      out.push({ ...base, status: 'fail', evidence: ev })
    } else if (judged.some(j => j.status === 'pass')) {
      const pass = judged.find(j => j.status === 'pass' && j.evidence)
      out.push({ ...base, status: 'pass', evidence: (pass && pass.evidence) || '' })
    } else if (judged.length > 0) {
      out.push({ ...base, status: 'not_applicable', evidence: judged[0].evidence || '' })
    } else {
      out.push({ ...base, status: 'not_judged', evidence: 'no reviewer judged it' })
    }
  }
  return out
}

// Decides pass or fail from the raw facts. An agent's own "verdict" is never
// consulted: the result is passing only if this list is empty.
//
// `qc` is the QC agent's result, or null when it did not run: QC is off, or a
// check failed, so the change goes back to Build anyway and QC runs next round.
//
// `review` is the reviewer of the whole change, judged against the contract.
// `specReviews` is [{ spec, review }], one per spec when the work was split
// (empty for a single spec). A criterion passes only if the whole-change
// reviewer and every spec reviewer responsible for it all say `met`.
// What QA sends back never reaches this point: a spec QA fails goes back to
// Build before the change is checked or reviewed.
function evaluate(contract, check, review, specReviews, qc) {
  const failures = checkFailures(contract, check)

  const judged = new Map((review.criteria || []).map(c => [c.id, c]))
  for (const c of contract.criteria) {
    const j = judged.get(c.id)
    if (!j) failures.push({ kind: 'criterion', id: c.id, problem: `Criterion ${c.id} was not judged by the reviewer.` })
    else if (j.status !== 'met') {
      failures.push({ kind: 'criterion', id: c.id, problem: `Criterion ${c.id} is ${j.status}: ${j.evidence}` })
    }
  }

  for (const f of review.findings || []) {
    if (f.severity === 'blocking') {
      failures.push({ kind: 'finding', file: normPath(f.file), line: f.line, problem: f.problem })
    }
  }

  const brokenAt = new Set()
  const addStandard = sf => {
    const key = `${sf.id}|${sf.file}|${sf.line}`
    if (!brokenAt.has(key)) {
      brokenAt.add(key)
      failures.push(sf)
    }
  }
  for (const sf of standardsFailures(contract.standards, review, null)) addStandard(sf)

  for (const { spec, review: specReview } of specReviews || []) {
    const specJudged = new Map((specReview.criteria || []).map(c => [c.id, c]))
    for (const id of spec.criteria || []) {
      const j = specJudged.get(id)
      if (!j) failures.push({ kind: 'criterion', id, spec: spec.id, problem: `Criterion ${id} was not judged by the reviewer of ${spec.id}.` })
      else if (j.status !== 'met') {
        failures.push({ kind: 'criterion', id, spec: spec.id, problem: `Criterion ${id} is ${j.status} in ${spec.id}: ${j.evidence}` })
      }
    }
    for (const f of specReview.findings || []) {
      if (f.severity === 'blocking') {
        failures.push({ kind: 'finding', file: normPath(f.file), line: f.line, spec: spec.id, problem: f.problem })
      }
    }
    for (const sf of standardsFailures(contract.standards, specReview, spec)) addStandard(sf)
  }
  if (qc) failures.push(...qcFailures(contract, qc))
  return failures
}

// The planner's open questions, blank ones dropped. A plan with any is not
// built: nobody answers during a run, so a question the planner had to answer
// itself would be a guess that every agent after it builds on. The session
// takes them to the people who can answer, outside the run.
function openQuestions(plan) {
  if (!plan || !Array.isArray(plan.questions)) return []
  return plan.questions
    .map(q => (typeof q === 'string' ? { question: q, why: '', criteria: [] } : q))
    .filter(q => q && !isBlank(q.question))
    .map(q => ({ question: String(q.question).trim(), why: isBlank(q.why) ? '' : String(q.why).trim(), criteria: Array.isArray(q.criteria) ? q.criteria : [] }))
}

function questionsText(questions) {
  return questions.map((q, i) => `Q${i + 1}: ${q.question}${q.criteria.length ? ` (${q.criteria.join(', ')})` : ''}${q.why ? ` - ${q.why}` : ''}`).join(' ')
}

// Sends the failures of a check and review back to Build, to the specs that
// must answer for them. Each spec's implementer gets, in a fresh session, the
// failures that concern its own files, so no agent is handed another spec's work:
//   - a finding that names a file goes to the spec owning it;
//   - a criterion judged for one spec goes to that spec, one judged for the
//     whole change, or failed by QC, to every spec responsible for it;
//   - a failing check whose failing tests pass alone, and for which the
//     checker found the test file(s) that break them (`culprits`), goes to
//     the specs owning those files only: a mock or global leaked by one test
//     file makes many other files fail, and the output names the victims;
//   - any other failing check, or one whose culprits no spec owns, goes to
//     every spec whose files appear in its output, and to every spec when
//     none do, since code cannot tell whose fault it is.
// Anything that matches no spec goes to all of them. Returns [{ spec,
// failures }] in spec order, for the specs that have something to answer for.
function routeFailures(failures, specs) {
  const bySpec = new Map(specs.map(s => [s.id, []]))
  const owner = new Map()
  for (const s of specs) for (const f of specFiles(s)) owner.set(f, s.id)
  for (const f of failures) {
    let ids = []
    if ((f.kind === 'finding' || f.kind === 'standard') && owner.has(normPath(f.file))) ids = [owner.get(normPath(f.file))]
    else if (f.spec && bySpec.has(f.spec)) ids = [f.spec]
    else if (f.kind === 'criterion' || f.kind === 'qc') ids = specs.filter(s => (s.criteria || []).includes(f.id)).map(s => s.id)
    else if (f.kind === 'regression') ids = specs.filter(s => (s.filesOwned || []).some(file => UI_FILES.some(p => matchesGlob(file, p)))).map(s => s.id)
    else if (f.kind === 'check') {
      const culprits = new Set((f.culprits || []).map(repoPath).filter(c => owner.has(c)).map(c => owner.get(c)))
      if (culprits.size > 0) ids = specs.filter(s => culprits.has(s.id)).map(s => s.id)
      else {
        const out = String(f.outputTail || '')
        ids = specs.filter(s => specFiles(s).some(file => out.includes(file))).map(s => s.id)
      }
    }
    if (ids.length === 0) ids = specs.map(s => s.id)
    for (const id of ids) bySpec.get(id).push(f)
  }
  return specs.map(s => ({ spec: s, failures: bySpec.get(s.id) })).filter(g => g.failures.length > 0)
}

// The failure log: every failure that sent a spec back to Build, or that ended
// the run because its spec had already gone back `maxRebuilds` times, in the
// order found. After each run the invoking session reads the logs of recent
// runs for the mistakes the team keeps making (SKILL.md, step 7), so an entry
// keeps what the failure was, where it pointed and which specs had to answer
// for it, and nothing of any agent's account. The problem is cut short: the log
// is filed with every run in runs.js, and a pattern shows in a few lines.
// `groups` is the routing, [{ spec, failures }]; `at` is { stage, round,
// sentBack }: stage 'qa' with round = how many times the spec had been sent back
// before this QA (0 after its first build), or stage 'review' with round = the
// check-and-review pass (1 for the first). A failure routed to several specs is
