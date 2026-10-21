// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  state: {
    sqlProjectKeyByWorktree: { wt: 'proj' },
    sqlSnapshotsByProject: {
      proj: { projectKey: 'proj', connections: [{ id: 'c1', name: 'Local DB' }] }
    },
    loadSqlSnapshot: vi.fn(async () => undefined)
  },
  testDatabase: vi.fn(),
  listConsoleTabs: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state)
}))
vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

import DatabaseModePicker from './DatabaseModePicker'
import type { DatabaseModeChoice } from '../../../../../shared/test-orchestrator/test-orchestrator-types'

let root: Root
let container: HTMLDivElement

const button = (label: string): HTMLButtonElement | undefined =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === label)

async function render(
  rememberedMode: string | null,
  value: DatabaseModeChoice | null,
  onChange = vi.fn()
): Promise<typeof onChange> {
  await act(async () => {
    root.render(
      <DatabaseModePicker
        worktreeId="wt"
        rememberedMode={rememberedMode}
        value={value}
        onChange={onChange}
      />
    )
  })
  return onChange
}

beforeEach(() => {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { testRun: { testDatabase: mocks.testDatabase, listConsoleTabs: mocks.listConsoleTabs } }
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

describe('DatabaseModePicker', () => {
  it('defaults to Manual on first use', async () => {
    const onChange = await render(null, null)
    expect(onChange).toHaveBeenCalledWith({ mode: 'manual' })
    expect(button('Manual')?.getAttribute('aria-pressed')).toBe('true')
  })

  it('opens on Automatic when remembered and emits the chosen connection', async () => {
    const onChange = await render('automatic', null)
    expect(onChange).not.toHaveBeenCalled()
    await act(async () => button('Local DB')?.click())
    expect(onChange).toHaveBeenCalledWith({
      mode: 'automatic',
      connectionId: 'c1',
      projectKey: 'proj'
    })
  })

  it('tests the chosen connection and shows a failure', async () => {
    mocks.testDatabase.mockResolvedValue({
      ok: false,
      code: 'connection-failed',
      message: 'refused'
    })
    const choice: DatabaseModeChoice = { mode: 'automatic', connectionId: 'c1', projectKey: 'proj' }
    await render('automatic', choice)
    await act(async () => button('Test connection')?.click())
    expect(mocks.testDatabase).toHaveBeenCalledWith({ worktreeId: 'wt', mode: choice })
    expect(container.textContent).toContain('refused')
  })

  it('disables the test until a connection is chosen', async () => {
    await render('automatic', null)
    expect(button('Test connection')?.disabled).toBe(true)
  })

  describe('Browser mode', () => {
    const tab = { browserPageId: 'p1', title: 'Console', url: 'https://db.example.com/query' }
    beforeEach(() => mocks.listConsoleTabs.mockResolvedValue({ ok: true, tabs: [tab] }))

    it('emits the browser choice only after the console check passes', async () => {
      mocks.testDatabase.mockResolvedValue({ ok: true })
      const onChange = await render('browser', null)
      await act(async () => button('Console')?.click())
      expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ mode: 'browser' }))
      await act(async () => button('Check console')?.click())
      expect(mocks.testDatabase).toHaveBeenCalledWith({
        worktreeId: 'wt',
        mode: { mode: 'browser', origin: 'https://db.example.com' },
        browserPageId: 'p1'
      })
      expect(onChange).toHaveBeenLastCalledWith({
        mode: 'browser',
        origin: 'https://db.example.com'
      })
    })

    it('shows the screenshot on console-not-found and offers recovery actions', async () => {
      mocks.testDatabase.mockResolvedValue({
        ok: false,
        code: 'console-not-found',
        message: 'No editor found',
        screenshot: 'data:image/png;base64,AAA'
      })
      const onChange = await render('browser', null)
      await act(async () => button('Console')?.click())
      await act(async () => button('Check console')?.click())
      expect(container.textContent).toContain('No editor found')
      expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AAA')
      expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ mode: 'browser' }))
      await act(async () => button('Choose another mode')?.click())
      expect(onChange).toHaveBeenLastCalledWith({ mode: 'manual' })
    })

    it('pre-selects the tab matching the remembered origin', async () => {
      await act(async () => {
        root.render(
          <DatabaseModePicker
            worktreeId="wt"
            rememberedMode="browser"
            rememberedOrigin="https://db.example.com"
            value={null}
            onChange={vi.fn()}
          />
        )
      })
      expect(button('Console')?.getAttribute('aria-pressed')).toBe('true')
    })
  })
})
