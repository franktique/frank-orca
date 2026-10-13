import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type {
  ApiNodeId,
  Run,
  RunRequestResult,
  RunScope,
  RunTotals
} from '../../../../shared/api-client/api-client-types'

export type RunnerFilter = 'all' | 'passed' | 'failed'

export type RunnerSetup = {
  /** requestId → included; a request absent from the map is included (the default is all). */
  excluded: Record<ApiNodeId, true>
  iterations: number
  delayMs: number
  stopOnFailure: boolean
  environmentId: ApiNodeId | null
}

export type RunnerScopeState = {
  setup: RunnerSetup
  /** The live run, or the last stored one for this scope. */
  run: Run | null
  running: boolean
  filter: RunnerFilter
}

export const runnerScopeKey = (worktreeId: string, scope: RunScope): string =>
  `${worktreeId}::${scope.folderId ?? scope.collectionId}`

const DEFAULT_SETUP = (environmentId: ApiNodeId | null): RunnerSetup => ({
  excluded: {},
  iterations: 1,
  delayMs: 0,
  stopOnFailure: false,
  environmentId
})

export type ApiClientRunnerSlice = {
  apiClientRunnerByScope: Record<string, RunnerScopeState | undefined>
  /** Progress that arrived before the start call returned its run id. */
  apiClientUnclaimedRunProgress: Record<string, RunRequestResult[] | undefined>
  loadApiClientRun: (worktreeId: string, scope: RunScope) => Promise<void>
  updateApiClientRunnerSetup: (
    worktreeId: string,
    scope: RunScope,
    patch: Partial<RunnerSetup>
  ) => void
  setApiClientRunnerFilter: (worktreeId: string, scope: RunScope, filter: RunnerFilter) => void
  startApiClientRun: (
    worktreeId: string,
    scope: RunScope,
    includedRequestIds: ApiNodeId[]
  ) => Promise<void>
  stopApiClientRun: (worktreeId: string, scope: RunScope) => Promise<void>
  clearApiClientRun: (worktreeId: string, scope: RunScope) => Promise<void>
  applyApiClientRunProgress: (event: {
    worktreeId: string
    runId: string
    result: RunRequestResult
    totals: RunTotals
  }) => void
  applyApiClientRunFinished: (event: { worktreeId: string; run: Run }) => void
}

function scopeState(state: AppState, worktreeId: string, scope: RunScope): RunnerScopeState {
  return (
    state.apiClientRunnerByScope[runnerScopeKey(worktreeId, scope)] ?? {
      setup: DEFAULT_SETUP(
        state.apiClientSnapshotsByWorktree[worktreeId]?.activeEnvironmentId ?? null
      ),
      run: null,
      running: false,
      filter: 'all'
    }
  )
}

function withScope(
  state: AppState,
  worktreeId: string,
  scope: RunScope,
  patch: Partial<RunnerScopeState>
): Pick<AppState, 'apiClientRunnerByScope'> {
  const key = runnerScopeKey(worktreeId, scope)
  return {
    apiClientRunnerByScope: {
      ...state.apiClientRunnerByScope,
      [key]: { ...scopeState(state, worktreeId, scope), ...patch }
    }
  }
}

export const createApiClientRunnerSlice: StateCreator<AppState, [], [], ApiClientRunnerSlice> = (
  set,
  get
) => ({
  apiClientRunnerByScope: {},
  apiClientUnclaimedRunProgress: {},

  loadApiClientRun: async (worktreeId, scope) => {
    const response = await window.api.apiClient.getLatestRun({
      worktreeId,
      scopeId: scope.folderId ?? scope.collectionId
    })
    if (!response.ok) {
      return
    }
    set((state) => {
      // A live run is fresher than whatever is stored.
      const current = scopeState(state, worktreeId, scope)
      return current.running ? {} : withScope(state, worktreeId, scope, { run: response.run })
    })
  },

  updateApiClientRunnerSetup: (worktreeId, scope, patch) =>
    set((state) =>
      withScope(state, worktreeId, scope, {
        setup: { ...scopeState(state, worktreeId, scope).setup, ...patch }
      })
    ),

  setApiClientRunnerFilter: (worktreeId, scope, filter) =>
    set((state) => withScope(state, worktreeId, scope, { filter })),

  startApiClientRun: async (worktreeId, scope, includedRequestIds) => {
    const { setup, running } = scopeState(get(), worktreeId, scope)
    if (running || includedRequestIds.length === 0) {
      return
    }
    set((state) => withScope(state, worktreeId, scope, { running: true, run: null }))
    const response = await window.api.apiClient.startRun({
      worktreeId,
      scope,
      environmentId: setup.environmentId,
      options: {
        iterations: setup.iterations,
        delayMs: setup.delayMs,
        stopOnFailure: setup.stopOnFailure,
        includedRequestIds
      }
    })
    if (!response.ok) {
      set((state) => withScope(state, worktreeId, scope, { running: false }))
      return
    }
    const early = get().apiClientUnclaimedRunProgress[response.runId] ?? []
    set((state) => {
      const { [response.runId]: _claimed, ...rest } = state.apiClientUnclaimedRunProgress
      const live: Run = {
        id: response.runId,
        scope,
        environmentId: setup.environmentId,
        options: {
          iterations: setup.iterations,
          delayMs: setup.delayMs,
          stopOnFailure: setup.stopOnFailure,
          includedRequestIds
        },
        origin: 'manual',
        state: 'running',
        stoppedEarly: false,
        startedAt: Date.now(),
        endedAt: null,
        results: early,
        totals: totalsOf(early)
      }
      return {
        apiClientUnclaimedRunProgress: rest,
        ...withScope(state, worktreeId, scope, { run: live })
      }
    })
  },

  stopApiClientRun: async (worktreeId, scope) => {
    const run = scopeState(get(), worktreeId, scope).run
    if (run?.state === 'running') {
      await window.api.apiClient.stopRun({ worktreeId, runId: run.id })
    }
  },

  clearApiClientRun: async (worktreeId, scope) => {
    set((state) => withScope(state, worktreeId, scope, { run: null }))
    await window.api.apiClient.clearRun({
      worktreeId,
      scopeId: scope.folderId ?? scope.collectionId
    })
  },

  applyApiClientRunProgress: ({ worktreeId, runId, result, totals }) =>
    set((state) => {
      for (const [key, entry] of Object.entries(state.apiClientRunnerByScope)) {
        if (entry?.run?.id === runId && key.startsWith(`${worktreeId}::`)) {
          return {
            apiClientRunnerByScope: {
              ...state.apiClientRunnerByScope,
              [key]: {
                ...entry,
                run: { ...entry.run, results: [...entry.run.results, result], totals }
              }
            }
          }
        }
      }
      return {
        apiClientUnclaimedRunProgress: {
          ...state.apiClientUnclaimedRunProgress,
          [runId]: [...(state.apiClientUnclaimedRunProgress[runId] ?? []), result]
        }
      }
    }),

  applyApiClientRunFinished: ({ worktreeId, run }) =>
    set((state) => {
      const { [run.id]: _dropped, ...rest } = state.apiClientUnclaimedRunProgress
      return {
        apiClientUnclaimedRunProgress: rest,
        ...withScope(state, worktreeId, run.scope, { run, running: false })
      }
    })
})

function totalsOf(results: readonly RunRequestResult[]): RunTotals {
  return results.reduce<RunTotals>(
    (totals, result) => ({
      requests: totals.requests + 1,
      testsPassed: totals.testsPassed + result.tests.filter((t) => t.passed).length,
      testsFailed: totals.testsFailed + result.tests.filter((t) => !t.passed).length,
      durationMs: totals.durationMs + result.durationMs
    }),
    { requests: 0, testsPassed: 0, testsFailed: 0, durationMs: 0 }
  )
}
