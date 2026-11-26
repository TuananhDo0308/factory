// --- Models -----------------------------------------------------------------
// The model and reasoning effort of each role, decided here. The planner is
// where a mistake costs the most, since every agent after it builds on its
// specs, so it gets the strongest model; so does the reviewer of the whole
// change, the last gate before pass or fail. Implementers, QA, spec reviewers
// and the checker work from a spec already written, or only run commands. A
// spec sent back to Build has shown that its first model was not enough, so
// its rebuild runs on a stronger one.
//
// Customizing models without touching the pipeline:
//   1. Pass `args.modelProfile` ("balanced" | "fast" | "flagship" | "inherit")
//      matching `factory/catalog/model-profiles.json`, AND/OR
//   2. Pass `args.models` to override individual roles, e.g.
//      `{ "implementer": { "model": "opus" } }`. A model of `"inherit"` uses
//      the invoking session's model.
const MODELS = {
  planner: { model: 'fable', effort: 'high' },
  implementer: { model: 'sonnet', effort: 'medium' },
  qa: { model: 'sonnet', effort: 'medium' },
  rebuild: { model: 'opus', effort: 'medium' },
  checker: { model: 'sonnet', effort: 'low' },
  reviewer: { model: 'opus', effort: 'high' },
  specReviewer: { model: 'sonnet', effort: 'medium' },
  qc: { model: 'sonnet', effort: 'medium' },
}
const MODEL_NAMES = ['haiku', 'sonnet', 'opus', 'fable', 'inherit']
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

// Named model profiles (kept in sync with `factory/catalog/model-profiles.json`).
const MODEL_PROFILES = {
  balanced: MODELS,
  fast: {
    planner: { model: 'sonnet', effort: 'high' },
    implementer: { model: 'sonnet', effort: 'medium' },
    qa: { model: 'haiku', effort: 'medium' },
    rebuild: { model: 'sonnet', effort: 'high' },
    checker: { model: 'haiku', effort: 'low' },
    reviewer: { model: 'sonnet', effort: 'high' },
    specReviewer: { model: 'haiku', effort: 'medium' },
    qc: { model: 'sonnet', effort: 'low' },
  },
  flagship: {
    planner: { model: 'fable', effort: 'high' },
    implementer: { model: 'opus', effort: 'high' },
    qa: { model: 'opus', effort: 'medium' },
    rebuild: { model: 'opus', effort: 'high' },
    checker: { model: 'sonnet', effort: 'low' },
    reviewer: { model: 'opus', effort: 'xhigh' },
    specReviewer: { model: 'opus', effort: 'high' },
    qc: { model: 'sonnet', effort: 'high' },
  },
  inherit: {
    planner: { model: 'inherit' },
    implementer: { model: 'inherit' },
    qa: { model: 'inherit' },
    rebuild: { model: 'inherit' },
    checker: { model: 'inherit' },
    reviewer: { model: 'inherit' },
    specReviewer: { model: 'inherit' },
    qc: { model: 'inherit' },
  },
}

// Problems with `args.modelProfile`; empty means it can be used.
function modelProfileProblems(profile) {
  if (profile === undefined || profile === null || profile === '') return []
  if (typeof profile !== 'string' || !MODEL_PROFILES[profile]) {
    return [`"modelProfile" must be one of ${Object.keys(MODEL_PROFILES).join(', ')}.`]
  }
  return []
}

// Merges an optional `args.modelProfile` underneath explicit `args.models` overrides.
// Returns `overrides` untouched when no non-default profile is specified.
function resolveModelsForProfile(profile, overrides) {
  if (!profile || profile === 'balanced' || !MODEL_PROFILES[profile]) return overrides
  const base = MODEL_PROFILES[profile]
  const out = {}
  for (const role of new Set([...Object.keys(base), ...Object.keys(overrides || {})])) {
    out[role] = { ...(base[role] || {}), ...((overrides || {})[role] || {}) }
  }
  return out
}

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

// Which reviewers and models a run gets, by its risk (super-board's and
// zazencodes' routing): a low-risk change is reviewed once, on a cheaper
// model; a high-risk one by every reviewer on the strongest. `args.models`
// still overrides any role.
const ROUTING = {
  low: { specReviews: false, models: { reviewer: { model: 'sonnet', effort: 'medium' } } },
  medium: { specReviews: true, models: {} },
  high: { specReviews: true, models: { reviewer: { model: 'opus', effort: 'xhigh' }, specReviewer: { model: 'opus', effort: 'high' } } },
}

// The models for a run at this risk, with the caller's overrides on top.
function routedModels(risk, overrides) {
  const routed = (ROUTING[risk] || ROUTING.medium).models
  const out = {}
  for (const role of new Set([...Object.keys(routed), ...Object.keys(overrides || {})])) {
    out[role] = { ...(routed[role] || {}), ...((overrides || {})[role] || {}) }
  }
  return out
}
