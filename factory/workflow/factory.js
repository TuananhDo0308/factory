export const meta = {
  name: 'factory',
  description: 'Run a coding contract through a planner, one test-first implementer and one QA agent per spec, a checker and fresh reviewers; a spec that fails QA or review goes back to Build, a bounded number of times',
  whenToUse: 'Called by the factory skill after the contract is written. Not meant to be started without its args.',
  phases: [
    { title: 'Spec', detail: 'planner turns the contract into specs; code validates them' },
    { title: 'Build', detail: 'per spec: the implementer writes the tests first, then the code; then QA. A spec QA sends back is rebuilt and checked again' },
    { title: 'Check', detail: 'checker runs the contract checks and lists changed files' },
    { title: 'Review', detail: 'one reviewer for the whole change, plus one per spec when the work was split; the specs a failure concerns go back to Build' },
  ],
}

// ---------------------------------------------------------------------------
// Pure helpers. No agents, no I/O: these are the rules that code enforces so
// that no agent has to be trusted to follow them.
// ---------------------------------------------------------------------------

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

// --- Models -----------------------------------------------------------------
// The model and reasoning effort of each role, decided here. The planner is
// where a mistake costs the most, since every agent after it builds on its
// specs, so it gets the strongest model; so does the reviewer of the whole
// change, the last gate before pass or fail. Implementers, QA, spec reviewers
// and the checker work from a spec already written, or only run commands. A
// spec sent back to Build has shown that its first model was not enough, so
// its rebuild runs on a stronger one. `args.models` can replace
// any entry, e.g. { "implementer": { "model": "opus" } }; a model of
// "inherit" uses the session's model.
const MODELS = {
  planner: { model: 'fable', effort: 'high' },
  implementer: { model: 'sonnet', effort: 'medium' },
  qa: { model: 'sonnet', effort: 'medium' },
  rebuild: { model: 'opus', effort: 'medium' },
  checker: { model: 'sonnet', effort: 'low' },
  reviewer: { model: 'opus', effort: 'high' },
  specReviewer: { model: 'sonnet', effort: 'medium' },
}
const MODEL_NAMES = ['haiku', 'sonnet', 'opus', 'fable', 'inherit']
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

// Problems with `args.models`; empty means it can be used.
function modelProblems(overrides) {
  if (overrides === undefined || overrides === null) return []
  if (typeof overrides !== 'object' || Array.isArray(overrides)) return ['"models" must be an object of roles.']
  const problems = []
  for (const [role, entry] of Object.entries(overrides)) {
    if (!MODELS[role]) { problems.push(`"models" names ${role}, which is not a role (${Object.keys(MODELS).join(', ')}).`); continue }
    if (!entry || typeof entry !== 'object') { problems.push(`"models.${role}" must be an object with "model" and/or "effort".`); continue }
    if (entry.model !== undefined && !MODEL_NAMES.includes(entry.model)) problems.push(`"models.${role}.model" must be one of ${MODEL_NAMES.join(', ')}.`)
    if (entry.effort !== undefined && !EFFORTS.includes(entry.effort)) problems.push(`"models.${role}.effort" must be one of ${EFFORTS.join(', ')}.`)
  }
  return problems
}

// The agent() options for one role: { model?, effort? }. "inherit" leaves the
// model out, so the agent runs on the session's.
function modelFor(role, overrides) {
  const entry = { ...(MODELS[role] || {}), ...((overrides && overrides[role]) || {}) }
  const opts = {}
  if (entry.model && entry.model !== 'inherit') opts.model = entry.model
  if (entry.effort) opts.effort = entry.effort
  return opts
}

// --- Skills -----------------------------------------------------------------
// Which installed skills each agent loads, decided here and not by the agent.
// This is super-board's skill registry (scripts/super-board-skills-ready.py),
// row for row: build rows by the card's type, lane boundaries that always load,
// and a conditional tier the agent judges by the rule given with each. Factory
// differs only where a skill cannot run here: mattpocock's `implement` cannot
// be invoked by an agent (disable-model-invocation), `resolving-merge-conflicts`
// is no longer published and no merge happens inside a run, `ask-matt` cannot
// be invoked either, and the ponytail plugin has no public source, so its
// fallback rules are written into the implementer and reviewer briefs, as
// super-board does when the plugin is absent.
// The planner gives every spec a `kind`; a spec's own `skills` replace the
// kind's row and keep the fixed ones. The session resolves each name to an
// installed SKILL.md before the run (scripts/skills-ready.sh, which carries
// the same lists) and passes the paths in `args.skills`; a run with a required
// skill missing stops before the planner. mattpocock's code-review is installed
// as mp-code-review, so that it does not take the name of Claude Code's own
// /code-review command.
const SKILLS = {
  kinds: ['feature', 'bug', 'ux', 'refactor', 'tech-debt', 'tests', 'docs'],
  implementer: {
    feature: ['tdd', 'codebase-design'],
    bug: ['diagnosing-bugs', 'tdd'],
    ux: ['tdd'],
    refactor: ['codebase-design', 'tdd'],
    'tech-debt': ['codebase-design', 'tdd'],
    tests: ['tdd'],
    docs: [],
  },
  always: {
    implementer: ['verification-before-completion', 'mp-code-review'],
    qa: ['tdd', 'diagnosing-bugs', 'verification-before-completion', 'testing-strategy', 'mp-code-review', 'pr-security-review'],
    reviewer: ['mp-code-review', 'codebase-design'],
    specReviewer: ['mp-code-review', 'codebase-design'],
  },
  // Loaded only when the situation calls for it, which the agent judges by the
  // rule given with each. Offered only when installed; a run starts without them.
  conditional: {
    implementer: {
      vitest: 'when the tests run on Vitest (the repository\'s package.json or config says so)',
      'playwright-best-practices': 'when the test for a criterion has to drive a browser, or the repository tests with Playwright',
      'testing-strategy': 'when the spec leaves open which cases are worth a test',
      'domain-modeling': 'when the change names a domain concept the codebase does not have yet; sharpen the term, and write it only into files you own',
    },
    qa: {
      vitest: 'when the tests run on Vitest (the repository\'s package.json or config says so)',
      'playwright-best-practices': 'when a gap can only be shown through a browser, or the repository tests with Playwright',
    },
  },
  // Skills that wait on a person. Nobody is there to answer during a run.
  interactive: ['grill-me', 'grilling', 'grill-with-docs', 'wizard', 'teach', 'to-questionnaire', 'wait-what', 'ask-matt', 'setup-matt-pocock-skills'],
}

// Every skill the registry can hand out: what the session must have installed.
function requiredSkills() {
  const all = [...Object.values(SKILLS.implementer).flat(), ...Object.values(SKILLS.always).flat()]
  return [...new Set(all)].sort()
}

// Skills only of the conditional tier: offered when installed, never required.
// A skill one role always loads (testing-strategy for QA) is required anyway.
function optionalSkills() {
  const required = requiredSkills()
  return [...new Set(Object.values(SKILLS.conditional).flatMap(Object.keys))].filter(n => !required.includes(n)).sort()
}

// The conditional skills one role is offered: [{ name, when }], only those
// that `available` ({ name: path }) resolves and that it does not load anyway.
function conditionalFor(role, available, loaded) {
  const have = available && typeof available === 'object' ? available : {}
  return Object.entries(SKILLS.conditional[role] || {})
    .filter(([name]) => !isBlank(have[name]) && !(loaded || []).includes(name))
    .map(([name, when]) => ({ name, when }))
}

// The required skills that `available` ({ name: path }) does not resolve.
function missingSkills(available) {
  const have = available && typeof available === 'object' ? available : {}
  return requiredSkills().filter(n => isBlank(have[n]))
}

// The skills one agent loads, in order. `role` is implementer, qa, reviewer or
// specReviewer; `spec` is absent for the reviewer of the whole change.
function skillsFor(role, spec) {
  const own =
    role === 'implementer' && spec
      ? Array.isArray(spec.skills) && spec.skills.length > 0
        ? spec.skills
        : SKILLS.implementer[spec.kind] || []
      : []
  return [...new Set([...own, ...(SKILLS.always[role] || [])])]
}

// Returns a list of human-readable problems; empty means the specs are usable.
// `available` lists the skill names installed for this run; when given, a
// spec's own `skills` must come from it.
function validateSpecs(specs, contract, available) {
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

// Caches that running a project's checks leaves behind. They are never source,
// and a repository without a .gitignore for them would otherwise stop every run
// at the first check, because the agents and the checker run the tests.
const GENERATED = ['**/__pycache__', '*.pyc', '**/.pytest_cache', '**/.mypy_cache', '**/.ruff_cache', '**/.DS_Store']

// An ignore entry is an exact path, a directory (everything beneath it),
// `*.ext` (any file with that ending) or `**/name` (a file or directory of that
// name at any depth).
function matchesIgnore(file, entry) {
  const e = normPath(entry)
  if (!e) return false
  if (e.startsWith('**/')) return file.split('/').includes(e.slice(3))
  if (e.startsWith('*.')) return file.endsWith(e.slice(1))
  return file === e || file.startsWith(`${e}/`)
}

// Files changed in the repository that no spec owns, that were not already
// dirty before the run started and that are not generated caches.
function filesOutsideOwnership(changedFiles, specs, ignoreFiles) {
  const owned = ownedFiles(specs)
  const ignore = [...GENERATED, ...(ignoreFiles || [])]
  return (changedFiles || []).map(normPath).filter(f => f && !owned.has(f) && !ignore.some(e => matchesIgnore(f, e)))
}

// Decides pass or fail from the raw facts. An agent's own "verdict" is never
// consulted: the result is passing only if this list is empty.
//
// `review` is the reviewer of the whole change, judged against the contract.
// `specReviews` is [{ spec, review }], one per spec when the work was split
// (empty for a single spec). A criterion passes only if the whole-change
// reviewer and every spec reviewer responsible for it all say `met`.
// What QA sends back never reaches this point: a spec QA fails goes back to
// Build before the change is checked or reviewed.
function evaluate(contract, check, review, specReviews) {
  const failures = []

  const ran = new Map((check.results || []).map(r => [r.name, r]))
  for (const c of contract.checks) {
    const r = ran.get(c.name)
    if (!r) failures.push({ kind: 'check', name: c.name, problem: `Check "${c.name}" (${c.command}) was not run.` })
    else if (r.exitCode !== 0) {
      failures.push({ kind: 'check', name: c.name, problem: `Check "${c.name}" (${c.command}) exited with ${r.exitCode}.`, outputTail: r.outputTail })
    }
  }

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
  }
  return failures
}

// Sends the failures of a check and review back to Build, to the specs that
// must answer for them. Each spec's implementer gets, in a fresh session, the
// failures that concern its own files, so no agent is handed another spec's work:
//   - a finding that names a file goes to the spec owning it;
//   - a criterion judged for one spec goes to that spec, one judged for the
//     whole change to every spec responsible for it;
//   - a failing check goes to every spec whose files appear in its output, and
//     to every spec when none do, since code cannot tell whose fault it is.
// Anything that matches no spec goes to all of them. Returns [{ spec,
// failures }] in spec order, for the specs that have something to answer for.
function routeFailures(failures, specs) {
  const bySpec = new Map(specs.map(s => [s.id, []]))
  const owner = new Map()
  for (const s of specs) for (const f of specFiles(s)) owner.set(f, s.id)
  for (const f of failures) {
    let ids = []
    if (f.kind === 'finding' && owner.has(normPath(f.file))) ids = [owner.get(normPath(f.file))]
    else if (f.spec && bySpec.has(f.spec)) ids = [f.spec]
    else if (f.kind === 'criterion') ids = specs.filter(s => (s.criteria || []).includes(f.id)).map(s => s.id)
    else if (f.kind === 'check') {
      const out = String(f.outputTail || '')
      ids = specs.filter(s => specFiles(s).some(file => out.includes(file))).map(s => s.id)
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
// one entry naming all of them.
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
        if (f.kind === 'criterion') e.criterion = f.id
        if (f.kind === 'check') e.check = f.name
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

// The run as the dashboard shows it, built from the raw state so that what is
// displayed is decided here and not by the agent that writes the file.
// `run` is { id, title, agents, maxRepairRounds }; `progress` is { phase,
// outcome, levels, build: { <spec id>: { impl, test } }, repairs }. For a spec,
// `impl` is its implementer and `test` its QA agent; `repairs` lists every time
// work went back to Build, as { tag, text, state }.
function runRecord(run, contract, state, progress) {
  const specs = state.specs || []
  const failed = new Set((state.failures || []).filter(f => f.kind === 'criterion').map(f => f.id))
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
          state: results.every(r => r.exitCode === 0) ? 'ok' : 'fail',
        }
      : { text: contract.checks.map(c => c.command).join(' · ') },
    review: state.review
      ? [{ tag: 'whole change', ...reviewLine(state.review) }, ...(state.specReviews || []).map(r => ({ tag: r.spec, ...reviewLine(r) }))]
      : [],
    repairs: progress.repairs,
    criteria: contract.criteria.map(c => ({ id: c.id, text: c.text, status: state.review ? (failed.has(c.id) ? 'not_met' : 'met') : '' })),
    failureLog: state.failureLog || [],
  }
}

// ---------------------------------------------------------------------------
// Text rendering for prompts
// ---------------------------------------------------------------------------

function bullets(items) {
  return (items || []).map(i => `- ${i}`).join('\n') || '- none'
}

function contractText(contract) {
  return [
    `Objective: ${contract.objective}`,
    '',
    'Acceptance criteria:',
    ...contract.criteria.map(c => `- ${c.id}: ${c.text}`),
    '',
    'Out of scope:',
    bullets(contract.outOfScope),
    '',
    'Checks:',
    contract.checks.length > 0 ? contract.checks.map(c => `- ${c.name}: ${c.command}`).join('\n') : '- none (the project has no runnable check)',
  ].join('\n')
}

// The GitHub issue a contract was written from, with its sub-issues, as shown
// to the planner only. The sub-issues are a developer's notes on how the work
// divides; they add context for the split but are not specs and not criteria,
// so the planner still owns the split, code still validates it, and only the
// contract is judged. The other roles get what they need through their spec.
// `issue` is { number, title, body, subIssues: [{ number, title, body }] };
// returns '' without one.
function issueText(issue) {
  if (!issue || (isBlank(issue.title) && isBlank(issue.body))) return ''
  const one = (label, i) => [`${label} #${i.number}: ${i.title || ''}`, isBlank(i.body) ? '(no description)' : String(i.body).trim()].join('\n')
  const subs = Array.isArray(issue.subIssues) ? issue.subIssues.filter(Boolean) : []
  return [
    `The contract above was written from GitHub issue #${issue.number}. The issue and its sub-issues follow as background. The sub-issues are a developer's notes on how the work divides and where it touches the code: use them to understand the task and as a starting point for your split, not as specs or criteria. You decide the specs; one spec per sub-issue is fine when the files allow it, but merge, split or regroup them when file ownership or dependencies call for it. Only the contract's criteria are judged. Where a note disagrees with the code, the code is right; where it disagrees with the contract, the contract is right, and say so in \`risks\`.`,
    '',
    one('Issue', issue),
    ...(subs.length > 0 ? subs.flatMap(s => ['', one('Sub-issue', s)]) : ['', 'It has no sub-issues.']),
  ].join('\n')
}

// One spec, as shown to one role. The implementer sees all of it. The QA agent
// is not shown the planned changes or the implementer's checklist: it judges
// the tests against what the spec requires, not against the plan the code was
// built from, so it does not inherit that plan's mistakes.
function specText(spec, contract, view) {
  const criteria = new Map(contract.criteria.map(c => [c.id, c.text]))
  const part = (title, body) => ['', `${title}\n${body}`]
  const files =
    view === 'implementer'
      ? [
          ...part('Source files you own (change nothing else):', bullets(spec.filesOwned)),
          ...part('Test files you own (write the tests here, before the code):', bullets(spec.testFiles)),
        ]
      : view === 'qa'
        ? [
            ...part('Test files of this spec (the only files you may change or create):', bullets(spec.testFiles)),
            ...part('Source files of this spec (read them, never change them):', bullets(spec.filesOwned)),
          ]
        : [
            ...part('Source files:', bullets(spec.filesOwned)),
            ...part('Test files:', bullets(spec.testFiles)),
          ]
  return [
    `Spec ${spec.id}: ${spec.title}`,
    ...part('Goal:', spec.goal),
    ...part('Criteria:', (spec.criteria || []).map(id => `- ${id}: ${criteria.get(id) || ''}`).join('\n')),
    ...files,
    ...part('Context:', spec.context || 'none'),
    ...part('Interfaces:', spec.interfaces || 'none'),
    ...(view !== 'qa' ? part('Changes:', spec.changes || 'none') : []),
    ...part('Tests:', spec.tests),
    ...part('Out of scope:', spec.outOfScope || 'none'),
    ...(view !== 'qa' ? part('Done when:', bullets(spec.doneWhen)) : []),
  ].join('\n')
}

// The scratch directory of one agent: `<scratch root>/<label as a slug>`.
// Agents of a run otherwise share their session's scratchpad, so two of them
// could pick the same folder name: one would then delete the other's files, or
// write through a link the other made, into the repository itself. Labels are
// unique within a run, so the directories are too.
function scratchDir(root, label) {
  const slug = String(label || 'agent')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${root}/${slug || 'agent'}`
}

function scratchNote(dir) {
  return [
    `Scratch directory: ${dir}`,
    'Put every temporary file you need (stubs, configs, copies, scratch repositories) in that directory, creating it if needed, and nowhere else: other agents of this run work at the same time, and a shared scratch area lets them delete or write through each other\'s files. Never create a link there to anything in the repository, its installed dependencies included: a write through such a link lands in the repository.',
  ].join('\n')
}

// The skills block of one agent's prompt. `paths` maps each name to the
// SKILL.md the session resolved, so an agent without the Skill tool can read it.
// `fixedPoint` is how a review skill should see the change: the run's work is
// not committed, so a skill that diffs against HEAD would see nothing.
// `extra` is [{ name, when }]: skills to load only when their rule applies.
function skillsNote(names, paths, fixedPoint, extra) {
  const maybe = extra || []
  if ((!names || names.length === 0) && maybe.length === 0) return ''
  return [
    ...(names && names.length > 0
      ? [
          `Skills: before you start, load each of these with the Skill tool, in this order: ${names.join(', ')}. If the Skill tool is not available to you, read the file instead and follow it:`,
          ...names.map(n => `- ${n}: ${(paths && paths[n]) || 'not resolved'}`),
        ]
      : []),
    ...(maybe.length > 0
      ? ['Load these too, each only when its rule applies (with the Skill tool, or by reading the file):', ...maybe.map(m => `- ${m.name}, ${m.when}: ${(paths && paths[m.name]) || 'not resolved'}`)]
      : []),
    'You run unattended, inside a team. Where a skill says to ask or confirm with the user, decide from your assignment instead: the spec and its interfaces are what was agreed. Where a skill conflicts with your role brief (what you may change, what you return, whether you start other agents), the brief wins.',
    ...(fixedPoint ? [fixedPoint] : []),
  ].join('\n')
}

// How a review skill that diffs against a fixed point should see this run.
function fixedPoint(specSource) {
  return `For a skill that reviews a diff against a base branch or fixed point (mp-code-review, pr-security-review): the base is the commit ${args.base}, there is no pull request and nothing to fetch, and the change is not committed, so read it with \`git diff ${args.base}\` and the untracked files in \`git status --short\`, not with \`git diff <base>...HEAD\` or \`origin/<base>\`. Its spec is ${specSource}; there is no issue tracker. Its findings become your findings, judged and reported in your own return format.`
}

function header(role) {
  return [
    `Read your role brief first: ${args.roles[role]}`,
    '',
    `Repository: ${args.repo}`,
    `Base commit: ${args.base}`,
    'Work only inside that repository.',
  ].join('\n')
}

// The parts of the change and who owns which file, without the specs themselves.
function partsText(specs) {
  return specs
    .map(s => [`${s.id}: ${s.title}`, 'Source files:', bullets(s.filesOwned), 'Test files:', bullets(s.testFiles), `Interfaces: ${s.interfaces || 'none'}`].join('\n'))
    .join('\n\n')
}

// ---------------------------------------------------------------------------
// Schemas: what each agent must hand back
// ---------------------------------------------------------------------------

const STRINGS = { type: 'array', items: { type: 'string' } }

const COMMANDS = {
  type: 'array',
  items: {
    type: 'object',
    properties: { command: { type: 'string' }, result: { type: 'string' } },
    required: ['command', 'result'],
  },
}

const SPEC_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'S1, S2, ...' },
    title: { type: 'string' },
    goal: { type: 'string' },
    kind: { type: 'string', enum: ['feature', 'bug', 'ux', 'refactor', 'tech-debt', 'tests', 'docs'], description: 'What kind of work this spec is; it decides the skills its implementer loads' },
    skills: { ...STRINGS, description: 'Installed skills that replace those of the kind for this spec; empty to use the kind\'s' },
    criteria: { ...STRINGS, description: 'Criterion ids this spec is responsible for' },
    dependsOn: { ...STRINGS, description: 'Ids of specs that must be finished first; empty if none' },
    filesOwned: { ...STRINGS, description: 'Repository-relative paths of every source file the implementer may change or create; empty for a spec that only adds tests' },
    testFiles: { ...STRINGS, description: 'Repository-relative paths of every test file the implementer writes first and the QA agent may add to; empty if this spec needs no test' },
    context: { type: 'string' },
    interfaces: { type: 'string' },
    changes: { type: 'string' },
    tests: { type: 'string' },
    outOfScope: { type: 'string' },
    doneWhen: STRINGS,
  },
  required: ['id', 'title', 'goal', 'kind', 'skills', 'criteria', 'dependsOn', 'filesOwned', 'testFiles', 'context', 'interfaces', 'changes', 'tests', 'outOfScope', 'doneWhen'],
}

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    overview: { type: 'string' },
    specs: { type: 'array', items: SPEC_SCHEMA },
    risks: STRINGS,
  },
  required: ['overview', 'specs', 'risks'],
}

const BUILD_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'blocked'] },
    blockedReason: { type: 'string', description: 'Why the spec could not be carried out; empty when done' },
    filesChanged: STRINGS,
    tdd: {
      type: 'array',
      description: 'One entry per criterion of the spec',
      items: {
        type: 'object',
        properties: {
          criterion: { type: 'string' },
          tests: { ...STRINGS, description: 'Names of the tests written for this criterion before its code' },
          red: { type: 'string', description: 'The failure each test showed before the code existed, or why the criterion has no test' },
        },
        required: ['criterion', 'tests', 'red'],
      },
    },
    doneWhen: {
      type: 'array',
      items: {
        type: 'object',
        properties: { item: { type: 'string' }, done: { type: 'boolean' } },
        required: ['item', 'done'],
      },
    },
    checksRun: COMMANDS,
    openIssues: STRINGS,
  },
  required: ['status', 'blockedReason', 'filesChanged', 'tdd', 'doneWhen', 'checksRun', 'openIssues'],
}

const REBUILD_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'blocked'] },
    blockedReason: { type: 'string', description: 'Why the failures could not be acted on; empty when done' },
    filesChanged: STRINGS,
    fixes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          failure: { type: 'string', description: 'The failure from the report, in a few words' },
          action: { type: 'string', description: 'What was changed, or why nothing was; for a changed test, why the test was wrong against the spec' },
        },
        required: ['failure', 'action'],
      },
    },
    checksRun: COMMANDS,
    openIssues: STRINGS,
  },
  required: ['status', 'blockedReason', 'filesChanged', 'fixes', 'checksRun', 'openIssues'],
}

const QA_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'blocked'] },
    blockedReason: { type: 'string', description: 'Why the tests could not be checked; empty when done' },
    filesChanged: { ...STRINGS, description: 'Every test file changed or created; empty if none' },
    ledger: {
      type: 'array',
      description: 'One entry per criterion of the spec',
      items: {
        type: 'object',
        properties: {
          criterion: { type: 'string' },
          tests: { ...STRINGS, description: 'file:line of each test that asserts this criterion and can fail; empty if none' },
        },
        required: ['criterion', 'tests'],
      },
    },
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          problem: { type: 'string', description: 'The untested case or faulty test, with the exact witness value' },
          written: { type: 'boolean', description: 'True when a test for it was added in this session' },
        },
        required: ['severity', 'problem', 'written'],
      },
    },
    failures: {
      type: 'array',
      description: 'What the code or its tests must answer for: a new test that fails against the code, a high gap that cannot be tested without changing the code, or a test that contradicts the spec',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          problem: { type: 'string' },
        },
        required: ['file', 'line', 'problem'],
      },
    },
    checksRun: COMMANDS,
    openIssues: STRINGS,
  },
  required: ['status', 'blockedReason', 'filesChanged', 'ledger', 'gaps', 'failures', 'checksRun', 'openIssues'],
}

const CHECK_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          command: { type: 'string' },
          exitCode: { type: 'integer' },
          outputTail: { type: 'string', description: 'Last lines of the command output, copied verbatim' },
        },
        required: ['name', 'command', 'exitCode', 'outputTail'],
      },
    },
    changedFiles: { ...STRINGS, description: 'Repository-relative paths changed or created since the base commit' },
  },
  required: ['results', 'changedFiles'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          status: { type: 'string', enum: ['met', 'not_met', 'unknown'] },
          evidence: { type: 'string' },
        },
        required: ['id', 'status', 'evidence'],
      },
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocking', 'minor'] },
          file: { type: 'string' },
          line: { type: 'integer' },
          problem: { type: 'string' },
        },
        required: ['severity', 'file', 'line', 'problem'],
      },
    },
    notReviewed: STRINGS,
  },
  required: ['criteria', 'findings', 'notReviewed'],
}

// ---------------------------------------------------------------------------
// Agent calls
// ---------------------------------------------------------------------------

// Every agent of the team is started through here, so the run can report how
// many it used, and each gets a scratch directory of its own. The recorder
// below is not counted: it is not part of the team.
let started = 0
function spawn(prompt, opts) {
  started++
  return agent(`${prompt}\n\n${scratchNote(scratchDir(scratch, opts.label))}`, opts)
}

// A script cannot write files, so a small agent writes the dashboard's progress
// file. It is handed the finished text and decides nothing.
function writeProgress(file, record, label, phaseTitle) {
  return agent(
    [
      'You are the recorder of a Factory run. Your only job is to write one file. Do not read, run or change anything else, and do not judge the content.',
      '',
      `Overwrite the file ${file} (create it if it does not exist) so that it contains exactly the single line between the two marker lines below, without the markers:`,
      '',
      '-----BEGIN-----',
      `window.FACTORY_LIVE = ${JSON.stringify(record)}`,
      '-----END-----',
      '',
      'Then reply with the single word: written',
    ].join('\n'),
    { label, phase: phaseTitle, model: 'haiku', effort: 'low' },
  )
}

function planSpecs(contract, previous, problems) {
  const redo = problems
    ? [
        '',
        'Your previous specs were rejected by an automatic check. Fix exactly these problems and return the full corrected set:',
        bullets(problems),
        '',
        'Previous specs:',
        JSON.stringify(previous, null, 2),
      ].join('\n')
    : ''
  return spawn(
    [
      header('planner'),
      '',
      'Turn this contract into one or more specs.',
      '',
      contractText(contract),
      ...(issueText(args.issue) ? ['', issueText(args.issue)] : []),
      '',
      `Skills installed for this run, which a spec may name in "skills" instead of those of its kind: ${Object.keys(args.skills || {}).join(', ') || 'none'}`,
      redo,
    ].join('\n'),
    { label: problems ? 'planner (revision)' : 'planner', phase: 'Spec', schema: PLAN_SCHEMA, ...modelFor('planner', args.models) },
  )
}

function buildSpec(spec, contract) {
  return spawn(
    [
      header('implementer'),
      '',
      hasTests(spec)
        ? 'Build this spec test-first. It is your whole assignment. For each criterion, write its test, run it and see it fail for the right reason, then write the code that makes it pass.'
        : 'Build this spec. It is your whole assignment. It has no test files; its "Tests" section says why.',
      '',
      specText(spec, contract, 'implementer'),
      '',
      skillsNote(skillsFor('implementer', spec), args.skills, '', conditionalFor('implementer', args.skills, skillsFor('implementer', spec))),
    ].join('\n'),
    { label: `build ${spec.id}`, phase: 'Build', schema: BUILD_SCHEMA, ...modelFor('implementer', args.models) },
  )
}

// QA of one spec, after its implementer has finished. It sees the spec without
// the planned changes, and the files, but not the implementer's account.
// `pass` is how many times the spec has been sent back to Build before this.
function qaSpec(spec, contract, pass) {
  return spawn(
    [
      header('qa'),
      '',
      pass > 0
        ? `Check this spec again. QA or review sent it back to Build ${pass} time(s), and a new session of its implementer has acted on the failures. You are a new QA session: check the tests and the code as they are now, from the start.`
        : 'Check this spec. Its implementer wrote the tests first and then the code, and has finished.',
      hasTests(spec)
        ? 'Judge the tests against what the spec requires, close the serious gaps with new tests, run the security and code review, and report what the code or its tests must answer for.'
        : 'It has no test files, so you can add no tests: judge what is tested against the spec, run the security and code review, and report what the code must answer for.',
      '',
      specText(spec, contract, 'qa'),
      '',
      skillsNote(skillsFor('qa', spec), args.skills, '', conditionalFor('qa', args.skills, skillsFor('qa', spec))),
      '',
      `See this spec's part of the change with \`git diff ${args.base} -- <file>\` for each file above; a new file is untracked, so read it directly.`,
      'Implementers of other specs may still be working in the same repository. Run this spec\'s test files, not the whole suite: a failure in another spec\'s half-built files is not yours to report.',
    ].join('\n'),
    { label: pass > 0 ? `qa ${pass} ${spec.id}` : `qa ${spec.id}`, phase: 'Build', schema: QA_SCHEMA, ...modelFor('qa', args.models) },
  )
}

// A fresh session of a spec's implementer, when the spec is sent back to
// Build. It gets its own spec, the failures that concern its files, who found
// them (`source`) and the map of the other parts. `n` counts the returns.
function rebuildSpec(spec, failures, source, contract, specs, n) {
  const others = specs.filter(s => s !== spec)
  return spawn(
    [
      header('implementer'),
      '',
      `The spec below was sent back to Build (time ${n} of at most ${maxRebuilds}) because ${source} found failures. You are a new session of its implementer: the code and tests on disk were written by an earlier one. Act on the failures below that concern your files. QA checks the spec again when you are done.`,
      '',
      'Failures:',
      '',
      JSON.stringify(failures, null, 2),
      '',
      'Your spec:',
      '',
      specText(spec, contract, 'implementer'),
      ...(others.length > 0
        ? ['', 'The other parts of the change, built by other implementers, some of whom may be acting on their own failures at the same time. Read them for their interfaces; change none of their files:', '', partsText(others)]
        : []),
      '',
      `See the change so far with \`git diff ${args.base}\` and \`git status --short\` (new files are untracked).`,
      '',
      skillsNote(skillsFor('implementer', spec), args.skills, '', conditionalFor('implementer', args.skills, skillsFor('implementer', spec))),
    ].join('\n'),
    { label: `rebuild ${n} ${spec.id}`, phase: 'Build', schema: REBUILD_SCHEMA, ...modelFor('rebuild', args.models) },
  )
}

function runChecks(contract, round) {
  return spawn(
    [
      header('checker'),
      '',
      'Run each of these commands from the repository root, exactly as written, and report what happened:',
      contract.checks.length > 0 ? contract.checks.map(c => `- ${c.name}: ${c.command}`).join('\n') : '- (no commands)',
      '',
      `Then list every file changed or created since the base commit: the output of \`git diff --name-only ${args.base}\` together with \`git ls-files --others --exclude-standard\`.`,
    ].join('\n'),
    { label: round === 0 ? 'checker' : `checker (round ${round})`, phase: 'Check', schema: CHECK_SCHEMA, ...modelFor('checker', args.models) },
  )
}

// Reviewer of the whole change. With one spec it is the only reviewer. With
// several, the spec reviewers read each part line by line, and this one is told
// where the parts meet so it can concentrate on whether they fit together.
function runReview(contract, check, specs, round) {
  const split = specs.length > 1
  const seams = split
    ? [
        '',
        `The work was split into ${specs.length} parts, each built by a different implementer that could not see the others' code. Each part is also being reviewed line by line by its own reviewer, so spend your attention on the places where the parts meet and on whether the change as a whole satisfies the contract. The parts and the interfaces they were told to share:`,
        '',
        partsText(specs),
      ].join('\n')
    : ''
  return spawn(
    [
      header('reviewer'),
      '',
      'Review the whole change against this contract.',
      '',
      contractText(contract),
      '',
      `See the change with \`git diff ${args.base}\` and \`git status --short\` (new files are untracked).`,
      '',
      'Check results observed by an independent checker:',
      JSON.stringify(check.results, null, 2),
      seams,
      '',
      skillsNote(skillsFor('reviewer'), args.skills, fixedPoint('the contract above')),
    ].join('\n'),
    { label: round === 0 ? 'reviewer' : `reviewer (round ${round})`, phase: 'Review', schema: REVIEW_SCHEMA, ...modelFor('reviewer', args.models) },
  )
}

// Reviewer of one spec: sees that spec and the files it owns, nothing else.
function runSpecReview(spec, contract, check, round) {
  return spawn(
    [
      header('specReviewer'),
      '',
      'Review this one part of a larger change. Judge only the criteria and files listed here.',
      '',
      specText(spec, contract, 'reviewer'),
      '',
      `See this part of the change with \`git diff ${args.base} -- <file>\` for each file above; a new file is untracked, so read it directly.`,
      '',
      'Check results for the whole change, observed by an independent checker:',
      JSON.stringify(check.results, null, 2),
      '',
      skillsNote(skillsFor('specReviewer', spec), args.skills, fixedPoint('the spec above')),
    ].join('\n'),
    { label: round === 0 ? `review ${spec.id}` : `review ${spec.id} (round ${round})`, phase: 'Review', schema: REVIEW_SCHEMA, ...modelFor('specReviewer', args.models) },
  )
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

const input = args || {}
const contract = input.contract
// How many times one spec may be sent back to Build, by QA or by review
// (super-board's rebuild cap). A spec past it fails the run.
const maxRebuilds = Number.isInteger(input.maxRebuilds) ? input.maxRebuilds : 2
const maxSpecRevisions = Number.isInteger(input.maxSpecRevisions) ? input.maxSpecRevisions : 2
// The agents' scratch directories go next to the repository by default, never
// inside it, where they would show up as changes that no spec owns.
const repo = String(input.repo || '').replace(/\/+$/, '')
const scratch = isBlank(input.scratch) ? `${repo}-factory-scratch` : String(input.scratch).replace(/\/+$/, '')

const state = { outcome: 'blocked', reason: '', overview: '', risks: [], specs: [], builds: [], qa: [], rebuilds: [], sentBack: {}, testsChangedInRebuild: [], check: null, review: null, specReviews: [], failures: [], failureLog: [], repairRounds: 0 }

// Progress for the dashboard, only when the caller passed `dashboard.file`.
// Records are written one after another and without holding the team up; only
// the last one is waited for.
const dash = input.dashboard && !isBlank(input.dashboard.file) ? input.dashboard : null
const progress = { phase: 'Spec', outcome: 'running', levels: 0, build: {}, repairs: [] }
let recording = Promise.resolve()

function record(phaseTitle, outcome) {
  progress.phase = phaseTitle
  progress.outcome = outcome
  if (!dash) return recording
  const run = {
    id: isBlank(dash.id) ? `run-${String(input.base || '').slice(0, 7)}` : dash.id,
    title: isBlank(dash.title) ? (contract && contract.objective) || '' : dash.title,
    agents: started,
    maxRepairRounds: maxRebuilds,
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

const missing = []
if (isBlank(input.repo)) missing.push('repo')
if (isBlank(input.base)) missing.push('base')
for (const role of ['planner', 'implementer', 'qa', 'checker', 'reviewer', 'specReviewer']) {
  if (!input.roles || isBlank(input.roles[role])) missing.push(`roles.${role}`)
}
if (!contract || isBlank(contract.objective)) missing.push('contract.objective')
if (!contract || !Array.isArray(contract.criteria) || contract.criteria.length === 0) missing.push('contract.criteria')
if (!contract || !Array.isArray(contract.checks)) missing.push('contract.checks')
if (missing.length > 0) return stop('blocked', `Missing workflow args: ${missing.join(', ')}`)
const badModels = modelProblems(input.models)
if (badModels.length > 0) return stop('blocked', `The "models" arg is not usable: ${badModels.join(' ')}`)
const absentSkills = missingSkills(input.skills)
if (absentSkills.length > 0) {
  return stop('blocked', `Skills the team needs are not installed or were not passed in "skills": ${absentSkills.join(', ')}. Run scripts/skills-ready.sh, install what it reports missing, and pass its output as "skills".`)
}
const installed = Object.keys(input.skills)

// --- Spec -------------------------------------------------------------------
phase('Spec')
record('Spec', 'running')
let specs = input.specs
let problems
if (Array.isArray(specs) && specs.length > 0) {
  problems = validateSpecs(specs, contract, installed)
  state.specs = specs
  if (problems.length > 0) return stop('blocked', `The supplied specs are not usable: ${problems.join(' ')}`)
  log(`Using ${specs.length} supplied spec(s); planner skipped.`)
} else {
  let plan = await planSpecs(contract)
  if (!plan) return stop('blocked', 'The planner did not return a result.')
  problems = validateSpecs(plan.specs, contract, installed)
  let revisions = 0
  while (problems.length > 0 && revisions < maxSpecRevisions) {
    revisions++
    log(`Specs rejected (${problems.length} problem(s)); asking the planner to revise (${revisions}/${maxSpecRevisions}).`)
    const revised = await planSpecs(contract, plan.specs, problems)
    if (!revised) return stop('blocked', 'The planner did not return a revised result.')
    plan = revised
    problems = validateSpecs(plan.specs, contract, installed)
  }
  specs = plan.specs
  state.specs = specs
  state.overview = plan.overview
  state.risks = plan.risks
  if (problems.length > 0) return stop('blocked', `The specs are still not usable after ${maxSpecRevisions} revision(s): ${problems.join(' ')}`)
}

const levels = buildLevels(specs)
progress.levels = levels.length
log(`${specs.length} spec(s) in ${levels.length} build level(s): ${levels.map(l => l.map(s => s.id).join('+')).join(' -> ')}`)
const untested = specs.filter(s => !hasTests(s)).map(s => s.id)
if (untested.length > 0) log(`No test-first step for ${untested.join(', ')}: the spec names no test files. QA still checks it.`)

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

// --- Check and review; failures go back to Build ---------------------------
let round = 0
while (true) {
  phase('Check')
  record('Check', 'running')
  const check = await runChecks(contract, round)
  if (!check) return stop('blocked', 'The checker did not return a result.')
  state.check = check

  const stray = filesOutsideOwnership(check.changedFiles, specs, input.ignoreFiles)
  const caches = (check.changedFiles || []).map(normPath).filter(f => !ownedFiles(specs).has(f) && GENERATED.some(e => matchesIgnore(f, e)))
  if (caches.length > 0) log(`Not counted as changes: ${caches.length} generated cache file(s) (${caches.join(', ')}).`)
  if (stray.length > 0) {
    return stop('blocked', `Files were changed that no spec owns: ${stray.join(', ')}. Either the specs were incomplete or an agent went outside its assignment.`)
  }

  // With several specs, every spec gets its own reviewer, alongside the reviewer
  // of the whole change. None of them depends on another, so they run together.
  phase('Review')
  const reviewedSpecs = specs.length > 1 ? specs : []
  record('Review', 'running')
  const reviews = await parallel([
    () => runReview(contract, check, specs, round),
    ...reviewedSpecs.map(spec => () => runSpecReview(spec, contract, check, round)),
  ])
  const review = reviews[0]
  if (!review) return stop('blocked', 'The reviewer did not return a result.')
  const specReviews = reviewedSpecs.map((spec, i) => ({ spec, review: reviews[i + 1] }))
  const absent = specReviews.filter(r => !r.review).map(r => r.spec.id)
  if (absent.length > 0) return stop('blocked', `The reviewer of ${absent.join(', ')} did not return a result.`)
  state.review = review
  state.specReviews = specReviews.map(r => ({ spec: r.spec.id, ...r.review }))

  state.failures = evaluate(contract, check, review, specReviews)
  if (state.failures.length === 0) return stop('passed', `All checks pass and every criterion is met${round > 0 ? ` after ${round} return(s) to Build from review` : ''}.`)

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
  const who = groups.map(g => g.spec.id).join(', ')
  log(`${state.failures.length} failure(s) from check and review; back to Build: ${who}.`)
  progress.repairs = [...progress.repairs, { tag: `review ${round}`, text: `${state.failures.length} failure(s), back to Build: ${who}`, state: 'run' }]
  phase('Build')
  record('Build', 'running')
  const stopped = await runChains(groups.map(g => ({ spec: g.spec, failures: g.failures, source: 'the checker and the reviewers' })))
  if (stopped) return stop(stopped.outcome, `A spec sent back to Build could not be completed. ${stopped.reason}`)
  progress.repairs = progress.repairs.map(r => (r.tag === `review ${round}` ? { ...r, state: 'ok' } : r))
}
