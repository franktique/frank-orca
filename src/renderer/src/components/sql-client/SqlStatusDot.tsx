import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { SqlConnectionStatus } from '../../../../shared/sql-client/sql-client-types'

function dotClass(state: SqlConnectionStatus['state']): string {
  switch (state) {
    case 'connected':
      return 'bg-status-success'
    case 'connecting':
      return 'bg-muted-foreground animate-pulse'
    case 'error':
      return 'bg-destructive'
    case 'idle':
      return 'bg-muted-foreground/40'
  }
}

function statusLabel(status: SqlConnectionStatus): string {
  switch (status.state) {
    case 'connected':
      return translate('sqlClient.status.connected', 'Connected')
    case 'connecting':
      return translate('sqlClient.status.connecting', 'Connecting')
    case 'error':
      return status.message
    case 'idle':
      return translate('sqlClient.status.idle', 'Not connected')
  }
}

export default function SqlStatusDot({
  status
}: {
  status: SqlConnectionStatus
}): React.JSX.Element {
  return (
    <span
      role="img"
      aria-label={statusLabel(status)}
      title={statusLabel(status)}
      data-status={status.state}
      className={cn('size-2 shrink-0 rounded-full', dotClass(status.state))}
    />
  )
}
