import { memo } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'

const TOOLTIP_CHARS = 2000
const CHAR_PX = 7
const CELL_PADDING_PX = 16

type ResultCellProps = {
  value: string | null
  width: number
  rowIndex: number
  columnIndex: number
  selected: boolean
  focused: boolean
  copied: boolean
  /** Stable across renders so unchanged cells skip re-rendering while scrolling. */
  onSelect: (row: number, col: number, extend: boolean) => void
}

/** One data cell. NULL is a token of its own, so it never reads as the text "NULL". */
function ResultCellInner({
  value,
  width,
  rowIndex,
  columnIndex,
  selected,
  focused,
  copied,
  onSelect
}: ResultCellProps): React.JSX.Element {
  const content =
    value === null ? (
      <span className="italic text-muted-foreground">
        {translate('sqlClient.grid.null', 'NULL')}
      </span>
    ) : (
      <span className="truncate">{value}</span>
    )
  const cell = (
    <div
      role="gridcell"
      tabIndex={focused ? 0 : -1}
      aria-selected={selected}
      data-row={rowIndex}
      data-column={columnIndex}
      data-copied={copied ? 'true' : undefined}
      onClick={(event) => onSelect(rowIndex, columnIndex, event.shiftKey)}
      className={cn(
        'flex h-full cursor-pointer items-center overflow-hidden whitespace-pre border-r border-border/60 px-2 outline-none',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        selected && 'bg-accent',
        copied && 'bg-status-success-background'
      )}
      style={{ width }}
    >
      {content}
    </div>
  )
  // Only a value that cannot fit needs the full text on hover.
  if (value === null || value.length * CHAR_PX <= width - CELL_PADDING_PX) {
    return cell
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>{cell}</TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-md break-words whitespace-pre-wrap">
        <span className="font-mono">
          {value.length > TOOLTIP_CHARS ? `${value.slice(0, TOOLTIP_CHARS)}…` : value}
        </span>
      </TooltipContent>
    </Tooltip>
  )
}

const ResultCell = memo(ResultCellInner)
export default ResultCell
