// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConsoleEntry } from '../../../../../shared/api-client/api-client-types'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, unknown>) =>
    values
      ? fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values[name] ?? ''))
      : fallback
}))

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 28,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 28,
        size: 28
      })),
    measureElement: () => undefined,
    measure: () => undefined,
    scrollToIndex: () => undefined
  })
}))

import ApiConsolePanel from './ApiConsolePanel'

function entry(id: string, overrides: Partial<ConsoleEntry> = {}): ConsoleEntry {
  return {
    id,
    worktreeId: 'wt',
    at: 1,
    origin: 'manual',
    method: 'POST',
    url: `http://x/${id}`,
    status: 201,
    durationMs: 120,
    request: {
      method: 'POST',
      url: `http://x/${id}`,
      headers: [['X-Request', 'req-header']],
      body: '{"sent":true}'
    },
    outcome: {
      kind: 'response',
      response: {
        status: 201,
        statusText: 'Created',
        headers: [['X-Response', 'res-header']],
        sizeBytes: 5,
        contentType: 'application/json',
        body: { encoding: 'utf8', text: '{"ok":true}', truncated: false },
        redirects: []
      }
    },
    scriptLogs: [{ level: 'log', phase: 'test', text: 'hello from script' }],
    tests: [],
    ...overrides
  }
}

let container: HTMLDivElement
let root: Root
const onCollapsedChange = vi.fn()
const onClear = vi.fn()

async function render(entries: ConsoleEntry[], collapsed = false): Promise<void> {
  await act(async () => {
    root.render(
      <ApiConsolePanel
        entries={entries}
        collapsed={collapsed}
        height={200}
        onCollapsedChange={onCollapsedChange}
        onHeightChange={() => undefined}
        onClear={onClear}
      />
    )
  })
}

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((candidate) =>
    candidate.getAttribute('aria-label')?.startsWith(label)
  )
  if (!(found instanceof HTMLButtonElement)) {
    throw new Error(`button not found: ${label}`)
  }
  return found
}

beforeEach(() => {
  onCollapsedChange.mockReset()
  onClear.mockReset()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('ApiConsolePanel', () => {
  it('lists entries oldest first with method, URL, status and time', async () => {
    await render([entry('a'), entry('b')])
    const text = container.textContent ?? ''
    expect(text.indexOf('http://x/a')).toBeLessThan(text.indexOf('http://x/b'))
    expect(text).toContain('POST')
    expect(text).toContain('201')
    expect(text).toContain('120 ms')
  })

  it('expands an entry to show headers, bodies and script logs, and collapses it again', async () => {
    await render([entry('a')])
    expect(container.textContent).not.toContain('req-header')
    act(() => button('Toggle details').click())
    const expanded = container.textContent ?? ''
    expect(expanded).toContain('req-header')
    expect(expanded).toContain('{"sent":true}')
    expect(expanded).toContain('res-header')
    expect(expanded).toContain('{"ok":true}')
    expect(expanded).toContain('hello from script')
    act(() => button('Toggle details').click())
    expect(container.textContent).not.toContain('req-header')
  })

  it('marks agent-initiated entries', async () => {
    await render([entry('a', { origin: 'agent' })])
    expect(container.textContent).toContain('Agent')
  })

  it('collapses the whole console and gives its space back', async () => {
    await render([entry('a')])
    act(() => button('Collapse console').click())
    expect(onCollapsedChange).toHaveBeenCalledWith(true)
    await render([entry('a')], true)
    expect(container.textContent).not.toContain('http://x/a')
    expect(container.querySelector('section')?.getAttribute('style')).toBeNull()
    act(() => button('Expand console').click())
    expect(onCollapsedChange).toHaveBeenLastCalledWith(false)
  })

  it('clears the console', async () => {
    await render([entry('a')])
    act(() => button('Clear console').click())
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('shows an empty hint and disables Clear without entries', async () => {
    await render([])
    expect(container.textContent).toContain('Requests you send appear here.')
    expect(button('Clear console').disabled).toBe(true)
  })
})
