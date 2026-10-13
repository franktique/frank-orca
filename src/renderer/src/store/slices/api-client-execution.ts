import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type {
  ApiNodeId,
  ApiRequest,
  ConsoleEntry,
  LatestResult
} from '../../../../shared/api-client/api-client-types'
import { API_CLIENT_LIMITS } from '../../../../shared/api-client/api-client-types'
import { findStoredRequest } from './api-client-draft-state'

export type ApiClientExecutionSlice = {
  /** worktreeId → requestId → latest result. Shared by every tab (FR-003b). */
  apiClientResultsByWorktree: Record<string, Record<ApiNodeId, LatestResult> | undefined>
  apiClientConsoleByWorktree: Record<string, ConsoleEntry[] | undefined>
  /** tabId → the send that tab is waiting on. */
  apiClientExecutionsByTab: Record<
    string,
    { executionId: string; requestId: ApiNodeId } | undefined
  >
  loadApiClientResult: (worktreeId: string, requestId: ApiNodeId) => Promise<void>
  loadApiClientConsole: (worktreeId: string) => Promise<void>
  clearApiClientConsole: (worktreeId: string) => Promise<void>
  sendApiClientRequest: (tabId: string) => Promise<void>
  cancelApiClientExecution: (tabId: string) => Promise<void>
  applyApiClientExecutionFinished: (event: {
    worktreeId: string
    executionId: string
    requestId: ApiNodeId
    result: LatestResult
  }) => void
  applyApiClientConsoleAppended: (event: { worktreeId: string; entry: ConsoleEntry }) => void
}

export const createApiClientExecutionSlice: StateCreator<
  AppState,
  [],
  [],
  ApiClientExecutionSlice
> = (set, get) => ({
  apiClientResultsByWorktree: {},
  apiClientConsoleByWorktree: {},
  apiClientExecutionsByTab: {},

  loadApiClientResult: async (worktreeId, requestId) => {
    const response = await window.api.apiClient.getLatestResult({ worktreeId, requestId })
    if (!response.ok || !response.result) {
      return
    }
    const { result } = response
    set((state) => ({
      apiClientResultsByWorktree: {
        ...state.apiClientResultsByWorktree,
        [worktreeId]: { ...state.apiClientResultsByWorktree[worktreeId], [requestId]: result }
      }
    }))
  },

  loadApiClientConsole: async (worktreeId) => {
    const response = await window.api.apiClient.getConsole({ worktreeId })
    if (response.ok) {
      set((state) => ({
        apiClientConsoleByWorktree: {
          ...state.apiClientConsoleByWorktree,
          [worktreeId]: response.entries
        }
      }))
    }
  },

  clearApiClientConsole: async (worktreeId) => {
    set((state) => ({
      apiClientConsoleByWorktree: { ...state.apiClientConsoleByWorktree, [worktreeId]: [] }
    }))
    await window.api.apiClient.clearConsole({ worktreeId })
  },

  sendApiClientRequest: async (tabId) => {
    const state = get()
    const tab = state.apiClientTabsById[tabId]
    if (!tab || tab.view.kind !== 'request' || state.apiClientExecutionsByTab[tabId]) {
      return
    }
    const { requestId } = tab.view
    const draft = state.apiClientDraftsByTab[tabId]
    const response = await window.api.apiClient.send({
      worktreeId: tab.worktreeId,
      requestId,
      ...(draft?.kind === 'request' ? { draft: draft.request } : {})
    })
    if (!response.ok) {
      return
    }
    set((current) => ({
      apiClientExecutionsByTab: {
        ...current.apiClientExecutionsByTab,
        [tabId]: { executionId: response.executionId, requestId }
      }
    }))
  },

  cancelApiClientExecution: async (tabId) => {
    const execution = get().apiClientExecutionsByTab[tabId]
    const tab = get().apiClientTabsById[tabId]
    if (execution && tab) {
      await window.api.apiClient.cancel({
        worktreeId: tab.worktreeId,
        executionId: execution.executionId
      })
    }
  },

  applyApiClientExecutionFinished: ({ worktreeId, executionId, requestId, result }) =>
    set((state) => {
      const executions = Object.fromEntries(
        Object.entries(state.apiClientExecutionsByTab).filter(
          ([, execution]) => execution?.executionId !== executionId
        )
      )
      return {
        apiClientExecutionsByTab: executions,
        apiClientResultsByWorktree: {
          ...state.apiClientResultsByWorktree,
          [worktreeId]: { ...state.apiClientResultsByWorktree[worktreeId], [requestId]: result }
        }
      }
    }),

  applyApiClientConsoleAppended: ({ worktreeId, entry }) =>
    set((state) => {
      const known = state.apiClientConsoleByWorktree[worktreeId] ?? []
      if (known.some((existing) => existing.id === entry.id)) {
        return {}
      }
      const next = [...known, entry].slice(-API_CLIENT_LIMITS.consoleEntriesMax)
      return {
        apiClientConsoleByWorktree: { ...state.apiClientConsoleByWorktree, [worktreeId]: next }
      }
    })
})

/**
 * The saved request a tab shows. Returns the object held in the snapshot, so a selector built on
 * it stays referentially stable between store updates.
 */
export function selectViewedRequest(state: AppState, tabId: string | null): ApiRequest | null {
  const tab = tabId ? state.apiClientTabsById[tabId] : undefined
  if (!tab || tab.view.kind !== 'request') {
    return null
  }
  return (
    findStoredRequest(state.apiClientSnapshotsByWorktree[tab.worktreeId], tab.view.requestId)
      ?.request ?? null
  )
}
