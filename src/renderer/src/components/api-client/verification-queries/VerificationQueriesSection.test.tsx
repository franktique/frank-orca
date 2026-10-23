// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TestMap } from '../../../../../shared/test-orchestrator/test-orchestrator-types'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const query = (id: string, sql: string) => ({
  id,
  sql,
  precondition: false,
  changesData: false
})

const testMap: TestMap = {
  orcaTestMap: 1,
  collectionId: 'col-1',
  loadedAt: 42,
  entries: [
    {
      ref: { id: 'req-1' },
      link: { state: 'linked', requestId: 'req-1' },
      before: [query('q1', 'select 1'), query('q2', 'select {{missing}}')],
      after: [query('q3', 'select 3')]
    }
  ]
}

const mocks = vi.hoisted(() => ({
  state: {
    apiClientTestRunByTarget: Object.fromEntries<{ testMap: TestMap }>([]),
    loadApiClientTestMap: vi.fn()
  },
  saveQueries: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state)
}))
vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, unknown>) =>
    values
      ? fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values[name] ?? ''))
      : fallback
}))
vi.mock('../ApiClientCodeEditor', () => ({
  default: ({
    value,
    label,
    onChange
  }: {
    value: string
    label: string
    onChange: (value: string) => void
  }) => <textarea aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
}))

import VerificationQueriesSection from './VerificationQueriesSection'

let container: HTMLDivElement
let root: Root

async function renderSection(): Promise<void> {
  await act(async () => {
    root.render(
      <VerificationQueriesSection
        worktreeId="wt"
        collectionId="col-1"
        requestId="req-1"
        scopes={[]}
      />
    )
  })
}

beforeEach(() => {
  mocks.state.apiClientTestRunByTarget = { 'wt::col-1': { testMap } }
  mocks.state.loadApiClientTestMap.mockResolvedValue(undefined)
  mocks.saveQueries.mockResolvedValue({ ok: true })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { testRun: { saveQueries: mocks.saveQueries } }
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllMocks()
})

describe('VerificationQueriesSection', () => {
  it('lists Before and After queries in map order', async () => {
    await renderSection()
    const editors = [...container.querySelectorAll<HTMLTextAreaElement>('textarea')]
    expect(editors.map((editor) => editor.value)).toEqual([
      'select 1',
      'select {{missing}}',
      'select 3'
    ])
  })

  it('highlights unresolved variables', async () => {
    await renderSection()
    expect(container.textContent).toContain('Unresolved: {{missing}}')
  })

  it('saves the edited queries with the loaded map version', async () => {
    await renderSection()
    const first = container.querySelector<HTMLTextAreaElement>('textarea')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(first, 'select 2')
      first.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const save = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Save queries'
    )!
    await act(async () => save.click())
    expect(mocks.saveQueries).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-1',
        baseLoadedAt: 42,
        before: [expect.objectContaining({ id: 'q1', sql: 'select 2' }), expect.anything()],
        after: [expect.objectContaining({ id: 'q3' })]
      })
    )
  })

  it('shows a conflict message when the map was replaced', async () => {
    mocks.saveQueries.mockResolvedValue({ ok: false, code: 'conflict', message: 'x' })
    await renderSection()
    const add = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Add query'
    )!
    await act(async () => add.click())
    const save = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Save queries'
    )!
    await act(async () => save.click())
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('replaced')
  })
})
