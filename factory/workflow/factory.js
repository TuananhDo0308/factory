export const meta = {
  name: 'factory',
  description: 'Run a coding contract through a planner, one implementer and one tester per spec, a checker, fresh reviewers and a single fixer, with bounded repair rounds',
  whenToUse: 'Called by the factory skill after the contract is written. Not meant to be started without its args.',
  phases: [
    { title: 'Spec', detail: 'planner turns the contract into specs; code validates them' },
    { title: 'Build', detail: 'one implementer per spec, beside a tester that writes the tests and then re-checks them in fresh sessions' },
    { title: 'Check', detail: 'checker runs the contract checks and lists changed files' },
    { title: 'Review', detail: 'one reviewer for the whole change, plus one per spec when the work was split' },
    { title: 'Repair', detail: 'one fixer repairs the code from the combined report, a tester only on a reviewer finding; then check and review again' },
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

// A spec has an implementer when it owns source files and a tester when it
// owns test files. A spec may have only one of the two.
function hasCode(spec) {
  return Array.isArray(spec.filesOwned) && spec.filesOwned.length > 0
}

function hasTests(spec) {
  return Array.isArray(spec.testFiles) && spec.testFiles.length > 0
}

// Returns a list of human-readable problems; empty means the specs are usable.
function validateSpecs(specs, contract) {
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

  // One owner per file, across specs and across the two roles inside a spec.
  const owner = new Map()
  for (const s of specs) {
    for (const [role, files] of [['implementer', s.filesOwned], ['tester', s.testFiles]]) {
      for (const raw of files || []) {
        const f = normPath(raw)
        if (!f) { problems.push(`Spec ${s.id}: has an empty file path.`); continue }
        const who = `the ${role} of ${s.id}`
        if (owner.has(f) && owner.get(f) !== who) {
          problems.push(`File ${f} is owned by both ${owner.get(f)} and ${who}; a file may have one owner only.`)
        }
        owner.set(f, who)
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
  for (const s of specs) for (const f of [...(s.filesOwned || []), ...(s.testFiles || [])]) set.add(normPath(f))
  return set
}

// Files one agent says it changed that are not in the list it was given. This
// is how an implementer that edits a test, or a tester that edits the code, is
// caught: the checker's list cannot tell who changed a file.
function filesOutsideAssignment(filesChanged, allowed) {
  const mine = new Set((allowed || []).map(normPath))
  return (filesChanged || []).map(normPath).filter(f => f && !mine.has(f))
}

// Files changed in the repository that no spec owns and that were not already
// dirty before the run started.
function filesOutsideOwnership(changedFiles, specs, ignoreFiles) {
  const owned = ownedFiles(specs)
  const ignored = new Set((ignoreFiles || []).map(normPath))
  return (changedFiles || []).map(normPath).filter(f => f && !owned.has(f) && !ignored.has(f))
}

// Decides pass or fail from the raw facts. An agent's own "verdict" is never
// consulted: the result is passing only if this list is empty.
//
// `review` is the reviewer of the whole change, judged against the contract.
// `specReviews` is [{ spec, review }], one per spec when the work was split
// (empty for a single spec). A criterion passes only if the whole-change
// reviewer and every spec reviewer responsible for it all say `met`.
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

// Every source file of the change: what the fixer may touch in a repair round.
function sourceFiles(specs) {
  const set = new Set()
  for (const s of specs) for (const f of s.filesOwned || []) set.add(normPath(f))
  return [...set]
}

// Splits the failures of one round into the combined report for the fixer and
// the few that go back to a tester.
//
// The tests are the standard. They were written from the spec and re-checked
// by the tester before the code was judged, so a failure is presumed to be the
// code's fault and goes into the report. One fixer gets the whole report: a
// failure often sits where two parts meet, and an agent that sees one spec
// cannot repair both sides of it.
//   - a finding against a test file goes to the tester that owns the file: a
//     reviewer naming the test is the only thing that sends a test back;
//   - every other failure goes into the report;
//   - except that a spec with no source files has no code to fix, so a failure
//     that belongs to such a spec goes to its tester.
// Returns { code, tests }: `code` is the fixer's report, in the order the
// failures were found; `tests` is [{ spec, failures }] for the testers.
function splitFailures(failures, specs) {
  const code = []
  const bySpec = new Map(specs.map(s => [s.id, []]))
  const owns = (files, file) => (files || []).map(normPath).includes(file)
  for (const f of failures) {
    const testOwners = f.kind === 'finding' ? specs.filter(s => owns(s.testFiles, f.file)) : []
    if (testOwners.length > 0) {
      for (const s of testOwners) bySpec.get(s.id).push(f)
      continue
    }
    let concerned = specs
    if (f.kind === 'finding' && owns(sourceFiles(specs), f.file)) concerned = specs.filter(s => owns(s.filesOwned, f.file))
    else if (f.spec) concerned = specs.filter(s => s.id === f.spec)
    else if (f.kind === 'criterion') concerned = specs.filter(s => (s.criteria || []).includes(f.id))
    if (concerned.length === 0) concerned = specs
    if (concerned.some(hasCode)) code.push(f)
    for (const s of concerned) if (!hasCode(s)) bySpec.get(s.id).push(f)
  }
  return { code, tests: specs.map(s => ({ spec: s, failures: bySpec.get(s.id) })).filter(g => g.failures.length > 0) }
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

// One spec, as shown to one role. The implementer is not shown the tests to
// write and the tester is not shown the changes to make: each works from what
// the spec requires, not from what the other is about to produce.
function specText(spec, contract, view) {
  const criteria = new Map(contract.criteria.map(c => [c.id, c.text]))
  const part = (title, body) => ['', `${title}\n${body}`]
  const files =
    view === 'implementer'
      ? [
          ...part('Files you own (change nothing else):', bullets(spec.filesOwned)),
          ...(hasTests(spec) ? part('Test files, owned by the tester of this spec (do not open or change them):', bullets(spec.testFiles)) : []),
        ]
      : view === 'tester'
        ? [
            ...part('Test files you own (change nothing else):', bullets(spec.testFiles)),
            ...(hasCode(spec) ? part('Source files, owned by the implementer of this spec (do not change them, and do not read the working copy):', bullets(spec.filesOwned)) : []),
          ]
        : [
            ...part('Source files, owned by the implementer:', bullets(spec.filesOwned)),
            ...part('Test files, owned by the tester:', bullets(spec.testFiles)),
          ]
  return [
    `Spec ${spec.id}: ${spec.title}`,
    ...part('Goal:', spec.goal),
    ...part('Criteria you are responsible for:', (spec.criteria || []).map(id => `- ${id}: ${criteria.get(id) || ''}`).join('\n')),
    ...files,
    ...part('Context:', spec.context || 'none'),
    ...part('Interfaces:', spec.interfaces || 'none'),
    ...(view !== 'tester' ? part('Changes:', spec.changes || 'none') : []),
    ...(view !== 'implementer' ? part('Tests:', spec.tests) : []),
    ...part('Out of scope:', spec.outOfScope || 'none'),
    ...(view !== 'tester' ? part('Done when:', bullets(spec.doneWhen)) : []),
  ].join('\n')
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

// ---------------------------------------------------------------------------
// Schemas: what each agent must hand back
// ---------------------------------------------------------------------------

const STRINGS = { type: 'array', items: { type: 'string' } }

const SPEC_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'S1, S2, ...' },
    title: { type: 'string' },
    goal: { type: 'string' },
    criteria: { ...STRINGS, description: 'Criterion ids this spec is responsible for' },
    dependsOn: { ...STRINGS, description: 'Ids of specs that must be finished first; empty if none' },
    filesOwned: { ...STRINGS, description: 'Repository-relative paths of every source file the implementer may change or create; empty for a spec that only adds tests' },
    testFiles: { ...STRINGS, description: 'Repository-relative paths of every test file the tester may change or create; empty if this spec needs no test' },
    context: { type: 'string' },
    interfaces: { type: 'string' },
    changes: { type: 'string' },
    tests: { type: 'string' },
    outOfScope: { type: 'string' },
    doneWhen: STRINGS,
  },
  required: ['id', 'title', 'goal', 'criteria', 'dependsOn', 'filesOwned', 'testFiles', 'context', 'interfaces', 'changes', 'tests', 'outOfScope', 'doneWhen'],
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
    doneWhen: {
      type: 'array',
      items: {
        type: 'object',
        properties: { item: { type: 'string' }, done: { type: 'boolean' } },
        required: ['item', 'done'],
      },
    },
    checksRun: {
      type: 'array',
      items: {
        type: 'object',
        properties: { command: { type: 'string' }, result: { type: 'string' } },
        required: ['command', 'result'],
      },
    },
    openIssues: STRINGS,
  },
  required: ['status', 'blockedReason', 'filesChanged', 'doneWhen', 'checksRun', 'openIssues'],
}

const TEST_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'blocked'] },
    blockedReason: { type: 'string', description: 'Why the tests could not be written; empty when done' },
    filesChanged: STRINGS,
    coverage: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          criterion: { type: 'string' },
          tests: { ...STRINGS, description: 'Names of the tests that fail unless this criterion is met' },
        },
        required: ['criterion', 'tests'],
      },
    },
    openIssues: STRINGS,
  },
  required: ['status', 'blockedReason', 'filesChanged', 'coverage', 'openIssues'],
}

const SELF_CHECK_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'blocked'] },
    blockedReason: { type: 'string', description: 'Why the tests could not be checked or corrected; empty when done' },
    problems: { ...STRINGS, description: 'Each fault found in the tests and how it was corrected; empty if none' },
    filesChanged: { ...STRINGS, description: 'Every test file changed in this pass; empty means the tests were left exactly as found' },
    openIssues: STRINGS,
  },
  required: ['status', 'blockedReason', 'problems', 'filesChanged', 'openIssues'],
}

const FIX_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'blocked'] },
    blockedReason: { type: 'string', description: 'Why the report could not be acted on; empty when done' },
    filesChanged: STRINGS,
    fixes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          failure: { type: 'string', description: 'The failure from the report, in a few words' },
          action: { type: 'string', description: 'What was changed, or why nothing was' },
        },
        required: ['failure', 'action'],
      },
    },
    checksRun: {
      type: 'array',
      items: {
        type: 'object',
        properties: { command: { type: 'string' }, result: { type: 'string' } },
        required: ['command', 'result'],
      },
    },
    openIssues: STRINGS,
  },
  required: ['status', 'blockedReason', 'filesChanged', 'fixes', 'checksRun', 'openIssues'],
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
  return agent(
    [header('planner'), '', 'Turn this contract into one or more specs.', '', contractText(contract), redo].join('\n'),
    { label: problems ? 'planner (revision)' : 'planner', phase: 'Spec', schema: PLAN_SCHEMA },
  )
}

function buildSpec(spec, contract) {
  return agent(
    [
      header('implementer'),
      '',
      hasTests(spec)
        ? 'Build this spec. It is your whole assignment. Its tests are being written at the same time by a separate tester working from the same spec, so write no tests yourself.'
        : 'Build this spec. It is your whole assignment.',
      '',
      specText(spec, contract, 'implementer'),
    ].join('\n'),
    { label: `build ${spec.id}`, phase: 'Build', schema: BUILD_SCHEMA },
  )
}

// Tester of one spec. It runs beside the implementer of the same spec, so the
// tests are written from the spec and cannot be fitted to the code.
function writeTests(spec, contract) {
  return agent(
    [
      header('tester'),
      '',
      hasCode(spec)
        ? 'Write the tests for this spec. It is your whole assignment. An implementer is building the code at the same time from the same spec, so the tests are expected to fail until that code is in place.'
        : 'Write the tests for this spec. It is your whole assignment. The code under test already exists and is not being changed.',
      '',
      specText(spec, contract, 'tester'),
    ].join('\n'),
    { label: `test ${spec.id}`, phase: 'Build', schema: TEST_SCHEMA },
  )
}

// A later session of the same tester, with fresh context: it reads the tests as
// an outsider would, against the spec, and corrects what is wrong.
function selfCheckTests(spec, contract, pass) {
  return agent(
    [
      header('tester'),
      '',
      `This is self-check pass ${pass} on the tests of the spec below. They were written in an earlier session of your role; you are seeing them for the first time. Check every test in the files you own against the spec, correct what is wrong, and report what you found. Change a file only to correct a fault: a pass that changes nothing is what confirms the tests, and they are then treated as the standard the code is judged by.`,
      '',
      specText(spec, contract, 'tester'),
    ].join('\n'),
    { label: `self-check ${pass} ${spec.id}`, phase: 'Build', schema: SELF_CHECK_SCHEMA },
  )
}

// The tester's whole turn on one spec: write the tests, then re-check them in
// fresh sessions until a pass leaves them untouched, at most `maxPasses` times.
// Returns [{ result, tag }] in the order the sessions ran.
async function testSpec(spec, contract, maxPasses) {
  const written = await writeTests(spec, contract)
  const runs = [{ result: written, tag: {} }]
  if (!written || written.status !== 'done') return runs
  for (let pass = 1; pass <= maxPasses; pass++) {
    const result = await selfCheckTests(spec, contract, pass)
    runs.push({ result, tag: { selfCheck: pass } })
    if (!result || result.status !== 'done' || (result.filesChanged || []).length === 0) return runs
  }
  if (maxPasses > 0) log(`${spec.id}: the tests were still being corrected in self-check pass ${maxPasses}, the last one allowed; that correction was not re-checked.`)
  return runs
}

function runChecks(contract, round) {
  return agent(
    [
      header('checker'),
      '',
      'Run each of these commands from the repository root, exactly as written, and report what happened:',
      contract.checks.length > 0 ? contract.checks.map(c => `- ${c.name}: ${c.command}`).join('\n') : '- (no commands)',
      '',
      `Then list every file changed or created since the base commit: the output of \`git diff --name-only ${args.base}\` together with \`git ls-files --others --exclude-standard\`.`,
    ].join('\n'),
    { label: round === 0 ? 'checker' : `checker (round ${round})`, phase: round === 0 ? 'Check' : 'Repair', schema: CHECK_SCHEMA },
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
  return agent(
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
    ].join('\n'),
    { label: round === 0 ? 'reviewer' : `reviewer (round ${round})`, phase: round === 0 ? 'Review' : 'Repair', schema: REVIEW_SCHEMA },
  )
}

// Reviewer of one spec: sees that spec and the files it owns, nothing else.
function runSpecReview(spec, contract, check, round) {
  return agent(
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
    ].join('\n'),
    { label: round === 0 ? `review ${spec.id}` : `review ${spec.id} (round ${round})`, phase: round === 0 ? 'Review' : 'Repair', schema: REVIEW_SCHEMA },
  )
}

// The parts of the change and who owns which file, without the specs themselves.
function partsText(specs) {
  return specs
    .map(s => [`${s.id}: ${s.title}`, 'Source files:', bullets(s.filesOwned), 'Test files:', bullets(s.testFiles), `Interfaces: ${s.interfaces || 'none'}`].join('\n'))
    .join('\n\n')
}

// The one fixer of a repair round. It gets the combined report and the map of
// the change, not the specs, and may change source files only.
function fixCode(report, testFailures, contract, specs, round) {
  const beingCorrected =
    testFailures.length > 0
      ? [
          '',
          'These failures are in test files and are being corrected by their testers right now. Do not act on them; they are listed so that you do not bend the code to a test that is about to change:',
          '',
          JSON.stringify(testFailures, null, 2),
        ]
      : []
  return agent(
    [
      header('fixer'),
      '',
      `This is repair round ${round}. The change below was built, checked and reviewed, and did not pass. Fix the code so that it does.`,
      '',
      contractText(contract),
      '',
      'The report: every failure the checker and the reviewers found that the code has to answer for.',
      '',
      JSON.stringify(report, null, 2),
      ...beingCorrected,
      '',
      'The parts of the change. You may change the source files listed here and nothing else. The test files are the standard the code is judged by: read them to see what they expect, but do not change them.',
      '',
      partsText(specs),
      '',
      `See the change so far with \`git diff ${args.base}\` and \`git status --short\` (new files are untracked).`,
    ].join('\n'),
    { label: `fixer (round ${round})`, phase: 'Repair', schema: FIX_SCHEMA },
  )
}

// Only reached when a reviewer raised a finding against a test file, or for a
// spec that has no source files.
function repairTests(spec, failures, contract, round) {
  return agent(
    [
      header('tester'),
      '',
      `This is repair round ${round}. The tests for the spec below have been written and the code built, and the combined change did not pass. These failures were traced to the test files you own:`,
      '',
      JSON.stringify(failures, null, 2),
      '',
      'Judge each one against the spec and correct the tests where the failure is right: a test that asks for something the spec does not require, that calls the code differently from the interfaces in the spec, that is broken in itself, or a criterion with no test that would fail without the change. If a test is right according to the spec, leave it exactly as it is, return `done`, and say so in `openIssues`. Never change a test to match what the code does.',
      '',
      'Your spec:',
      '',
      specText(spec, contract, 'tester'),
    ].join('\n'),
    { label: `repair ${round} ${spec.id} tests`, phase: 'Repair', schema: TEST_SCHEMA },
  )
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

const input = args || {}
const contract = input.contract
const maxRepairRounds = Number.isInteger(input.maxRepairRounds) ? input.maxRepairRounds : 2
const maxSpecRevisions = Number.isInteger(input.maxSpecRevisions) ? input.maxSpecRevisions : 2
const maxTestChecks = Number.isInteger(input.maxTestChecks) ? input.maxTestChecks : 2

const state = { outcome: 'blocked', reason: '', overview: '', risks: [], specs: [], builds: [], tests: [], repairs: [], check: null, review: null, specReviews: [], failures: [], repairRounds: 0 }

function stop(outcome, reason) {
  state.outcome = outcome
  state.reason = reason
  log(`${outcome}: ${reason}`)
  return state
}

// Records what one build or repair agent returned. Returns the reason the run
// has to stop because of it, or '' if the agent did its job inside its own files.
// A job is { role, spec, allowed }: `allowed` is the list of files it may change,
// and `spec` is absent for the fixer, which works across the whole change.
// `tag` marks a later session: { repairRound } or { selfCheck }.
function settle(job, result, tag) {
  const r = result || { status: 'blocked', blockedReason: `The ${job.role} did not return a result.`, filesChanged: [], openIssues: [] }
  const entry = { ...(job.spec ? { spec: job.spec.id } : {}), ...tag, ...r }
  if (job.role === 'tester') state.tests.push(entry)
  else if (job.role === 'fixer') state.repairs.push(entry)
  else state.builds.push(entry)
  const who = job.spec ? `${job.spec.id} ${job.role}` : job.role
  if (r.status !== 'done') return `${who}: ${r.blockedReason || 'no reason given'}`
  const outside = filesOutsideAssignment(r.filesChanged, job.allowed)
  if (outside.length > 0) return `${who}: changed files it does not own (${outside.join(', ')})`
  return ''
}

const missing = []
if (isBlank(input.repo)) missing.push('repo')
if (isBlank(input.base)) missing.push('base')
for (const role of ['planner', 'implementer', 'tester', 'checker', 'reviewer', 'specReviewer', 'fixer']) {
  if (!input.roles || isBlank(input.roles[role])) missing.push(`roles.${role}`)
}
if (!contract || isBlank(contract.objective)) missing.push('contract.objective')
if (!contract || !Array.isArray(contract.criteria) || contract.criteria.length === 0) missing.push('contract.criteria')
if (!contract || !Array.isArray(contract.checks)) missing.push('contract.checks')
if (missing.length > 0) return stop('blocked', `Missing workflow args: ${missing.join(', ')}`)

// --- Spec -------------------------------------------------------------------
phase('Spec')
let specs = input.specs
let problems
if (Array.isArray(specs) && specs.length > 0) {
  problems = validateSpecs(specs, contract)
  state.specs = specs
  if (problems.length > 0) return stop('blocked', `The supplied specs are not usable: ${problems.join(' ')}`)
  log(`Using ${specs.length} supplied spec(s); planner skipped.`)
} else {
  let plan = await planSpecs(contract)
  if (!plan) return stop('blocked', 'The planner did not return a result.')
  problems = validateSpecs(plan.specs, contract)
  let revisions = 0
  while (problems.length > 0 && revisions < maxSpecRevisions) {
    revisions++
    log(`Specs rejected (${problems.length} problem(s)); asking the planner to revise (${revisions}/${maxSpecRevisions}).`)
    const revised = await planSpecs(contract, plan.specs, problems)
    if (!revised) return stop('blocked', 'The planner did not return a revised result.')
    plan = revised
    problems = validateSpecs(plan.specs, contract)
  }
  specs = plan.specs
  state.specs = specs
  state.overview = plan.overview
  state.risks = plan.risks
  if (problems.length > 0) return stop('blocked', `The specs are still not usable after ${maxSpecRevisions} revision(s): ${problems.join(' ')}`)
}

const levels = buildLevels(specs)
log(`${specs.length} spec(s) in ${levels.length} build level(s): ${levels.map(l => l.map(s => s.id).join('+')).join(' -> ')}`)
const untested = specs.filter(s => !hasTests(s)).map(s => s.id)
if (untested.length > 0) log(`No tester for ${untested.join(', ')}: the spec names no test files.`)

// --- Build ------------------------------------------------------------------
phase('Build')
for (const level of levels) {
  // The implementer and the tester of a spec start together, so neither works
  // from the other's output; the tester's self-check passes run while the
  // implementer is still building. Barrier on purpose: the next level depends
  // on everything in this one.
  const jobs = level.flatMap(spec => [
    ...(hasCode(spec) ? [{ spec, role: 'implementer', allowed: spec.filesOwned }] : []),
    ...(hasTests(spec) ? [{ spec, role: 'tester', allowed: spec.testFiles }] : []),
  ])
  const results = await parallel(
    jobs.map(j => () => (j.role === 'tester' ? testSpec(j.spec, contract, maxTestChecks) : buildSpec(j.spec, contract).then(result => [{ result, tag: {} }]))),
  )
  const blocked = jobs.flatMap((j, i) => (results[i] || [{ result: null, tag: {} }]).map(run => settle(j, run.result, run.tag))).filter(Boolean)
  if (blocked.length > 0) return stop('blocked', `The build could not be completed. ${blocked.join(' | ')}`)
}

// --- Check and review, then bounded repair ----------------------------------
let round = 0
while (true) {
  const check = await runChecks(contract, round)
  if (!check) return stop('blocked', 'The checker did not return a result.')
  state.check = check

  const stray = filesOutsideOwnership(check.changedFiles, specs, input.ignoreFiles)
  if (stray.length > 0) {
    return stop('blocked', `Files were changed that no spec owns: ${stray.join(', ')}. Either the specs were incomplete or an agent went outside its assignment.`)
  }

  // With several specs, every spec gets its own reviewer, alongside the reviewer
  // of the whole change. None of them depends on another, so they run together.
  const reviewedSpecs = specs.length > 1 ? specs : []
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
  if (state.failures.length === 0) return stop('passed', `All checks pass and every criterion is met${round > 0 ? ` after ${round} repair round(s)` : ''}.`)
  if (round >= maxRepairRounds) return stop('failed', `${state.failures.length} failure(s) remain after ${round} repair round(s).`)

  round++
  state.repairRounds = round
  // One fixer takes the combined report and repairs the code. A tester is
  // called back only for its own test files. They own disjoint files, so they
  // can run at the same time.
  const split = splitFailures(state.failures, specs)
  const jobs = [
    ...(split.code.length > 0 ? [{ role: 'fixer', allowed: sourceFiles(specs), failures: split.code }] : []),
    ...split.tests.map(g => ({ spec: g.spec, role: 'tester', allowed: g.spec.testFiles, failures: g.failures })),
  ]
  log(`${state.failures.length} failure(s); repair round ${round}/${maxRepairRounds}: ${jobs.map(j => (j.spec ? `${j.spec.id} tester` : 'fixer')).join(', ')}.`)
  const fixes = await parallel(
    jobs.map(j => () => (j.role === 'tester' ? repairTests(j.spec, j.failures, contract, round) : fixCode(j.failures, split.tests.flatMap(g => g.failures), contract, specs, round))),
  )
  const stuck = jobs.map((j, i) => settle(j, fixes[i], { repairRound: round })).filter(Boolean)
  if (stuck.length > 0) return stop('failed', `Repair round ${round} could not be carried out. ${stuck.join(' | ')}`)
}
