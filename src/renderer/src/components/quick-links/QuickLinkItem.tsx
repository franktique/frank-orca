import type { MouseEvent, PointerEvent } from 'react'
import { ChevronDown, ChevronRight, ExternalLink, Globe, Link, Pencil, Trash2 } from 'lucide-react'
import { CommandItem } from '@/components/ui/command'
import type { QuickLink } from '../../../../shared/quick-link-types'
import { httpLinkDestinationLabel, type HttpLinkDestination } from '@/lib/http-link-destinations'
import { translate } from '@/i18n/i18n'

type QuickLinkItemProps = {
  link: QuickLink
  expanded: boolean
  destinations: readonly HttpLinkDestination[]
  onToggle: () => void
  onOpen: (destination: HttpLinkDestination) => void
  onEdit: () => void
  onDelete: () => void
}

function stopRowSelect(event: MouseEvent | PointerEvent): void {
  // Why: cmdk selects the parent CommandItem on click; nested actions must not toggle the row.
  event.preventDefault()
  event.stopPropagation()
}

export function QuickLinkItem({
  link,
  expanded,
  destinations,
  onToggle,
  onOpen,
  onEdit,
  onDelete
}: QuickLinkItemProps): React.JSX.Element {
  const Chevron = expanded ? ChevronDown : ChevronRight
  return (
    <>
      <CommandItem
        value={link.id}
        onSelect={onToggle}
        aria-expanded={expanded}
        className="group/ql mx-1 cursor-pointer"
      >
        <Link className="size-3 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-foreground">{link.label}</span>
          <span className="block truncate font-mono text-[11px] text-muted-foreground">
            {link.url}
          </span>
        </span>
        <span
          role="group"
          aria-label={translate(
            'auto.components.quick.links.QuickLinkItem.actions',
            'Quick link actions'
          )}
          className="flex shrink-0 items-center gap-0.5 can-hover:opacity-0 transition-opacity group-hover/ql:opacity-100 group-data-[selected=true]/ql:opacity-100"
        >
          <button
            type="button"
            onPointerDown={stopRowSelect}
            onClick={(event) => {
              stopRowSelect(event)
              onEdit()
            }}
            className="cursor-pointer rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={translate(
              'auto.components.quick.links.QuickLinkItem.edit',
              'Edit {{value0}}',
              { value0: link.label }
            )}
          >
            <Pencil className="size-3" />
          </button>
          <button
            type="button"
            onPointerDown={stopRowSelect}
            onClick={(event) => {
              stopRowSelect(event)
              onDelete()
            }}
            className="cursor-pointer rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
            aria-label={translate(
              'auto.components.quick.links.QuickLinkItem.remove',
              'Remove {{value0}}',
              { value0: link.label }
            )}
          >
            <Trash2 className="size-3" />
          </button>
        </span>
        <Chevron className="size-3 shrink-0 text-muted-foreground" />
      </CommandItem>
      {expanded
        ? destinations.map((destination) => {
            const Icon = destination === 'orca' ? Globe : ExternalLink
            return (
              <CommandItem
                key={destination}
                value={`${link.id}::${destination}`}
                onSelect={() => onOpen(destination)}
                className="mx-1 ml-6 cursor-pointer"
              >
                <Icon className="size-3.5 shrink-0" />
                {httpLinkDestinationLabel(destination)}
              </CommandItem>
            )
          })
        : null}
    </>
  )
}
