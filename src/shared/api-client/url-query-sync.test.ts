import { describe, expect, it } from 'vitest'
import { applyQueryRows, applyRawUrl } from './url-query-sync'

const row = (key: string, value: string, enabled = true) => ({ key, value, enabled })

describe('applyQueryRows', () => {
  it('rebuilds the query string from enabled rows and keeps the hash', () => {
    const url = applyQueryRows({ raw: 'http://x/a?old=1#frag', query: [] }, [
      row('a', '1'),
      row('b', '2', false),
      row('c', '3')
    ])
    expect(url.raw).toBe('http://x/a?a=1&c=3#frag')
    expect(url.query).toHaveLength(3)
  })

  it('drops the question mark when no row is enabled', () => {
    expect(applyQueryRows({ raw: 'http://x/a?a=1', query: [] }, [row('a', '1', false)]).raw).toBe(
      'http://x/a'
    )
  })

  it('leaves {{variables}} in the base untouched', () => {
    expect(
      applyQueryRows({ raw: '{{baseUrl}}/items', query: [] }, [row('q', '{{term}}')]).raw
    ).toBe('{{baseUrl}}/items?q={{term}}')
  })
})

describe('applyRawUrl', () => {
  it('refreshes enabled rows from the typed URL and keeps disabled rows in place', () => {
    const url = applyRawUrl(
      { raw: 'http://x?a=1&c=3', query: [row('a', '1'), row('off', 'z', false), row('c', '3')] },
      'http://x?a=9&c=3&d=4'
    )
    expect(url.query.map((r) => [r.key, r.value, r.enabled])).toEqual([
      ['a', '9', true],
      ['off', 'z', false],
      ['c', '3', true],
      ['d', '4', true]
    ])
  })

  it('removes enabled rows that are gone from the URL', () => {
    const url = applyRawUrl(
      { raw: 'http://x?a=1&b=2', query: [row('a', '1'), row('b', '2')] },
      'http://x?a=1'
    )
    expect(url.query.map((r) => r.key)).toEqual(['a'])
  })

  it('round-trips with applyQueryRows', () => {
    const edited = applyQueryRows({ raw: 'http://x', query: [] }, [row('k', 'v')])
    expect(applyRawUrl(edited, edited.raw).query).toMatchObject([{ key: 'k', value: 'v' }])
  })
})
