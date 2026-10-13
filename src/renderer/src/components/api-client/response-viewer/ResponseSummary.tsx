import { Badge } from '@/components/ui/badge'
import { translate } from '@/i18n/i18n'
import type { LatestResult } from '../../../../../shared/api-client/api-client-types'
import { formatBytes, formatDuration } from './response-formatting'

function statusVariant(status: number): 'secondary' | 'outline' | 'destructive' {
  if (status >= 400) {
    return 'destructive'
  }
  return status >= 300 ? 'outline' : 'secondary'
}

function originLabel(origin: LatestResult['origin']): string {
  if (origin === 'run') {
    return translate('apiClient.origin.run', 'Run')
  }
  return origin === 'agent'
    ? translate('apiClient.origin.agent', 'Agent')
    : translate('apiClient.origin.manual', 'Manual')
}

export default function ResponseSummary({ result }: { result: LatestResult }): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs" data-testid="response-summary">
      {result.outcome.kind === 'response' ? (
        <>
          <Badge variant={statusVariant(result.outcome.response.status)}>
            {result.outcome.response.status} {result.outcome.response.statusText}
          </Badge>
          <span>
            {translate('apiClient.response.time', 'Time')}: {formatDuration(result.durationMs)}
          </span>
          <span>
            {translate('apiClient.response.size', 'Size')}:{' '}
            {formatBytes(result.outcome.response.sizeBytes)}
          </span>
        </>
      ) : null}
      <Badge variant="hostContext">{originLabel(result.origin)}</Badge>
    </div>
  )
}
