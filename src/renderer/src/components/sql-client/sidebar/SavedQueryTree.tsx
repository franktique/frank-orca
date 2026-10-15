import { useState } from 'react'
import { ChevronRight, FolderPlus, MoreHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { hasUnsavedSqlChanges, loadSavedQueryIntoSqlTab } from '@/lib/sql-saved-query-loading'
import { saveSqlTabInPlace } from '@/lib/sql-saved-query-actions'
import { SQL_CLIENT_LIMITS } from '../../../../../shared/sql-client/sql-client-schemas'
import type {
  SqlQueryCollection,
  SqlSavedQuery
} from '../../../../../shared/sql-client/sql-client-types'
import { useSqlSnapshot } from '../use-sql-project'
import {
  DeleteCollectionDialog,
  DeleteQueryDialog,
  MoveQueryDialog,
  NameDialog,
  UnsavedQueryDialog
} from './SavedQueryDialogs'

type Dialog =
  | { kind: 'rename-query'; query: SqlSavedQuery }
  | { kind: 'move-query'; query: SqlSavedQuery }
  | { kind: 'delete-query'; query: SqlSavedQuery }
  | { kind: 'new-collection' }
  | { kind: 'rename-collection'; collection: SqlQueryCollection }
  | { kind: 'delete-collection'; collection: SqlQueryCollection }
  | { kind: 'unsaved'; query: SqlSavedQuery }

const snippet = (sql: string): string => sql.replace(/\s+/g, ' ').trim().slice(0, 60)

function RowMenu({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={label}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{children}</DropdownMenuContent>
    </DropdownMenu>
  )
}

function QueryRow({
  query,
  selected,
  onOpen,
  onDialog
}: {
  query: SqlSavedQuery
  selected: boolean
  onOpen: () => void
  onDialog: (dialog: Dialog) => void
}): React.JSX.Element {
  return (
    <li
      data-current={selected ? 'true' : undefined}
      className="group flex items-center gap-1 rounded-md px-2 py-1 hover:bg-accent data-[current=true]:bg-accent"
    >
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[13px]">{query.name}</span>
        <span className="block truncate font-mono text-[11px] text-muted-foreground">
          {snippet(query.sql)}
        </span>
      </button>
      <div className="shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
        <RowMenu label={translate('sqlClient.saved.queryActions', 'Query actions')}>
          <DropdownMenuItem onSelect={() => onDialog({ kind: 'rename-query', query })}>
            {translate('sqlClient.saved.rename', 'Rename')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onDialog({ kind: 'move-query', query })}>
            {translate('sqlClient.saved.moveTo', 'Move to collection…')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onDialog({ kind: 'delete-query', query })}>
            {translate('sqlClient.common.delete', 'Delete')}
          </DropdownMenuItem>
        </RowMenu>
      </div>
    </li>
  )
}

export default function SavedQueryTree({
  worktreeId,
  tabId
}: {
  worktreeId: string
  tabId: string
}): React.JSX.Element {
  const snapshot = useSqlSnapshot(worktreeId)
  const connectionId = useAppStore((state) => state.sqlTabsById[tabId]?.connectionId ?? null)
  const loadedQueryId = useAppStore((state) => state.sqlTabsById[tabId]?.savedQueryId ?? null)
  const reload = useAppStore((state) => state.loadSqlSnapshot)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [dialog, setDialog] = useState<Dialog | null>(null)

  if (!connectionId) {
    return (
      <p className="px-3 text-xs text-muted-foreground">
        {translate(
          'sqlClient.sidebar.selectConnection',
          'Select a connection to see its saved queries.'
        )}
      </p>
    )
  }
  const collections = (snapshot?.collections ?? []).filter((c) => c.connectionId === connectionId)
  const queries = (snapshot?.queries ?? []).filter((q) => q.connectionId === connectionId)
  const ungrouped = queries.filter((q) => q.collectionId === null)

  const run = async (call: Promise<{ ok: boolean; message?: string }>): Promise<void> => {
    const result = await call
    if (!result.ok && result.message) {
      toast.error(result.message)
    }
    await reload(worktreeId)
  }

  const open = (query: SqlSavedQuery): void => {
    if (hasUnsavedSqlChanges(tabId) && loadedQueryId !== query.id) {
      setDialog({ kind: 'unsaved', query })
      return
    }
    loadSavedQueryIntoSqlTab(tabId, query.id)
  }

  const toggle = (id: string): void =>
    setCollapsed((current) => {
      const next = new Set(current)
      if (!next.delete(id)) {
        next.add(id)
      }
      return next
    })

  const rows = (list: SqlSavedQuery[]): React.JSX.Element => (
    <ul className="space-y-0.5">
      {list.map((query) => (
        <QueryRow
          key={query.id}
          query={query}
          selected={query.id === loadedQueryId}
          onOpen={() => open(query)}
          onDialog={setDialog}
        />
      ))}
    </ul>
  )

  return (
    <>
      <div className="space-y-1 px-1.5">
        {collections.map((collection) => {
          const members = queries.filter((q) => q.collectionId === collection.id)
          const isOpen = !collapsed.has(collection.id)
          return (
            <div key={collection.id}>
              <div className="group flex items-center gap-1 rounded-md px-1 py-1 hover:bg-accent">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => toggle(collection.id)}
                  className="flex min-w-0 flex-1 items-center gap-1 text-left text-[13px]"
                >
                  <ChevronRight
                    className={cn('size-3 shrink-0 transition-transform', isOpen && 'rotate-90')}
                    aria-hidden="true"
                  />
                  <span className="truncate">{collection.name}</span>
                  <span className="text-[11px] text-muted-foreground">{members.length}</span>
                </button>
                <div className="shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                  <RowMenu
                    label={translate('sqlClient.saved.collectionActions', 'Collection actions')}
                  >
                    <DropdownMenuItem
                      onSelect={() => setDialog({ kind: 'rename-collection', collection })}
                    >
                      {translate('sqlClient.saved.rename', 'Rename')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => setDialog({ kind: 'delete-collection', collection })}
                    >
                      {translate('sqlClient.common.delete', 'Delete')}
                    </DropdownMenuItem>
                  </RowMenu>
                </div>
              </div>
              {isOpen ? <div className="pl-4">{rows(members)}</div> : null}
            </div>
          )
        })}
        {ungrouped.length > 0 ? rows(ungrouped) : null}
        {collections.length === 0 && ungrouped.length === 0 ? (
          <p className="px-1.5 text-xs text-muted-foreground">
            {translate('sqlClient.sidebar.noSavedQueries', 'No saved queries yet.')}
          </p>
        ) : null}
        <Button
          variant="ghost"
          size="xs"
          className="w-full justify-start"
          onClick={() => setDialog({ kind: 'new-collection' })}
        >
          <FolderPlus />
          {translate('sqlClient.saved.newCollectionButton', 'New collection')}
        </Button>
      </div>

      {dialog?.kind === 'rename-query' ? (
        <NameDialog
          title={translate('sqlClient.saved.renameQueryTitle', 'Rename query')}
          label={translate('sqlClient.saved.name', 'Name')}
          initialValue={dialog.query.name}
          confirmLabel={translate('sqlClient.saved.rename', 'Rename')}
          maxLength={SQL_CLIENT_LIMITS.queryNameMax}
          onCancel={() => setDialog(null)}
          onSubmit={(name) => {
            const { query } = dialog
            setDialog(null)
            void run(
              window.api.sqlClient.renameQuery({
                worktreeId,
                id: query.id,
                baseRevision: query.revision,
                name
              })
            )
          }}
        />
      ) : null}
      {dialog?.kind === 'move-query' ? (
        <MoveQueryDialog
          collections={collections}
          currentCollectionId={dialog.query.collectionId}
          onCancel={() => setDialog(null)}
          onMove={(collectionId) => {
            const { query } = dialog
            setDialog(null)
            void run(
              window.api.sqlClient.moveQuery({
                worktreeId,
                id: query.id,
                baseRevision: query.revision,
                collectionId
              })
            )
          }}
        />
      ) : null}
      {dialog?.kind === 'delete-query' ? (
        <DeleteQueryDialog
          name={dialog.query.name}
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            const { query } = dialog
            setDialog(null)
            void run(window.api.sqlClient.deleteQuery({ worktreeId, id: query.id }))
          }}
        />
      ) : null}
      {dialog?.kind === 'new-collection' ? (
        <NameDialog
          title={translate('sqlClient.saved.newCollectionTitle', 'New collection')}
          label={translate('sqlClient.saved.name', 'Name')}
          initialValue=""
          confirmLabel={translate('sqlClient.saved.create', 'Create')}
          maxLength={SQL_CLIENT_LIMITS.collectionNameMax}
          onCancel={() => setDialog(null)}
          onSubmit={(name) => {
            setDialog(null)
            void run(window.api.sqlClient.createCollection({ worktreeId, connectionId, name }))
          }}
        />
      ) : null}
      {dialog?.kind === 'rename-collection' ? (
        <NameDialog
          title={translate('sqlClient.saved.renameCollectionTitle', 'Rename collection')}
          label={translate('sqlClient.saved.name', 'Name')}
          initialValue={dialog.collection.name}
          confirmLabel={translate('sqlClient.saved.rename', 'Rename')}
          maxLength={SQL_CLIENT_LIMITS.collectionNameMax}
          onCancel={() => setDialog(null)}
          onSubmit={(name) => {
            const { collection } = dialog
            setDialog(null)
            void run(
              window.api.sqlClient.renameCollection({
                worktreeId,
                id: collection.id,
                baseRevision: collection.revision,
                name
              })
            )
          }}
        />
      ) : null}
      {dialog?.kind === 'delete-collection' ? (
        <DeleteCollectionDialog
          name={dialog.collection.name}
          queryCount={queries.filter((q) => q.collectionId === dialog.collection.id).length}
          onCancel={() => setDialog(null)}
          onUngroup={() => {
            const { collection } = dialog
            setDialog(null)
            void run(
              window.api.sqlClient.deleteCollection({
                worktreeId,
                id: collection.id,
                deleteQueries: false
              })
            )
          }}
          onDeleteAll={() => {
            const { collection } = dialog
            setDialog(null)
            void run(
              window.api.sqlClient.deleteCollection({
                worktreeId,
                id: collection.id,
                deleteQueries: true
              })
            )
          }}
        />
      ) : null}
      {dialog?.kind === 'unsaved' ? (
        <UnsavedQueryDialog
          onCancel={() => setDialog(null)}
          onDiscard={() => {
            const { query } = dialog
            setDialog(null)
            loadSavedQueryIntoSqlTab(tabId, query.id)
          }}
          onSave={() => {
            const { query } = dialog
            setDialog(null)
            void saveSqlTabInPlace(tabId).then((saved) => {
              if (saved) {
                loadSavedQueryIntoSqlTab(tabId, query.id)
              }
            })
          }}
        />
      ) : null}
    </>
  )
}
