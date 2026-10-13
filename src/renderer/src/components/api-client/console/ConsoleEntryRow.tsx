import { ChevronDown, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { translate } from '@/i18n/i18n'
import type { ConsoleEntry } from '../../../../../shared/api-client/api-client-types'
import { formatDuration } from '../response-viewer/response-formatting'
import { useState } from 'react'

function HeaderList({ headers }: { headers: readonly [string, string][] }): React.JSX.Element {
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

function Section({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="space-y-1">
      <h5 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h5>
      {children}
    </section>
  )
}

function originLabel(origin: ConsoleEntry['origin']): string {
  return origin === 'agent'
    ? translate('apiClient.origin.agent', 'Agent')
    : origin === 'run'
      ? translate('apiClient.origin.run', 'Run')
      : translate('apiClient.origin.manual', 'Manual')
}

export default function ConsoleEntryRow({
  entry,
  onToggle
}: {
  entry: ConsoleEntry
  /** The virtualized list re-measures the row when it opens or closes. */
  onToggle?: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const response = entry.outcome.kind === 'response' ? entry.outcome.response : null
  return (
    <div className="border-b border-border">
      <Collapsible
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          onToggle?.()
        }}
      >
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-2 py-1 text-left text-xs hover:bg-accent"
            aria-label={translate(
              'apiClient.console.toggleEntry',
              'Toggle details for {{method}} {{url}}',
              {
                method: entry.method,
                url: entry.url
              }
            )}
          >
            {open ? (
              <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
            )}
            <Badge variant="hostContext">{originLabel(entry.origin)}</Badge>
            <span className="shrink-0 font-mono font-semibold">{entry.method}</span>
            <span className="min-w-0 flex-1 truncate font-mono">{entry.url}</span>
            {response ? (
              <Badge variant={response.status >= 400 ? 'destructive' : 'secondary'}>
                {response.status}
              </Badge>
            ) : (
              <Badge variant="destructive">
                {entry.outcome.kind === 'error' ? entry.outcome.code : ''}
              </Badge>
            )}
            {entry.durationMs !== undefined ? (
              <span className="shrink-0 text-muted-foreground">
                {formatDuration(entry.durationMs)}
              </span>
            ) : null}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-3 px-3 py-2">
            <Section title={translate('apiClient.console.requestHeaders', 'Request headers')}>
              <HeaderList headers={entry.request.headers} />
            </Section>
            {entry.request.body ? (
              <Section title={translate('apiClient.console.requestBody', 'Request body')}>
                <pre className="whitespace-pre-wrap break-all font-mono text-[11px]">
                  {entry.request.body}
                </pre>
              </Section>
            ) : null}
            {response ? (
              <>
                <Section title={translate('apiClient.console.responseHeaders', 'Response headers')}>
                  <HeaderList headers={response.headers} />
                </Section>
                <Section title={translate('apiClient.console.responseBody', 'Response body')}>
                  <pre className="whitespace-pre-wrap break-all font-mono text-[11px]">
                    {response.body.encoding === 'utf8'
                      ? (response.body.text ?? '')
                      : translate('apiClient.console.binaryBody', 'Binary body')}
                  </pre>
                </Section>
              </>
            ) : entry.outcome.kind === 'error' ? (
              <p className="text-xs text-destructive">{entry.outcome.message}</p>
            ) : null}
            {entry.scriptLogs.length > 0 ? (
              <Section title={translate('apiClient.console.logs', 'Script logs')}>
                <ul className="space-y-0.5 font-mono text-[11px]">
                  {entry.scriptLogs.map((log, index) => (
                    <li
                      key={`${log.phase}:${log.level}:${log.text}:${entry.scriptLogs.slice(0, index).filter((l) => l.text === log.text && l.level === log.level && l.phase === log.phase).length}`}
                    >
                      <span className="text-muted-foreground">[{log.level}]</span> {log.text}
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
