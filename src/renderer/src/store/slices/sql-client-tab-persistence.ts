import type { AppState } from '../types'
import type { SqlSnapshot } from '../../../../shared/sql-client/sql-client-ipc-schemas'
import type { SqlPersistedTab } from '../../../../shared/sql-client/sql-client-types'
import type { SqlTabState } from './sql-client'

// Why 1 MB: the session file must stay small; a larger draft stays in memory with a notice.
export const SQL_DRAFT_PERSIST_LIMIT = 1024 * 1024
export const SQL_DRAFT_PERSIST_DEBOUNCE_MS = 500

export function isSqlDraftTooLarge(text: string): boolean {
  return text.length > SQL_DRAFT_PERSIST_LIMIT
}

export function toPersistedSqlTab(tab: SqlTabState): SqlPersistedTab {
  return {
    draftText: tab.draftTooLarge ? '' : tab.draftText,
    connectionId: tab.connectionId,
    savedQueryId: tab.savedQueryId,
    savedQueryRevision: tab.savedQueryRevision,
    splitRatio: tab.splitRatio
  }
}

/**
 * Writes the tab's draft and layout onto its unified tab, which is what the session saves, so
 * persistence stays on the existing path instead of adding a second one.
 */
export function withPersistedSqlTab(
  state: AppState,
  tab: SqlTabState
): Pick<AppState, 'unifiedTabsByWorktree'> | Record<string, never> {
  const tabs = state.unifiedTabsByWorktree[tab.worktreeId]
  if (!tabs?.some((candidate) => candidate.id === tab.tabId)) {
    return {}
  }
  return {
    unifiedTabsByWorktree: {
      ...state.unifiedTabsByWorktree,
      [tab.worktreeId]: tabs.map((candidate) =>
        candidate.id === tab.tabId ? { ...candidate, sql: toPersistedSqlTab(tab) } : candidate
      )
    }
  }
}

/** Ids deleted while the app was closed (or elsewhere) fall back to null; the draft text stays. */
export function reconcileSqlTabWithSnapshot(
  tab: SqlTabState,
  snapshot: SqlSnapshot
): Partial<SqlPersistedTab> | null {
  const patch: Partial<SqlPersistedTab> = {}
  if (tab.connectionId && !snapshot.connections.some((c) => c.id === tab.connectionId)) {
    patch.connectionId = null
  }
  if (tab.savedQueryId && !snapshot.queries.some((q) => q.id === tab.savedQueryId)) {
    patch.savedQueryId = null
    patch.savedQueryRevision = null
  }
  return Object.keys(patch).length > 0 ? patch : null
}
