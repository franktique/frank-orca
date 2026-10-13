import { translate } from '@/i18n/i18n'
import type { RunRequestResult } from '../../../../../shared/api-client/api-client-types'
import TestResultsList from '../response-viewer/TestResultsList'

function Headers({ headers }: { headers: readonly [string, string][] }): React.JSX.Element {
  return (
    <dl className="space-y-0.5 font-mono text-[11px]">
      {headers.map(([name, value], index) => (
        <div
          key={`${name}:${headers.slice(0, index).filter(([n]) => n === name).length}`}
          className="flex gap-2"
        >
          <dt className="shrink-0 text-muted-foreground">{name}:</dt>
          <dd className="min-w-0 break-all">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** One result's stored detail; works after a restart and for every iteration. */
export default function RunResultDetail({
  result
}: {
  result: RunRequestResult
}): React.JSX.Element {
  if (!result.detail) {
    return (
      <p className="text-xs text-muted-foreground" role="status">
        {translate('apiClient.runner.detailsNotKept', 'Details were not kept for this result.')}
      </p>
    )
  }
  const { detail } = result
  const response = detail.outcome.kind === 'response' ? detail.outcome.response : null
  return (
    <div className="space-y-3 text-xs">
      <section className="space-y-1">
        <h5 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {translate('apiClient.console.requestHeaders', 'Request headers')}
        </h5>
        <Headers headers={detail.resolvedRequest.headers} />
        {detail.resolvedRequest.body ? (
          <pre className="whitespace-pre-wrap break-all font-mono text-[11px]">
            {detail.resolvedRequest.body}
          </pre>
        ) : null}
      </section>
      {response ? (
        <section className="space-y-1">
          <h5 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {translate('apiClient.console.responseHeaders', 'Response headers')}
          </h5>
          <Headers headers={response.headers} />
          <pre className="whitespace-pre-wrap break-all font-mono text-[11px]">
            {response.body.encoding === 'utf8'
              ? (response.body.text ?? '')
              : translate('apiClient.console.binaryBody', 'Binary body')}
          </pre>
        </section>
      ) : (
        <p className="text-destructive">
          {detail.outcome.kind === 'error' ? detail.outcome.message : ''}
        </p>
      )}
      {detail.scriptLogs.length > 0 ? (
        <section className="space-y-1">
          <h5 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {translate('apiClient.console.logs', 'Script logs')}
          </h5>
          <ul className="space-y-0.5 font-mono text-[11px]">
            {detail.scriptLogs.map((log, index) => (
              <li
                key={`${log.phase}:${log.level}:${log.text}:${detail.scriptLogs.slice(0, index).filter((l) => l.text === log.text && l.level === log.level).length}`}
              >
                <span className="text-muted-foreground">[{log.level}]</span> {log.text}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <TestResultsList tests={result.tests} />
    </div>
  )
}
