import { describe, expect, it } from 'vitest'
import type { ExplanationSet } from './explanation-types'
import {
  buildGlobalOrder,
  fileLabel,
  itemLabel,
  labelsForPath,
  toChangeLetter
} from './explanation-labels'

function makeSet(changes: { files: { path: string; itemIds: string[] }[] }[]): ExplanationSet {
  return {
    id: 'set-1',
    workspaceId: 'ws',
    revision: 1,
    producer: { agentName: 'agent' },
    generatedAt: 0,
    changeSetBase: {
      kind: 'branch-and-uncommitted',
      baseRef: 'origin/main',
      mergeBase: 'm',
      headOid: 'h'
    },
    changes: changes.map((change, changeIndex) => ({
      index: changeIndex,
      title: `Change ${changeIndex}`,
      summary: '',
      files: change.files.map((file, fileIndex) => ({
        path: file.path,
        status: 'modified' as const,
        position: fileIndex + 1,
        items: file.itemIds.map((itemId, itemIndex) => ({
          id: itemId,
          position: itemIndex + 1,
          anchor: { fileLevel: true },
          text: 'text'
        }))
      }))
    })),
    questions: [],
    publishWarnings: []
  }
}

describe('toChangeLetter', () => {
  it('is bijective base-26', () => {
    expect(toChangeLetter(0)).toBe('A')
    expect(toChangeLetter(1)).toBe('B')
    expect(toChangeLetter(25)).toBe('Z')
    expect(toChangeLetter(26)).toBe('AA')
    expect(toChangeLetter(27)).toBe('AB')
    expect(toChangeLetter(51)).toBe('AZ')
    expect(toChangeLetter(52)).toBe('BA')
  })
})

describe('labels', () => {
  it('builds file and item labels from 1-based positions', () => {
    expect(fileLabel(0, 1)).toBe('A1')
    expect(fileLabel(1, 3)).toBe('B3')
    expect(itemLabel(1, 3, 2)).toBe('B3.2')
  })
})

describe('buildGlobalOrder', () => {
  it('walks change → file → item order across files and changes', () => {
    const set = makeSet([
      {
        files: [
          { path: 'a.ts', itemIds: ['a1'] },
          { path: 'b.ts', itemIds: ['b1'] }
        ]
      },
      { files: [{ path: 'a.ts', itemIds: ['a2'] }] }
    ])
    expect(buildGlobalOrder(set).map((entry) => entry.label)).toEqual(['A1.1', 'A2.1', 'B1.1'])
  })

  it('keeps a file in two changes under both labels', () => {
    const set = makeSet([
      { files: [{ path: 'a.ts', itemIds: ['a1'] }] },
      { files: [{ path: 'c.ts', itemIds: ['c1'] }] },
      { files: [{ path: 'a.ts', itemIds: ['a2'] }] }
    ])
    expect(labelsForPath(set, 'a.ts')).toEqual(['A1.1', 'C1.1'])
  })

  it('labelsForPath sorts by global order', () => {
    const set = makeSet([
      { files: [{ path: 'a.ts', itemIds: ['x1', 'x2'] }] },
      { files: [{ path: 'a.ts', itemIds: ['x3'] }] }
    ])
    expect(labelsForPath(set, 'a.ts')).toEqual(['A1.1', 'A1.2', 'B1.1'])
  })
})
