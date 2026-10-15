import { describe, expect, it } from 'vitest'
import {
  clampColumnWidth,
  GRID_MAX_COLUMN_PX,
  GRID_MIN_COLUMN_PX,
  measureColumnWidths
} from './grid-column-widths'

const column = (name: string, dataTypeName = 'text') => ({ name, dataTypeId: 25, dataTypeName })

describe('measureColumnWidths', () => {
  it('never goes below the minimum or above the maximum', () => {
    const widths = measureColumnWidths([column('a', 'int'), column('b')], [['1', 'x'.repeat(5000)]])
    expect(widths[0]).toBe(GRID_MIN_COLUMN_PX)
    expect(widths[1]).toBeLessThanOrEqual(GRID_MAX_COLUMN_PX)
  })

  it('widens a column for a long header and ignores rows past the sample', () => {
    const rows = Array.from({ length: 200 }, (_unused, index) => [
      index === 150 ? 'y'.repeat(60) : 'z'
    ])
    const [width] = measureColumnWidths([column('a_rather_long_column_name')], rows)
    expect(width).toBeGreaterThan(GRID_MIN_COLUMN_PX)
    expect(width).toBe(measureColumnWidths([column('a_rather_long_column_name')], [['z']])[0])
  })

  it('treats NULL cells as empty', () => {
    expect(measureColumnWidths([column('id', 'int')], [[null]])).toEqual([GRID_MIN_COLUMN_PX])
  })

  it('clamps user resizing', () => {
    expect(clampColumnWidth(10)).toBe(GRID_MIN_COLUMN_PX)
    expect(clampColumnWidth(9999)).toBe(GRID_MAX_COLUMN_PX)
    expect(clampColumnWidth(200)).toBe(200)
  })
})
