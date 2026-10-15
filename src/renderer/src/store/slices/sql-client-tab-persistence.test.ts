// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SqlSnapshot } from '../../../../shared/sql-client/sql-client-ipc-schemas'
import type { SqlConnectionView } from '../../../../shared/sql-client/sql-client-types'
import type { Tab } from '../../../../shared/tab-types'
import {
  SQL_DRAFT_PERSIST_DEBOUNCE_MS,
  SQL_DRAFT_PERSIST_LIMIT
} from './sql-client-tab-persistence'
import { createTestStore } from './store-test-helpers'

const WORKTREE = 'wt-1'
const TAB = 'sql-1'

function sqlTab(sql?: Tab['sql']): Tab {
  return {
    id: TAB,
    entityId: TAB,
    groupId: 'g1',
    worktreeId: WORKTREE,
    contentType: 'sql',
    label: 'SQL',
    customLabel: null,
    color: null,
    sortOrder: 0,
    createdAt: 1,
    ...(sql ? { sql } : {})
  }
}

function connection(id: string): SqlConnectionView {
  return {
    id,
    name: id,
    host: 'localhost',
    port: 5432,
    user: 'u',
    database: 'd',
    sslMode: 'prefer',
    createdAt: 't',
    updatedAt: 't',
    revision: 1,
    passwordState: 'set',
    agentAccess: 'full',
    status: { state: 'idle' }
  }
}

function snapshot(overrides: Partial<SqlSnapshot> = {}): SqlSnapshot {
  return {
    projectKey: 'repo:r1',
    connections: [connection('c1')],
    collections: [],
    queries: [],
    encryptionAvailable: true,
    ...overrides
  }
}

function seed(sql?: Tab['sql']) {
  const store = createTestStore()
  store.setState({ unifiedTabsByWorktree: { [WORKTREE]: [sqlTab(sql)] } })
  return store
}

const persisted = (store: ReturnType<typeof seed>) =>
  store.getState().unifiedTabsByWorktree[WORKTREE]?.[0]?.sql

const getSnapshot = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  getSnapshot.mockReset()
  Object.defineProperty(window, 'api', {
    value: { sqlClient: { getSnapshot } },
    configurable: true
  })
})
afterEach(() => vi.useRealTimers())

describe('SQL tab persistence', () => {
  it('restores the draft, connection, saved query and split from the unified tab', () => {
    const store = seed({
      draftText: 'select 1',
      connectionId: 'c1',
      savedQueryId: 'q1',
      savedQueryRevision: 3,
      splitRatio: 0.3
    })
    expect(store.getState().ensureSqlTabState(TAB, WORKTREE)).toMatchObject({
      draftText: 'select 1',
      connectionId: 'c1',
      savedQueryId: 'q1',
      savedQueryRevision: 3,
      splitRatio: 0.3,
      draftTooLarge: false
    })
  })

  it('defaults a tab that was never saved', () => {
    const store = seed()
    expect(store.getState().ensureSqlTabState(TAB, WORKTREE)).toMatchObject({
      draftText: '',
      connectionId: null,
      splitRatio: 0.5
    })
  })

  it('writes the draft to the unified tab only after typing pauses', () => {
    const store = seed()
    store.getState().ensureSqlTabState(TAB, WORKTREE)
    store.getState().updateSqlTab(TAB, { draftText: 's' })
    store.getState().updateSqlTab(TAB, { draftText: 'select 2' })

    expect(store.getState().sqlTabsById[TAB]?.draftText).toBe('select 2')
    expect(persisted(store)).toBeUndefined()
    vi.advanceTimersByTime(SQL_DRAFT_PERSIST_DEBOUNCE_MS - 1)
    expect(persisted(store)).toBeUndefined()
    vi.advanceTimersByTime(1)
    expect(persisted(store)?.draftText).toBe('select 2')
  })

  it('persists connection and layout changes immediately', () => {
    const store = seed()
    store.getState().ensureSqlTabState(TAB, WORKTREE)
    store.getState().updateSqlTab(TAB, { connectionId: 'c1', splitRatio: 0.7 })
    expect(persisted(store)).toMatchObject({ connectionId: 'c1', splitRatio: 0.7 })
  })

  it('keeps a draft over 1 MB in memory only and flags it for the notice', () => {
    const store = seed()
    store.getState().ensureSqlTabState(TAB, WORKTREE)
    const huge = 'x'.repeat(SQL_DRAFT_PERSIST_LIMIT + 1)
    store.getState().updateSqlTab(TAB, { draftText: huge })
    vi.advanceTimersByTime(SQL_DRAFT_PERSIST_DEBOUNCE_MS)

    expect(store.getState().sqlTabsById[TAB]).toMatchObject({
      draftText: huge,
      draftTooLarge: true
    })
    expect(persisted(store)?.draftText).toBe('')

    store.getState().updateSqlTab(TAB, { draftText: 'small again' })
    expect(store.getState().sqlTabsById[TAB]?.draftTooLarge).toBe(false)
  })

  it('falls back to null for deleted connection and saved query ids, keeping the draft', async () => {
    const store = seed({
      draftText: 'select keep_me',
      connectionId: 'deleted-connection',
      savedQueryId: 'deleted-query',
      savedQueryRevision: 2,
      splitRatio: 0.5
    })
    store.getState().ensureSqlTabState(TAB, WORKTREE)
    getSnapshot.mockResolvedValue({ ok: true, ...snapshot() })

    await store.getState().loadSqlSnapshot(WORKTREE)

    expect(store.getState().sqlTabsById[TAB]).toMatchObject({
      draftText: 'select keep_me',
      connectionId: null,
      savedQueryId: null,
      savedQueryRevision: null
    })
    expect(persisted(store)).toMatchObject({ connectionId: null, savedQueryId: null })
  })

  it('keeps ids that still exist', async () => {
    const store = seed({
      draftText: '',
      connectionId: 'c1',
      savedQueryId: 'q1',
      savedQueryRevision: 1,
      splitRatio: 0.5
    })
    store.getState().ensureSqlTabState(TAB, WORKTREE)
    getSnapshot.mockResolvedValue({
      ok: true,
      ...snapshot({
        queries: [
          {
            id: 'q1',
            connectionId: 'c1',
            collectionId: null,
            name: 'q',
            sql: 'select 1',
            createdAt: 't',
            updatedAt: 't',
            revision: 1
          }
        ]
      })
    })
    await store.getState().loadSqlSnapshot(WORKTREE)
    expect(store.getState().sqlTabsById[TAB]).toMatchObject({
      connectionId: 'c1',
      savedQueryId: 'q1'
    })
  })

  it('starts every connection idle after a restart', async () => {
    const store = seed()
    getSnapshot.mockResolvedValue({ ok: true, ...snapshot() })
    await store.getState().loadSqlSnapshot(WORKTREE)
    expect(store.getState().sqlConnectionStatusByKey['repo:r1:c1']).toEqual({ state: 'idle' })
  })
})
