import { describe, expect, it } from 'vitest'
import type { LineAnchor } from '../../../../../shared/agent-explanations/explanation-types'
import type { ExplanationFileItem } from './explanation-file-items'
import {
  layoutExplanationMarkers,
  maxMarkersPerLine,
  topForOriginalLineInline,
  type MarkerLayoutContext
} from './explanation-marker-layout'

const LINE_HEIGHT = 20

function lineItem(
  id: string,
  side: 'new' | 'old',
  line: number,
  state: 'fresh' | 'outdated' = 'fresh'
): ExplanationFileItem {
  const anchor: LineAnchor = {
    side,
    startLine: line,
    endLine: line,
    fingerprint: { lines: [], before: [], after: [] }
  }
  return {
    kind: 'line',
    item: { id, position: 1, anchor, text: id },
    label: `A1.${id}`,
    changeIndex: 0,
    changeTitle: 'T',
    anchor,
    state,
    line,
    endLine: line
  }
}

function context(sideBySide: boolean): MarkerLayoutContext {
  return {
    sideBySide,
    topForLine: (_side, line) => (line - 1) * LINE_HEIGHT,
    topForOriginalLineInline: (line) => (line === 99 ? null : 1000 + line)
  }
}

describe('layoutExplanationMarkers', () => {
  it('puts markers that share a line side by side', () => {
    const placements = layoutExplanationMarkers(
      [lineItem('1', 'new', 5), lineItem('2', 'new', 5), lineItem('3', 'new', 6)],
      context(true)
    )
    expect(placements.map((p) => [p.itemId, p.top, p.slot])).toEqual([
      ['1', 80, 0],
      ['2', 80, 1],
      ['3', 100, 0]
    ])
    expect(maxMarkersPerLine(placements, 'modified')).toBe(2)
    expect(maxMarkersPerLine(placements, 'original')).toBe(0)
  })

  it('routes old-side anchors to the original editor in side-by-side mode', () => {
    const [placement] = layoutExplanationMarkers([lineItem('1', 'old', 3)], context(true))
    expect(placement.editorSide).toBe('original')
    expect(placement.top).toBe(40)
  })

  it('maps old-side anchors into the modified editor when inline', () => {
    const placements = layoutExplanationMarkers(
      [lineItem('1', 'old', 3), lineItem('2', 'old', 99), lineItem('3', 'new', 2)],
      context(false)
    )
    expect(placements.map((p) => [p.itemId, p.editorSide, p.top])).toEqual([
      ['1', 'modified', 1003],
      ['3', 'modified', 20]
    ])
  })

  it('skips detached items', () => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test double only needs the members the code under test reads.
    const detached: ExplanationFileItem = {
      ...lineItem('1', 'new', 1),
      kind: 'detached',
      reason: 'detached'
    } as ExplanationFileItem
    expect(layoutExplanationMarkers([detached], context(true))).toEqual([])
  })

  it('lays out 60 markers on a 5k-line model within one frame', () => {
    const items = Array.from({ length: 60 }, (_, i) => lineItem(String(i), 'new', 1 + i * 80))
    const start = performance.now()
    const placements = layoutExplanationMarkers(items, context(true))
    expect(performance.now() - start).toBeLessThan(16)
    expect(placements).toHaveLength(60)
  })
})

describe('topForOriginalLineInline', () => {
  const metrics = {
    lineHeight: LINE_HEIGHT,
    topForModifiedLine: (line: number) => (line - 1) * LINE_HEIGHT,
    bottomForModifiedLine: (line: number) => line * LINE_HEIGHT
  }

  it('stacks replaced lines in a block above the modified range', () => {
    const changes = [
      {
        originalStartLineNumber: 10,
        originalEndLineNumber: 11,
        modifiedStartLineNumber: 10,
        modifiedEndLineNumber: 10
      }
    ]
    // Block of two deleted lines sits directly above modified line 10 (top 180).
    expect(topForOriginalLineInline(changes, 10, metrics)).toBe(140)
    expect(topForOriginalLineInline(changes, 11, metrics)).toBe(160)
  })

  it('places a pure deletion after the preceding modified line', () => {
    const changes = [
      {
        originalStartLineNumber: 4,
        originalEndLineNumber: 4,
        modifiedStartLineNumber: 3,
        modifiedEndLineNumber: 0
      }
    ]
    expect(topForOriginalLineInline(changes, 4, metrics)).toBe(60)
  })

  it('returns null for an original line that is not part of any change', () => {
    expect(topForOriginalLineInline([], 7, metrics)).toBeNull()
  })
})
