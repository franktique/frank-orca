import type { SqlColumn } from '../../../../../shared/sql-client/sql-client-types'

export const GRID_MIN_COLUMN_PX = 80
export const GRID_MAX_COLUMN_PX = 480
const CHAR_PX = 7
const CELL_PADDING_PX = 24
const SAMPLE_ROWS = 100
const SAMPLE_CELL_CHARS = 80

const clamp = (width: number): number =>
  Math.min(GRID_MAX_COLUMN_PX, Math.max(GRID_MIN_COLUMN_PX, width))

/** Sizes each column to its header and the first 100 rows, so a huge cell cannot widen it. */
export function measureColumnWidths(
  columns: readonly SqlColumn[],
  rows: readonly (readonly (string | null)[])[]
): number[] {
  const sample = rows.slice(0, SAMPLE_ROWS)
  return columns.map((column, index) => {
    let chars = Math.max(column.name.length, column.dataTypeName.length)
    for (const row of sample) {
      const cell = row[index]
      if (cell !== null && cell !== undefined) {
        chars = Math.max(chars, Math.min(cell.length, SAMPLE_CELL_CHARS))
      }
    }
    return clamp(chars * CHAR_PX + CELL_PADDING_PX)
  })
}

export function clampColumnWidth(width: number): number {
  return clamp(width)
}
