import { useState } from 'react'
import { ChevronRight, Copy, Loader2, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import {
  quotePgIdentifier,
  quoteQualifiedName
} from '../../../../../shared/sql-client/pg-identifier-quoting'
import type { SqlRelationKind, SqlSchema } from '../../../../../shared/sql-client/sql-client-types'
import { useSqlConnectionStatus, useSqlSnapshot } from '../use-sql-project'
import { columnKey, useSqlSchemaTree, type SchemaTreeState } from './use-sql-schema-tree'

const KIND_LABEL: Record<SqlRelationKind, () => string> = {
  table: () => translate('sqlClient.schema.table', 'table'),
  view: () => translate('sqlClient.schema.view', 'view'),
  'materialized-view': () => translate('sqlClient.schema.materializedView', 'mat. view'),
  'partitioned-table': () => translate('sqlClient.schema.partitionedTable', 'partitioned'),
  'foreign-table': () => translate('sqlClient.schema.foreignTable', 'foreign')
}

function copyName(text: string): void {
  void window.api.ui.writeClipboardText(text)
}

function CopyButton({ text, label }: { text: string; label: string }): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={label} onClick={() => copyName(text)}>
          <Copy />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

function Status({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="px-2 py-1 text-xs text-muted-foreground">{children}</p>
}

function Expander({
  open,
  onToggle,
  children
}: {
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="flex min-w-0 flex-1 items-center gap-1 text-left text-[13px]"
    >
      <ChevronRight
        className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')}
        aria-hidden="true"
      />
      {children}
    </button>
  )
}

function ColumnRows({
  state,
  schema,
  relation
}: {
  state: SchemaTreeState
  schema: string
  relation: string
}): React.JSX.Element {
  const loaded = state.columns[columnKey(schema, relation)]
  if (!loaded || loaded.status === 'loading') {
    return <Loader2 className="ml-6 size-3 animate-spin text-muted-foreground" />
  }
  if (loaded.status === 'error') {
    return <Status>{loaded.message}</Status>
  }
  return (
    <ul className="pl-6">
      {loaded.items.map((column) => (
        <li key={column.name} className="group flex items-center gap-1 px-1 py-0.5 text-[12px]">
          <span className="truncate">{column.name}</span>
          <span className="truncate text-[11px] text-muted-foreground">{column.dataTypeName}</span>
          {column.isPrimaryKey ? (
            <Badge variant="outline">{translate('sqlClient.schema.primaryKey', 'PK')}</Badge>
          ) : null}
          {column.nullable ? null : (
            <span className="text-[10px] text-muted-foreground">
              {translate('sqlClient.schema.notNull', 'not null')}
            </span>
          )}
          <span className="ml-auto opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
            <CopyButton
              text={quotePgIdentifier(column.name)}
              label={translate('sqlClient.schema.copyName', 'Copy name')}
            />
          </span>
        </li>
      ))}
    </ul>
  )
}

function SchemaNode({
  schema,
  tree,
  onLoadRelations,
  onLoadColumns
}: {
  schema: SqlSchema
  tree: SchemaTreeState
  onLoadRelations: (schema: string) => void
  onLoadColumns: (schema: string, relation: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [openRelations, setOpenRelations] = useState<ReadonlySet<string>>(new Set())
  const relations = tree.relations[schema.name]

  const toggleSchema = (): void => {
    if (!open && !relations) {
      onLoadRelations(schema.name)
    }
    setOpen(!open)
  }
  const toggleRelation = (name: string): void => {
    const next = new Set(openRelations)
    if (next.delete(name)) {
      setOpenRelations(next)
      return
    }
    if (!tree.columns[columnKey(schema.name, name)]) {
      onLoadColumns(schema.name, name)
    }
    next.add(name)
    setOpenRelations(next)
  }

  return (
    <li>
      <div className="group flex items-center gap-1 rounded-md px-1 py-1 hover:bg-accent">
        <Expander open={open} onToggle={toggleSchema}>
          <span className="truncate">{schema.name}</span>
        </Expander>
        <span className="shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
          <CopyButton
            text={quotePgIdentifier(schema.name)}
            label={translate('sqlClient.schema.copyName', 'Copy name')}
          />
        </span>
      </div>
      {open ? (
        <div className="pl-4">
          {!relations || relations.status === 'loading' ? (
            <Loader2 className="ml-2 size-3 animate-spin text-muted-foreground" />
          ) : relations.status === 'error' ? (
            <Status>{relations.message}</Status>
          ) : relations.items.length === 0 ? (
            <Status>{translate('sqlClient.schema.noRelations', 'No tables or views')}</Status>
          ) : (
            <ul>
              {relations.items.map((relation) => (
                <li key={relation.name}>
                  <div className="group flex items-center gap-1 rounded-md px-1 py-1 hover:bg-accent">
                    <Expander
                      open={openRelations.has(relation.name)}
                      onToggle={() => toggleRelation(relation.name)}
                    >
                      <span className="truncate">{relation.name}</span>
                      <Badge variant="secondary">{KIND_LABEL[relation.kind]()}</Badge>
                    </Expander>
                    <span className="shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                      <CopyButton
                        text={quoteQualifiedName(schema.name, relation.name)}
                        label={translate('sqlClient.schema.copyName', 'Copy name')}
                      />
                    </span>
                  </div>
                  {openRelations.has(relation.name) ? (
                    <ColumnRows state={tree} schema={schema.name} relation={relation.name} />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </li>
  )
}

export default function SchemaBrowser({
  worktreeId,
  tabId
}: {
  worktreeId: string
  tabId: string
}): React.JSX.Element {
  const snapshot = useSqlSnapshot(worktreeId)
  const connectionId = useAppStore((state) => state.sqlTabsById[tabId]?.connectionId ?? null)
  const connection = snapshot?.connections.find((entry) => entry.id === connectionId)
  if (!connectionId || !connection) {
    return (
      <Status>
        {translate(
          'sqlClient.sidebar.schemaNoConnection',
          'Select a connection to browse its schema.'
        )}
      </Status>
    )
  }
  return <ConnectedSchema key={connectionId} worktreeId={worktreeId} connection={connection} />
}

function ConnectedSchema({
  worktreeId,
  connection
}: {
  worktreeId: string
  connection: NonNullable<ReturnType<typeof useSqlSnapshot>>['connections'][number]
}): React.JSX.Element {
  const status = useSqlConnectionStatus(worktreeId, connection)
  const connected = status.state === 'connected'
  const { state, refresh, loadRelations, loadColumns } = useSqlSchemaTree(
    worktreeId,
    connection.id,
    connected
  )

  if (!connected) {
    return (
      <div className="space-y-2 px-3">
        <p className="text-xs text-muted-foreground">
          {translate('sqlClient.schema.connectFirst', 'Connect to browse the schema.')}
        </p>
        <Button
          variant="outline"
          size="xs"
          disabled={status.state === 'connecting'}
          onClick={() =>
            void window.api.sqlClient.connect({
              worktreeId,
              connectionId: connection.id
            })
          }
        >
          {translate('sqlClient.connection.connect', 'Connect')}
        </Button>
      </div>
    )
  }

  return (
    <div className="px-1.5">
      <div className="flex justify-end">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={translate('sqlClient.schema.refresh', 'Refresh schema')}
              onClick={() => void refresh()}
            >
              <RefreshCw />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {translate('sqlClient.schema.refresh', 'Refresh schema')}
          </TooltipContent>
        </Tooltip>
      </div>
      {!state.schemas || state.schemas.status === 'loading' ? (
        <Loader2 className="ml-2 size-3 animate-spin text-muted-foreground" />
      ) : state.schemas.status === 'error' ? (
        <Status>{state.schemas.message}</Status>
      ) : (
        <ul>
          {state.schemas.items.map((schema) => (
            <SchemaNode
              key={schema.name}
              schema={schema}
              tree={state}
              onLoadRelations={(name) => void loadRelations(name)}
              onLoadColumns={(name, relation) => void loadColumns(name, relation)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
