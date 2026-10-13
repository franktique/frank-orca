import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import { flagDraftsAfterSnapshot } from './api-client-drafts'
import { isViewStillValid, withPersistedTab } from './api-client-tab-persistence'
import type { ApiClientChangedEvent } from '../../../../shared/api-client/api-client-ipc-schemas'
import type {
  ApiClientPersistedView,
  ApiNodeId,
  SecretProtection,
  WorktreeApiData
} from '../../../../shared/api-client/api-client-types'

export type ApiClientTabView = ApiClientPersistedView

export type ApiClientTabState = {
  tabId: string
  worktreeId: string
  view: ApiClientTabView
  consoleCollapsed: boolean
  consoleHeight: number
  splitRatio: number
}

export const API_CLIENT_DEFAULT_LAYOUT = {
  consoleCollapsed: false,
  consoleHeight: 200,
  splitRatio: 0.5
} as const

export type ApiClientSlice = {
  apiClientSnapshotsByWorktree: Record<string, WorktreeApiData | undefined>
  apiClientProtectionByWorktree: Record<string, SecretProtection | undefined>
  apiClientTabsById: Record<string, ApiClientTabState | undefined>
  loadApiClientSnapshot: (worktreeId: string) => Promise<void>
  /** Refetches what changed; callers never need to inspect the event themselves. */
  applyApiClientChanged: (event: ApiClientChangedEvent) => Promise<void>
  ensureApiClientTabState: (tabId: string, worktreeId: string) => ApiClientTabState
  setApiClientTabView: (tabId: string, view: ApiClientTabView) => void
  setApiClientTabLayout: (
    tabId: string,
    layout: Partial<Pick<ApiClientTabState, 'consoleCollapsed' | 'consoleHeight' | 'splitRatio'>>
  ) => void
  removeApiClientTabState: (tabId: string) => void
  setApiClientActiveEnvironment: (
    worktreeId: string,
    environmentId: ApiNodeId | null
  ) => Promise<void>
}

export const createApiClientSlice: StateCreator<AppState, [], [], ApiClientSlice> = (set, get) => ({
  apiClientSnapshotsByWorktree: {},
  apiClientProtectionByWorktree: {},
  apiClientTabsById: {},

  loadApiClientSnapshot: async (worktreeId) => {
    const result = await window.api.apiClient.getSnapshot({ worktreeId })
    if (!result.ok) {
      return
    }
    set((state) => ({
      apiClientSnapshotsByWorktree: {
        ...state.apiClientSnapshotsByWorktree,
        [worktreeId]: result.data
      },
      apiClientProtectionByWorktree: {
        ...state.apiClientProtectionByWorktree,
        [worktreeId]: result.secretProtection
      },
      ...flagDraftsAfterSnapshot(state, worktreeId, result.data)
    }))
    // Tabs restored onto a deleted request, environment or run scope fall back to the empty view.
    for (const tab of Object.values(get().apiClientTabsById)) {
      if (tab?.worktreeId === worktreeId && !isViewStillValid(tab.view, result.data)) {
        get().setApiClientTabView(tab.tabId, { kind: 'empty' })
      }
    }
  },

  applyApiClientChanged: async (event) => {
    const known = get().apiClientSnapshotsByWorktree[event.worktreeId]
    // Why: a worktree this window never opened has nothing on screen to refresh.
    if (known && known.revision >= event.revision) {
      return
    }
    if (!known && !hasApiClientTabForWorktree(get(), event.worktreeId)) {
      return
    }
    await get().loadApiClientSnapshot(event.worktreeId)
  },

  ensureApiClientTabState: (tabId, worktreeId) => {
    const existing = get().apiClientTabsById[tabId]
    if (existing) {
      return existing
    }
    // Restored sessions carry the tab's view and layout on its unified tab.
    const saved = get().unifiedTabsByWorktree[worktreeId]?.find(
      (tab) => tab.id === tabId
    )?.apiClient
    const created: ApiClientTabState = {
      tabId,
      worktreeId,
      view: saved?.view ?? { kind: 'empty' },
      consoleCollapsed: saved?.consoleCollapsed ?? API_CLIENT_DEFAULT_LAYOUT.consoleCollapsed,
      consoleHeight: saved?.consoleHeight ?? API_CLIENT_DEFAULT_LAYOUT.consoleHeight,
      splitRatio: saved?.splitRatio ?? API_CLIENT_DEFAULT_LAYOUT.splitRatio
    }
    set((state) => ({ apiClientTabsById: { ...state.apiClientTabsById, [tabId]: created } }))
    return created
  },

  setApiClientTabView: (tabId, view) =>
    set((state) => {
      const tab = state.apiClientTabsById[tabId]
      if (!tab) {
        return {}
      }
      const next = { ...tab, view }
      return {
        apiClientTabsById: { ...state.apiClientTabsById, [tabId]: next },
        ...withPersistedTab(state, next)
      }
    }),

  setApiClientTabLayout: (tabId, layout) =>
    set((state) => {
      const tab = state.apiClientTabsById[tabId]
      if (!tab) {
        return {}
      }
      const next = { ...tab, ...layout }
      return {
        apiClientTabsById: { ...state.apiClientTabsById, [tabId]: next },
        ...withPersistedTab(state, next)
      }
    }),

  removeApiClientTabState: (tabId) =>
    set((state) => {
      if (!state.apiClientTabsById[tabId]) {
        return {}
      }
      const { [tabId]: _removed, ...rest } = state.apiClientTabsById
      return { apiClientTabsById: rest }
    }),

  setApiClientActiveEnvironment: async (worktreeId, environmentId) => {
    // Why optimistic: every tab's selector reads the shared snapshot, and the change event
    // that follows only confirms it.
    set((state) => {
      const snapshot = state.apiClientSnapshotsByWorktree[worktreeId]
      return snapshot
        ? {
            apiClientSnapshotsByWorktree: {
              ...state.apiClientSnapshotsByWorktree,
              [worktreeId]: { ...snapshot, activeEnvironmentId: environmentId }
            }
          }
        : {}
    })
    const result = await window.api.apiClient.setActiveEnvironment({ worktreeId, environmentId })
    if (!result.ok) {
      await get().loadApiClientSnapshot(worktreeId)
    }
  }
})

function hasApiClientTabForWorktree(state: AppState, worktreeId: string): boolean {
  return Object.values(state.apiClientTabsById).some((tab) => tab?.worktreeId === worktreeId)
}
