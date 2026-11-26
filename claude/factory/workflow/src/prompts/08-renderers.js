// ---------------------------------------------------------------------------
// Text rendering for prompts
// ---------------------------------------------------------------------------

function bullets(items) {
  return (items || []).map(i => `- ${i}`).join('\n') || '- none'
}

// What the product must look like, from the contract's `design` (the
// project's DESIGN.md and tokens, and the approved mockup of each screen a
// criterion shows, with the states it must show). It reaches every role that
// builds or judges a screen, so nobody invents a look. Mockups are files in the
// repository: a link behind a sign-in is one an agent cannot open.
function designProblems(contract) {
  const d = contract && contract.design
  if (!d) return []
  const problems = []
  const ids = new Set((contract.criteria || []).map(c => c.id))
  for (const [i, sc] of (d.screens || []).entries()) {
    const name = isBlank(sc.screen) ? `screen ${i + 1}` : `screen "${sc.screen}"`
    if (isBlank(sc.mockup)) problems.push(`design: ${name} has no mockup.`)
    else if (/^https?:/i.test(String(sc.mockup))) problems.push(`design: ${name}'s mockup is a link (${sc.mockup}); commit the image to the repository so agents can open it.`)
    if (!Array.isArray(sc.criteria) || sc.criteria.length === 0) problems.push(`design: ${name} names no criterion.`)
    for (const c of sc.criteria || []) if (!ids.has(c)) problems.push(`design: ${name} names ${c}, which is not in the contract.`)
  }
  if ((d.screens || []).length > 0 && isBlank(d.doc)) problems.push('design: screens are given but no design doc (DESIGN.md).')
  for (const [i, b] of (d.baseline || []).entries()) {
    const name = isBlank(b.screen) ? `baseline screen ${i + 1}` : `baseline screen "${b.screen}"`
    if (isBlank(b.route)) problems.push(`design: ${name} has no route.`)
    if (!Array.isArray(b.before) || b.before.length === 0) problems.push(`design: ${name} has no before screenshot; take it on the base commit before the run.`)
  }
  return problems
}

// The design lines for the screens that concern `ids` (all screens when ids is null).
function designText(design, ids) {
  if (!design) return ''
  const screens = (design.screens || []).filter(sc => !ids || (sc.criteria || []).some(c => ids.includes(c)))
  const lines = []
  if (!isBlank(design.doc)) lines.push(`- Design rules: ${design.doc}${isBlank(design.tokens) ? '' : `; tokens: ${design.tokens} (use them; no colour, size or spacing written out by hand)`}`)
  if (!isBlank(design.uiStore)) {
    lines.push(`- Component catalogue: ${design.uiStore}/catalog.md (build from these components and copy its pattern files; where it lists duplicates, use the preferred one; a new component only when none fits)`)
    lines.push(`- Today's screens, if they were captured: ${design.uiStore}/screens/ (index.json lists them by route); a screen the ticket changes in words starts from how it looks there`)
  }
  if ((design.reuse || []).length > 0) lines.push(`- Reuse: ${design.reuse.join(', ')}`)
  for (const sc of screens) lines.push(`- Screen "${sc.screen}" for ${sc.criteria.join(', ')}: mockup ${sc.mockup}${(sc.states || []).length ? `; states: ${sc.states.join(', ')}` : ''}`)
  return lines.length > 0 ? lines.join('\n') : ''
}

function standardsText(standards, view) {
  if (!standards || !Array.isArray(standards.rules) || standards.rules.length === 0) return ''
  const fileName = standards.file || 'the project\'s'
  const line = r => `- ${r.id} (${r.severity}${r.enforced === 'tool' ? `, kept by the check "${r.check}"` : ''}): ${r.text}`
  const rules = standards.rules
  const reviewRules = rules.filter(r => r.enforced === 'review')
  const toolRules = rules.filter(r => r.enforced === 'tool')
  if (view === 'implementer') {
    return [
      `Coding standards (${fileName}; follow every one in the code and tests you write):`,
      ...rules.map(line),
    ].join('\n')
  }
  const lines = [
    `Coding standards to judge (${fileName}): give each rule below one entry in \`standards\`: \`pass\`, \`fail\` with the file and line of each place it is broken, or \`not_applicable\` when the code you review has nothing it applies to. A blocking rule that fails goes back to Build; a minor one is reported.`,
    ...(reviewRules.length > 0 ? reviewRules.map(line) : ['- none: every rule is kept by a tool']),
  ]
  if (toolRules.length > 0) {
    lines.push('Kept by the checks, not by you (their result is above):', ...toolRules.map(line))
  }
  return lines.join('\n')
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
    ...(designText(contract.design, null) ? ['', 'Design (what the product must look like):', designText(contract.design, null)] : []),
  ].join('\n')
}

// The contract as the QC agent sees it: what the product must do and how a
// user starts it. No checks, specs, diff or file list: QC judges the product by
// using it, and the code it would read is what the reviewers already read.
// `contract.run` is optional; without it QC finds out how to start the product
// the way a new teammate would.
function qcText(contract) {
  return [
    `Objective: ${contract.objective}`,
    '',
    'Acceptance criteria:',
    ...contract.criteria.map(c => `- ${c.id}: ${c.text}`),
    '',
    'Out of scope:',
    bullets(contract.outOfScope),
    '',
    'How to run the product:',
    isBlank(contract.run) ? 'Not given. Find out from the repository\'s README, docs and manifest (package.json scripts, Makefile, pyproject), as a new teammate would.' : String(contract.run).trim(),
    ...((contract.design && (contract.design.screens || []).length > 0)
      ? ['', 'Screens to compare with their approved mockups (one entry each in `screens`, and an accessibility scan of each in `a11y`):', ...contract.design.screens.map(sc => `- "${sc.screen}" (${sc.criteria.join(', ')}): ${sc.mockup}${(sc.states || []).length ? `; states: ${sc.states.join(', ')}` : ''}`)]
      : []),
    ...((contract.design && (contract.design.baseline || []).length > 0)
      ? ['', 'Screens this change must not break, with how they looked before it (one entry each in `baseline`):', ...contract.design.baseline.map(b => `- "${b.screen}" at ${b.route}: before ${(b.before || []).join(', ')}${b.expect ? `; the change intends: ${b.expect}` : ''}`)]
      : []),
  ].join('\n')
}

// --- Browser ----------------------------------------------------------------
function needsBrowser(contract, surfaces) {
  const d = (contract && contract.design) || {}
  return (surfaces || []).includes('ui') || (d.screens || []).length > 0 || (d.baseline || []).length > 0
}

function browserProblem(browser, contract, surfaces, qcOn) {
  if (!isBlank(browser) && !/^[A-Za-z0-9_-]+$/.test(String(browser).trim())) {
    return `"browser" must be the name of an MCP server (letters, digits, - and _), not "${browser}".`
  }
  if (!qcOn || !needsBrowser(contract, surfaces) || !isBlank(browser)) return ''
  return 'The change has a screen, and QC uses screens by clicking through a browser MCP server, which this run was not given. Configure Playwright MCP in .mcp.json or ~/.claude.json (with `claude mcp add` or factory-init), restart the session so its tools load, and pass its server name as "browser".'
}

function browserNote(browser) {
  if (isBlank(browser)) return ''
  const server = String(browser).trim()
  if (server === 'http') {
    return 'Browser mode: `http` (no Playwright MCP configured in this session). Start the real HTTP server as the contract\'s `run` says, verify every rendered HTML/CSS/JS asset and API endpoint through live HTTP requests (using node fetch or curl), and leave no files behind in the repository.'
  }
  const t = name => `\`mcp__${server}__browser_${name}\``
  return [
    `Browser: use the Playwright MCP tools of server "${server}" (load them with ToolSearch if they are deferred) for every criterion and screen seen in a browser.`,
    `- Open a page with ${t('navigate')} and read it with ${t('snapshot')} before every action: the snapshot is what you act on, by the element's role and name.`,
    `- Act one step at a time with ${t('click')}, ${t('type')}, ${t('fill_form')}, ${t('select_option')} and ${t('press_key')}, and take a new snapshot after each to see what it did. Wait for a change with ${t('wait_for')}, not a fixed sleep.`,
    `- Set the width with ${t('resize')}, save screenshots with ${t('take_screenshot')} under an absolute path in your scratch directory (a relative name lands in the repository), and read ${t('console_messages')} once per screen: an error there goes in \`openIssues\`.`,
    `- Write no browser script: no Playwright or Puppeteer file, no \`npx playwright\`, no ${t('run_code_unsafe')}, except the one accessibility scan your brief describes. Close the browser with ${t('close')} before you return.`,
    '- If these browser MCP tools are not available in your toolset, return `blocked` and say so: do not fall back to a script.',
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
    ...(designText(contract.design, spec.criteria || []) ? part('Design (follow it; the mockups are the approved look):', designText(contract.design, spec.criteria || [])) : []),
    ...(view === 'implementer' && standardsText(contract.standards, 'implementer') ? ['', standardsText(contract.standards, 'implementer')] : []),
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
    ...projectNote(role, args.projectDocs, args.projectStack),
  ].join('\n')
}

// The project's own instructions, named in its profile's `docs`: every role
// that reads code reads them first, because the patterns, commands and
// defaults the tech lead wrote there are what the code must follow. QC does
// not: it uses the product the way a user would, from the README and docs.
function projectNote(role, docs, stack) {
  if (role === 'qc') return []
  let s = stack
  if (typeof s === 'string') {
    const raw = s.trim()
    if (raw.startsWith('{')) {
      try {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) s = parsed
      } catch {}
    }
  }
  const st = s && typeof s === 'object' && (s.languages || []).length
    ? [`Stack: ${[...(s.languages || []), ...(s.frameworks || [])].join(', ')}${s.packageManager ? ` (${s.packageManager})` : ''}${s.adr ? `; why it was chosen: ${s.adr}` : ''}. Follow its conventions and the project's own patterns; add no other framework or library for something these already do.`]
    : typeof s === 'string' && !isBlank(s)
      ? [`Stack: ${s.trim()}. Follow its conventions and the project's own patterns; add no other framework or library for something these already do.`]
      : []
  if (!docs || typeof docs !== 'object' || isBlank(docs.agents)) return st.length ? ['', ...st] : []
  const more = [['product', 'what the product is and for whom'], ['decisions', 'decisions people already made; follow them'], ['glossary', 'the words the product uses']]
    .filter(([k]) => role === 'planner' || role === 'reviewer' ? !isBlank(docs[k]) : k === 'decisions' && !isBlank(docs[k]))
    .map(([k, why]) => `- ${docs[k]}: ${why}`)
  return ['', `Project instructions: read ${docs.agents} before anything else and follow it; where it conflicts with your role brief on what you may change or return, the brief wins.`, ...st, ...more]
}

// The parts of the change and who owns which file, without the specs themselves.
function partsText(specs) {
  return specs
    .map(s => [`${s.id}: ${s.title}`, 'Source files:', bullets(s.filesOwned), 'Test files:', bullets(s.testFiles), `Interfaces: ${s.interfaces || 'none'}`].join('\n'))
    .join('\n\n')
}

// What the checker is told for the isolation search (roles/checker.md): each
// spec's test files, the suspects when a failing test passes alone. Only the
// run's own test files are listed: the tests that were there before the run
// passed with each other already. '' when no spec has test files.
const MAX_ISOLATION_RUNS = 12
function isolationText(specs) {
  const withTests = (specs || []).filter(hasTests)
  if (withTests.length === 0) return ''
  return [
    `If a test command fails, look for a test file that breaks the others, as your brief says, in at most ${MAX_ISOLATION_RUNS} extra runs per command. The suspects are the test files of this run, per spec:`,
    ...withTests.map(s => `- ${s.id}: ${s.testFiles.map(normPath).join(', ')}`),
  ].join('\n')
}
