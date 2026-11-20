// Tests for factory/scripts/scan-ui.mjs, the UI catalogue read from code.
// Run: node --test tests/
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseComponents, family, duplicateGroups, buildCatalog, catalogMarkdown, uiLibraries } from '../factory/scripts/scan-ui.mjs'

const button = `import { cva } from 'class-variance-authority'
const buttonVariants = cva('inline-flex', {
  variants: {
    variant: {
      default: 'bg-primary',
      destructive: 'bg-destructive',
      outline: 'border',
    },
    size: {
      sm: 'h-8',
      lg: 'h-10',
    },
  },
  defaultVariants: { variant: 'default' },
})
export interface ButtonProps {
  asChild?: boolean
  loading?: boolean
}
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>((props, ref) => null)
export { buttonVariants }
`

test('parseComponents reads names, props and cva variants', () => {
  const [c, style] = parseComponents('components/ui/button.tsx', button)
  assert.equal(c.name, 'Button')
  assert.deepEqual([style.name, style.kind], ['buttonVariants', 'style'])
  assert.deepEqual(c.props, ['asChild', 'loading'])
  assert.deepEqual(c.variants, { variant: ['default', 'destructive', 'outline'], size: ['sm', 'lg'] })
})

test('parseComponents reads function components, union variants, and skips Props and Providers', () => {
  const t = `type BadgeProps = {\n  tone?: 'info' | 'warn'\n  label: string\n}\nexport function Badge({ tone, label }: BadgeProps) {}\nexport function ThemeProvider() {}\nexport const helper = () => 1`
  const cs = parseComponents('src/components/Badge.tsx', t)
  assert.deepEqual(cs.map(c => c.name), ['Badge'])
  assert.deepEqual(cs[0].props, ['tone', 'label'])
  assert.deepEqual(cs[0].variants, { tone: ['info', 'warn'] })
  assert.deepEqual(parseComponents('src/components/Card.vue', '<script setup>defineProps<{ title: string; dense?: boolean }>()</script>').map(c => [c.name, c.props]), [['Card', ['title', 'dense']]])
})

test('family groups look-alikes: prefixes, suffixes and synonyms', () => {
  assert.equal(family('PrimaryButton'), 'button')
  assert.equal(family('ButtonV2'), 'button')
  assert.equal(family('Modal'), 'dialog')
  assert.equal(family('ConfirmDialog'), 'confirmdialog')
  assert.equal(family('AppSnackbar'), 'toast')
  assert.equal(family('Alert'), 'alert', 'an inline alert is not a toast')
  const d = duplicateGroups([{ name: 'Button', file: 'ui/button.tsx' }, { name: 'PrimaryButton', file: 'old/PrimaryButton.tsx' }, { name: 'Card', file: 'ui/card.tsx' }])
  assert.deepEqual(d, [{ family: 'button', members: ['ui/button.tsx#Button', 'old/PrimaryButton.tsx#PrimaryButton'] }])
})

const files = {
  'package.json': JSON.stringify({ dependencies: { '@radix-ui/react-dialog': '1', tailwindcss: '4', 'react-hook-form': '7', 'class-variance-authority': '0.7' } }),
  'components.json': '{}',
  'components/ui/button.tsx': button,
  'components/old/PrimaryButton.tsx': 'export function PrimaryButton() { return null }',
  'components/ui/dialog.tsx': 'export function Dialog() {}',
  'components/EmptyState.tsx': 'export function EmptyState({ title }) {}',
  'app/orders/page.tsx': `import { Button } from '@/components/ui/button'\nimport { EmptyState } from '@/components/EmptyState'\nexport default function Page() { return <><Button>Export</Button><Button variant="outline" /><EmptyState title="No orders" /></> }`,
  'app/settings/page.tsx': `import { Button } from '@/components/ui/button'\nimport { useForm } from 'react-hook-form'\nexport default function S() { const f = useForm(); return <form onSubmit={f.handleSubmit(x => x)}><Button /></form> }`,
  'app/pricing/page.tsx': `import Link from 'next/link'\nimport { buttonVariants } from '@/components/ui/button'\nexport default function P() { return <Link className={buttonVariants({ variant: 'outline' })} href="/x" /> }`,
  'app/legacy/page.tsx': `import { PrimaryButton } from '../../components/old/PrimaryButton'\nexport default function L() { return <PrimaryButton /> }`,
  'components/ui/button.test.tsx': `import { Button } from './button'; <Button />`,
}

test('buildCatalog counts usage, finds duplicates, patterns and unused components, and keeps choices made', () => {
  const pkg = JSON.parse(files['package.json'])
  const cat = buildCatalog({ files: Object.keys(files), read: f => files[f] || '', pkg, preferred: { button: 'components/ui/button.tsx#Button' } })
  const button = cat.components.find(c => c.name === 'Button')
  assert.equal(button.usedIn, 2, 'tests do not count as use')
  assert.equal(button.renders, 3)
  assert.equal(button.example, 'app/orders/page.tsx')
  assert.equal(cat.components[0].name, 'Button', 'most used first')
  assert.equal(cat.components.find(c => c.name === 'buttonVariants').usedIn, 1, 'style helpers are counted')
  assert.deepEqual(cat.duplicates, [{ family: 'button', members: ['components/ui/button.tsx#Button', 'components/old/PrimaryButton.tsx#PrimaryButton'], preferred: 'components/ui/button.tsx#Button' }])
  assert.deepEqual(cat.unused, ['components/ui/dialog.tsx#Dialog'])
  assert.match(catalogMarkdown(cat), /`buttonVariants` \(style helper\)/)
  assert.match(catalogMarkdown(cat), /## Available but not used yet/)
  assert.deepEqual(cat.patterns.form, ['app/settings/page.tsx'])
  assert.deepEqual(cat.patterns['empty state'], ['app/orders/page.tsx'])
  assert.ok(cat.libraries[0].startsWith('shadcn/ui'))
  assert.ok(cat.libraries.includes('React Hook Form'))
})

test('the markdown flags an undecided duplicate for the person', () => {
  const cat = buildCatalog({ files: Object.keys(files), read: f => files[f] || '', pkg: null })
  const md = catalogMarkdown(cat)
  assert.match(md, /\| button \| `components\/ui\/button\.tsx#Button`, `components\/old\/PrimaryButton\.tsx#PrimaryButton` \| \*\*not decided: ask\*\* \|/)
  assert.match(md, /\| `Button` \| `components\/ui\/button\.tsx` \| asChild, loading \| variant: default\/destructive\/outline; size: sm\/lg \| 2 file\(s\) \| `app\/orders\/page\.tsx` \|/)
  assert.match(md, /\*\*form\*\*: `app\/settings\/page\.tsx`/)
  assert.deepEqual(uiLibraries(null, []), [])
})
