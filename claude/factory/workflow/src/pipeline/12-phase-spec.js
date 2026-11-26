// --- Spec -------------------------------------------------------------------
phase('Spec')
record('Spec', 'running')
let specs = input.specs
let problems
if (Array.isArray(specs) && specs.length > 0) {
  problems = validateSpecs(specs, contract, installed, guarded)
  state.specs = specs
  if (problems.length > 0) return stop('blocked', `The supplied specs are not usable: ${problems.join(' ')}`)
  log(`Using ${specs.length} supplied spec(s); planner skipped.`)
} else {
  // A plan with open questions stops here, before any spec is checked or
  // built: the answers may change the specs.
  const asked = p => {
    state.questions = openQuestions(p)
    state.overview = p.overview
    state.risks = p.risks
    if (state.questions.length === 0) return null
    state.specs = p.specs
    return stop('blocked', `The planner has ${state.questions.length} open question(s) that the contract, the issue and the repository do not answer: ${questionsText(state.questions)}`)
  }
  let plan = await planSpecs(contract)
  if (!plan) return stop('blocked', 'The planner did not return a result.')
  const firstAsk = asked(plan)
  if (firstAsk) return firstAsk
  if (questionsOnly) {
    state.specs = plan.specs
    return stop('ready', 'The planner has no open questions.')
  }
  problems = validateSpecs(plan.specs, contract, installed, guarded)
  let revisions = 0
  while (problems.length > 0 && revisions < maxSpecRevisions) {
    revisions++
    log(`Specs rejected (${problems.length} problem(s)); asking the planner to revise (${revisions}/${maxSpecRevisions}).`)
    const revised = await planSpecs(contract, plan.specs, problems)
    if (!revised) return stop('blocked', 'The planner did not return a revised result.')
    plan = revised
    const revisedAsk = asked(plan)
    if (revisedAsk) return revisedAsk
    problems = validateSpecs(plan.specs, contract, installed, guarded)
  }
  specs = plan.specs
  state.specs = specs
  state.overview = plan.overview
  state.risks = plan.risks
  state.rated = { risk: plan.risk, surfaces: plan.surfaces }
  if (problems.length > 0) return stop('blocked', `The specs are still not usable after ${maxSpecRevisions} revision(s): ${problems.join(' ')}`)
}

// Risk routes the review: code raises the rating to what the specs' files
// show, then picks the reviewers and their models from ROUTING. The prompt
// helpers read the result from `args` (models, surfaces).
const rated = state.rated || { risk: input.risk, surfaces: input.surfaces }
state.risk = assessRisk(rated.risk, rated.surfaces, specs)
args.models = routedModels(state.risk.risk, baseModels)
args.surfaces = state.risk.surfaces
log(`Risk ${state.risk.risk}${state.risk.raisedBy.length ? ` (raised: ${state.risk.raisedBy.join('; ')})` : ''}; surfaces: ${state.risk.surfaces.join(', ') || 'none'}.`)
if (!qcOn && state.risk.surfaces.includes('ui')) log('QC is off, but the change has a visible surface: nobody will use it before a person does.')
const noBrowserForUi = browserProblem(input.browser, contract, state.risk.surfaces, qcOn)
if (noBrowserForUi) return stop('blocked', noBrowserForUi)

const levels = buildLevels(specs)
progress.levels = levels.length
log(`${specs.length} spec(s) in ${levels.length} build level(s): ${levels.map(l => l.map(s => s.id).join('+')).join(' -> ')}`)
const untested = specs.filter(s => !hasTests(s)).map(s => s.id)
if (untested.length > 0) log(`No test-first step for ${untested.join(', ')}: the spec names no test files. QA still checks it.`)
