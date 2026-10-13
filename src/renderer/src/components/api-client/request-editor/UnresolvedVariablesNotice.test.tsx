// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VariableScope } from '../../../../../shared/api-client/variable-resolution'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, unknown>) =>
    values
      ? fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values[name] ?? ''))
      : fallback
}))

import UnresolvedVariablesNotice from './UnresolvedVariablesNotice'

const scopes: VariableScope[] = [
  { name: 'environment', variables: [{ key: 'token', value: 'x', enabled: true }] }
]

let container: HTMLDivElement
let root: Root

async function render(texts: string[]): Promise<void> {
  await act(async () => {
    root.render(<UnresolvedVariablesNotice texts={texts} scopes={scopes} />)
  })
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('UnresolvedVariablesNotice', () => {
  it('names each unresolved variable once across the body and auth fields', async () => {
    await render(['{"a":"{{missing}}","t":"{{token}}"}', '{{missing}} {{other}}'])
    expect(container.textContent).toBe('Unresolved: {{missing}}, {{other}}')
  })

  it('renders nothing when every variable resolves', async () => {
    await render(['{{token}}', ''])
    expect(container.textContent).toBe('')
  })
})
