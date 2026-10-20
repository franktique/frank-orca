import { useAppStore } from '@/store'
import type { SqlSavedQuery } from '../../../../shared/sql-client/sql-client-types'

/** The saved query a tab was loaded from, and whether the draft has drifted from it (FR-023). */
export function useSqlSavedQueryState(
  worktreeId: string,
  tabId: string
): { query: SqlSavedQuery | null; unsaved: boolean } {
  const query = useAppStore((state) => {
    const savedId = state.sqlTabsById[tabId]?.savedQueryId
    const projectKey = state.sqlProjectKeyByWorktree[worktreeId]
    if (!savedId || !projectKey) {
      return null
    }
    return state.sqlSnapshotsByProject[projectKey]?.queries.find((q) => q.id === savedId) ?? null
  })
  const draftText = useAppStore((state) => state.sqlTabsById[tabId]?.draftText ?? '')
  return { query, unsaved: query !== null && draftText !== query.sql }
}
