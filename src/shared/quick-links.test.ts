import { describe, expect, it } from 'vitest'
import {
  applyQuickLinkMutation,
  MAX_QUICK_LINKS,
  normalizeQuickLinks,
  normalizeQuickLinkUrl
} from './quick-links'
import type { QuickLink } from './quick-link-types'

const link = (over: Partial<QuickLink> = {}): QuickLink => ({
  id: 'quick-link-1',
  label: 'Docs',
  url: 'https://example.com/',
  ...over
})

describe('normalizeQuickLinkUrl', () => {
  it('keeps http and https URLs', () => {
    expect(normalizeQuickLinkUrl(' https://example.com/a?b=1 ')).toBe('https://example.com/a?b=1')
    expect(normalizeQuickLinkUrl('http://localhost:3000')).toBe('http://localhost:3000/')
  })

  it('assumes https when no scheme is given', () => {
    expect(normalizeQuickLinkUrl('example.com/path')).toBe('https://example.com/path')
    expect(normalizeQuickLinkUrl('localhost:3000')).toBe('https://localhost:3000/')
  })

  it('rejects non-web schemes and garbage', () => {
    expect(normalizeQuickLinkUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeQuickLinkUrl('file:///etc/passwd')).toBeNull()
    expect(normalizeQuickLinkUrl('mailto:a@b.com')).toBeNull()
    expect(normalizeQuickLinkUrl('   ')).toBeNull()
    expect(normalizeQuickLinkUrl('http://')).toBeNull()
  })
})

describe('normalizeQuickLinks', () => {
  it('returns [] for non-arrays', () => {
    expect(normalizeQuickLinks(undefined)).toEqual([])
    expect(normalizeQuickLinks('nope')).toEqual([])
  })

  it('drops entries without a usable URL and falls back to the URL as label', () => {
    expect(
      normalizeQuickLinks([
        1,
        null,
        { id: 'a', label: 'x' },
        { id: 'b', url: 'javascript:void(0)' }
      ])
    ).toEqual([])
    expect(normalizeQuickLinks([{ id: 'c', url: 'example.com' }])).toEqual([
      { id: 'c', label: 'https://example.com/', url: 'https://example.com/' }
    ])
  })

  it('dedupes ids and caps the list', () => {
    const out = normalizeQuickLinks([link(), link()])
    expect(out.map((l) => l.id)).toEqual(['quick-link-1', 'quick-link-1-2'])
    const many = Array.from({ length: MAX_QUICK_LINKS + 5 }, (_, i) => link({ id: `l${i}` }))
    expect(normalizeQuickLinks(many)).toHaveLength(MAX_QUICK_LINKS)
  })
})

describe('applyQuickLinkMutation', () => {
  it('appends, replaces, and deletes', () => {
    const added = applyQuickLinkMutation([], { type: 'upsert', link: link() })
    expect(added).toEqual([link()])
    const edited = applyQuickLinkMutation(added, { type: 'upsert', link: link({ label: 'New' }) })
    expect(edited).toEqual([link({ label: 'New' })])
    expect(applyQuickLinkMutation(edited, { type: 'delete', id: 'quick-link-1' })).toEqual([])
  })
})
