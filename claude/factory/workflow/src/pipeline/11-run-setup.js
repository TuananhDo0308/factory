// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

if (typeof args === 'string') {
  try { args = JSON.parse(args) } catch { args = {} }
}
if (!args || typeof args !== 'object') args = {}
const input = args
let contract = input.contract
// How many times one spec may be sent back to Build, by QA or by review
// (super-board's rebuild cap). A spec past it fails the run.
const maxRebuilds = Number.isInteger(input.maxRebuilds) ? input.maxRebuilds : 2
const maxSpecRevisions = Number.isInteger(input.maxSpecRevisions) ? input.maxSpecRevisions : 2
// QC runs unless the caller turns it off with `qc: false`, for a change no user
// can see (the session says why in its report).
const qcOn = input.qc !== false && input.questionsOnly !== true
// `questionsOnly: true` runs the planner alone, as the readiness check before
// an issue is marked ready: outcome `ready` when it has no questions, else
// `blocked` with them in `questions`. Nothing is built.
const questionsOnly = input.questionsOnly === true
// The agents' scratch directories go next to the repository by default, never
// inside it, where they would show up as changes that no spec owns.
const repo = String(input.repo || '').replace(/\/+$/, '')
const scratch = isBlank(input.scratch) ? `${repo}-factory-scratch` : String(input.scratch).replace(/\/+$/, '')

const state = { outcome: 'blocked', reason: '', overview: '', risks: [], questions: [], risk: null, merge: null, flaky: [], tddUnproven: [], specs: [], builds: [], qa: [], rebuilds: [], sentBack: {}, testsChangedInRebuild: [], check: null, review: null, specReviews: [], qc: [], standards: [], failures: [], failureLog: [], repairRounds: 0 }

// Progress for the dashboard, only when the caller passed `dashboard.file`.
// Records are written one after another and without holding the team up; only
// the last one is waited for.
const dash = input.dashboard && !isBlank(input.dashboard.file) ? input.dashboard : null
const runId = dash && !isBlank(dash.id)
  ? dash.id
  : (!isBlank(input.runId) ? String(input.runId).trim() : `run-${String(input.base || '').slice(0, 7) || 'dev'}`)
const progress = { phase: 'Spec', outcome: 'running', levels: 0, build: {}, repairs: [] }
let recording = Promise.resolve()

function record(phaseTitle, outcome) {
  progress.phase = phaseTitle
  progress.outcome = outcome
  if (!dash) return recording
  const issueObj = input.issue && typeof input.issue === 'object' ? input.issue : {}
  const issueNumber = Number.isInteger(issueObj.number) ? issueObj.number : undefined
  const issueKeyRaw = dash.issueKey || issueObj.issueKey || issueObj.key || ''
  const run = {
    id: runId,
    title: isBlank(dash.title) ? (contract && contract.objective) || '' : dash.title,
    agents: started,
    maxRepairRounds: maxRebuilds,
    ...(!isBlank(repo) ? { repo } : {}),
    ...(!isBlank(issueKeyRaw) ? { issueKey: String(issueKeyRaw).trim() } : {}),
    ...(issueNumber !== undefined ? { issueNumber } : {}),
  }
  const snapshot = runRecord(run, contract, state, progress)
  const label = outcome === 'running' ? `record ${phaseTitle}` : `record ${outcome}`
  recording = recording.then(() => writeProgress(dash.file, snapshot, label, phaseTitle)).catch(() => null)
  return recording
}

async function stop(outcome, reason) {
  state.outcome = outcome
  state.reason = reason
  log(`${outcome}: ${reason}`)
  if (contract && Array.isArray(contract.criteria) && Array.isArray(contract.checks)) await record(progress.phase, outcome)
  return state
}

// Records what one agent returned. Returns the reason the run has to stop
// because of it, or '' if the agent did its job inside its own files. A job is
// { role, spec, allowed }: `allowed` is the list of files it may change.
// `tag` marks a later session: { rebuild: n }.
const JOBS = {
  implementer: { list: 'builds', who: 'implementer' },
  qa: { list: 'qa', who: 'QA' },
  rebuild: { list: 'rebuilds', who: 'implementer' },
}
function settle(job, result, tag) {
  const kind = JOBS[job.role]
  const r = result || { status: 'blocked', blockedReason: `The ${kind.who} did not return a result.`, filesChanged: [], openIssues: [] }
  state[kind.list].push({ spec: job.spec.id, ...tag, ...r })
  const who = `${job.spec.id} ${kind.who}`
  if (r.status !== 'done') return `${who}: ${r.blockedReason || 'no reason given'}`
  const outside = filesOutsideAssignment(r.filesChanged, job.allowed)
  if (outside.length > 0) return `${who}: changed files it may not change (${outside.join(', ')})`
  return ''
}

const badProfile = modelProfileProblems(input.modelProfile)
if (badProfile.length > 0) return stop('blocked', `The "modelProfile" arg is not usable: ${badProfile.join(' ')}`)
const badModels = modelProblems(input.models)
if (badModels.length > 0) return stop('blocked', `The "models" arg is not usable: ${badModels.join(' ')}`)
const baseModels = resolveModelsForProfile(input.modelProfile, input.models)
if (baseModels) args.models = baseModels

const missing = []
if (isBlank(input.repo)) missing.push('repo')
if (isBlank(input.base)) missing.push('base')
for (const role of questionsOnly ? ['planner'] : ['planner', 'implementer', 'qa', 'checker', 'reviewer', 'specReviewer', ...(qcOn ? ['qc'] : [])]) {
  if (!input.roles || isBlank(input.roles[role])) missing.push(`roles.${role}`)
}
if (!contract || isBlank(contract.objective)) missing.push('contract.objective')
if (!contract || !Array.isArray(contract.criteria) || contract.criteria.length === 0) missing.push('contract.criteria')
if (!contract || !Array.isArray(contract.checks)) missing.push('contract.checks')
if (missing.length > 0) return stop('blocked', `Missing workflow args: ${missing.join(', ')}`)
if (questionsOnly && Array.isArray(input.specs) && input.specs.length > 0) return stop('blocked', '"questionsOnly" runs the planner; it cannot be given "specs".')
const badDesign = designProblems(contract)
if (badDesign.length > 0) return stop('blocked', `The contract's design is not usable: ${badDesign.join(' ')}`)
const badStandards = standardsProblems(contract)
if (badStandards.length > 0) return stop('blocked', `The contract's coding standards are not usable: ${badStandards.join(' ')}`)
const noBrowser = browserProblem(input.browser, contract, input.surfaces, qcOn)
if (noBrowser) return stop('blocked', noBrowser)
const absentStack = questionsOnly ? [] : missingProjectSkills(input.projectSkills, input.skills)
if (absentStack.length > 0) return stop('blocked', `The project's stack skills are not installed or were not passed in "skills": ${absentStack.join(', ')}. Install them with scripts/stack-skills.mjs and pass the output of skills-ready.sh.`)
const absentSkills = questionsOnly ? [] : missingSkills(input.skills)
if (absentSkills.length > 0) {
  return stop('blocked', `Skills the team needs are not installed or were not passed in "skills": ${absentSkills.join(', ')}. Run scripts/skills-ready.sh, install what it reports missing, and pass its output as "skills".`)
}
const installed = Object.keys(input.skills || {})
const allowProtected = input.allowProtected
const guarded = f => protectedFiles([f], input.protectedPaths, allowProtected).length > 0
