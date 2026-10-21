import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type { ApiNodeId } from '../../../../shared/api-client/api-client-types'
import type {
  RaisedPause,
  TestMap,
  TestRunSummary
} from '../../../../shared/test-orchestrator/test-orchestrator-types'
import type {
  TestMapChangedEvent,
  TestRunChangedEvent,
  TestRunFinishedEvent,
  TestRunPausedEvent
} from '../../../../preload/api/test-run-api'

export type ActiveTestRunPause = { runId: string; pauseId: string; request: RaisedPause }

export type TestRunTargetState = {
  testMap: TestMap | null
  /** The live run, or the last stored one for this collection. */
  run: TestRunSummary | null
  pause: ActiveTestRunPause | null
}

export const testRunKey = (worktreeId: string, collectionId: ApiNodeId): string =>
  `${worktreeId}::${collectionId}`

const EMPTY: TestRunTargetState = { testMap: null, run: null, pause: null }

export type ApiClientTestRunSlice = {
  apiClientTestRunByTarget: Record<string, TestRunTargetState | undefined>
  loadApiClientTestMap: (worktreeId: string, collectionId: ApiNodeId) => Promise<void>
  loadApiClientTestRun: (worktreeId: string, collectionId: ApiNodeId) => Promise<void>
  applyTestRunChanged: (event: TestRunChangedEvent) => void
  applyTestRunPaused: (event: TestRunPausedEvent) => void
  applyTestRunFinished: (event: TestRunFinishedEvent) => void
  applyTestMapChanged: (event: TestMapChangedEvent) => void
}

function withTarget(
  state: AppState,
  worktreeId: string,
  collectionId: ApiNodeId,
  patch: Partial<TestRunTargetState>
): Pick<AppState, 'apiClientTestRunByTarget'> {
  const key = testRunKey(worktreeId, collectionId)
  return {
    apiClientTestRunByTarget: {
      ...state.apiClientTestRunByTarget,
      [key]: { ...(state.apiClientTestRunByTarget[key] ?? EMPTY), ...patch }
    }
  }
}

export const createApiClientTestRunSlice: StateCreator<AppState, [], [], ApiClientTestRunSlice> = (
  set,
  get
) => ({
  apiClientTestRunByTarget: {},

  loadApiClientTestMap: async (worktreeId, collectionId) => {
    const testMap = await window.api.testRun.getTestMap({ worktreeId, collectionId })
    set((state) => withTarget(state, worktreeId, collectionId, { testMap }))
  },

  loadApiClientTestRun: async (worktreeId, collectionId) => {
    const run = await window.api.testRun.getRun({ worktreeId, collectionId })
    set((state) => {
      // Why: a run still marked active here may have been updated by events during the fetch.
      const current = state.apiClientTestRunByTarget[testRunKey(worktreeId, collectionId)]
      const pause = run?.state === 'paused' ? (current?.pause ?? null) : null
      return withTarget(state, worktreeId, collectionId, { run, pause })
    })
  },

  applyTestRunChanged: ({ worktreeId, collectionId, run }) =>
    set((state) =>
      withTarget(state, worktreeId, collectionId, {
        run,
        // Why: leaving the paused state means the pause was answered or the run ended.
        ...(run.state === 'paused' ? {} : { pause: null })
      })
    ),

  applyTestRunPaused: ({ worktreeId, collectionId, runId, pause }) =>
    set((state) => {
      const { pauseId, ...request } = pause
      return withTarget(state, worktreeId, collectionId, {
        pause: { runId, pauseId, request }
      })
    }),

  applyTestRunFinished: ({ worktreeId, collectionId, run }) =>
    set((state) => withTarget(state, worktreeId, collectionId, { run, pause: null })),

  applyTestMapChanged: ({ worktreeId, collectionId }) => {
    void get().loadApiClientTestMap(worktreeId, collectionId)
  }
})
