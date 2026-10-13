import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type { ApiRequest } from '../../../../shared/api-client/api-client-types'
import {
  isEnvironmentUnchanged,
  startEnvironmentDraft,
  toDraftEnvironmentPayload,
  type EditableEnvironmentVariable
} from './api-client-environment-draft'
import type { ApiClientTabView } from './api-client'
import {
  findStoredRequest,
  flagChangedDrafts,
  isRequestUnchanged,
  startRequestDraft,
  type ApiClientDraft
} from './api-client-draft-state'

export type ApiClientDraftSlice = {
  apiClientDraftsByTab: Record<string, ApiClientDraft | undefined>
  /** A tab whose close was refused because it has unsaved edits; its pane asks what to do. */
  apiClientPendingCloseTabId: string | null
  /** A request/environment switch refused for the same reason. */
  apiClientPendingViewByTab: Record<string, ApiClientTabView | undefined>
  /** Replaces the tab's draft with `edited`, or drops it when nothing differs from the saved copy. */
  editApiClientRequest: (tabId: string, edited: ApiRequest) => void
  /** Same as `editApiClientRequest`, for the environment the tab shows. */
  editApiClientEnvironment: (
    tabId: string,
    patch: { name?: string; variables?: EditableEnvironmentVariable[] }
  ) => void
  /** Fetches the plain values of masked secrets into the draft; nothing is saved by revealing. */
  revealApiClientEnvironmentSecrets: (tabId: string, index?: number) => Promise<void>
  discardApiClientDraft: (tabId: string) => void
  /** Saves the draft; returns false when it was refused (conflict) or failed. */
  saveApiClientDraft: (tabId: string) => Promise<boolean>
  /** Keeps the draft after a refused save (the user chose Cancel in the conflict dialog). */
  dismissApiClientConflict: (tabId: string) => void
  /** Drops the draft so the editor shows the latest saved copy again. */
  reloadApiClientDraft: (tabId: string) => void
  /** Switches the tab's view, or parks the switch while unsaved edits need a decision. */
  requestApiClientTabView: (tabId: string, view: ApiClientTabView) => void
  confirmApiClientPendingView: (tabId: string, save: boolean) => Promise<void>
  cancelApiClientPendingView: (tabId: string) => void
  requestApiClientTabClose: (tabId: string) => void
  clearApiClientPendingClose: () => void
}

export const createApiClientDraftSlice: StateCreator<AppState, [], [], ApiClientDraftSlice> = (
  set,
  get
) => ({
  apiClientDraftsByTab: {},
  apiClientPendingCloseTabId: null,
  apiClientPendingViewByTab: {},

  editApiClientRequest: (tabId, edited) => {
    const state = get()
    const tab = state.apiClientTabsById[tabId]
    if (!tab || tab.view.kind !== 'request') {
      return
    }
    const stored = findStoredRequest(
      state.apiClientSnapshotsByWorktree[tab.worktreeId],
      tab.view.requestId
    )
    if (!stored) {
      return
    }
    set((current) => {
      const existing = current.apiClientDraftsByTab[tabId]
      if (isRequestUnchanged(edited, stored.request)) {
        const { [tabId]: _dropped, ...rest } = current.apiClientDraftsByTab
        return { apiClientDraftsByTab: rest }
      }
      const draft = existing ? { ...existing, request: edited } : startRequestDraft(stored, edited)
      return { apiClientDraftsByTab: { ...current.apiClientDraftsByTab, [tabId]: draft } }
    })
  },

  editApiClientEnvironment: (tabId, patch) => {
    const state = get()
    const tab = state.apiClientTabsById[tabId]
    if (!tab || tab.view.kind !== 'environment') {
      return
    }
    const { environmentId } = tab.view
    const stored = state.apiClientSnapshotsByWorktree[tab.worktreeId]?.environments.find(
      (environment) => environment.id === environmentId
    )
    if (!stored) {
      return
    }
    set((current) => {
      const existing = current.apiClientDraftsByTab[tabId]
      const base = existing?.kind === 'environment' ? existing : startEnvironmentDraft(stored)
      const next = { ...base, ...patch }
      if (isEnvironmentUnchanged(next, stored)) {
        const { [tabId]: _dropped, ...rest } = current.apiClientDraftsByTab
        return { apiClientDraftsByTab: rest }
      }
      return { apiClientDraftsByTab: { ...current.apiClientDraftsByTab, [tabId]: next } }
    })
  },

  revealApiClientEnvironmentSecrets: async (tabId, onlyIndex) => {
    const tab = get().apiClientTabsById[tabId]
    if (!tab || tab.view.kind !== 'environment') {
      return
    }
    const { environmentId } = tab.view
    const response = await window.api.apiClient.getSnapshot({
      worktreeId: tab.worktreeId,
      revealSecrets: true
    })
    const revealed = response.ok
      ? response.data.environments.find((environment) => environment.id === environmentId)
      : undefined
    const current = get().apiClientDraftsByTab[tabId]
    const stored = get().apiClientSnapshotsByWorktree[tab.worktreeId]?.environments.find(
      (environment) => environment.id === environmentId
    )
    if (!revealed || !stored) {
      return
    }
    const base = current?.kind === 'environment' ? current : startEnvironmentDraft(stored)
    const variables = base.variables.map((variable, index) => {
      const source = revealed.variables[index]
      const wanted = onlyIndex === undefined || onlyIndex === index
      return wanted && variable.masked && source?.key === variable.key && source.value !== null
        ? { ...variable, masked: false, value: source.value, revealedValue: source.value }
        : variable
    })
    get().editApiClientEnvironment(tabId, { variables })
  },

  discardApiClientDraft: (tabId) =>
    set((state) => {
      const { [tabId]: _dropped, ...rest } = state.apiClientDraftsByTab
      return { apiClientDraftsByTab: rest }
    }),

  reloadApiClientDraft: (tabId) => get().discardApiClientDraft(tabId),

  dismissApiClientConflict: (tabId) =>
    set((state) => {
      const draft = state.apiClientDraftsByTab[tabId]
      return draft
        ? {
            apiClientDraftsByTab: {
              ...state.apiClientDraftsByTab,
              [tabId]: { ...draft, conflict: false }
            }
          }
        : {}
    }),

  saveApiClientDraft: async (tabId) => {
    const state = get()
    const tab = state.apiClientTabsById[tabId]
    const draft = state.apiClientDraftsByTab[tabId]
    if (!tab || !draft) {
      return true
    }
    const result =
      draft.kind === 'request'
        ? await window.api.apiClient.saveRequest({
            worktreeId: tab.worktreeId,
            collectionId: draft.collectionId,
            request: draft.request,
            baseRevision: draft.baseRevision
          })
        : await window.api.apiClient.saveEnvironment({
            worktreeId: tab.worktreeId,
            environment: toDraftEnvironmentPayload(draft),
            baseRevision: draft.baseRevision
          })
    if (result.ok) {
      get().discardApiClientDraft(tabId)
      await get().loadApiClientSnapshot(tab.worktreeId)
      return true
    }
    if (result.code === 'conflict') {
      set((current) => ({
        apiClientDraftsByTab: {
          ...current.apiClientDraftsByTab,
          [tabId]: { ...draft, changedElsewhere: true, conflict: true }
        }
      }))
    }
    return false
  },

  requestApiClientTabView: (tabId, view) => {
    const state = get()
    if (state.apiClientDraftsByTab[tabId]) {
      set((current) => ({
        apiClientPendingViewByTab: { ...current.apiClientPendingViewByTab, [tabId]: view }
      }))
      return
    }
    state.setApiClientTabView(tabId, view)
  },

  confirmApiClientPendingView: async (tabId, save) => {
    const pending = get().apiClientPendingViewByTab[tabId]
    if (!pending) {
      return
    }
    if (save && !(await get().saveApiClientDraft(tabId))) {
      return
    }
    get().discardApiClientDraft(tabId)
    get().setApiClientTabView(tabId, pending)
    get().cancelApiClientPendingView(tabId)
  },

  cancelApiClientPendingView: (tabId) =>
    set((state) => {
      const { [tabId]: _dropped, ...rest } = state.apiClientPendingViewByTab
      return { apiClientPendingViewByTab: rest }
    }),

  requestApiClientTabClose: (tabId) => {
    const worktreeId = get().apiClientTabsById[tabId]?.worktreeId
    if (worktreeId) {
      // Why activate first: the confirmation dialog lives in the tab's own pane.
      get().activateTab(tabId, { worktreeId })
      get().setActiveTabType('api-client')
    }
    set({ apiClientPendingCloseTabId: tabId })
  },

  clearApiClientPendingClose: () => set({ apiClientPendingCloseTabId: null })
})

/** Re-flags drafts after a snapshot refresh; called from the snapshot loader. */
export function flagDraftsAfterSnapshot(
  state: AppState,
  worktreeId: string,
  snapshot: NonNullable<AppState['apiClientSnapshotsByWorktree'][string]>
): Partial<AppState> {
  const tabWorktrees = Object.fromEntries(
    Object.values(state.apiClientTabsById).flatMap((tab) =>
      tab ? [[tab.tabId, tab.worktreeId]] : []
    )
  )
  const drafts = flagChangedDrafts(state.apiClientDraftsByTab, worktreeId, tabWorktrees, snapshot)
  return drafts === state.apiClientDraftsByTab ? {} : { apiClientDraftsByTab: drafts }
}
