import { describe, expect, it } from 'vitest'
import { toRelativeImageLink } from './evidence-markdown-text'

describe('toRelativeImageLink', () => {
  it('links per-case paths with forward slashes and no forced prefix', () => {
    expect(toRelativeImageLink('SC-1\\SC-1-request.png')).toBe('SC-1/SC-1-request.png')
    expect(toRelativeImageLink('./SC-1/SC-1-request.png')).toBe('SC-1/SC-1-request.png')
  })

  it('keeps legacy images/ links from older runs intact', () => {
    expect(toRelativeImageLink('images/03-sc-1-request.png')).toBe('images/03-sc-1-request.png')
  })
})
