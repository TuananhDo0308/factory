export const meta = {
  name: 'factory',
  description: 'Run a coding contract through a planner, one test-first implementer and one QA agent per spec, a checker, fresh reviewers and a QC agent that uses the product; a spec that fails QA, review or QC goes back to Build, a bounded number of times',
  whenToUse: 'Called by the factory skill after the contract is written. Not meant to be started without its args.',
  phases: [
    { title: 'Spec', detail: 'planner turns the contract into specs; code validates them' },
    { title: 'Build', detail: 'per spec: the implementer writes the tests first, then the code; then QA. A spec QA sends back is rebuilt and checked again' },
    { title: 'Check', detail: 'checker runs the contract checks and lists changed files' },
    { title: 'Review', detail: 'only once every check passes: reviewers chosen by the run\'s risk (one for the whole change, plus one per spec when the work was split above low risk) and a QC agent that runs the product; the specs a failure concerns go back to Build, and a passing run is marked for a person when it touches what one must see' },
  ],
}

// ---------------------------------------------------------------------------
// Pure helpers. No agents, no I/O: these are the rules that code enforces so
// that no agent has to be trusted to follow them.
// ---------------------------------------------------------------------------
