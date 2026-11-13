// Loads the pure helpers of factory/workflow/factory.js for testing.
//
// A workflow script is not a module: its body uses top-level `return` and the
// globals the Workflow tool provides. Everything above "The run" section only
// defines functions and constants, so that part is evaluated here inside a
// function, with stand-ins for the globals, and the helpers are handed back.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const NAMES = [
  'validateSpecs', 'buildLevels', 'matchesIgnore', 'filesOutsideOwnership', 'filesOutsideAssignment',
  'worktreeOf', 'setupScript', 'readSetup', 'gatherScript', 'readGather',
  'evaluate', 'sourceFiles', 'splitFailures', 'runRecord', 'specText', 'contractText',
]

const file = fileURLToPath(new URL('../factory/workflow/factory.js', import.meta.url))
const source = readFileSync(file, 'utf8')
const run = source.indexOf('\n// The run\n')
if (run < 0) throw new Error('factory.js has no "The run" section; update tests/load.mjs')
const head = source.slice(0, source.lastIndexOf('// ----', run)).replace('export const meta', 'const meta')

const args = { repo: '/repo', base: 'BASE', roles: {} }
export const helpers = new Function('args', 'agent', 'log', `${head}\nreturn { ${NAMES.join(', ')} }`)(args, () => null, () => {})
