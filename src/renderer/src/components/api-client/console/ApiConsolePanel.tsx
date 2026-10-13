import { useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { ConsoleEntry } from '../../../../../shared/api-client/api-client-types'
import ConsoleEntryRow from './ConsoleEntryRow'

const MIN_HEIGHT_PX = 80
const MAX_HEIGHT_PX = 600
const ROW_ESTIMATE_PX = 28

type ApiConsolePanelProps = {
  entries: readonly ConsoleEntry[]
  collapsed: boolean
  height: number
  onCollapsedChange: (collapsed: boolean) => void
  onHeightChange: (height: number) => void
  onClear: () => void
}

/** Vertical drag handle on the console's top edge. */
function ResizeHandle({
  height,
  onHeightChange
}: {
  height: number
  onHeightChange: (height: number) => void
}): React.JSX.Element {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={translate('apiClient.console.resize', 'Resize console')}
      className="group flex h-2 cursor-row-resize items-center justify-center"
      onMouseDown={(event) => {
        event.preventDefault()
        const startY = event.clientY
        const startHeight = height
        const onMove = (move: MouseEvent): void =>
          onHeightChange(
            Math.min(MAX_HEIGHT_PX, Math.max(MIN_HEIGHT_PX, startHeight + (startY - move.clientY)))
          )
        const onUp = (): void => {
          window.removeEventListener('mousemove', onMove)
          window.removeEventListener('mouseup', onUp)
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
      }}
    >
      <div className="h-px w-full bg-border transition-colors group-hover:bg-ring/50" />
    </div>
  )
}

export default function ApiConsolePanel({
  entries,
  collapsed,
  height,
  onCollapsedChange,
  onHeightChange,
  onClear
}: ApiConsolePanelProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE_PX,
    overscan: 8
  })

  // Newest entries sit at the bottom, so follow them as they arrive.
  useEffect(() => {
    if (!collapsed && entries.length > 0) {
      virtualizer.scrollToIndex(entries.length - 1, { align: 'end' })
    }
  }, [collapsed, entries.length, virtualizer])

  return (
    <section
      aria-label={translate('apiClient.console.title', 'Console')}
      className="flex shrink-0 flex-col border-t border-border"
      // Collapsed, the console gives its space back to the request and response.
      style={collapsed ? undefined : { height }}
    >
      {collapsed ? null : <ResizeHandle height={height} onHeightChange={onHeightChange} />}
      <div className="flex items-center justify-between gap-2 px-2 py-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {translate('apiClient.console.title', 'Console')} ({entries.length})
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={translate('apiClient.console.clear', 'Clear console')}
            disabled={entries.length === 0}
            onClick={onClear}
          >
            <Trash2 />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-expanded={!collapsed}
            aria-label={
              collapsed
                ? translate('apiClient.console.expand', 'Expand console')
                : translate('apiClient.console.collapse', 'Collapse console')
            }
            onClick={() => onCollapsedChange(!collapsed)}
          >
            {collapsed ? <ChevronUp /> : <ChevronDown />}
          </Button>
        </div>
      </div>
      {collapsed ? null : entries.length === 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          {translate('apiClient.console.empty', 'Requests you send appear here.')}
        </p>
      ) : (
        <div ref={scrollRef} className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto">
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => (
              <div
                key={entries[item.index].id}
                ref={virtualizer.measureElement}
                data-index={item.index}
                className="absolute left-0 w-full"
                style={{ top: item.start }}
              >
                <ConsoleEntryRow
                  entry={entries[item.index]}
                  onToggle={() => virtualizer.measure()}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
