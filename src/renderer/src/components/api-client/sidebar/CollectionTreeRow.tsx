import { Fragment, useState } from 'react'
import { ChevronDown, ChevronRight, Ellipsis, Folder, Library } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { buildRowMenuEntries, type RowAction } from './collection-tree-menu'
import type { TreeRow } from './collection-tree-rows'

const INDENT_PX = 12
const BASE_PADDING_PX = 8

type CollectionTreeRowProps = {
  row: TreeRow
  selected: boolean
  renaming: boolean
  onToggle: (row: TreeRow) => void
  onOpen: (row: TreeRow) => void
  onAction: (row: TreeRow, action: RowAction) => void
  onRenameCommit: (row: TreeRow, name: string) => void
  onRenameCancel: () => void
}

function RowIcon({ row }: { row: TreeRow }): React.JSX.Element | null {
  if (row.kind === 'request') {
    return <Badge variant="hostContext">{row.method}</Badge>
  }
  const Icon = row.kind === 'collection' ? Library : Folder
  return <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
}

export default function CollectionTreeRow({
  row,
  selected,
  renaming,
  onToggle,
  onOpen,
  onAction,
  onRenameCommit,
  onRenameCancel
}: CollectionTreeRowProps): React.JSX.Element {
  const [draftName, setDraftName] = useState(row.name)
  const entries = buildRowMenuEntries(row)
  const isContainer = row.kind !== 'request'
  const expanded = row.kind !== 'request' && row.expanded

  const body = renaming ? (
    <Input
      autoFocus
      value={draftName}
      aria-label={translate('apiClient.tree.renameLabel', 'Name')}
      className="h-6"
      onChange={(event) => setDraftName(event.target.value)}
      onBlur={onRenameCancel}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          onRenameCommit(row, draftName)
        } else if (event.key === 'Escape') {
          onRenameCancel()
        }
      }}
    />
  ) : (
    <button
      type="button"
      className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
      onClick={() => (isContainer ? onToggle(row) : onOpen(row))}
      onDoubleClick={() => onAction(row, 'rename')}
    >
      {isContainer ? (
        expanded ? (
          <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
        )
      ) : null}
      <RowIcon row={row} />
      <span className="truncate text-[13px]">{row.name}</span>
    </button>
  )

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="treeitem"
          aria-level={row.depth + 1}
          aria-selected={selected}
          aria-expanded={row.kind === 'request' ? undefined : row.expanded}
          data-selected={selected ? 'true' : undefined}
          className="group flex h-7 items-center gap-1 rounded-md pr-1 hover:bg-accent data-[selected=true]:bg-accent"
          style={{ paddingLeft: BASE_PADDING_PX + row.depth * INDENT_PX }}
        >
          {body}
          {renaming ? null : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                {/* Why a wrapper: Button owns its effects, so the hover reveal lives on a plain element. */}
                <span className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={translate('apiClient.tree.moreActions', 'More actions')}
                  >
                    <Ellipsis />
                  </Button>
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {entries.map((entry) => (
                  <Fragment key={entry.action}>
                    {entry.separatorBefore ? <DropdownMenuSeparator /> : null}
                    <DropdownMenuItem
                      variant={entry.destructive ? 'destructive' : 'default'}
                      onSelect={() => onAction(row, entry.action)}
                    >
                      {entry.label}
                    </DropdownMenuItem>
                  </Fragment>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {entries.map((entry) => (
          <Fragment key={entry.action}>
            {entry.separatorBefore ? <ContextMenuSeparator /> : null}
            <ContextMenuItem
              variant={entry.destructive ? 'destructive' : 'default'}
              onSelect={() => onAction(row, entry.action)}
            >
              {entry.label}
            </ContextMenuItem>
          </Fragment>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  )
}
