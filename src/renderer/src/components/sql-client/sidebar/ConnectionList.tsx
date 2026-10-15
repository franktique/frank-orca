import { useState } from 'react'
import { Pencil, Plug, PlugZap, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { SqlConnectionView } from '../../../../../shared/sql-client/sql-client-types'
import SqlStatusDot from '../SqlStatusDot'
import { useSqlConnectionStatus, useSqlSnapshot } from '../use-sql-project'
import ConnectionDeleteDialog from './ConnectionDeleteDialog'
import ConnectionFormDialog from './ConnectionFormDialog'

function IconAction({
  label,
  onClick,
  children
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={label} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

function ConnectionRow({
  worktreeId,
  connection,
  selected,
  onSelect,
  onEdit,
  onDelete
}: {
  worktreeId: string
  connection: SqlConnectionView
  selected: boolean
  onSelect: () => void
  onEdit: () => void
  onDelete: () => void
}): React.JSX.Element {
  const status = useSqlConnectionStatus(worktreeId, connection)
  const connected = status.state === 'connected'
  const toggle = (): void => {
    const call = connected ? window.api.sqlClient.disconnect : window.api.sqlClient.connect
    void call({ worktreeId, connectionId: connection.id })
  }
  return (
    <li
      data-current={selected ? 'true' : undefined}
      className="group flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent data-[current=true]:bg-accent"
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <SqlStatusDot status={status} />
        <span className="min-w-0">
          <span className="block truncate text-[13px]">{connection.name}</span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {connection.host}:{connection.port}/{connection.database}
          </span>
        </span>
      </button>
      <div className="flex shrink-0 items-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
        <IconAction
          label={
            connected
              ? translate('sqlClient.connection.disconnect', 'Disconnect')
              : translate('sqlClient.connection.connect', 'Connect')
          }
          onClick={toggle}
        >
          {connected ? <PlugZap /> : <Plug />}
        </IconAction>
        <IconAction label={translate('sqlClient.connection.edit', 'Edit')} onClick={onEdit}>
          <Pencil />
        </IconAction>
        <IconAction label={translate('sqlClient.common.delete', 'Delete')} onClick={onDelete}>
          <Trash2 />
        </IconAction>
      </div>
    </li>
  )
}

export default function ConnectionList({
  worktreeId,
  tabId
}: {
  worktreeId: string
  tabId: string
}): React.JSX.Element {
  const snapshot = useSqlSnapshot(worktreeId)
  const selectedId = useAppStore((state) => state.sqlTabsById[tabId]?.connectionId ?? null)
  const updateTab = useAppStore((state) => state.updateSqlTab)
  const reload = useAppStore((state) => state.loadSqlSnapshot)
  const [dialog, setDialog] = useState<
    | { kind: 'form'; connection?: SqlConnectionView }
    | { kind: 'delete'; connection: SqlConnectionView }
    | null
  >(null)

  const connections = snapshot?.connections ?? []
  const confirmDelete = async (connection: SqlConnectionView): Promise<void> => {
    setDialog(null)
    await window.api.sqlClient.deleteConnection({ worktreeId, id: connection.id })
    await reload(worktreeId)
  }

  return (
    <>
      {connections.length === 0 ? (
        <p className="px-3 text-xs text-muted-foreground">
          {translate('sqlClient.sidebar.noConnections', 'No connections yet.')}
        </p>
      ) : (
        <ul className="space-y-0.5 px-1.5">
          {connections.map((connection) => (
            <ConnectionRow
              key={connection.id}
              worktreeId={worktreeId}
              connection={connection}
              selected={connection.id === selectedId}
              onSelect={() => updateTab(tabId, { connectionId: connection.id })}
              onEdit={() => setDialog({ kind: 'form', connection })}
              onDelete={() => setDialog({ kind: 'delete', connection })}
            />
          ))}
        </ul>
      )}
      <div className="px-1.5 pt-1">
        <Button
          variant="ghost"
          size="xs"
          className="w-full justify-start"
          onClick={() => setDialog({ kind: 'form' })}
        >
          <Plus />
          {translate('sqlClient.connection.add', 'Add connection')}
        </Button>
      </div>
      {dialog?.kind === 'form' ? (
        <ConnectionFormDialog
          worktreeId={worktreeId}
          existing={dialog.connection}
          encryptionAvailable={snapshot?.encryptionAvailable ?? true}
          protectionGapMessage={snapshot?.protectionGapMessage}
          onClose={() => setDialog(null)}
          onSaved={(saved) => {
            setDialog(null)
            void reload(worktreeId)
            if (!dialog.connection) {
              updateTab(tabId, { connectionId: saved.id })
            }
          }}
        />
      ) : null}
      {dialog?.kind === 'delete' ? (
        <ConnectionDeleteDialog
          name={dialog.connection.name}
          queryCount={
            (snapshot?.queries ?? []).filter((q) => q.connectionId === dialog.connection.id).length
          }
          collectionCount={
            (snapshot?.collections ?? []).filter((c) => c.connectionId === dialog.connection.id)
              .length
          }
          onConfirm={() => void confirmDelete(dialog.connection)}
          onCancel={() => setDialog(null)}
        />
      ) : null}
    </>
  )
}
