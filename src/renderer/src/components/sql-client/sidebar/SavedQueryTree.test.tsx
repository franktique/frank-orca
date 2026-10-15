// @vitest-environment happy-dom

import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import userEvent from '@testing-library/user-event'
import type { SqlSnapshot } from '../../../../../shared/sql-client/sql-client-ipc-schemas'
import type {
  SqlQueryCollection,
  SqlSavedQuery
} from '../../../../../shared/sql-client/sql-client-types'

type MockState = {
  sqlTabsById: Record<string, { connectionId: string | null; savedQueryId: string | null }>
  sqlProjectKeyByWorktree: Record<string, string>
  sqlSnapshotsByProject: Record<string, unknown>
  loadSqlSnapshot: () => Promise<void>
}

const mocks = vi.hoisted(() => ({
  state: {
    sqlTabsById: {},
    sqlProjectKeyByWorktree: { 'wt-1': 'repo:r1' },
    sqlSnapshotsByProject: {},
    loadSqlSnapshot: vi.fn(async () => undefined)
  } satisfies MockState,
  hasUnsavedSqlChanges: vi.fn(() => false),
  loadSavedQueryIntoSqlTab: vi.fn(() => true),
  saveSqlTabInPlace: vi.fn(async () => true),
  api: {
    renameQuery: vi.fn(),
    moveQuery: vi.fn(),
    deleteQuery: vi.fn(),
    createCollection: vi.fn(),
    renameCollection: vi.fn(),
    deleteCollection: vi.fn()
  }
}))

vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state),
    { getState: () => mocks.state }
  )
}))
vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values?.[name] ?? ''))
}))
vi.mock('@/lib/sql-saved-query-loading', () => ({
  hasUnsavedSqlChanges: mocks.hasUnsavedSqlChanges,
  loadSavedQueryIntoSqlTab: mocks.loadSavedQueryIntoSqlTab
}))
vi.mock('@/lib/sql-saved-query-actions', () => ({ saveSqlTabInPlace: mocks.saveSqlTabInPlace }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
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
vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

import SavedQueryTree from './SavedQueryTree'

const query = (id: string, connectionId: string, collectionId: string | null): SqlSavedQuery => ({
  id,
  connectionId,
  collectionId,
  name: `Query ${id}`,
  sql: `select '${id}'`,
  createdAt: 't',
  updatedAt: 't',
  revision: 2
})

const collection = (id: string, connectionId: string): SqlQueryCollection => ({
  id,
  connectionId,
  name: `Collection ${id}`,
  createdAt: 't',
  revision: 1
})

function setup(overrides: { connectionId?: string | null; savedQueryId?: string | null } = {}) {
  const snapshot: SqlSnapshot = {
    projectKey: 'repo:r1',
    connections: [],
    collections: [collection('c1', 'conn-a'), collection('c2', 'conn-b')],
    queries: [
      query('q1', 'conn-a', 'c1'),
      query('q2', 'conn-a', null),
      query('q3', 'conn-b', 'c2'),
      query('q4', 'conn-b', null)
    ],
    encryptionAvailable: true
  }
  mocks.state.sqlSnapshotsByProject = { 'repo:r1': snapshot }
  mocks.state.sqlTabsById = {
    'tab-1': {
      connectionId: overrides.connectionId === undefined ? 'conn-a' : overrides.connectionId,
      savedQueryId: overrides.savedQueryId ?? null
    }
  }
  return render(<SavedQueryTree worktreeId="wt-1" tabId="tab-1" />)
}

beforeEach(() => {
  mocks.hasUnsavedSqlChanges.mockReset().mockReturnValue(false)
  mocks.loadSavedQueryIntoSqlTab.mockReset().mockReturnValue(true)
  mocks.saveSqlTabInPlace.mockReset().mockResolvedValue(true)
  mocks.state.loadSqlSnapshot.mockClear()
  for (const fn of Object.values(mocks.api)) {
    fn.mockReset().mockResolvedValue({ ok: true })
  }
  Object.defineProperty(window, 'api', { value: { sqlClient: mocks.api }, configurable: true })
})
afterEach(cleanup)

describe('SavedQueryTree', () => {
  it('lists only the selected connection’s collections and queries', () => {
    setup()
    expect(screen.getByText('Collection c1')).toBeInTheDocument()
    expect(screen.getByText('Query q1')).toBeInTheDocument()
    expect(screen.getByText('Query q2')).toBeInTheDocument()
    expect(screen.queryByText('Collection c2')).not.toBeInTheDocument()
    expect(screen.queryByText('Query q3')).not.toBeInTheDocument()
    expect(screen.queryByText('Query q4')).not.toBeInTheDocument()
  })

  it('asks for a connection first when none is selected', () => {
    setup({ connectionId: null })
    expect(screen.getByText('Select a connection to see its saved queries.')).toBeInTheDocument()
  })

  it('loads a query into the tab on click', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByText('Query q2'))
    expect(mocks.loadSavedQueryIntoSqlTab).toHaveBeenCalledWith('tab-1', 'q2')
  })

  it('prompts to save or discard when the loaded query has unsaved changes', async () => {
    const user = userEvent.setup()
    mocks.hasUnsavedSqlChanges.mockReturnValue(true)
    setup({ savedQueryId: 'q1' })
    await user.click(screen.getByText('Query q2'))
    expect(mocks.loadSavedQueryIntoSqlTab).not.toHaveBeenCalled()
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(mocks.loadSavedQueryIntoSqlTab).toHaveBeenCalledWith('tab-1', 'q2')
  })

  it('saves in place before loading when the user chooses Save', async () => {
    const user = userEvent.setup()
    mocks.hasUnsavedSqlChanges.mockReturnValue(true)
    setup({ savedQueryId: 'q1' })
    await user.click(screen.getByText('Query q2'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocks.loadSavedQueryIntoSqlTab).toHaveBeenCalledWith('tab-1', 'q2'))
    expect(mocks.saveSqlTabInPlace).toHaveBeenCalledWith('tab-1')
  })

  it('does not load when the user cancels the prompt', async () => {
    const user = userEvent.setup()
    mocks.hasUnsavedSqlChanges.mockReturnValue(true)
    setup({ savedQueryId: 'q1' })
    await user.click(screen.getByText('Query q2'))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(mocks.loadSavedQueryIntoSqlTab).not.toHaveBeenCalled()
    expect(mocks.saveSqlTabInPlace).not.toHaveBeenCalled()
  })

  it('shows the query count and a delete-queries-too choice when deleting a collection', async () => {
    const user = userEvent.setup()
    setup()
    const row = screen.getByText('Collection c1').closest('div')!
    await user.click(within(row.parentElement!).getAllByRole('menuitem', { name: 'Delete' })[0])
    expect(screen.getByText(/holds 1 saved queries/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete queries too' }))
    expect(mocks.api.deleteCollection).toHaveBeenCalledWith({
      worktreeId: 'wt-1',
      id: 'c1',
      deleteQueries: true
    })
  })

  it('can keep the queries when deleting a collection', async () => {
    const user = userEvent.setup()
    setup()
    const row = screen.getByText('Collection c1').closest('div')!
    await user.click(within(row.parentElement!).getAllByRole('menuitem', { name: 'Delete' })[0])
    await user.click(screen.getByRole('button', { name: 'Keep queries' }))
    expect(mocks.api.deleteCollection).toHaveBeenCalledWith({
      worktreeId: 'wt-1',
      id: 'c1',
      deleteQueries: false
    })
  })

  it('renames a query with its current revision', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getAllByRole('menuitem', { name: 'Rename' })[1])
    const input = screen.getByRole('textbox', { name: 'Name' })
    await user.clear(input)
    await user.type(input, 'Renamed')
    await user.click(screen.getByRole('button', { name: 'Rename' }))
    expect(mocks.api.renameQuery).toHaveBeenCalledWith({
      worktreeId: 'wt-1',
      id: 'q1',
      baseRevision: 2,
      name: 'Renamed'
    })
  })

  it('moves a query out of its collection', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getAllByRole('menuitem', { name: 'Move to collection…' })[0])
    await user.click(screen.getByRole('button', { name: 'Move' }))
    expect(mocks.api.moveQuery).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'q1', baseRevision: 2 })
    )
  })

  it('creates a collection for the selected connection', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('button', { name: 'New collection' }))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Cleanup')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(mocks.api.createCollection).toHaveBeenCalledWith({
      worktreeId: 'wt-1',
      connectionId: 'conn-a',
      name: 'Cleanup'
    })
  })
})
