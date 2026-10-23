import { translate } from '@/i18n/i18n'
import type {
  PauseAnswer,
  PauseRequest
} from '../../../../../shared/test-orchestrator/test-orchestrator-types'
import TestRunBrowserRecoveryPause from './TestRunBrowserRecoveryPause'
import TestRunCredentialsPause from './TestRunCredentialsPause'
import TestRunManualQueriesPause from './TestRunManualQueriesPause'
import TestRunStoppingPause from './TestRunStoppingPause'

// Why: the stopping prompt is raised as a pause but is not part of the stored PauseRequest union.
export type TestRunPauseCardRequest = PauseRequest | { kind: 'stopping' }

export type TestRunPauseCardProps = {
  /** Lets the browser-recovery variant list tabs for "pick another tab". */
  worktreeId?: string
  pause: TestRunPauseCardRequest
  onAnswer: (answer: PauseAnswer) => void
}

function pauseTitle(pause: TestRunPauseCardRequest): string {
  switch (pause.kind) {
    case 'manual-queries':
      return translate('apiClient.testRun.pause.manualQueries', 'Run the queries yourself')
    case 'browser-recovery':
      return translate('apiClient.testRun.pause.browserRecovery', 'The database console needs help')
    case 'credentials':
      return translate('apiClient.testRun.pause.credentials', 'Credentials expired')
    case 'stopping':
      return translate('apiClient.testRun.pause.stopping', 'Stopping the run')
  }
}

function PauseBody({ pause, onAnswer, worktreeId }: TestRunPauseCardProps): React.ReactNode {
  switch (pause.kind) {
    case 'manual-queries':
      return <TestRunManualQueriesPause queries={pause.queries} onAnswer={onAnswer} />
    case 'credentials':
      return <TestRunCredentialsPause inputs={pause.inputs} onAnswer={onAnswer} />
    case 'stopping':
      return <TestRunStoppingPause onAnswer={onAnswer} />
    case 'browser-recovery':
      return (
        <TestRunBrowserRecoveryPause
          worktreeId={worktreeId}
          problem={pause.problem}
          screenshot={pause.screenshot}
          onAnswer={onAnswer}
        />
      )
  }
}

/** `onAnswer` is what each pause-kind variant dispatches through `testRun:answerPause`. */
export default function TestRunPauseCard(props: TestRunPauseCardProps): React.JSX.Element {
  const { pause } = props
  return (
    <section
      role="region"
      aria-label={translate('apiClient.testRun.pause.label', 'Waiting for you')}
      className="space-y-2 rounded-md border border-border bg-card p-3 text-sm"
    >
      <div>
        <h3 className="font-medium">{pauseTitle(pause)}</h3>
        {pause.kind === 'stopping' ? null : (
          <p className="text-xs text-muted-foreground">
            {translate('apiClient.testRun.pause.step', 'Paused at step {{stepId}}', {
              stepId: pause.stepId
            })}
          </p>
        )}
      </div>
      <PauseBody {...props} />
    </section>
  )
}
