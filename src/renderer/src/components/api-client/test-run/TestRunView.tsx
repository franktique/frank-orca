import { useEffect, useState } from 'react'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { testRunKey } from '@/store/slices/api-client-test-run'
import type { StepResult } from '../../../../../shared/test-orchestrator/test-orchestrator-types'
import DatabaseModePicker from './DatabaseModePicker'
import TestRunPauseCard from './TestRunPauseCard'
import TestRunProgress from './TestRunProgress'
import TestRunSetup from './TestRunSetup'
import TestRunStepDetail from './TestRunStepDetail'
import TestRunSummary from './TestRunSummary'

export default function TestRunView({
  worktreeId,
  collectionId
}: {
  worktreeId: string
  collectionId: string
}): React.JSX.Element {
  const target = useAppStore(
    (state) => state.apiClientTestRunByTarget[testRunKey(worktreeId, collectionId)]
  )
  const loadRun = useAppStore((state) => state.loadApiClientTestRun)
  const loadMap = useAppStore((state) => state.loadApiClientTestMap)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [detail, setDetail] = useState<StepResult | null>(null)
  const [dismissedRunId, setDismissedRunId] = useState<string | null>(null)
  const run = target?.run ?? null
  const runId = run?.id
  const selectedResult = selectedIndex === null ? undefined : run?.steps[selectedIndex]?.result

  // Why: returning to the tab or worktree must show the run's current state (FR-005c).
  useEffect(() => {
    void loadRun(worktreeId, collectionId)
    void loadMap(worktreeId, collectionId)
  }, [loadMap, loadRun, worktreeId, collectionId])

  useEffect(() => {
    if (selectedIndex === null || !runId) {
      setDetail(null)
      return
    }
    let cancelled = false
    void window.api.testRun
      .getStepDetail({ worktreeId, collectionId, runId, stepIndex: selectedIndex })
      .then((result) => {
        if (!cancelled) {
          setDetail(result.ok ? result.step : null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [selectedIndex, selectedResult, runId, worktreeId, collectionId])

  if (!window.api.testRun) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
        {translate(
          'apiClient.testRun.unavailable',
          'Test runs are not available for this workspace.'
        )}
      </div>
    )
  }

  const finished = run?.state === 'finished'
  if (!run || (finished && dismissedRunId === run.id)) {
    return (
      <TestRunSetup
        worktreeId={worktreeId}
        collectionId={collectionId}
        databaseModeSlot={(slot) => (
          <DatabaseModePicker
            worktreeId={worktreeId}
            rememberedMode={slot.rememberedMode}
            value={slot.value}
            onChange={slot.onChange}
          />
        )}
      />
    )
  }

  const detailSlot = detail ? <TestRunStepDetail step={detail} /> : null
  if (finished) {
    return (
      <div className="scrollbar-sleek flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <TestRunSummary
          worktreeId={worktreeId}
          run={run}
          onNewRun={() => setDismissedRunId(run.id)}
        />
        <TestRunProgress
          run={run}
          selectedIndex={selectedIndex}
          onSelectStep={setSelectedIndex}
          onStop={() => undefined}
          detailSlot={detailSlot}
        />
      </div>
    )
  }
  return (
    <TestRunProgress
      run={run}
      selectedIndex={selectedIndex}
      onSelectStep={setSelectedIndex}
      onStop={() => void window.api.testRun.stop({ worktreeId, runId: run.id })}
      pauseSlot={
        target?.pause ? (
          <TestRunPauseCard
            worktreeId={worktreeId}
            pause={target.pause.request}
            onAnswer={(answer) =>
              void window.api.testRun.answerPause({
                worktreeId,
                runId: target.pause?.runId ?? run.id,
                pauseId: target.pause?.pauseId ?? '',
                answer
              })
            }
          />
        ) : null
      }
      detailSlot={detailSlot}
    />
  )
}
