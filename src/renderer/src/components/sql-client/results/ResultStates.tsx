import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { SqlRunError } from '../../../../../shared/sql-client/sql-client-types'

const shortcut = (): string => (navigator.userAgent.includes('Mac') ? '⌘+Enter' : 'Ctrl+Enter')

function Centered({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

export function EmptyResultState(): React.JSX.Element {
  return (
    <Centered>
      {translate('sqlClient.results.empty', 'Run a query with {{shortcut}} or F5', {
        shortcut: shortcut()
      })}
    </Centered>
  )
}

export function RunningResultState({
  startedAt,
  onCancel
}: {
  startedAt: number
  onCancel: () => void
}): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [])
  return (
    <Centered>
      <Loader2 className="size-5 animate-spin" aria-hidden="true" />
      <span role="status">
        {translate('sqlClient.results.running', 'Running… {{seconds}} s', {
          seconds: ((now - startedAt) / 1000).toFixed(1)
        })}
      </span>
      <Button variant="outline" size="sm" onClick={onCancel}>
        {translate('sqlClient.toolbar.cancel', 'Cancel')}
      </Button>
    </Centered>
  )
}

export function CommandResultState({
  command,
  affectedRows
}: {
  command: string
  affectedRows: number | null
}): React.JSX.Element {
  return (
    <Centered>
      {affectedRows === null
        ? translate('sqlClient.results.commandDone', '{{command}} completed', {
            command: command || 'Command'
          })
        : translate('sqlClient.results.affected', '{{count}} rows affected', {
            count: affectedRows
          })}
    </Centered>
  )
}

export function CancelledResultState(): React.JSX.Element {
  return <Centered>{translate('sqlClient.results.cancelled', 'Query cancelled')}</Centered>
}

function Detail({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div>
      <span className="text-muted-foreground">{label}: </span>
      <span className="whitespace-pre-wrap">{value}</span>
    </div>
  )
}

export function ErrorResultState({ error }: { error: SqlRunError }): React.JSX.Element {
  const failedNumber =
    error.failedStatementIndex === undefined ? null : error.failedStatementIndex + 1
  return (
    <div role="alert" className="scrollbar-sleek h-full space-y-2 overflow-auto p-4 text-sm">
      <p className="font-medium text-destructive">{error.message}</p>
      <div className="space-y-1 font-mono text-xs">
        {error.code ? (
          <Detail label={translate('sqlClient.results.sqlstate', 'SQLSTATE')} value={error.code} />
        ) : null}
        {error.position ? (
          <Detail
            label={translate('sqlClient.results.position', 'Position')}
            value={String(error.position)}
          />
        ) : null}
        {error.detail ? (
          <Detail label={translate('sqlClient.results.detail', 'Detail')} value={error.detail} />
        ) : null}
        {error.hint ? (
          <Detail label={translate('sqlClient.results.hint', 'Hint')} value={error.hint} />
        ) : null}
      </div>
      {failedNumber !== null ? (
        <div className="space-y-1 text-xs">
          <p>
            {translate('sqlClient.results.failedStatement', 'Statement {{number}} failed:', {
              number: failedNumber
            })}
          </p>
          {error.failedStatementText ? (
            <pre className="whitespace-pre-wrap rounded-md bg-muted p-2 font-mono">
              {error.failedStatementText}
            </pre>
          ) : null}
        </div>
      ) : null}
      {error.nothingApplied === true ? (
        <p className="text-xs text-muted-foreground">
          {translate('sqlClient.results.nothingApplied', 'Nothing was applied.')}
        </p>
      ) : null}
      {error.nothingApplied === false && failedNumber !== null && failedNumber > 1 ? (
        <p className="text-xs text-muted-foreground">
          {failedNumber === 2
            ? translate('sqlClient.results.alreadyRanOne', 'Statement 1 already ran.')
            : translate('sqlClient.results.alreadyRan', 'Statements 1–{{count}} already ran.', {
                count: failedNumber - 1
              })}
        </p>
      ) : null}
    </div>
  )
}
