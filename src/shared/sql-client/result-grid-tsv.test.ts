import { describe, expect, it } from 'vitest'
import { selectionToTsv } from './result-grid-tsv'
import type { SqlColumn } from './sql-client-types'

const columns: SqlColumn[] = [
  { name: 'id', dataTypeId: 23, dataTypeName: 'integer' },
  { name: 'note', dataTypeId: 25, dataTypeName: 'text' },
  { name: 'flag', dataTypeId: 16, dataTypeName: 'boolean' }
]
const rows: (string | null)[][] = [
  ['1', 'plain', 't'],
  ['2', null, 'f'],
  ['3', 'a\tb', null],
  ['4', 'line1\nline2', 't'],
  ['5', 'say "hi"', 'f']
]

describe('selectionToTsv', () => {
  it('puts the header row first for a range', () => {
    expect(selectionToTsv(columns, rows, { rowStart: 0, rowEnd: 1, colStart: 0, colEnd: 2 })).toBe(
      'id\tnote\tflag\n1\tplain\tt\n2\t\tf'
    )
  })

  it('writes NULL as an empty field, not the text NULL', () => {
    const tsv = selectionToTsv(columns, rows, { rowStart: 1, rowEnd: 1, colStart: 1, colEnd: 2 })
    expect(tsv).toBe('note\tflag\n\tf')
  })

  it('quotes values containing a tab, newline or double quote', () => {
    expect(selectionToTsv(columns, rows, { rowStart: 2, rowEnd: 4, colStart: 1, colEnd: 1 })).toBe(
      'note\n"a\tb"\n"line1\nline2"\n"say ""hi"""'
    )
  })

  it('selects a whole row or a whole column', () => {
    expect(selectionToTsv(columns, rows, { rowStart: 0, rowEnd: 0, colStart: 0, colEnd: 2 })).toBe(
      'id\tnote\tflag\n1\tplain\tt'
    )
    expect(selectionToTsv(columns, rows, { rowStart: 0, rowEnd: 4, colStart: 0, colEnd: 0 })).toBe(
      'id\n1\n2\n3\n4\n5'
    )
  })

  it('returns the bare value for a single cell, untouched', () => {
    expect(selectionToTsv(columns, rows, { rowStart: 3, rowEnd: 3, colStart: 1, colEnd: 1 })).toBe(
      'line1\nline2'
    )
    expect(selectionToTsv(columns, rows, { rowStart: 1, rowEnd: 1, colStart: 1, colEnd: 1 })).toBe(
      ''
    )
  })

  it('normalizes a reversed range', () => {
    expect(selectionToTsv(columns, rows, { rowStart: 1, rowEnd: 0, colStart: 1, colEnd: 0 })).toBe(
      'id\tnote\n1\tplain\n2\t'
    )
  })
})
