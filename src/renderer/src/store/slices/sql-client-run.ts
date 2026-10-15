import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type { SqlRunResult } from '../../../../shared/sql-client/sql-client-types'

export type SqlClientRunSlice = {
  /**
   * Runs `sqlText` on the tab's connection; resolves when the run ends, including cancel.
   * `baseOffset` is where `sqlText` starts in the editor, to place error markers.
   */
  runSqlTab: (tabId: string, sqlText: string, baseOffset?: number) => Promise<void>
  cancelSqlTabRun: (tabId: string) => Promise<void>
  clearSqlTabResult: (tabId: string) => void
}

function failureResult(message: string, elapsedMs: number): SqlRunResult {
  return { kind: 'error', error: { message, category: 'other' }, elapsedMs }
}

export const createSqlClientRunSlice: StateCreator<AppState, [], [], SqlClientRunSlice> = (
  set,
  get
) => {
  const setRun = (tabId: string, run: AppState['sqlRunByTab'][string]): void =>
    set((state) => ({ sqlRunByTab: { ...state.sqlRunByTab, [tabId]: run } }))

  return {
    runSqlTab: async (tabId, sqlText, baseOffset = 0) => {
      const tab = get().sqlTabsById[tabId]
      if (!tab?.connectionId || get().sqlRunByTab[tabId]?.state === 'running') {
        return
      }
      const runId = crypto.randomUUID()
      const startedAt = Date.now()
      setRun(tabId, { state: 'running', runId, startedAt, baseOffset })
      let result: SqlRunResult
      try {
        const response = await window.api.sqlClient.run({
          worktreeId: tab.worktreeId,
          tabId,
          connectionId: tab.connectionId,
          runId,
          sql: sqlText
        })
        result = response.ok
          ? response.result
          : failureResult(response.message, Date.now() - startedAt)
      } catch (error) {
        result = failureResult(
          error instanceof Error ? error.message : 'The query could not be run.',
          Date.now() - startedAt
        )
      }
      // A newer run (or a cleared tab) must not be overwritten by this one finishing late.
      const current = get().sqlRunByTab[tabId]
      if (current?.state === 'running' && current.runId === runId) {
        setRun(tabId, { state: 'done', runId, result, baseOffset })
      }
    },

    cancelSqlTabRun: async (tabId) => {
      const tab = get().sqlTabsById[tabId]
      const run = get().sqlRunByTab[tabId]
      if (!tab || run?.state !== 'running') {
        return
      }
      await window.api.sqlClient.cancel({ worktreeId: tab.worktreeId, tabId, runId: run.runId })
    },

    clearSqlTabResult: (tabId) => {
      if (get().sqlRunByTab[tabId]?.state !== 'running') {
        setRun(tabId, { state: 'idle' })
      }
    }
  }
}
