import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { PauseAnswer } from '../../../../../shared/test-orchestrator/test-orchestrator-types'

export default function TestRunStoppingPause({
  onAnswer
}: {
  onAnswer: (answer: PauseAnswer) => void
}): React.JSX.Element {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {translate(
          'apiClient.testRun.pause.stoppingHint',
          'Cleanup removes the data this run created. Keep data leaves it for you to inspect.'
        )}
      </p>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => onAnswer({ kind: 'stopping', choice: 'run-cleanup' })}>
          {translate('apiClient.testRun.pause.runCleanup', 'Run cleanup')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onAnswer({ kind: 'stopping', choice: 'keep-data' })}
        >
          {translate('apiClient.testRun.pause.keepData', 'Keep data')}
        </Button>
      </div>
    </div>
  )
}
