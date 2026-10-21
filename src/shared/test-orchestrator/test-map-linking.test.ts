import { describe, expect, it } from 'vitest'
import type { ApiFolder, ApiRequest, Collection } from '../api-client/api-client-types'
import { linkTestMapEntries, linkTestMapFile, rematchTestMap } from './test-map-linking'
import { parseTestMapFile } from './test-map-schema'
import type { TestMap } from './test-orchestrator-types'

const request = (id: string, name: string): ApiRequest =>
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Partial fixture carries only the fields the code under test reads.
  ({
    id,
    kind: 'request',
    name,
    method: 'GET',
    url: { raw: '' },
    pathVariables: [],
    headers: [],
    events: {},
    settings: {},
    revision: 1,
    postmanExtra: {}
  }) as unknown as ApiRequest

const folder = (id: string, name: string, items: (ApiFolder | ApiRequest)[]): ApiFolder =>
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Partial fixture carries only the fields the code under test reads.
  ({
    id,
    kind: 'folder',
    name,
    variables: [],
    events: {},
    items,
    postmanExtra: {}
  }) as unknown as ApiFolder

const collectionOf = (items: Collection['items'], id = 'c1'): Collection =>
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Partial fixture carries only the fields the code under test reads.
  ({
    id,
    name: 'C',
    variables: [],
    events: {},
    items,
    revision: 1,
    postmanExtra: {},
    importWarnings: []
  }) as unknown as Collection

const baseItems = [
  folder('f1', 'Setup', [request('r1', 'Create case')]),
  folder('f2', 'Scenarios', [request('r2', 'SC-1 Bulk create')])
]

function link(entries: object[], collection: Collection) {
  const parsed = parseTestMapFile({ orcaTestMap: 1, entries })
  if (!parsed.ok) {
    throw new Error(JSON.stringify(parsed.issues))
  }
  return linkTestMapFile(parsed.file, collection)
}

describe('linkTestMapFile', () => {
  it('links by id first', () => {
    const { entries } = link([{ request: { id: 'r2' } }], collectionOf(baseItems))
    expect(entries[0].link).toEqual({ state: 'linked', requestId: 'r2' })
  })

  it('links by exact path', () => {
    const { entries } = link(
      [{ request: { path: ['Setup', 'Create case'] } }],
      collectionOf(baseItems)
    )
    expect(entries[0].link).toEqual({ state: 'linked', requestId: 'r1' })
  })

  it('links case- and whitespace-insensitively', () => {
    const { entries } = link(
      [{ request: { path: ['  setup ', 'create   CASE'] } }],
      collectionOf(baseItems)
    )
    expect(entries[0].link).toEqual({ state: 'linked', requestId: 'r1' })
  })

  it('reports ambiguous paths without linking', () => {
    const items = [folder('f', 'A', [request('x1', 'Dup'), request('x2', 'Dup')])]
    const { entries, warnings } = link([{ request: { path: ['A', 'Dup'] } }], collectionOf(items))
    expect(entries[0].link).toEqual({ state: 'ambiguous', candidates: ['x1', 'x2'] })
    expect(warnings.ambiguous).toHaveLength(1)
  })

  it('does not fall through to the loose match when exact is ambiguous', () => {
    const items = [
      folder('f', 'A', [request('x1', 'Dup'), request('x2', 'Dup'), request('x3', 'dup')])
    ]
    const { entries } = link([{ request: { path: ['A', 'Dup'] } }], collectionOf(items))
    expect(entries[0].link).toEqual({ state: 'ambiguous', candidates: ['x1', 'x2'] })
  })

  it('reports unmatched refs', () => {
    const { entries, warnings } = link([{ request: { path: ['Nope'] } }], collectionOf(baseItems))
    expect(entries[0].link).toEqual({ state: 'unmatched' })
    expect(warnings.unmatched).toEqual([{ path: ['Nope'] }])
  })
})

describe('re-linking', () => {
  it('marks previously linked requests as broken after delete', () => {
    const first = link([{ request: { path: ['Setup', 'Create case'] } }], collectionOf(baseItems))
    const after = linkTestMapEntries(first.entries, collectionOf([baseItems[1]]))
    expect(after.entries[0].link).toEqual({ state: 'broken', lastRequestId: 'r1' })
    expect(after.warnings.broken).toHaveLength(1)
  })

  it('re-matches from stored refs after re-import with new node ids', () => {
    const first = link([{ request: { path: ['Setup', 'Create case'] } }], collectionOf(baseItems))
    const map: TestMap = {
      orcaTestMap: 1,
      collectionId: 'c1',
      entries: first.entries,
      loadedAt: 0
    }
    const reimported = collectionOf([folder('g1', 'Setup', [request('q1', 'Create case')])], 'c2')
    const { map: next, warnings } = rematchTestMap(map, reimported)
    expect(next.entries[0].link).toEqual({ state: 'linked', requestId: 'q1' })
    expect(next.collectionId).toBe('c2')
    expect(warnings.broken).toEqual([])
  })
})
