import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type {
  SqlChangedEvent,
  SqlConnectionStatusEvent,
  SqlSnapshot
} from '../../../../shared/sql-client/sql-client-ipc-schemas'
import { defaultSqlPersistedTab } from '../../../../shared/sql-client/sql-client-schemas'
import type {
  SqlConnectionStatus,
  SqlPersistedTab,
  SqlRunResult
} from '../../../../shared/sql-client/sql-client-types'
import {
  isSqlDraftTooLarge,
  reconcileSqlTabWithSnapshot,
  SQL_DRAFT_PERSIST_DEBOUNCE_MS,
  withPersistedSqlTab
} from './sql-client-tab-persistence'

export type SqlTabState = SqlPersistedTab & {
  tabId: string
  worktreeId: string
  /** The draft is over the persistence limit: kept in memory only, and the pane says so. */
  draftTooLarge: boolean
}

export type SqlTabRuntimeState =
  | { state: 'idle' }
  | { state: 'running'; runId: string; startedAt: number; baseOffset: number }
  | { state: 'done'; runId: string; result: SqlRunResult; baseOffset: number }

export type SqlClientSlice = {
  sqlSnapshotsByProject: Record<string, SqlSnapshot | undefined>
  sqlProjectKeyByWorktree: Record<string, string | undefined>
  sqlConnectionStatusByKey: Record<string, SqlConnectionStatus | undefined>
  sqlTabsById: Record<string, SqlTabState | undefined>
  sqlRunByTab: Record<string, SqlTabRuntimeState | undefined>
  loadSqlSnapshot: (worktreeId: string) => Promise<void>
  /** Refetches the project's snapshot (debounced) for any worktree this window knows. */
  applySqlChanged: (event: SqlChangedEvent) => void
  applySqlConnectionStatus: (event: SqlConnectionStatusEvent) => void
  ensureSqlTabState: (tabId: string, worktreeId: string) => SqlTabState
  updateSqlTab: (tabId: string, patch: Partial<SqlPersistedTab>) => void
  removeSqlTabState: (tabId: string) => void
}

export const sqlConnectionStatusKey = (projectKey: string, connectionId: string): string =>
  `${projectKey}:${connectionId}`

const SNAPSHOT_REFETCH_DEBOUNCE_MS = 100
const refetchTimers = new Map<string, ReturnType<typeof setTimeout>>()
const draftTimers = new Map<string, ReturnType<typeof setTimeout>>()

export const createSqlClientSlice: StateCreator<AppState, [], [], SqlClientSlice> = (set, get) => {
  const persistTab = (tabId: string): void => {
    const tab = get().sqlTabsById[tabId]
    if (tab) {
      set((state) => withPersistedSqlTab(state, tab))
    }
  }

  const patchTab = (tabId: string, patch: Partial<SqlPersistedTab>, debounced: boolean): void => {
    const tab = get().sqlTabsById[tabId]
    if (!tab) {
      return
    }
    const next: SqlTabState = {
      ...tab,
      ...patch,
      draftTooLarge:
        patch.draftText !== undefined ? isSqlDraftTooLarge(patch.draftText) : tab.draftTooLarge
    }
    set((state) => ({ sqlTabsById: { ...state.sqlTabsById, [tabId]: next } }))
    if (!debounced) {
      persistTab(tabId)
      return
    }
    clearTimeout(draftTimers.get(tabId))
    draftTimers.set(
      tabId,
      setTimeout(() => {
        draftTimers.delete(tabId)
        persistTab(tabId)
      }, SQL_DRAFT_PERSIST_DEBOUNCE_MS)
    )
  }

  return {
    sqlSnapshotsByProject: {},
    sqlProjectKeyByWorktree: {},
    sqlConnectionStatusByKey: {},
    sqlTabsById: {},
    sqlRunByTab: {},

    loadSqlSnapshot: async (worktreeId) => {
      const result = await window.api.sqlClient.getSnapshot({ worktreeId })
      if (!result.ok) {
        return
      }
      const { ok: _ok, ...snapshot } = result
      const statuses = Object.fromEntries(
        snapshot.connections.map((c) => [
          sqlConnectionStatusKey(snapshot.projectKey, c.id),
          c.status
        ])
      )
      set((state) => ({
        sqlSnapshotsByProject: { ...state.sqlSnapshotsByProject, [snapshot.projectKey]: snapshot },
        sqlProjectKeyByWorktree: {
          ...state.sqlProjectKeyByWorktree,
          [worktreeId]: snapshot.projectKey
        },
        sqlConnectionStatusByKey: { ...state.sqlConnectionStatusByKey, ...statuses }
      }))
      for (const tab of Object.values(get().sqlTabsById)) {
        const projectKey = tab && get().sqlProjectKeyByWorktree[tab.worktreeId]
        const patch =
          tab && projectKey === snapshot.projectKey
            ? reconcileSqlTabWithSnapshot(tab, snapshot)
            : null
        if (tab && patch) {
          patchTab(tab.tabId, patch, false)
        }
      }
    },

    applySqlChanged: (event) => {
      const worktreeId = Object.entries(get().sqlProjectKeyByWorktree).find(
        ([, key]) => key === event.projectKey
      )?.[0]
      if (!worktreeId) {
        return
      }
      clearTimeout(refetchTimers.get(event.projectKey))
      refetchTimers.set(
        event.projectKey,
        setTimeout(() => {
          refetchTimers.delete(event.projectKey)
          void get().loadSqlSnapshot(worktreeId)
        }, SNAPSHOT_REFETCH_DEBOUNCE_MS)
      )
    },

    applySqlConnectionStatus: (event) =>
      set((state) => ({
        sqlConnectionStatusByKey: {
          ...state.sqlConnectionStatusByKey,
          [sqlConnectionStatusKey(event.projectKey, event.connectionId)]: event.status
        }
      })),

    ensureSqlTabState: (tabId, worktreeId) => {
      const existing = get().sqlTabsById[tabId]
      if (existing) {
        return existing
      }
      // Restored sessions carry the draft and layout on the unified tab.
      const saved =
        get().unifiedTabsByWorktree[worktreeId]?.find((tab) => tab.id === tabId)?.sql ??
        defaultSqlPersistedTab()
      const created: SqlTabState = {
        ...saved,
        tabId,
        worktreeId,
        draftTooLarge: isSqlDraftTooLarge(saved.draftText)
      }
      set((state) => ({ sqlTabsById: { ...state.sqlTabsById, [tabId]: created } }))
      return created
    },

    updateSqlTab: (tabId, patch) => patchTab(tabId, patch, patch.draftText !== undefined),

    removeSqlTabState: (tabId) => {
      clearTimeout(draftTimers.get(tabId))
      draftTimers.delete(tabId)
      set((state) => {
        const { [tabId]: _tab, ...tabs } = state.sqlTabsById
        const { [tabId]: _run, ...runs } = state.sqlRunByTab
        return { sqlTabsById: tabs, sqlRunByTab: runs }
      })
    }
  }
}
