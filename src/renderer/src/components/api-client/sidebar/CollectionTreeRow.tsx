import { Fragment, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Database,
  Ellipsis,
  Folder,
  Library,
  Unlink
} from 'lucide-react'
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
import { buildRowMenuEntries, type RowAction, type TestMapMenuState } from './collection-tree-menu'
import type { TreeRow } from './collection-tree-rows'
import type { RequestTestMapMarker } from './test-map-markers'

const INDENT_PX = 12
const BASE_PADDING_PX = 8

type CollectionTreeRowProps = {
  row: TreeRow
  selected: boolean
  renaming: boolean
  testMapState?: TestMapMenuState
  hasUncleanedCaptures?: boolean
  testMapMarker?: RequestTestMapMarker
  brokenLinkCount?: number
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

function TestMapIndicator({
  marker,
  brokenLinkCount
}: {
  marker?: RequestTestMapMarker
  brokenLinkCount: number
}): React.JSX.Element | null {
  if (marker === 'has-queries') {
    const label = translate('apiClient.testMap.hasQueries', 'Has verification queries')
    return <Database className="size-3 shrink-0 text-muted-foreground" aria-label={label} />
  }
  if (marker === 'broken' || brokenLinkCount > 0) {
    const label =
      marker === 'broken'
        ? translate('apiClient.testMap.brokenLink', 'Test map link broken: request was deleted')
        : translate(
            'apiClient.testMap.brokenLinks',
            '{{count}} test map entries point to deleted requests',
            { count: brokenLinkCount }
          )
    return <Unlink className="size-3 shrink-0 text-destructive" aria-label={label} />
  }
  return null
}

export default function CollectionTreeRow({
  row,
  selected,
  renaming,
  testMapState = 'unavailable',
  hasUncleanedCaptures = false,
  testMapMarker,
  brokenLinkCount = 0,
  onToggle,
  onOpen,
  onAction,
  onRenameCommit,
  onRenameCancel
}: CollectionTreeRowProps): React.JSX.Element {
  const [draftName, setDraftName] = useState(row.name)
  const entries = buildRowMenuEntries(row, testMapState, hasUncleanedCaptures)
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
      <TestMapIndicator marker={testMapMarker} brokenLinkCount={brokenLinkCount} />
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
