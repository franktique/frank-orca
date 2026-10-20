import { useCallback, useState } from 'react'
import type { GridRange } from '../../../../../shared/sql-client/result-grid-tsv'

export type GridCell = { row: number; col: number }

type Bounds = { rowCount: number; columnCount: number }

const clamp = (value: number, max: number): number => Math.min(Math.max(value, 0), max)

const isMac = (): boolean => navigator.userAgent.includes('Mac')

/** Where an arrow, Home or End key moves the focused cell; null for any other key. */
export function moveFocus(key: string, from: GridCell, bounds: Bounds): GridCell | null {
  const lastRow = bounds.rowCount - 1
  const lastCol = bounds.columnCount - 1
  switch (key) {
    case 'ArrowUp':
      return { row: clamp(from.row - 1, lastRow), col: from.col }
    case 'ArrowDown':
      return { row: clamp(from.row + 1, lastRow), col: from.col }
    case 'ArrowLeft':
      return { row: from.row, col: clamp(from.col - 1, lastCol) }
    case 'ArrowRight':
      return { row: from.row, col: clamp(from.col + 1, lastCol) }
    case 'Home':
      return { row: from.row, col: 0 }
    case 'End':
      return { row: from.row, col: lastCol }
    default:
      return null
  }
}

export function toRange(anchor: GridCell, focus: GridCell): GridRange {
  return {
    rowStart: Math.min(anchor.row, focus.row),
    rowEnd: Math.max(anchor.row, focus.row),
    colStart: Math.min(anchor.col, focus.col),
    colEnd: Math.max(anchor.col, focus.col)
  }
}

type Options = Bounds & {
  onCopyCell: (cell: GridCell) => void
  onCopyRange: (range: GridRange) => void
  /** Called after the focus moves, so the grid can scroll the cell into view. */
  onFocusChange?: (cell: GridCell) => void
}

/** Focus, rectangular range, row and column selection, and the roving-tabindex key model. */
export function useGridSelection({
  rowCount,
  columnCount,
  onCopyCell,
  onCopyRange,
  onFocusChange
}: Options) {
  const [focus, setFocus] = useState<GridCell | null>(null)
  const [anchor, setAnchor] = useState<GridCell | null>(null)
  const [range, setRange] = useState<GridRange | null>(null)

  const place = useCallback(
    (next: GridCell, extend: boolean) => {
      const from = extend && anchor ? anchor : next
      setAnchor(from)
      setFocus(next)
      setRange(extend ? toRange(from, next) : null)
      onFocusChange?.(next)
    },
    [anchor, onFocusChange]
  )

  const clickCell = useCallback(
    (cell: GridCell, extend: boolean) => {
      place(cell, extend)
      if (!extend) {
        onCopyCell(cell)
      }
    },
    [onCopyCell, place]
  )

  const selectRow = useCallback(
    (row: number, extend: boolean) => {
      const from = extend && anchor ? anchor.row : row
      setAnchor({ row: from, col: 0 })
      setFocus({ row, col: 0 })
      setRange({
        rowStart: Math.min(from, row),
        rowEnd: Math.max(from, row),
        colStart: 0,
        colEnd: columnCount - 1
      })
    },
    [anchor, columnCount]
  )

  const selectColumn = useCallback(
    (col: number, extend: boolean) => {
      const from = extend && anchor ? anchor.col : col
      setAnchor({ row: 0, col: from })
      setFocus({ row: 0, col })
      setRange({
        rowStart: 0,
        rowEnd: rowCount - 1,
        colStart: Math.min(from, col),
        colEnd: Math.max(from, col)
      })
    },
    [anchor, rowCount]
  )

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (rowCount === 0 || columnCount === 0) {
        return
      }
      const current = focus ?? { row: 0, col: 0 }
      const modifier = isMac() ? event.metaKey : event.ctrlKey
      if (modifier && event.key.toLowerCase() === 'c') {
        event.preventDefault()
        if (range) {
          onCopyRange(range)
        } else {
          onCopyCell(current)
        }
        return
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        onCopyCell(current)
        return
      }
      const next = moveFocus(event.key, current, { rowCount, columnCount })
      if (next) {
        event.preventDefault()
        place(next, event.shiftKey)
      }
    },
    [columnCount, focus, onCopyCell, onCopyRange, place, range, rowCount]
  )

  const isSelected = useCallback(
    (row: number, col: number): boolean =>
      range
        ? row >= range.rowStart &&
          row <= range.rowEnd &&
          col >= range.colStart &&
          col <= range.colEnd
        : focus?.row === row && focus.col === col,
    [focus, range]
  )

  const reset = useCallback(() => {
    setFocus(null)
    setAnchor(null)
    setRange(null)
  }, [])

  const focusCell = useCallback((cell: GridCell) => place(cell, false), [place])

  return {
    focus,
    range,
    isSelected,
    clickCell,
    focusCell,
    selectRow,
    selectColumn,
    onKeyDown,
    reset
  }
}
