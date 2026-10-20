import type { SqlColumn } from './sql-client-types'

export type GridRange = { rowStart: number; rowEnd: number; colStart: number; colEnd: number }

const NEEDS_QUOTING = /[\t\n\r"]/

function field(value: string | null): string {
  if (value === null) {
    return ''
  }
  return NEEDS_QUOTING.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

/**
 * A single cell copies its value as stored; a larger range copies a TSV with the column names on
 * the first row, so it pastes straight into a spreadsheet.
 */
export function selectionToTsv(
  columns: readonly SqlColumn[],
  rows: readonly (readonly (string | null)[])[],
  range: GridRange
): string {
  const rowStart = Math.min(range.rowStart, range.rowEnd)
  const rowEnd = Math.max(range.rowStart, range.rowEnd)
  const colStart = Math.min(range.colStart, range.colEnd)
  const colEnd = Math.max(range.colStart, range.colEnd)
  if (rowStart === rowEnd && colStart === colEnd) {
    return rows[rowStart]?.[colStart] ?? ''
  }
  const lines = [
    columns
      .slice(colStart, colEnd + 1)
      .map((column) => field(column.name))
      .join('\t')
  ]
  for (let row = rowStart; row <= rowEnd; row++) {
    lines.push(
      (rows[row] ?? [])
        .slice(colStart, colEnd + 1)
        .map(field)
        .join('\t')
    )
  }
  return lines.join('\n')
}
