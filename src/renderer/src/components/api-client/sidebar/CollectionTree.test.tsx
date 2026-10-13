// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ApiFolder,
  ApiRequest,
  Collection
} from '../../../../../shared/api-client/api-client-types'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  state: {
    apiClientTabsById: {},
    requestApiClientTabView: vi.fn()
  },
  treeOp: vi.fn()
}))

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

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 28,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 28,
        size: 28
      }))
  })
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

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect }: { children: ReactNode; onSelect?: () => void }) => (
    <button type="button" role="menuitem" onClick={onSelect}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => null
}))

vi.mock('@/components/ui/context-menu', () => ({
  ContextMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  ContextMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  ContextMenuContent: () => null,
  ContextMenuItem: () => null,
  ContextMenuSeparator: () => null
}))

import CollectionTree from './CollectionTree'

function request(id: string, name: string, method = 'GET'): ApiRequest {
  return {
    id,
    kind: 'request',
    name,
    method,
    url: { raw: '', query: [] },
    pathVariables: [],
    headers: [],
    events: {},
    settings: {},
    revision: 0,
    postmanExtra: {}
  }
}

function folder(id: string, name: string, items: (ApiFolder | ApiRequest)[]): ApiFolder {
  return { id, kind: 'folder', name, variables: [], events: {}, items, postmanExtra: {} }
}

const collection: Collection = {
  id: 'c1',
  name: 'Smoke',
  variables: [],
  events: {},
  revision: 0,
  postmanExtra: {},
  importWarnings: [],
  items: [
    folder('f1', 'MAIN', [
      request('r1', 'Login', 'POST'),
      folder('f2', 'Nested', [request('r2', 'Deep request')])
    ]),
    request('r3', 'Ping')
  ]
}

let container: HTMLDivElement
let root: Root

async function render(query = ''): Promise<void> {
  await act(async () => {
    root.render(
      <CollectionTree worktreeId="wt" tabId="tab-1" collections={[collection]} query={query} />
    )
  })
}

function rowNames(): string[] {
  return [...container.querySelectorAll('[role="treeitem"]')].map(
    (row) => row.querySelector('span.truncate')?.textContent ?? ''
  )
}

function click(element: Element | undefined): void {
  if (!(element instanceof HTMLElement)) {
    throw new Error('element not found')
  }
  act(() => {
    element.click()
  })
}

function clickRow(name: string): void {
  click(
    [...container.querySelectorAll('[role="treeitem"] button')].find((candidate) =>
      candidate.textContent?.includes(name)
    )
  )
}

beforeEach(() => {
  mocks.state.requestApiClientTabView.mockReset()
  mocks.treeOp.mockReset().mockResolvedValue({ ok: true })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { apiClient: { treeOp: mocks.treeOp } }
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('CollectionTree', () => {
  it('starts collapsed and shows nested items in order after expanding', async () => {
    await render()
    expect(rowNames()).toEqual(['Smoke'])
    clickRow('Smoke')
    expect(rowNames()).toEqual(['Smoke', 'MAIN', 'Ping'])
    clickRow('MAIN')
    expect(rowNames()).toEqual(['Smoke', 'MAIN', 'Login', 'Nested', 'Ping'])
    clickRow('Nested')
    expect(rowNames()).toEqual(['Smoke', 'MAIN', 'Login', 'Nested', 'Deep request', 'Ping'])
  })

  it('collapses an expanded folder', async () => {
    await render()
    clickRow('Smoke')
    clickRow('MAIN')
    clickRow('MAIN')
    expect(rowNames()).toEqual(['Smoke', 'MAIN', 'Ping'])
  })

  it('shows an HTTP method badge next to each request', async () => {
    await render()
    clickRow('Smoke')
    clickRow('MAIN')
    const login = [...container.querySelectorAll('[role="treeitem"]')].find((row) =>
      row.textContent?.includes('Login')
    )
    expect(login?.textContent).toContain('POST')
  })

  it('filters by name and keeps the ancestors of a match', async () => {
    await render('deep')
    expect(rowNames()).toEqual(['Smoke', 'MAIN', 'Nested', 'Deep request'])
  })

  it('opens a request in the active tab when it is clicked', async () => {
    await render()
    clickRow('Smoke')
    clickRow('Ping')
    expect(mocks.state.requestApiClientTabView).toHaveBeenCalledWith('tab-1', {
      kind: 'request',
      requestId: 'r3'
    })
  })

  it('offers every folder except the node itself and its descendants in Move to…', async () => {
    await render()
    clickRow('Smoke')
    // First Move to… belongs to MAIN: its own subtree is excluded.
    click(
      [...container.querySelectorAll('[role="menuitem"]')].find(
        (item) => item.textContent === 'Move to…'
      )
    )
    const options = [...container.querySelectorAll('[role="option"]')].map((o) => o.textContent)
    expect(options).toEqual(['Smoke'])
  })

  it('sends the move with the chosen parent', async () => {
    await render()
    clickRow('Smoke')
    clickRow('MAIN')
    const moveButtons = [...container.querySelectorAll('[role="menuitem"]')].filter(
      (item) => item.textContent === 'Move to…'
    )
    // Rows: Smoke, MAIN, Login, Nested, Ping → request "Ping" is the last row.
    click(moveButtons.at(-1))
    const options = [...container.querySelectorAll('[role="option"]')]
    expect(options.map((o) => o.textContent)).toEqual(['Smoke', 'MAIN', 'Nested'])
    click(options[1])
    const confirm = [...container.querySelectorAll('[role="dialog"] button')].find(
      (b) => b.textContent === 'Move'
    )
    click(confirm)
    await act(async () => undefined)
    expect(mocks.treeOp).toHaveBeenCalledWith({
      worktreeId: 'wt',
      op: 'move',
      target: { collectionId: 'c1', nodeId: 'r3' },
      parentId: 'f1'
    })
  })
})
