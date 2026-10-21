import { describe, expect, it } from 'vitest'
import type { Collection } from '../api-client/api-client-types'
import { exportTestMap, serializeTestMap } from './test-map-export'
import { linkTestMapFile } from './test-map-linking'
import { parseTestMapFile } from './test-map-schema'
import type { TestMap } from './test-orchestrator-types'

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Partial fixture carries only the fields the code under test reads.
const collection = {
  id: 'c1',
  name: 'C',
  variables: [],
  events: {},
  revision: 1,
  postmanExtra: {},
  importWarnings: [],
  items: [
    {
      id: 'f1',
      kind: 'folder',
      name: 'Setup',
      variables: [],
      events: {},
      postmanExtra: {},
      items: [{ id: 'r1', kind: 'request', name: 'Create case' }]
    },
    { id: 'r2', kind: 'request', name: 'Health' }
  ]
} as unknown as Collection

const source = {
  orcaTestMap: 1,
  guide: 'g.html',
  allowedHosts: ['localhost'],
  entries: [
    {
      request: { id: 'r1' },
      stepId: 'S-1',
      captures: [{ variable: 'caseId', from: 'id' }],
      after: [{ id: 'q1', sql: 'SELECT 1', description: 'one', changesData: true }]
    },
    { request: { path: ['health'] }, expect: { status: [200, 204] }, bogus: 1 },
    { request: { path: ['Missing'] } }
  ]
}

function load(raw: unknown): TestMap {
  const parsed = parseTestMapFile(raw)
  if (!parsed.ok) {
    throw new Error(JSON.stringify(parsed.issues))
  }
  const { entries } = linkTestMapFile(parsed.file, collection)
  return {
    orcaTestMap: 1,
    collectionId: collection.id,
    guidePath: parsed.file.guide,
    allowedHosts: parsed.file.allowedHosts,
    entries,
    loadedAt: 0
  }
}

describe('exportTestMap', () => {
  it('references linked requests by path and drops unknown fields', () => {
    const file = exportTestMap(load(source), collection)
    expect(file.entries[0].request).toEqual({ path: ['Setup', 'Create case'] })
    expect(file.entries[1].request).toEqual({ path: ['Health'] })
    expect(file.entries[2].request).toEqual({ path: ['Missing'] })
    expect(file.entries[1]).not.toHaveProperty('bogus')
  })

  it('round-trips to the same links and queries', () => {
    const map = load(source)
    const reloaded = load(JSON.parse(serializeTestMap(map, collection)))
    expect(reloaded.entries.map((e) => e.link)).toEqual(map.entries.map((e) => e.link))
    expect(reloaded.entries.map((e) => [e.before, e.after])).toEqual(
      map.entries.map((e) => [e.before, e.after])
    )
    expect(reloaded.guidePath).toBe('g.html')
  })

  it('exports UI-edited queries', () => {
    const map = load(source)
    map.entries[0].after[0] = { ...map.entries[0].after[0], sql: 'SELECT 2' }
    const reloaded = load(JSON.parse(serializeTestMap(map, collection)))
    expect(reloaded.entries[0].after[0].sql).toBe('SELECT 2')
  })
})
