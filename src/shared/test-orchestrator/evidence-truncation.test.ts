import { describe, expect, it } from 'vitest'
import { truncateBody, truncateRows } from './evidence-truncation'

describe('truncateBody', () => {
  it('leaves small bodies alone', () => {
    expect(truncateBody('hello')).toEqual({ text: 'hello', note: null })
  })

  it('cuts at 100 KB with a size note', () => {
    const result = truncateBody('a'.repeat(2.4 * 1024 * 1024))
    expect(new TextEncoder().encode(result.text).length).toBe(100 * 1024)
    expect(result.note).toBe('> Truncated: showing 100 KB of 2.4 MB.')
  })

  it('never splits a multi-byte code point', () => {
    const result = truncateBody('€'.repeat(10), 10)
    expect(result.text).toBe('€€€')
    expect(result.text).not.toContain('�')
  })
})

describe('truncateRows', () => {
  it('keeps up to 200 rows', () => {
    expect(truncateRows([1, 2, 3])).toEqual({ rows: [1, 2, 3], note: null })
  })

  it('cuts with a row-count note using the known total', () => {
    const rows = Array.from({ length: 300 }, (_, i) => i)
    const result = truncateRows(rows, 1532)
    expect(result.rows).toHaveLength(200)
    expect(result.note).toBe('> Truncated: showing 200 of 1,532 rows.')
  })
})
