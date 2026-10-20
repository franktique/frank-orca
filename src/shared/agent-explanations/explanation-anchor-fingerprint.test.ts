import { describe, expect, it } from 'vitest'
import {
  captureFingerprint,
  hashSideContent,
  relocateAnchor
} from './explanation-anchor-fingerprint'
import type { LineAnchor } from './explanation-types'

function anchorFor(
  sideLines: string[],
  startLine: number,
  endLine: number,
  side: 'new' | 'old' = 'new'
): LineAnchor {
  return {
    side,
    startLine,
    endLine,
    fingerprint: captureFingerprint(sideLines, startLine, endLine)
  }
}

describe('captureFingerprint', () => {
  it('captures anchored lines plus up to 2 context lines, trailing whitespace trimmed', () => {
    const lines = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    const fp = captureFingerprint(lines, 3, 4)
    expect(fp.lines).toEqual(['c', 'd'])
    expect(fp.before).toEqual(['a', 'b'])
    expect(fp.after).toEqual(['e', 'f'])
  })

  it('clips context at the file edges', () => {
    const lines = ['x', 'y']
    const fp = captureFingerprint(lines, 2, 2)
    expect(fp.before).toEqual(['x'])
    expect(fp.after).toEqual([])
  })
})

describe('hashSideContent', () => {
  it('normalizes line endings and includes the line count', () => {
    expect(hashSideContent('a\nb')).toBe(hashSideContent('a\r\nb'))
    expect(hashSideContent('a\nb')).not.toBe(hashSideContent('a\nb\nc'))
    expect(hashSideContent('a\nb')).toMatch(/^fnv1a:[0-9a-f]{8}:2$/)
  })
})

describe('relocateAnchor', () => {
  const original = ['one', 'two', 'three', 'four', 'five', 'six']

  it('is fresh when content is unchanged', () => {
    const anchor = anchorFor(original, 3, 4)
    expect(relocateAnchor(anchor, 'one\ntwo\nthree\nfour\nfive\nsix')).toEqual({
      state: 'fresh',
      line: 3,
      endLine: 4
    })
  })

  it('uses the diffIdentity fast path before scanning', () => {
    const anchor = anchorFor(original, 3, 4)
    anchor.fingerprint.diffIdentity = hashSideContent('ignored — identity wins')
    const result = relocateAnchor(
      anchor,
      'completely\ndifferent\ncontent',
      hashSideContent('ignored — identity wins')
    )
    expect(result).toEqual({ state: 'fresh', line: 3, endLine: 4 })
  })

  it('is outdated (moved) when the block moved', () => {
    const anchor = anchorFor(original, 2, 2)
    const moved = ['inserted', 'one', 'two', 'three', 'four', 'five', 'six']
    expect(relocateAnchor(anchor, moved.join('\n'))).toEqual({
      state: 'outdated',
      line: 3,
      endLine: 3
    })
  })

  it('is outdated (whitespace-changed) when only indentation changed', () => {
    const anchor = anchorFor(original, 3, 3)
    const indented = ['one', 'two', '    three', 'four', 'five', 'six']
    expect(relocateAnchor(anchor, indented.join('\n'))).toEqual({
      state: 'outdated',
      line: 3,
      endLine: 3
    })
  })

  it('breaks ties between multiple matches with context', () => {
    const source = ['ctxA', 'target', 'ctxB', 'tail']
    const anchor = anchorFor(source, 2, 2)
    // The original line now holds other text, and the block appears twice:
    // only the match framed by its recorded context counts.
    const edited = ['ctxA', 'moved-on', 'ctxB', 'junk', 'target', 'junk2', 'ctxA', 'target', 'ctxB']
    expect(relocateAnchor(anchor, edited.join('\n'))).toEqual({
      state: 'outdated',
      line: 8,
      endLine: 8
    })
  })

  it('prefers the match nearest the original line when context ties', () => {
    const source = ['a', 'target', 'b', 'marker', 'a', 'target', 'b']
    const anchor = anchorFor(source, 6, 6)
    const edited = ['a', 'target', 'b', 'a', 'target', 'b']
    expect(relocateAnchor(anchor, edited.join('\n'))).toEqual({
      state: 'outdated',
      line: 5,
      endLine: 5
    })
  })

  it('is detached when the anchored code was deleted', () => {
    const anchor = anchorFor(original, 3, 4)
    expect(relocateAnchor(anchor, 'one\ntwo\nfive\nsix')).toEqual({ state: 'detached' })
  })
})
