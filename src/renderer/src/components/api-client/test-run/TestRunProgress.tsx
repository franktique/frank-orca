import { Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { TestRunSummary } from '../../../../../shared/test-orchestrator/test-orchestrator-types'
import { formatDuration } from '../response-viewer/response-formatting'
import TestRunStepBadge from './TestRunStepBadge'
import { phaseLabel } from './test-run-phase-label'
import { useTestRunElapsed } from './use-test-run-elapsed'

type TestRunProgressProps = {
  run: TestRunSummary
  selectedIndex: number | null
  onSelectStep: (index: number | null) => void
  onStop: () => void
  /** Inline slot for the active TestRunPauseCard. */
  pauseSlot?: React.ReactNode
  detailSlot?: React.ReactNode
}

export default function TestRunProgress({
  run,
  selectedIndex,
  onSelectStep,
  onStop,
  pauseSlot,
  detailSlot
}: TestRunProgressProps): React.JSX.Element {
  const elapsed = useTestRunElapsed(run)
  const current = run.currentStepIndex === null ? undefined : run.steps[run.currentStepIndex]
  const waiting = run.state === 'paused'
  const stopping = run.state === 'stopping' || run.state === 'cleaning-up'

  return (
    <section
      className="flex min-h-0 flex-1 flex-col gap-3 p-3"
      aria-label={translate('apiClient.testRun.progress.title', 'Test run progress')}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 text-sm">
          <p className="truncate font-medium">
            {current
              ? `${phaseLabel(current.phase)} · ${current.title}`
              : translate('apiClient.testRun.progress.starting', 'Starting…')}
          </p>
          <p className="text-xs text-muted-foreground">
            {translate('apiClient.testRun.progress.elapsed', 'Elapsed {{time}}', {
              time: formatDuration(elapsed)
            })}
            {waiting
              ? ` · ${translate('apiClient.testRun.progress.waiting', 'Waiting for you')}`
              : ''}
            {stopping ? ` · ${translate('apiClient.testRun.progress.stopping', 'Stopping')}` : ''}
          </p>
        </div>
        {run.state === 'finished' ? null : (
          <Button variant="outline" size="sm" disabled={stopping} onClick={onStop}>
            <Square />
            {translate('apiClient.testRun.stop', 'Stop')}
          </Button>
        )}
      </div>
      {pauseSlot}
      <ul
        className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto"
        aria-label={translate('apiClient.testRun.progress.steps', 'Steps')}
      >
        {run.steps.map((step, index) => (
          <li
            key={`${step.stepId}:${run.steps.slice(0, index).filter((earlier) => earlier.stepId === step.stepId).length}`}
          >
            <button
              type="button"
              data-selected={index === selectedIndex ? 'true' : undefined}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-accent data-[selected=true]:bg-accent"
              onClick={() => onSelectStep(index === selectedIndex ? null : index)}
            >
              <TestRunStepBadge result={step.result} />
              <span className="min-w-0 flex-1 truncate">{step.title}</span>
              {step.reason ? (
                <span className="min-w-0 max-w-[40%] truncate text-muted-foreground">
                  {step.reason}
                </span>
              ) : null}
              <span className="shrink-0 text-muted-foreground">
                {formatDuration(step.durationMs)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {detailSlot}
    </section>
  )
}
