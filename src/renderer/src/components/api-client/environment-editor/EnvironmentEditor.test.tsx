// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Environment } from '../../../../../shared/api-client/api-client-types'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

type EnvironmentEditorMockState = {
  apiClientSnapshotsByWorktree: Record<string, unknown>
  apiClientDraftsByTab: Record<string, unknown>
  apiClientProtectionByWorktree: Record<string, unknown>
  apiClientPendingViewByTab: Record<string, unknown>
  apiClientPendingCloseTabId: string | null
  editApiClientEnvironment: ReturnType<typeof vi.fn>
  revealApiClientEnvironmentSecrets: ReturnType<typeof vi.fn>
  saveApiClientDraft: ReturnType<typeof vi.fn>
  reloadApiClientDraft: ReturnType<typeof vi.fn>
  dismissApiClientConflict: ReturnType<typeof vi.fn>
  confirmApiClientPendingView: ReturnType<typeof vi.fn>
  cancelApiClientPendingView: ReturnType<typeof vi.fn>
  clearApiClientPendingClose: ReturnType<typeof vi.fn>
  closeUnifiedTab: ReturnType<typeof vi.fn>
}

const mocks = vi.hoisted(() => {
  function emptyMap(): Record<string, unknown> {
    return {}
  }
  const state: EnvironmentEditorMockState = {
    apiClientSnapshotsByWorktree: emptyMap(),
    apiClientDraftsByTab: emptyMap(),
    apiClientProtectionByWorktree: emptyMap(),
    apiClientPendingViewByTab: emptyMap(),
    apiClientPendingCloseTabId: null,
    editApiClientEnvironment: vi.fn(),
    revealApiClientEnvironmentSecrets: vi.fn(),
    saveApiClientDraft: vi.fn().mockResolvedValue(true),
    reloadApiClientDraft: vi.fn(),
    dismissApiClientConflict: vi.fn(),
    confirmApiClientPendingView: vi.fn(),
    cancelApiClientPendingView: vi.fn(),
    clearApiClientPendingClose: vi.fn(),
    closeUnifiedTab: vi.fn()
  }
  return { state }
})

vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state),
    { getState: () => mocks.state }
  )
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, unknown>) =>
    values
      ? fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values[name] ?? ''))
      : fallback
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

import ApiClientUnsavedDialog from '../ApiClientUnsavedDialog'
import EnvironmentEditor from './EnvironmentEditor'

function environment(): Environment {
  return {
    id: 'env-1',
    name: 'Smoke Env',
    revision: 3,
    postmanExtra: {},
    variables: [
      ...Array.from({ length: 24 }, (_, index) => ({
        key: `var${index}`,
        value: `value${index}`,
        enabled: true,
        type: 'default' as const
      })),
      { key: 'token', value: null, enabled: true, type: 'secret' as const, masked: true },
      { key: 'lost', value: null, enabled: true, type: 'secret' as const, needsReentry: true },
      { key: 'last', value: 'final-value', enabled: true, type: 'default' as const }
    ]
  }
}

let container: HTMLDivElement
let root: Root

async function render(node: ReactNode): Promise<void> {
  await act(async () => {
    root.render(node)
  })
}

// A new element each time: React skips re-rendering an identical one.
const editor = (): React.JSX.Element => (
  <EnvironmentEditor tabId="tab-1" worktreeId="wt" environmentId="env-1" />
)

beforeEach(() => {
  Object.assign(mocks.state, {
    apiClientSnapshotsByWorktree: { wt: { environments: [environment()] } },
    apiClientDraftsByTab: {},
    apiClientProtectionByWorktree: {},
    apiClientPendingViewByTab: {},
    apiClientPendingCloseTabId: null
  })
  for (const value of Object.values(mocks.state)) {
    if (typeof value === 'function' && 'mockClear' in value) {
      value.mockClear()
    }
  }
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('EnvironmentEditor', () => {
  it('makes the variable table the scroll container with a sticky header, Save stays outside it', async () => {
    await render(editor())
    const scroller = container.querySelector('[data-testid="variables-scroll"]')
    expect(scroller?.className).toContain('overflow-y-auto')
    expect(scroller?.querySelector('thead')?.className).toContain('sticky')
    expect(scroller?.querySelectorAll('tbody tr').length).toBe(28)
    const save = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Save')
    expect(save).toBeDefined()
    expect(scroller?.contains(save ?? null)).toBe(false)
    // The last variable is reachable in the same table.
    expect([...container.querySelectorAll('input')].some((i) => i.value === 'final-value')).toBe(
      true
    )
  })

  it('keeps a secret masked until the user reveals it', async () => {
    await render(editor())
    const secretInputs = [...container.querySelectorAll('input[type="password"]')]
    const masked = secretInputs.find((input) => input.getAttribute('placeholder') === '••••••••')
    expect(masked).toBeDefined()
    expect(masked instanceof HTMLInputElement && masked.value).toBe('')
    const reveal = container.querySelector('button[aria-label="Reveal value"]')
    act(() => reveal instanceof HTMLElement && reveal.click())
    expect(mocks.state.revealApiClientEnvironmentSecrets).toHaveBeenCalledWith('tab-1', 24)
  })

  it('tells the user to re-enter a secret that could not be decrypted', async () => {
    await render(editor())
    expect(container.textContent).toContain('Some secret values could not be read on this computer')
    expect(container.querySelector('input[placeholder="Re-enter value"]')).not.toBeNull()
  })

  it('enables Save only while there are unsaved edits', async () => {
    await render(editor())
    const saveButton = (): HTMLButtonElement | undefined =>
      [...container.querySelectorAll('button')].find((b) => b.textContent === 'Save')
    expect(saveButton()?.disabled).toBe(true)
    mocks.state.apiClientDraftsByTab = {
      'tab-1': {
        kind: 'environment',
        environmentId: 'env-1',
        name: 'Renamed',
        variables: [],
        baseRevision: 3,
        changedElsewhere: false,
        conflict: false
      }
    }
    await render(editor())
    expect(saveButton()?.disabled).toBe(false)
  })

  it('asks before closing a tab that has unsaved edits and closes it on Discard', async () => {
    mocks.state.apiClientPendingCloseTabId = 'tab-1'
    await render(<ApiClientUnsavedDialog tabId="tab-1" />)
    expect(container.textContent).toContain('Unsaved changes')
    const discard = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Discard'
    )
    await act(async () => {
      discard?.click()
    })
    expect(mocks.state.clearApiClientPendingClose).toHaveBeenCalled()
    expect(mocks.state.closeUnifiedTab).toHaveBeenCalledWith('tab-1', {
      discardApiClientDraft: true
    })
  })

  it('words the dialog for the kind of draft that is unsaved', async () => {
    mocks.state.apiClientPendingCloseTabId = 'tab-1'
    mocks.state.apiClientDraftsByTab = { 'tab-1': { kind: 'environment' } }
    await render(<ApiClientUnsavedDialog tabId="tab-1" />)
    expect(container.textContent).toContain('This environment has changes')
  })

  it('keeps the tab open on Cancel', async () => {
    mocks.state.apiClientPendingCloseTabId = 'tab-1'
    await render(<ApiClientUnsavedDialog tabId="tab-1" />)
    const cancel = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')
    await act(async () => {
      cancel?.click()
    })
    expect(mocks.state.clearApiClientPendingClose).toHaveBeenCalled()
    expect(mocks.state.closeUnifiedTab).not.toHaveBeenCalled()
  })
})
