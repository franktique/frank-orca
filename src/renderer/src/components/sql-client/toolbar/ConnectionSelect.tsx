import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { SqlConnectionView } from '../../../../../shared/sql-client/sql-client-types'
import SqlStatusDot from '../SqlStatusDot'
import { useSqlConnectionStatus, useSqlSnapshot } from '../use-sql-project'

const NO_CONNECTION = '__none__'

function ConnectionOption({
  worktreeId,
  connection
}: {
  worktreeId: string
  connection: SqlConnectionView
}): React.JSX.Element {
  const status = useSqlConnectionStatus(worktreeId, connection)
  return (
    <SelectItem value={connection.id}>
      <span className="flex items-center gap-2">
        <SqlStatusDot status={status} />
        {connection.name}
      </span>
    </SelectItem>
  )
}

export default function ConnectionSelect({
  worktreeId,
  tabId
}: {
  worktreeId: string
  tabId: string
}): React.JSX.Element {
  const snapshot = useSqlSnapshot(worktreeId)
  const connectionId = useAppStore((state) => state.sqlTabsById[tabId]?.connectionId ?? null)
  const updateTab = useAppStore((state) => state.updateSqlTab)

  const change = (value: string): void => {
    // The old session was built for the previous connection.
    void window.api.sqlClient.closeTabSession({ worktreeId, tabId })
    updateTab(tabId, { connectionId: value === NO_CONNECTION ? null : value })
  }

  return (
    <Select value={connectionId ?? NO_CONNECTION} onValueChange={change}>
      <SelectTrigger
        className="w-56"
        aria-label={translate('sqlClient.toolbar.connection', 'Connection')}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_CONNECTION}>
          {translate('sqlClient.toolbar.noConnection', 'No connection')}
        </SelectItem>
        {(snapshot?.connections ?? []).map((connection) => (
          <ConnectionOption key={connection.id} worktreeId={worktreeId} connection={connection} />
        ))}
      </SelectContent>
    </Select>
  )
}
