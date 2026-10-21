// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import type { TestRunSummary } from '../../../../shared/test-orchestrator/test-orchestrator-types'
import { testRunKey } from './api-client-test-run'
import { createTestStore } from './store-test-helpers'

const KEY = testRunKey('w1', 'c1')

function summary(state: TestRunSummary['state']): TestRunSummary {
  return {
    id: 'run1',
    collectionId: 'c1',
    kind: 'full',
    environmentId: null,
    targetHosts: [],
    databaseMode: { mode: 'manual' },
    state,
    ending: null,
    startedAt: 1,
    endedAt: null,
    pausedMs: 0,
    currentStepIndex: null,
    steps: [],
    pause: null,
    evidence: null,
    cleanup: { cleaned: 0, notCleaned: [], keptByUser: false }
  }
}

describe('api-client test-run slice', () => {
  it('keeps a pause until the run leaves the paused state', () => {
    const store = createTestStore()
    const { applyTestRunChanged, applyTestRunPaused } = store.getState()
    applyTestRunChanged({ worktreeId: 'w1', collectionId: 'c1', run: summary('paused') })
    applyTestRunPaused({
      worktreeId: 'w1',
      collectionId: 'c1',
      runId: 'run1',
      pause: { kind: 'credentials', stepId: 's1', inputs: [], pauseId: 'p1' }
    })
    expect(store.getState().apiClientTestRunByTarget[KEY]?.pause?.pauseId).toBe('p1')
    applyTestRunChanged({ worktreeId: 'w1', collectionId: 'c1', run: summary('running') })
    expect(store.getState().apiClientTestRunByTarget[KEY]?.pause).toBeNull()
  })

  it('reloads the test map when it changes', async () => {
    const getTestMap = vi.fn().mockResolvedValue({ orcaTestMap: 1, entries: [] })
    vi.stubGlobal('window', { ...window, api: { testRun: { getTestMap } } })
    const store = createTestStore()
    store.getState().applyTestMapChanged({ worktreeId: 'w1', collectionId: 'c1' })
    await vi.waitFor(() =>
      expect(store.getState().apiClientTestRunByTarget[KEY]?.testMap).not.toBeNull()
    )
    expect(getTestMap).toHaveBeenCalledWith({ worktreeId: 'w1', collectionId: 'c1' })
    vi.unstubAllGlobals()
  })
})
