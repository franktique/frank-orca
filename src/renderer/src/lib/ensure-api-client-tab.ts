import { useAppStore } from '@/store'
import type { ApiClientTabView } from '@/store/slices/api-client'
import { translate } from '@/i18n/i18n'

export type EnsureApiClientTabOptions = {
  targetGroupId?: string
  /** Always create a tab (the '+' menu); otherwise reuse one that already exists. */
  forceNew?: boolean
  view?: ApiClientTabView
  /** Activate and focus the tab. Never done for a worktree that is not on screen. */
  activate?: boolean
}

/** Creates or finds an API Client tab and returns its id. */
export function ensureApiClientTab(
  worktreeId: string,
  options: EnsureApiClientTabOptions = {}
): string {
  const store = useAppStore.getState()
  const targetGroupId =
    options.targetGroupId ??
    store.activeGroupIdByWorktree[worktreeId] ??
    store.groupsByWorktree[worktreeId]?.[0]?.id
  // Why no early return: a worktree this window never showed has no group yet, and creating the
  // tab creates it, which is how a CLI `api show` reaches a worktree that is not on screen.
  const surface = (options.activate ?? true) && store.activeWorktreeId === worktreeId
  const existing = (store.unifiedTabsByWorktree[worktreeId] ?? []).filter(
    (tab) => tab.contentType === 'api-client'
  )
  const reusable = options.forceNew
    ? undefined
    : ((targetGroupId ? existing.find((tab) => tab.groupId === targetGroupId) : undefined) ??
      existing[0])

  const tab =
    reusable ??
    store.createUnifiedTab(worktreeId, 'api-client', {
      label: translate('apiClient.tab.title', 'API Client'),
      targetGroupId,
      activate: surface
    })

  store.ensureApiClientTabState(tab.id, worktreeId)
  if (options.view) {
    store.requestApiClientTabView(tab.id, options.view)
  }
  if (surface) {
    store.focusGroup(worktreeId, tab.groupId)
    store.activateTab(tab.id)
    store.setActiveTabType('api-client')
  }
  return tab.id
}
