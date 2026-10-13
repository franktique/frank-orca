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

vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))

import UrlBar from './UrlBar'

const scopes: VariableScope[] = [
  { name: 'environment', variables: [{ key: 'baseUrl', value: 'http://x', enabled: true }] }
]

let container: HTMLDivElement
let root: Root

async function render(url: string, sending = false): Promise<void> {
  await act(async () => {
    root.render(
      <UrlBar
        method="GET"
        url={url}
        scopes={scopes}
        sending={sending}
        onMethodChange={() => undefined}
        onUrlChange={() => undefined}
        onSend={() => undefined}
        onCancel={() => undefined}
      />
    )
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

describe('UrlBar', () => {
  it('marks unresolved {{variables}} and names them', async () => {
    await render('{{baseUrl}}/items/{{missing}}')
    const input = container.querySelector('input')
    expect(input?.getAttribute('aria-invalid')).toBe('true')
    expect(container.textContent).toContain('Unresolved: {{missing}}')
    expect(container.textContent).not.toContain('{{baseUrl}}')
  })

  it('does not mark a URL whose variables all resolve', async () => {
    await render('{{baseUrl}}/items')
    expect(container.querySelector('input')?.getAttribute('aria-invalid')).toBe('false')
    expect(container.textContent).not.toContain('Unresolved')
  })

  it('swaps Send for Cancel while a request is in flight', async () => {
    await render('{{baseUrl}}', true)
    const labels = [...container.querySelectorAll('button')].map((b) => b.textContent)
    expect(labels).toContain('Cancel')
    expect(labels).not.toContain('Send')
  })
})
