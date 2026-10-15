import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'

export type EnsureSqlTabOptions = {
  targetGroupId?: string
  /** Activate and focus the tab. Never done for a worktree that is not on screen. */
  activate?: boolean
  connectionId?: string | null
}

/** Always creates a new SQL tab (several may be open at once) and returns its id. */
export function ensureSqlTab(worktreeId: string, options: EnsureSqlTabOptions = {}): string {
  const store = useAppStore.getState()
  const targetGroupId =
    options.targetGroupId ??
    store.activeGroupIdByWorktree[worktreeId] ??
    store.groupsByWorktree[worktreeId]?.[0]?.id
  const surface = (options.activate ?? true) && store.activeWorktreeId === worktreeId

  const tab = store.createUnifiedTab(worktreeId, 'sql', {
    label: translate('sqlClient.tab.title', 'SQL'),
    targetGroupId,
    activate: surface
  })
  store.ensureSqlTabState(tab.id, worktreeId)
  if (options.connectionId) {
    store.updateSqlTab(tab.id, { connectionId: options.connectionId })
  }
  if (surface) {
    store.focusGroup(worktreeId, tab.groupId)
    store.activateTab(tab.id)
    store.setActiveTabType('sql')
    // The connection list lives in the right panel and nothing can run without it.
    if (!store.rightSidebarOpen) {
      store.setRightSidebarOpen(true)
    }
  }
  return tab.id
}
