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
    // The planner draws the seams every spec is built along: deep modules with
    // small interfaces, at the place the codebase already puts such code.
    planner: ['codebase-design'],
    implementer: ['verification-before-completion', 'mp-code-review'],
    qa: ['tdd', 'diagnosing-bugs', 'verification-before-completion', 'testing-strategy', 'mp-code-review', 'pr-security-review'],
    reviewer: ['mp-code-review', 'codebase-design'],
    specReviewer: ['mp-code-review', 'codebase-design'],
  },
  // Loaded only when the situation calls for it, which the agent judges by the
  // rule given with each. Offered only when installed; a run starts without them.
  conditional: {
    planner: {
      'domain-modeling': 'when the ticket names a domain concept the code does not have yet, or uses a word the code means differently; settle the term in the specs, not in files',
    },
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
    // QC loads no fixed or browser-test skill on purpose: the review skills
    // would make it read the code the way the reviewers already do, and it
    // clicks through browsers by hand via Playwright MCP rather than writing scripts.
    qc: {},
  },
  // Added for a surface the run touches: a change to auth or money gets the
  // security review from its reviewers too, not only from QA.
  surfaces: {
    security: { reviewer: ['pr-security-review'], specReviewer: ['pr-security-review'] },
  },
  // Skills that wait on a person. Nobody is there to answer during a run.
  interactive: ['grill-me', 'grilling', 'grill-with-docs', 'wizard', 'teach', 'to-questionnaire', 'wait-what', 'ask-matt', 'setup-matt-pocock-skills'],
}

// Every skill the registry can hand out: what the session must have installed.
function requiredSkills() {
  const all = [...Object.values(SKILLS.implementer).flat(), ...Object.values(SKILLS.always).flat(), ...Object.values(SKILLS.surfaces).flatMap(r => Object.values(r).flat())]
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
  const listed = Object.entries(SKILLS.conditional[role] || {})
    .filter(([name]) => !isBlank(have[name]) && !(loaded || []).includes(name))
    .map(([name, when]) => ({ name, when }))
  const own = role === 'checker' ? [] : repoSkillsFor(have, args && args.repo, [...(loaded || []), ...listed.map(l => l.name)])
  return [...listed, ...own]
}

// The project's own skills (under <repo>/.claude/skills, installed by
// factory-init or written by the team) that this role is not already loading:
// offered with a rule, so an agent loads the one that covers what it touches.
function repoSkillsFor(available, repo, loaded) {
  const root = `${String(repo || '').replace(/\/+$/, '')}/.claude/skills/`
  return Object.entries(available || {})
    .filter(([name, path]) => String(path || '').startsWith(root) && !(loaded || []).includes(name))
    .map(([name]) => ({ name, when: 'a skill of this project: read its description, and load it when it covers the code, library or pattern you work on' }))
}

// The required skills that `available` ({ name: path }) does not resolve.
function missingSkills(available) {
  const have = available && typeof available === 'object' ? available : {}
  return requiredSkills().filter(n => isBlank(have[n]))
}

// The project's stack skills (its profile's `skills`) that `available` does not
// resolve: a run must not start with an agent missing the skill its stack needs.
function missingProjectSkills(project, available) {
  const have = available && typeof available === 'object' ? available : {}
  const all = [...new Set(Object.values(project || {}).flat())]
  return all.filter(n => isBlank(have[n]))
}

// The skills one agent loads, in order. `role` is implementer, qa, reviewer or
// specReviewer; `spec` is absent for the reviewer of the whole change.
// `surfaces` (the run's, from assessRisk) add the skills SKILLS.surfaces names.
// `project` is the `skills` part of the project's profile (.factory/project.json):
// the stack's skills the tech lead chose, by role. They are added to the
// process skills, never in place of them; a spec reviewer gets the reviewer's.
function skillsFor(role, spec, surfaces, project) {
  const extra = (surfaces || []).flatMap(s => ((SKILLS.surfaces[s] || {})[role]) || [])
  const stack = ((project || {})[role === 'specReviewer' ? 'reviewer' : role]) || []
  const own =
    role === 'implementer' && spec
      ? Array.isArray(spec.skills) && spec.skills.length > 0
        ? spec.skills
        : SKILLS.implementer[spec.kind] || []
      : []
  return [...new Set([...own, ...(SKILLS.always[role] || []), ...extra, ...stack])]
}

// Returns a list of human-readable problems; empty means the specs are usable.
// `available` lists the skill names installed for this run; when given, a
// spec's own `skills` must come from it.
// `guarded(file)` says whether a file is protected in this run (see
