import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { Run } from '../../../../../shared/api-client/api-client-types'
import { formatDuration } from '../response-viewer/response-formatting'

export default function RunSummary({
  run,
  onClear
}: {
  run: Run
  onClear: () => void
}): React.JSX.Element {
  const failedTests = run.results.flatMap((result) =>
    result.tests
      .filter((test) => !test.passed)
      .map((test) => ({ request: result.requestName, name: test.name, error: test.error }))
  )
  return (
    <section
      className="space-y-2 rounded-md border border-border p-3 text-xs"
      aria-label={translate('apiClient.runner.summary', 'Summary')}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span>
          {translate('apiClient.runner.totalRequests', 'Requests')}: {run.totals.requests}
        </span>
        <span>
          {translate('apiClient.runner.testsPassed', 'Tests passed')}: {run.totals.testsPassed}
        </span>
        <span>
          {translate('apiClient.runner.testsFailed', 'Tests failed')}: {run.totals.testsFailed}
        </span>
        <span>
          {translate('apiClient.runner.duration', 'Duration')}:{' '}
          {formatDuration(run.totals.durationMs)}
        </span>
        <span className="ml-auto">
          <Button variant="outline" size="xs" onClick={onClear}>
            {translate('apiClient.runner.clear', 'Clear')}
          </Button>
        </span>
      </div>
      {run.state === 'stopped' ? (
        <p className="text-muted-foreground">
          {translate('apiClient.runner.stopped', 'The run was stopped before it finished.')}
        </p>
      ) : null}
      {run.stoppedEarly ? (
        <p className="text-muted-foreground">
          {translate('apiClient.runner.stoppedAtFailure', 'Stopped at first failure')}
        </p>
      ) : null}
      {run.error ? <p className="text-destructive">{run.error}</p> : null}
      {failedTests.length > 0 ? (
        <ul className="space-y-1">
          {failedTests.map((failure, index) => (
            <li
              key={`${failure.request}:${failure.name}:${failedTests.slice(0, index).filter((f) => f.request === failure.request && f.name === failure.name).length}`}
            >
              <span className="font-medium">{failure.request}</span> — {failure.name}
              {failure.error ? <span className="text-destructive">: {failure.error}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
