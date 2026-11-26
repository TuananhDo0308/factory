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
      skillsNote(skillsFor('planner', null, null, args.projectSkills), args.skills, '', conditionalFor('planner', args.skills, skillsFor('planner', null, null, args.projectSkills))),
      ...(args.questionsOnly
        ? ['', 'This is a readiness check, not a build: nothing will be built from these specs. What matters is `questions`: every decision the contract, the issue and the repository leave to you. Plan as you would for a build, so you meet the same gaps, then return them.']
        : []),
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
      skillsNote(skillsFor('implementer', spec, null, args.projectSkills), args.skills, '', conditionalFor('implementer', args.skills, skillsFor('implementer', spec, null, args.projectSkills))),
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
      skillsNote(skillsFor('qa', spec, null, args.projectSkills), args.skills, '', conditionalFor('qa', args.skills, skillsFor('qa', spec, null, args.projectSkills))),
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
      skillsNote(skillsFor('implementer', spec, null, args.projectSkills), args.skills, '', conditionalFor('implementer', args.skills, skillsFor('implementer', spec, null, args.projectSkills))),
    ].join('\n'),
    { label: `rebuild ${n} ${spec.id}`, phase: 'Build', schema: REBUILD_SCHEMA, ...modelFor('rebuild', args.models) },
  )
}

// `tdd` lists the specs whose new tests must be shown to fail on the base code
// this round: every eligible spec in the first check, then those just rebuilt.
function runChecks(contract, specs, round, tdd) {
  const isolation = isolationText(specs)
  const proof = !isBlank(contract.testFileCommand) && (tdd || []).length > 0
    ? [
        'Then show that the new tests fail without the change. In your scratch directory, `git worktree add --detach <dir> ' + args.base + '`, and if the repository has a `node_modules`, link it into that worktree. For each spec below, copy its test files from the repository into the worktree at the same paths, run the command with `{files}` replaced by those paths, from the worktree root, and report it in `baseRuns` with the spec id, the files, the command, the exit code and the output tail. Then `git worktree remove --force <dir>`. Change nothing in the repository itself.',
        `Command: ${contract.testFileCommand}`,
        ...tdd.map(s => `- ${s.id}: ${(s.testFiles || []).join(' ')}`),
        '',
      ]
    : []
  const migrate = contract.migration && !isBlank(contract.migration.up) && !isBlank(contract.migration.down)
    ? [`If any changed file is a database migration (under a migrations folder, a .sql file, schema.prisma), run, from the repository root and against the test database only, in this order: \`${contract.migration.up}\`, then \`${contract.migration.down}\`, then \`${contract.migration.up}\` again, and report them in \`migration\` (ran: true, one step each). When no changed file is a migration, report \`migration\` with ran: false and no steps.`, '']
    : []
  return spawn(
    [
      header('checker'),
      '',
      'Run each of these commands from the repository root, exactly as written, and report what happened. Report each result with the name in quotes, copied exactly:',
      contract.checks.length > 0 ? contract.checks.map(c => `- name "${c.name}", command: ${c.command}`).join('\n') : '- (no commands)',
      '',
      'When a command fails, run it once more exactly as written and report that exit code too, in `rerunExitCode`: a test that fails only sometimes must not be taken for a broken change.',
      '',
      ...(isolation ? [isolation, ''] : []),
      ...proof,
      ...migrate,
      `Then list every file changed or created since the base commit by running \`(git diff --name-only ${args.base}; git ls-files --others --exclude-standard) | sort -u\` and copying each line character-for-character verbatim into \`changedFiles\` (never retype, abbreviate, or merge filenames from memory).`,
    ].join('\n'),
    { label: round === 0 ? 'checker' : `checker (round ${round})`, phase: 'Check', schema: CHECK_SCHEMA, ...modelFor('checker', args.models) },
  )
}

// Focused single-turn verification of changedFiles, invoked only when the
// checker reports paths outside spec ownership or in protectedPaths so a
// hallucinated/merged filename never falsely blocks a passing run.
function verifyChangedFiles(flagged, round) {
  return spawn(
    [
      header('checker'),
      '',
      'Do not run tests or edit any files. Only verify the exact changed file list against Git.',
      `Run from the repository root: \`(git diff --name-only ${args.base}; git ls-files --others --exclude-standard) | sort -u\``,
      '',
      `The previous report flagged these path(s) as unowned or protected: ${flagged.join(', ')}.`,
      'Copy every non-empty line of the Git output above character-for-character verbatim into `changedFiles`. Do not include any path that did not literally appear in that Git output.',
    ].join('\n'),
    {
      label: round === 0 ? 'checker (verify files)' : `checker (verify files, round ${round})`,
      phase: 'Check',
      schema: CHANGED_FILES_SCHEMA,
      ...modelFor('checker', args.models),
    },
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
      ...(standardsText(contract.standards, 'reviewer') ? ['', standardsText(contract.standards, 'reviewer')] : []),
      '',
      skillsNote(skillsFor('reviewer', null, args.surfaces, args.projectSkills), args.skills, fixedPoint('the contract above'), conditionalFor('reviewer', args.skills, skillsFor('reviewer', null, args.surfaces, args.projectSkills))),
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
      ...(standardsText(contract.standards, 'reviewer') ? ['', standardsText(contract.standards, 'reviewer')] : []),
      '',
      skillsNote(skillsFor('specReviewer', spec, args.surfaces, args.projectSkills), args.skills, fixedPoint('the spec above'), conditionalFor('specReviewer', args.skills, skillsFor('specReviewer', spec, args.surfaces, args.projectSkills))),
    ].join('\n'),
    { label: round === 0 ? `review ${spec.id}` : `review ${spec.id} (round ${round})`, phase: 'Review', schema: REVIEW_SCHEMA, ...modelFor('specReviewer', args.models) },
  )
}

// QC: a fresh agent that runs the product and tries each criterion as a user
// would. It sees the contract and how to start the product, nothing of the
// specs, the diff or anyone's account, and changes nothing in the repository.
function runQc(contract, round) {
  return spawn(
    [
      header('qc'),
      '',
      'Use the product as it now stands in the repository, the way a user would, and judge each criterion by what it does.',
      '',
      qcText(contract),
      '',
      `The contract's checks have passed on this change. Do not read the change itself (\`git diff\`, the files it touched): judge what the product does, not what its code says.`,
      'Reviewers are reading the repository at the same time. Change nothing in it: no edits, commits, stashes or checkouts.',
      ...(browserNote(args.browser) ? ['', browserNote(args.browser)] : []),
      '',
      skillsNote(skillsFor('qc', null, null, args.projectSkills), args.skills, '', conditionalFor('qc', args.skills, skillsFor('qc', null, null, args.projectSkills))),
    ].join('\n'),
    { label: round === 0 ? 'qc' : `qc (round ${round})`, phase: 'Review', schema: QC_SCHEMA, ...modelFor('qc', args.models) },
  )
}
