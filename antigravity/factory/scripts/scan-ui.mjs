#!/usr/bin/env node
// The UI catalogue of a front end, read from its code: which components exist,
// their props and variants, how often and where each is used, which ones
// duplicate each other, and the file to copy for each common pattern (a form,
// a table, an empty state…). Agents build new screens from it, so that new code
// reuses the components the app already has instead of drawing look-alikes.
//
//   node scan-ui.mjs <repo> [--out .factory/design/ui-store]
//
// Writes catalog.json and catalog.md into --out. Choices a person made earlier
// (`preferred`: which of a set of duplicates is the one to use) are read back
// from the old catalog.json and kept. It reads source files only; it runs
// nothing. The pure functions are tested in tests/scan-ui.test.mjs.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const SOURCE = /\.(tsx|jsx|ts|js|vue|svelte)$/
const COMPONENT_FILE = /\.(tsx|jsx|vue|svelte)$/
const SKIP = /(^|\/)(node_modules|dist|build|\.next|coverage|\.storybook|__tests__|tests?|e2e|\.factory)\/|\.(test|spec|stories)\.[a-z]+$|\.d\.ts$/

// Component libraries and helpers, read from package.json and marker files.
export function uiLibraries(pkg, files) {
  const deps = pkg ? { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) } : {}
  const has = n => Object.keys(deps).some(d => d === n || d.startsWith(n))
  const libs = []
  if (files.includes('components.json') && has('@radix-ui/')) libs.push('shadcn/ui (Radix + Tailwind; components are copied into the repository)')
  else if (has('@radix-ui/')) libs.push('Radix UI')
  for (const [dep, name] of [['@mui/material', 'MUI'], ['antd', 'Ant Design'], ['@chakra-ui/react', 'Chakra UI'], ['@mantine/core', 'Mantine'], ['@headlessui/react', 'Headless UI'], ['react-bootstrap', 'React Bootstrap'], ['vuetify', 'Vuetify'], ['element-plus', 'Element Plus'], ['tailwindcss', 'Tailwind CSS'], ['class-variance-authority', 'cva (variants)'], ['styled-components', 'styled-components'], ['@emotion/react', 'Emotion'], ['react-hook-form', 'React Hook Form'], ['formik', 'Formik'], ['zod', 'zod'], ['@tanstack/react-table', 'TanStack Table'], ['lucide-react', 'Lucide icons'], ['sonner', 'sonner (toasts)'], ['react-hot-toast', 'react-hot-toast']]) {
    if (has(dep)) libs.push(name)
  }
  return libs
}

const PASCAL = /^[A-Z][A-Za-z0-9]*$/

// The components one file defines, with their props and variants.
export function parseComponents(path, text) {
  if (/\.(vue|svelte)$/.test(path)) {
    const name = basename(path).replace(/\.(vue|svelte)$/, '')
    const props = [...text.matchAll(/defineProps<\{([^}]*)\}>|export let ([a-zA-Z_]\w*)/g)].flatMap(m => (m[1] ? propKeys(m[1]) : [m[2]]))
    return [{ name, file: path, kind: 'component', props: [...new Set(props)], variants: variantsIn(text) }]
  }
  const names = new Set()
  for (const m of text.matchAll(/export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Z]\w*)/g)) names.add(m[1])
  for (const m of text.matchAll(/export\s+const\s+([A-Z]\w*)\s*(?::[^=]+)?=\s*(?:React\.)?(?:forwardRef|memo|\(|function|styled)/g)) names.add(m[1])
  for (const m of text.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const n = part.trim().split(/\s+as\s+/).pop().trim()
      if (PASCAL.test(n) && !/Props$|Variants$/.test(n) && new RegExp(`(?:function|const)\\s+${n.split(/\s+as\s+/)[0]}\\b`).test(text)) names.add(n)
    }
  }
  // Exported style helpers (cva's buttonVariants, a navStyles object): code often
  // styles a link or a div with them instead of rendering the component.
  const styles = new Set()
  for (const m of text.matchAll(/export\s+const\s+([a-z]\w*(?:Variants|Styles|Classes))\b/g)) styles.add(m[1])
  for (const m of text.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const n = part.trim().split(/\s+as\s+/).pop().trim()
      if (/^[a-z]\w*(Variants|Styles|Classes)$/.test(n)) styles.add(n)
    }
  }
  if (names.size === 0 && styles.size === 0) return []
  const variants = variantsIn(text)
  const comps = [...names].filter(n => PASCAL.test(n) && !/Props$|Context$|Provider$/.test(n)).map(name => {
    const block = text.match(new RegExp(`(?:interface\\s+${name}Props[^{]*|type\\s+${name}Props\\s*=[^{]*)\\{([\\s\\S]*?)\\n\\}`))
    return { name, file: path, kind: 'component', props: block ? propKeys(block[1]) : [], variants }
  })
  return [...comps, ...[...styles].map(name => ({ name, file: path, kind: 'style', props: [], variants }))]
}

// Top-level keys of a type body, on separate lines or separated by ; or ,.
function propKeys(body) {
  const top = topLevel(body)
  return [...top.matchAll(/(?:^|[;,\n])\s*(?:readonly\s+)?([a-zA-Z_]\w*)\??\s*:/g)].map(m => m[1])
}

// The text of an object body with every nested {...} removed.
function topLevel(body) {
  let depth = 0
  let out = ''
  for (const ch of body) {
    if (ch === '{') depth++
    if (depth === 0) out += ch
    if (ch === '}') depth--
  }
  return out
}

// The {...} that starts at text[open], as its inner text.
function braceBody(text, open) {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}' && --depth === 0) return text.slice(open + 1, i)
  }
  return ''
}

// Variant names from cva(...) or a union of string literals on `variant`/`size`.
function variantsIn(text) {
  const out = {}
  const at = text.search(/\bvariants\s*:\s*\{/)
  if (at >= 0) {
    const body = braceBody(text, text.indexOf('{', at))
    // Only the variant groups at the top of `variants`, not objects nested in them.
    const top = topLevel(body)
    for (const m of body.matchAll(/(?:^|[,\n])\s*["']?([a-zA-Z]\w*)["']?\s*:\s*\{/g)) {
      const start = m.index + m[0].length - 1
      if (!top.includes(m[0].slice(0, -1).trim())) continue
      const inner = braceBody(body, start)
      out[m[1]] = [...topLevel(inner).matchAll(/(?:^|[,\n])\s*["']?([a-zA-Z0-9-]+)["']?\s*:/g)].map(x => x[1])
    }
  }
  for (const key of ['variant', 'size', 'color', 'intent', 'tone']) {
    if (out[key]) continue
    const u = text.match(new RegExp(`\\b${key}\\??\\s*:\\s*((?:\\s*\\|?\\s*['"][\\w-]+['"])+)`))
    if (u) out[key] = [...u[1].matchAll(/['"]([\w-]+)['"]/g)].map(x => x[1])
  }
  return out
}

// How often each component is used: files that import it by name and render it.
export function usages(components, sources) {
  const out = new Map(components.map(c => [`${c.file}#${c.name}`, { files: [], renders: 0 }]))
  const byName = new Map()
  for (const c of components) {
    if (!byName.has(c.name)) byName.set(c.name, [])
    byName.get(c.name).push(c)
  }
  for (const [file, text] of sources) {
    for (const [name, defs] of byName) {
      const imp = text.match(new RegExp(`import\\s+(?:${name}\\b|[^;]*?[{,]\\s*${name}\\b[^;]*?)\\s*from\\s*['"]([^'"]+)['"]`))
      if (!imp) continue
      const renders = (text.match(new RegExp(`<${name}[\\s/>.]`, 'g')) || []).length
      // The definition the import path points at; the first when none clearly does.
      const target = defs.find(d => imp[1].replace(/^[@~]\//, '').replace(/^(\.\.?\/)+/, '').split('/').pop() === basename(d.file).replace(/\.\w+$/, '') || d.file.includes(imp[1].replace(/^[@~]\//, '').replace(/^(\.\.?\/)+/, ''))) || defs[0]
      const u = out.get(`${target.file}#${name}`)
      u.files.push(file)
      u.renders += renders
    }
  }
  return out
}

const PREFIX = /^(Base|Primary|Custom|App|Ui|UI|My|Old|New|Legacy|Simple|Basic|Styled|Shared|Common)(?=[A-Z])/
const SUFFIX = /(Component|V\d+|Old|New|Legacy|Wrapper|Base)$/
const SYNONYMS = { modal: 'dialog', popup: 'dialog', snackbar: 'toast', notification: 'toast', textfield: 'input', textinput: 'input', dropdown: 'select', spinner: 'loader', loading: 'loader', datatable: 'table', grid: 'table' }

export function family(name) {
  let n = name
  for (let i = 0; i < 3; i++) n = n.replace(PREFIX, '').replace(SUFFIX, '') || n
  const key = n.toLowerCase()
  return SYNONYMS[key] || key
}

// Sets of components that do the same job, for a person to pick one of.
export function duplicateGroups(components) {
  const groups = new Map()
  for (const c of components.filter(x => x.kind !== 'style')) {
    const f = family(c.name)
    if (!groups.has(f)) groups.set(f, [])
    groups.get(f).push(c)
  }
  return [...groups.entries()]
    .filter(([, list]) => new Set(list.map(c => c.file)).size > 1)
    .map(([key, list]) => ({ family: key, members: list.map(c => `${c.file}#${c.name}`) }))
}

const PATTERNS = [
  ['form', /form|useForm|zodResolver|handleSubmit|<form[\s>]/i],
  ['table', /<Table|DataTable|useReactTable|columns\s*[:=]/],
  ['empty state', /Empty(State)?\b|no results|nothing here|no data/i],
  ['confirm dialog', /(Alert)?Dialog|confirm|Modal/],
  ['toast', /toast|Snackbar|Notification/],
  ['page shell', /Layout|Shell|Sidebar|Navbar|Header/],
  ['pagination', /Pagination|pageSize|nextPage|loadMore/i],
  ['loading', /Skeleton|Spinner|isLoading|Loader/],
]

// For each pattern, the product files that show it, the most-used first: the
// file to copy when building another one.
export function patternExamples(sources, isPage) {
  const out = {}
  for (const [name, re] of PATTERNS) {
    const files = [...sources].filter(([f, t]) => isPage(f) && re.test(t)).map(([f, t]) => ({ file: f, lines: t.split('\n').length }))
    if (files.length) out[name] = files.sort((a, b) => a.lines - b.lines).slice(0, 3).map(x => x.file)
  }
  return out
}

export function buildCatalog({ files, read, pkg, preferred = {} }) {
  const product = files.filter(f => SOURCE.test(f) && !SKIP.test(f))
  const sources = new Map(product.map(f => [f, read(f)]))
  const components = product.filter(f => COMPONENT_FILE.test(f) && !/(^|\/)(app|pages|routes)\/.*(page|layout|\+page|index)\.(tsx|jsx|svelte|vue)$/.test(f))
    .flatMap(f => parseComponents(f, sources.get(f)))
  const use = usages(components, sources)
  const list = components.map(c => {
    const u = use.get(`${c.file}#${c.name}`)
    return { ...c, usedIn: u.files.length, renders: u.renders, example: u.files[0] || null }
  }).sort((a, b) => b.usedIn - a.usedIn || a.name.localeCompare(b.name))
  const dups = duplicateGroups(list).map(g => ({ ...g, preferred: preferred[g.family] || null }))
  const isPage = f => /(^|\/)(app|pages|routes|views|screens|features)\//.test(f)
  return {
    libraries: uiLibraries(pkg, files),
    components: list,
    duplicates: dups,
    patterns: patternExamples(sources, isPage),
    unused: list.filter(c => c.usedIn === 0 && c.kind !== 'style').map(c => `${c.file}#${c.name}`),
    preferred,
  }
}

export function catalogMarkdown(cat) {
  const lines = ['# UI catalogue', '', '> Written by `scan-ui.mjs` from the code. Build new screens from these components and patterns; create a new component only when none fits. Regenerate after a change to the UI; `preferred` choices are kept.', '']
  lines.push('## Libraries', '', cat.libraries.length ? cat.libraries.map(l => `- ${l}`).join('\n') : '- none detected', '')
  if (cat.duplicates.length) {
    lines.push('## Duplicates: use the preferred one', '', '| Job | Components | Use |', '|---|---|---|')
    for (const d of cat.duplicates) lines.push(`| ${d.family} | ${d.members.map(m => `\`${m}\``).join(', ')} | ${d.preferred ? `\`${d.preferred}\`` : '**not decided: ask**'} |`)
    lines.push('')
  }
  lines.push('## Components', '', '| Component | File | Props | Variants | Used in | Example |', '|---|---|---|---|---|---|')
  for (const c of cat.components) {
    const v = Object.entries(c.variants || {}).map(([k, vals]) => `${k}: ${vals.join('/')}`).join('; ')
    lines.push(`| \`${c.name}\`${c.kind === 'style' ? ' (style helper)' : ''} | \`${c.file}\` | ${c.props.slice(0, 8).join(', ')}${c.props.length > 8 ? ', …' : ''} | ${v} | ${c.usedIn} file(s) | ${c.example ? `\`${c.example}\`` : ''} |`)
  }
  lines.push('')
  if (Object.keys(cat.patterns).length) {
    lines.push('## Patterns: the file to copy', '')
    for (const [p, files] of Object.entries(cat.patterns)) lines.push(`- **${p}**: ${files.map(f => `\`${f}\``).join(', ')}`)
    lines.push('')
  }
  if (cat.unused.length) lines.push('## Available but not used yet', '', 'They exist in the code and may be used; with a copied-in library (shadcn/ui and the like) most of these are simply unused parts of it.', '', cat.unused.map(u => `- \`${u}\``).join('\n'), '')
  return lines.join('\n')
}

function main(argv) {
  const repo = argv.find(a => !a.startsWith('--'))
  const opt = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined }
  if (!repo || !existsSync(repo)) { console.error('usage: scan-ui.mjs <repo> [--out .factory/design/ui-store]'); return 2 }
  const out = join(repo, opt('--out') || '.factory/design/ui-store')
  let files
  try { files = execFileSync('git', ['-C', repo, 'ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\n').filter(Boolean) } catch { console.error('scan-ui: not a git repository'); return 2 }
  const read = f => { try { const p = join(repo, f); return statSync(p).size < 256 * 1024 ? readFileSync(p, 'utf8') : '' } catch { return '' } }
  let pkg = null
  try { pkg = JSON.parse(read('package.json')) } catch {}
  let preferred = {}
  try { preferred = JSON.parse(readFileSync(join(out, 'catalog.json'), 'utf8')).preferred || {} } catch {}
  const cat = buildCatalog({ files, read, pkg, preferred })
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'catalog.json'), JSON.stringify(cat, null, 2) + '\n')
  writeFileSync(join(out, 'catalog.md'), catalogMarkdown(cat))
  console.log(`${cat.components.length} component(s), ${cat.duplicates.length} duplicate set(s) (${cat.duplicates.filter(d => !d.preferred).length} undecided), ${Object.keys(cat.patterns).length} pattern(s), ${cat.unused.length} unused`)
  console.log(`wrote ${join(opt('--out') || '.factory/design/ui-store', 'catalog.json')} and catalog.md`)
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exit(main(process.argv.slice(2)))
