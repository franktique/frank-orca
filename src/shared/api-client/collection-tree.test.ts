import { describe, expect, it } from 'vitest'
import type { ApiFolder, ApiRequest, Collection } from './api-client-types'
import {
  cloneWithFreshIds,
  duplicateNode,
  findNode,
  flattenRequestsDepthFirst,
  getAncestorChain,
  insertNode,
  listMoveTargets,
  moveNode,
  removeNode
} from './collection-tree'

function request(id: string): ApiRequest {
  return {
    id,
    kind: 'request',
    name: id,
    method: 'GET',
    url: { raw: 'http://x', query: [] },
    pathVariables: [],
    headers: [],
    events: {},
    settings: {},
    revision: 0,
    postmanExtra: {}
  }
}

function folder(id: string, items: (ApiFolder | ApiRequest)[]): ApiFolder {
  return { id, kind: 'folder', name: id, variables: [], events: {}, items, postmanExtra: {} }
}

function collection(): Collection {
  return {
    id: 'c',
    name: 'c',
    variables: [],
    events: {},
    revision: 0,
    postmanExtra: {},
    importWarnings: [],
    items: [
      folder('outer', [
        request('r1'),
        folder('inner', [request('r2'), request('r3')]),
        request('r4')
      ]),
      request('r5')
    ]
  }
}

describe('collection tree', () => {
  it('flattens requests depth-first in stored order', () => {
    expect(flattenRequestsDepthFirst(collection()).map((r) => r.id)).toEqual([
      'r1',
      'r2',
      'r3',
      'r4',
      'r5'
    ])
  })

  it('flattens a folder scope only', () => {
    const c = collection()
    const inner = findNode(c, 'inner')?.node
    if (inner?.kind !== 'folder') {
      throw new Error('expected a folder')
    }
    expect(flattenRequestsDepthFirst(inner).map((r) => r.id)).toEqual(['r2', 'r3'])
  })

  it('returns the ancestor chain collection → outer → inner', () => {
    const chain = getAncestorChain(collection(), 'r2')!
    expect(chain.map((entry) => entry.id)).toEqual(['c', 'outer', 'inner', 'r2'])
  })

  it('moves a request across folders', () => {
    const c = collection()
    expect(moveNode(c, 'r5', 'inner', 0)).toBe(true)
    expect(flattenRequestsDepthFirst(c).map((r) => r.id)).toEqual(['r1', 'r5', 'r2', 'r3', 'r4'])
  })

  it('refuses to move a folder into its own descendant', () => {
    const c = collection()
    expect(moveNode(c, 'outer', 'inner')).toBe(false)
    expect(moveNode(c, 'outer', 'outer')).toBe(false)
    expect(findNode(c, 'inner')).not.toBeNull()
  })

  it('duplicates with fresh ids for the copy and every descendant', () => {
    const c = collection()
    let next = 0
    const copy = duplicateNode(c, 'outer', () => `new-${++next}`)
    if (copy?.kind !== 'folder') {
      throw new Error('expected a folder copy')
    }
    const ids = flattenRequestsDepthFirst(copy).map((r) => r.id)
    expect(new Set(ids).size).toBe(4)
    expect(ids.every((id) => id.startsWith('new-'))).toBe(true)
    expect(copy.id.startsWith('new-')).toBe(true)
    expect(c.items[1]).toBe(copy)
  })

  it('removes a folder and returns all nested request ids', () => {
    const c = collection()
    const removed = removeNode(c, 'outer')!
    expect(removed.removedRequestIds).toEqual(['r1', 'r2', 'r3', 'r4'])
    expect(c.items.map((i) => i.id)).toEqual(['r5'])
  })

  it('inserts at the root and into a folder', () => {
    const c = collection()
    expect(insertNode(c, null, request('r6'), 0)).toBe(true)
    expect(insertNode(c, 'inner', request('r7'))).toBe(true)
    expect(insertNode(c, 'missing', request('r8'))).toBe(false)
    expect(c.items[0].id).toBe('r6')
    expect(flattenRequestsDepthFirst(c).map((r) => r.id)).toContain('r7')
  })

  it('excludes the node and its descendants from move targets', () => {
    const targets = listMoveTargets(collection(), 'outer')
    expect(targets.map((t) => t.id)).toEqual([null])
    const all = listMoveTargets(collection(), 'r1')
    expect(all.map((t) => t.id)).toEqual([null, 'outer', 'inner'])
  })

  it('clones without sharing references', () => {
    const original = folder('f', [request('a')])
    const copy = cloneWithFreshIds(original, () => 'x')
    expect(copy.items[0]).not.toBe(original.items[0])
    expect(original.items[0].id).toBe('a')
  })
})
