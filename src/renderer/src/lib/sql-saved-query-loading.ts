import { useAppStore } from '@/store'

/** True when the tab's draft differs from the saved query it was loaded from (FR-023). */
export function hasUnsavedSqlChanges(tabId: string): boolean {
  const state = useAppStore.getState()
  const tab = state.sqlTabsById[tabId]
  if (!tab?.savedQueryId) {
    return false
  }
  const projectKey = state.sqlProjectKeyByWorktree[tab.worktreeId]
  const query = projectKey
    ? state.sqlSnapshotsByProject[projectKey]?.queries.find((q) => q.id === tab.savedQueryId)
    : undefined
  return query !== undefined && tab.draftText !== query.sql
}

/** Replaces the tab's editor text and connection with a saved query; false when it is unknown. */
export function loadSavedQueryIntoSqlTab(tabId: string, savedQueryId: string): boolean {
  const state = useAppStore.getState()
  const tab = state.sqlTabsById[tabId]
  const projectKey = tab ? state.sqlProjectKeyByWorktree[tab.worktreeId] : undefined
  const query = projectKey
    ? state.sqlSnapshotsByProject[projectKey]?.queries.find((q) => q.id === savedQueryId)
    : undefined
  if (!query) {
    return false
  }
  state.updateSqlTab(tabId, {
    draftText: query.sql,
    connectionId: query.connectionId,
    savedQueryId: query.id,
    savedQueryRevision: query.revision
  })
  state.clearSqlTabResult(tabId)
  return true
}
