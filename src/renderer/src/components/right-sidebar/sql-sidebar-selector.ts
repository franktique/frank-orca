import { getLocalWorkspaceTabAvailability } from '@/lib/local-workspace-tab-availability'
import type { AppState } from '@/store/types'

export type SqlSidebarTarget = { worktreeId: string; tabId: string }

/**
 * The focused SQL tab the right sidebar should serve, or null when the focused tab is not a
 * SQL tab. A render-time override, not a persisted route, so leaving the tab brings back
 * whatever panel the user had open.
 */
export function selectSqlSidebarTarget(state: AppState): SqlSidebarTarget | null {
  const worktreeId = state.activeWorktreeId
  if (!worktreeId || getLocalWorkspaceTabAvailability(state, worktreeId) !== 'available') {
    return null
  }
  const tab = state.getActiveTab(worktreeId)
  return tab?.contentType === 'sql' ? { worktreeId, tabId: tab.id } : null
}
