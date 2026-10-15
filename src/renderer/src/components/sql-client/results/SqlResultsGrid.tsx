import { useCallback, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { translate } from '@/i18n/i18n'
import { selectionToTsv, type GridRange } from '../../../../../shared/sql-client/result-grid-tsv'
import type { SqlColumn } from '../../../../../shared/sql-client/sql-client-types'
import { clampColumnWidth, measureColumnWidths } from './grid-column-widths'
import ResultCell from './ResultCell'
import { useGridCopy } from './use-grid-copy'
import { useGridSelection, type GridCell } from './use-grid-selection'

const ROW_HEIGHT = 28
const HEADER_HEIGHT = 40
const GUTTER_PX = 52
const OVERSCAN = 12

type Props = {
  columns: SqlColumn[]
  rows: (string | null)[][]
}

/** Virtualized, read-only result grid; copying is by click, keyboard, or range. */
export default function SqlResultsGrid({ columns, rows }: Props): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [widths, setWidths] = useState(() => measureColumnWidths(columns, rows))
  const { copiedCell, announcement, copy } = useGridCopy()
  // Names can repeat (`select 1 as a, 2 as a`), so a column's position is part of its identity.
  const columnIds = useMemo(
    () => columns.map((column, position) => `${position}:${column.name}`),
    [columns]
  )
  const rowCount = rows.length
  const columnCount = columns.length

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN
  })

  const copyCell = useCallback(
    ({ row, col }: GridCell) =>
      copy(
        rows[row]?.[col] ?? '',
        `${row}:${col}`,
        translate('sqlClient.grid.copiedCell', 'Copied cell')
      ),
    [copy, rows]
  )
  const copyRange = useCallback(
    (range: GridRange) =>
      copy(
        selectionToTsv(columns, rows, range),
        null,
        translate('sqlClient.grid.copiedRange', 'Copied {{rows}} rows and {{columns}} columns', {
          rows: Math.abs(range.rowEnd - range.rowStart) + 1,
          columns: Math.abs(range.colEnd - range.colStart) + 1
        })
      ),
    [columns, copy, rows]
  )
  const moveDomFocus = useCallback(
    (cell: GridCell) => {
      virtualizer.scrollToIndex(cell.row)
      // The target row may not be mounted until the scroll lands.
      requestAnimationFrame(() => {
        scrollRef.current
          ?.querySelector<HTMLElement>(`[data-row="${cell.row}"][data-column="${cell.col}"]`)
          ?.focus()
      })
    },
    [virtualizer]
  )

  const selection = useGridSelection({
    rowCount,
    columnCount,
    onCopyCell: copyCell,
    onCopyRange: copyRange,
    onFocusChange: moveDomFocus
  })

  const { clickCell } = selection
  const handleCellSelect = useCallback(
    (row: number, col: number, extend: boolean) => clickCell({ row, col }, extend),
    [clickCell]
  )

  const gridTemplate = useMemo(
    () => `${GUTTER_PX}px ${widths.map((width) => `${width}px`).join(' ')}`,
    [widths]
  )

  const startResize = (event: React.MouseEvent, column: number): void => {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startWidth = widths[column]
    const onMove = (move: MouseEvent): void =>
      setWidths((current) =>
        current.map((width, index) =>
          index === column ? clampColumnWidth(startWidth + move.clientX - startX) : width
        )
      )
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto scrollbar-editor font-mono text-xs outline-none"
        role="grid"
        aria-rowcount={rowCount + 1}
        aria-colcount={columnCount + 1}
        aria-label={translate('sqlClient.grid.label', 'Query results')}
        tabIndex={selection.focus ? -1 : 0}
        onKeyDown={selection.onKeyDown}
        onFocus={(event) => {
          if (event.target === event.currentTarget && rowCount > 0) {
            selection.focusCell({ row: 0, col: 0 })
          }
        }}
      >
        <div className="inline-block min-w-full" style={{ width: 'max-content' }}>
          <div
            role="row"
            aria-rowindex={1}
            className="sticky top-0 z-10 grid bg-muted/90 backdrop-blur"
            style={{ gridTemplateColumns: gridTemplate, height: HEADER_HEIGHT }}
          >
            <div
              role="columnheader"
              className="sticky left-0 z-20 flex items-center justify-end border-b border-r border-border/60 bg-muted px-2 text-[10px] text-muted-foreground"
            >
              #
            </div>
            {columnIds.map((columnId, index) => (
              <div
                key={columnId}
                role="columnheader"
                onClick={(event) => selection.selectColumn(index, event.shiftKey)}
                className="relative flex cursor-pointer flex-col justify-center overflow-hidden border-b border-r border-border/60 px-2"
              >
                <span className="truncate font-medium text-foreground">{columns[index].name}</span>
                <span className="truncate text-[10px] text-muted-foreground">
                  {columns[index].dataTypeName}
                </span>
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 right-0 w-1.5 cursor-col-resize hover:bg-ring/50"
                  onMouseDown={(event) => startResize(event, index)}
                  onClick={(event) => event.stopPropagation()}
                />
              </div>
            ))}
          </div>
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((item) => (
              <div
                key={item.key}
                role="row"
                aria-rowindex={item.index + 2}
                className="absolute left-0 grid border-b border-border/40 bg-background"
                style={{
                  top: item.start,
                  height: ROW_HEIGHT,
                  gridTemplateColumns: gridTemplate
                }}
              >
                <div
                  role="rowheader"
                  onClick={(event) => selection.selectRow(item.index, event.shiftKey)}
                  className="sticky left-0 z-[5] flex cursor-pointer items-center justify-end border-r border-border/60 bg-muted px-2 text-[10px] text-muted-foreground"
                >
                  {item.index + 1}
                </div>
                {columns.map((_column, col) => (
                  <ResultCell
                    key={col}
                    value={rows[item.index]?.[col] ?? null}
                    width={widths[col]}
                    rowIndex={item.index}
                    columnIndex={col}
                    selected={selection.isSelected(item.index, col)}
                    focused={selection.focus?.row === item.index && selection.focus.col === col}
                    copied={copiedCell === `${item.index}:${col}`}
                    onSelect={handleCellSelect}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  )
}
