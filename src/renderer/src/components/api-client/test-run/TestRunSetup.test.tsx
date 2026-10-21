// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  state: {
    apiClientSnapshotsByWorktree: { wt: { activeEnvironmentId: 'env-1' } }
  },
  prepare: vi.fn(),
  resolveTargets: vi.fn(),
  start: vi.fn()
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
vi.mock('../EnvironmentSelector', () => ({ default: () => <div /> }))

import TestRunSetup from './TestRunSetup'

const setupModel = (overrides: Record<string, unknown> = {}) => ({
  ok: true,
  setup: {
    steps: [{ stepId: 's1', title: 'Create case', phase: 'setup', queries: [], problems: [] }],
    inputs: [
      { name: 'host', secret: false, required: true, hasRemembered: false },
      { name: 'userToken', secret: true, required: true, hasRemembered: false }
    ],
    hasQueries: false,
    dataChangingSteps: [],
    rememberedMode: null,
    uncleanedCaptures: 0,
    ...overrides
  }
})

let root: Root
let container: HTMLDivElement

async function flush(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400)
  })
}

async function type(id: string, value: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>(`#${id}`)
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input?.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await flush()
}

const startButton = (): HTMLButtonElement | undefined =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === 'Start')

async function render(model = setupModel()): Promise<void> {
  mocks.prepare.mockResolvedValue(model)
  await act(async () => {
    root.render(<TestRunSetup worktreeId="wt" collectionId="col" />)
  })
  await flush()
}

beforeEach(() => {
  vi.useFakeTimers()
  mocks.resolveTargets.mockImplementation(
    async ({ inputs }: { inputs: Record<string, string> }) => ({
      ok: true,
      hosts: inputs.host ? [{ host: inputs.host, local: inputs.host.startsWith('localhost') }] : [],
      unresolved: []
    })
  )
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      testRun: {
        prepare: mocks.prepare,
        resolveTargets: mocks.resolveTargets,
        start: mocks.start,
        clearRememberedSecrets: vi.fn()
      }
    }
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('TestRunSetup', () => {
  it('keeps Start disabled until required inputs are filled', async () => {
    await render()
    expect(startButton()?.disabled).toBe(true)
    await type('test-run-input-host', 'localhost:3000')
    expect(startButton()?.disabled).toBe(true)
    await type('test-run-input-userToken', 'abc')
    expect(startButton()?.disabled).toBe(false)
  })

  it('masks secret inputs', async () => {
    await render()
    expect(container.querySelector<HTMLInputElement>('#test-run-input-userToken')?.type).toBe(
      'password'
    )
  })

  it('requires confirming a non-local host', async () => {
    await render()
    await type('test-run-input-host', 'qa.example.com')
    await type('test-run-input-userToken', 'abc')
    expect(startButton()?.disabled).toBe(true)
    expect(container.textContent).toContain('I confirm this run targets qa.example.com')
    await act(async () => {
      container.querySelector<HTMLElement>('#test-run-confirm-qa\\.example\\.com')?.click()
    })
    expect(startButton()?.disabled).toBe(false)
  })

  it('shows the refused host and the allowed list and blocks Start', async () => {
    mocks.resolveTargets.mockResolvedValue({
      ok: true,
      hosts: [{ host: 'qa.example.com', local: false }],
      unresolved: [],
      refused: { host: 'qa.example.com', allowedHosts: ['localhost'] }
    })
    await render()
    await type('test-run-input-host', 'qa.example.com')
    await type('test-run-input-userToken', 'abc')
    expect(container.textContent).toContain('qa.example.com, which is not in the test map')
    expect(container.textContent).toContain('localhost')
    expect(startButton()?.disabled).toBe(true)
  })

  it('offers no database-mode choice when the plan has no queries', async () => {
    const slot = vi.fn(() => <div>database-mode</div>)
    mocks.prepare.mockResolvedValue(setupModel())
    await act(async () => {
      root.render(<TestRunSetup worktreeId="wt" collectionId="col" databaseModeSlot={slot} />)
    })
    await flush()
    expect(slot).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain('database-mode')
  })

  it('shows the database-mode slot when the plan has queries', async () => {
    mocks.prepare.mockResolvedValue(setupModel({ hasQueries: true }))
    await act(async () => {
      root.render(
        <TestRunSetup
          worktreeId="wt"
          collectionId="col"
          databaseModeSlot={() => <div>database-mode</div>}
        />
      )
    })
    await flush()
    expect(container.textContent).toContain('database-mode')
  })
})
