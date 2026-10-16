import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Plus } from 'lucide-react'
import { Command, CommandEmpty, CommandInput, CommandList } from '@/components/ui/command'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { QuickLink } from '../../../../shared/quick-link-types'
import type { HttpLinkDestination } from '@/lib/http-link-destinations'
import { translate } from '@/i18n/i18n'
import { searchQuickLinks } from './quick-link-search'
import { QuickLinkItem } from './QuickLinkItem'

type QuickLinksMenuProps = {
  links: readonly QuickLink[]
  destinations: readonly HttpLinkDestination[]
  onOpenLink: (link: QuickLink, destination: HttpLinkDestination) => void
  onAddLink: () => void
  onEditLink: (link: QuickLink) => void
  onDeleteLink: (link: QuickLink) => void
}

export function QuickLinksMenu({
  links,
  destinations,
  onOpenLink,
  onAddLink,
  onEditLink,
  onDeleteLink
}: QuickLinksMenuProps): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [highlighted, setHighlighted] = useState('')
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const showSearch = links.length > 1

  const filtered = useMemo(() => searchQuickLinks(links, query), [links, query])

  useEffect(() => {
    if (!menuOpen) {
      setQuery('')
      setExpandedId(null)
    }
  }, [menuOpen])

  useEffect(() => {
    if (!menuOpen || !showSearch) {
      return undefined
    }
    // Why: cmdk needs the input focused so arrow keys and Enter drive the list.
    const frame = requestAnimationFrame(() => searchInputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [menuOpen, showSearch])

  const runAndClose = (action: () => void): void => {
    setMenuOpen(false)
    action()
  }

  const toggle = (link: QuickLink): void => {
    const next = expandedId === link.id ? null : link.id
    setExpandedId(next)
    // Why: land keyboard focus on the preferred destination so a second Enter opens it.
    setHighlighted(next && destinations[0] ? `${link.id}::${destinations[0]}` : link.id)
  }

  const label = translate('auto.components.quick.links.QuickLinksMenu.label', 'Quick links')

  return (
    <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button type="button" className="sidebar-toggle" aria-label={label}>
              <Link size={16} />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {label}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" side="bottom" sideOffset={6} className="w-80">
        <Command
          shouldFilter={false}
          loop
          value={highlighted || (filtered[0]?.id ?? '')}
          onValueChange={setHighlighted}
        >
          {showSearch ? (
            <CommandInput
              ref={searchInputRef}
              autoFocus
              placeholder={translate(
                'auto.components.quick.links.QuickLinksMenu.searchPlaceholder',
                'Search quick links...'
              )}
              value={query}
              onValueChange={(next) => {
                setQuery(next)
                setExpandedId(null)
                setHighlighted('')
              }}
            />
          ) : null}
          <CommandList className="max-h-72">
            {filtered.length === 0 ? (
              <CommandEmpty>
                {query.trim()
                  ? translate(
                      'auto.components.quick.links.QuickLinksMenu.noMatch',
                      'No links match'
                    )
                  : translate('auto.components.quick.links.QuickLinksMenu.empty', 'No links')}
              </CommandEmpty>
            ) : null}
            {filtered.map((link) => (
              <QuickLinkItem
                key={link.id}
                link={link}
                expanded={expandedId === link.id}
                destinations={destinations}
                onToggle={() => toggle(link)}
                onOpen={(destination) => runAndClose(() => onOpenLink(link, destination))}
                onEdit={() => runAndClose(() => onEditLink(link))}
                onDelete={() => runAndClose(() => onDeleteLink(link))}
              />
            ))}
          </CommandList>
          <div className="border-t border-border/50 p-1">
            <button
              type="button"
              onClick={() => runAndClose(onAddLink)}
              className="flex w-full cursor-pointer items-center gap-2 rounded-[5px] px-2 py-1.5 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <Plus className="size-3.5" />
              {translate('auto.components.quick.links.QuickLinksMenu.add', 'Link')}
            </button>
          </div>
        </Command>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
