import type { AppState } from '../types'
import type {
  ApiClientPersistedTab,
  WorktreeApiData
} from '../../../../shared/api-client/api-client-types'
import { findNode } from '../../../../shared/api-client/collection-tree'
import type { ApiClientTabState, ApiClientTabView } from './api-client'

export function toPersistedTab(tab: ApiClientTabState): ApiClientPersistedTab {
  return {
    view: tab.view,
    consoleCollapsed: tab.consoleCollapsed,
    consoleHeight: tab.consoleHeight,
    splitRatio: tab.splitRatio
  }
}

/**
 * Writes the tab's view and layout onto its unified tab, which is what the session saves. Doing it
 * here keeps session persistence on its existing path instead of adding a second one.
 */
export function withPersistedTab(
  state: AppState,
  tab: ApiClientTabState
): Pick<AppState, 'unifiedTabsByWorktree'> | Record<string, never> {
  const tabs = state.unifiedTabsByWorktree[tab.worktreeId]
  if (!tabs?.some((candidate) => candidate.id === tab.tabId)) {
    return {}
  }
  return {
    unifiedTabsByWorktree: {
      ...state.unifiedTabsByWorktree,
      [tab.worktreeId]: tabs.map((candidate) =>
        candidate.id === tab.tabId ? { ...candidate, apiClient: toPersistedTab(tab) } : candidate
      )
    }
  }
}

/** A restored view can point at something deleted while the app was closed. */
export function isViewStillValid(view: ApiClientTabView, snapshot: WorktreeApiData): boolean {
  switch (view.kind) {
    case 'request':
      return snapshot.collections.some(
        (collection) => findNode(collection, view.requestId) !== null
      )
    case 'environment':
      return snapshot.environments.some((environment) => environment.id === view.environmentId)
    case 'runner':
      return snapshot.collections.some(
        (collection) =>
          collection.id === view.scope.collectionId &&
          (!view.scope.folderId || findNode(collection, view.scope.folderId) !== null)
      )
    case 'empty':
      return true
  }
}
