import { translate } from '@/i18n/i18n'
import type { RunRequestResult } from '../../../../../shared/api-client/api-client-types'
import type { StepResult } from '../../../../../shared/test-orchestrator/test-orchestrator-types'
import RunResultDetail from '../runner/RunResultDetail'

function toRunnerResult(exchange: StepResult['exchanges'][number]): RunRequestResult {
  const response = exchange.outcome.kind === 'response' ? exchange.outcome.response : null
  return {
    iteration: 1,
    requestId: exchange.requestId,
    requestName: `${exchange.resolvedRequest.method} ${exchange.resolvedRequest.url}`,
    folderPath: [],
    ...(response ? { status: response.status } : {}),
    durationMs: 0,
    tests: exchange.tests,
    detail: {
      resolvedRequest: exchange.resolvedRequest,
      outcome: exchange.outcome,
      scriptLogs: []
    }
  }
}

/** A step's full request details, shown with the 001 runner's detail view (FR-005c). */
export default function TestRunStepDetail({ step }: { step: StepResult }): React.JSX.Element {
  return (
    <div className="scrollbar-sleek max-h-64 space-y-3 overflow-y-auto rounded-md border border-border p-3">
      {step.reason ? <p className="text-xs">{step.reason}</p> : null}
      {step.exchanges.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {translate('apiClient.testRun.detail.none', 'No request was sent for this step.')}
        </p>
      ) : (
        step.exchanges.map((exchange, index) => (
          <RunResultDetail
            key={`${exchange.requestId}:${step.exchanges.slice(0, index).filter((earlier) => earlier.requestId === exchange.requestId).length}`}
            result={toRunnerResult(exchange)}
          />
        ))
      )}
    </div>
  )
}
