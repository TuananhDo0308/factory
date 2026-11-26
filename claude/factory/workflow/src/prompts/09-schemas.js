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
    risk: { type: 'string', enum: ['low', 'medium', 'high'] },
    surfaces: { type: 'array', items: { type: 'string', enum: ['ui', 'security', 'data'] } },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: { question: { type: 'string' }, why: { type: 'string' }, criteria: STRINGS },
        required: ['question', 'why', 'criteria'],
      },
    },
  },
  required: ['overview', 'specs', 'risks', 'risk', 'surfaces', 'questions'],
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
          written: { type: 'boolean', description: 'True when this session closed it in the spec\'s test files: a test added, or a missing restore added' },
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
          culprits: { ...STRINGS, description: 'Only for a failing test command whose failing tests pass alone: the repository-relative test file(s) that make them fail when run before them, each confirmed by a run' },
          culpritEvidence: { type: 'string', description: 'The isolation runs you made and their results, including when no culprit was found' },
          rerunExitCode: { type: 'integer', description: 'Only when the command failed: the exit code of running it once more, exactly as written' },
        },
        required: ['name', 'command', 'exitCode', 'outputTail'],
      },
    },
    changedFiles: { ...STRINGS, description: 'Repository-relative paths changed or created since the base commit' },
    baseRuns: {
      type: 'array',
      description: 'Only when asked: each listed spec\'s test files run against the base code',
      items: {
        type: 'object',
        properties: { spec: { type: 'string' }, files: STRINGS, command: { type: 'string' }, exitCode: { type: 'integer' }, outputTail: { type: 'string' } },
        required: ['spec', 'files', 'command', 'exitCode', 'outputTail'],
      },
    },
    migration: {
      type: 'object',
      description: 'Only when asked and a changed file is a migration: up, down and up again',
      properties: {
        ran: { type: 'boolean' },
        steps: { type: 'array', items: { type: 'object', properties: { command: { type: 'string' }, exitCode: { type: 'integer' }, outputTail: { type: 'string' } }, required: ['command', 'exitCode', 'outputTail'] } },
      },
      required: ['ran', 'steps'],
    },
  },
  required: ['results', 'changedFiles'],
}

const CHANGED_FILES_SCHEMA = {
  type: 'object',
  properties: {
    changedFiles: {
      ...STRINGS,
      description: 'Exact verbatim repository-relative paths returned by git diff --name-only and git ls-files --others --exclude-standard',
    },
  },
  required: ['changedFiles'],
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
    standards: {
      type: 'array',
      description: 'One entry per coding standard you were given to judge; empty when you were given none',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The rule, S1..Sn' },
          status: { type: 'string', enum: ['pass', 'fail', 'not_applicable'] },
          file: { type: 'string', description: 'For a fail: the file that breaks it; otherwise empty' },
          line: { type: 'integer', description: 'For a fail: the line; otherwise 0' },
          evidence: { type: 'string', description: 'For a fail: what breaks the rule and what it requires instead, written to stand alone; for a pass: where you looked' },
        },
        required: ['id', 'status', 'file', 'line', 'evidence'],
      },
    },
    notReviewed: STRINGS,
  },
  required: ['criteria', 'findings', 'standards', 'notReviewed'],
}

const QC_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'blocked'] },
    blockedReason: { type: 'string', description: 'Why the product could not be run for a reason the change did not cause, and what is needed; empty when done' },
    startedWith: { type: 'string', description: 'How the product was built and started, as commands' },
    criteria: {
      type: 'array',
      description: 'Every criterion of the contract exactly once',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          status: { type: 'string', enum: ['pass', 'fail', 'not_observable'] },
          scenario: { type: 'string', description: 'What was done, through which entry point, with the exact inputs; for not_observable, why no use of the product can show it' },
          expected: { type: 'string', description: 'What the criterion says should be seen, written before running it' },
          observed: { type: 'string', description: 'What was seen, quoted from the output, response or page' },
          steps: { ...STRINGS, description: 'Every action taken on the product for this criterion, in order: in a browser, the tool and its target by role and name (navigate /login; type "a@b.co" into textbox "Email"; click button "Sign in"; snapshot: heading "Dashboard" shown); on a CLI or HTTP, the command. Empty only for not_observable' },
        },
        required: ['id', 'status', 'scenario', 'expected', 'observed', 'steps'],
      },
    },
    screens: {
      type: 'array',
      description: 'One entry per screen the contract gives a mockup for; empty when it gives none',
      items: {
        type: 'object',
        properties: {
          screen: { type: 'string' },
          screenshot: { type: 'string', description: 'Path of the screenshot taken, in the scratch directory' },
          status: { type: 'string', enum: ['match', 'differs'] },
          differences: STRINGS,
        },
        required: ['screen', 'screenshot', 'status', 'differences'],
      },
    },
    baseline: {
      type: 'array',
      description: 'One entry per screen the change must not break; empty when none are listed',
      items: {
        type: 'object',
        properties: {
          screen: { type: 'string' },
          after: { type: 'string', description: 'Path of the screenshot taken now' },
          status: { type: 'string', enum: ['same', 'intended', 'regressed'] },
          differences: STRINGS,
        },
        required: ['screen', 'after', 'status', 'differences'],
      },
    },
    a11y: {
      type: 'array',
      description: 'Accessibility scan of each screen with a mockup; empty when no scanner could run',
      items: {
        type: 'object',
        properties: {
          screen: { type: 'string' },
          tool: { type: 'string' },
          violations: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, impact: { type: 'string', enum: ['minor', 'moderate', 'serious', 'critical'] }, nodes: { type: 'integer' }, help: { type: 'string' } }, required: ['id', 'impact', 'nodes', 'help'] } },
        },
        required: ['screen', 'tool', 'violations'],
      },
    },
    filesChanged: { ...STRINGS, description: 'Repository files changed or created and not removed again; must be empty' },
    commandsRun: COMMANDS,
    openIssues: STRINGS,
  },
  required: ['status', 'blockedReason', 'startedWith', 'criteria', 'screens', 'baseline', 'a11y', 'filesChanged', 'commandsRun', 'openIssues'],
}
