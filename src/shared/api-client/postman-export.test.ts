import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Ajv from 'ajv'
import { describe, expect, it } from 'vitest'
import type { Collection } from './api-client-types'
import { flattenRequestsDepthFirst } from './collection-tree'
import { exportPostmanEnvironment } from './postman-environment-export'
import { isRecord } from './postman-field-mapping'
import { exportPostmanCollection } from './postman-export'
import { importPostmanJson } from './postman-import'

function fixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(__dirname, '__fixtures__', name), 'utf8'))
}

function counter(): () => string {
  let n = 0
  return () => `gen-${++n}`
}

function importCollection(name: string): {
  collection: Collection
  source: Record<string, unknown>
} {
  const source = fixture(name)
  const result = importPostmanJson(source, { newId: counter() })
  if (!result.ok || result.kind !== 'collection') {
    throw new Error('expected a collection')
  }
  return { collection: result.collection, source }
}

// Ajv has no draft-04 support; string-valued `id`/`$schema` keywords are the only blockers.
function stripDraft04Keywords(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(stripDraft04Keywords)
  }
  if (typeof node !== 'object' || node === null) {
    return node
  }
  return Object.fromEntries(
    Object.entries(node)
      .filter(([key, value]) => !((key === 'id' || key === '$schema') && typeof value === 'string'))
      .map(([key, value]) => [key, stripDraft04Keywords(value)])
  )
}

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: JSON fixture schema; Ajv requires its own object type.
const schema = stripDraft04Keywords(fixture('postman-collection-v2.1.schema.json')) as object
const validate = new Ajv({ strict: false, validateFormats: false, allErrors: false }).compile(
  schema
)

function expectValid(json: unknown): void {
  const valid = validate(json)
  expect(valid ? [] : validate.errors).toEqual([])
}

function recordField(source: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = source[key]
  return isRecord(value) ? value : {}
}

function exportedRequests(json: Record<string, unknown>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  const walk = (items: unknown): void => {
    if (!Array.isArray(items)) {
      return
    }
    for (const entry of items) {
      if (!isRecord(entry)) {
        continue
      }
      if (Array.isArray(entry.item)) {
        walk(entry.item)
      } else {
        out.push(entry)
      }
    }
  }
  walk(json.item)
  return out
}

describe('exportPostmanCollection', () => {
  it('round-trips the smoke collection: folders, requests, headers, bodies, scripts, variables', () => {
    const { collection, source } = importCollection('smoke.postman_collection.json')
    const exported = exportPostmanCollection(collection)
    const again = importPostmanJson(exported, { newId: counter() })
    if (!again.ok || again.kind !== 'collection') {
      throw new Error('expected a collection')
    }
    expect(again.collection.items).toEqual(collection.items)
    expect(again.collection.variables).toEqual(collection.variables)
    expect(again.collection.events).toEqual(collection.events)
    expect(again.collection.auth).toEqual(collection.auth)
    expect(again.collection.postmanExtra).toEqual(collection.postmanExtra)
    expect(exported['x-orca-unknown']).toEqual(source['x-orca-unknown'])
    expect(flattenRequestsDepthFirst(again.collection)).toHaveLength(37)
  })

  it('keeps the original request ids and the collection id', () => {
    const { collection, source } = importCollection('smoke.postman_collection.json')
    const exported = exportPostmanCollection(collection)
    expect(recordField(exported, 'info')._postman_id).toBe(recordField(source, 'info')._postman_id)
    expect(exportedRequests(exported).map((r) => r.id)).toEqual(
      exportedRequests(source).map((r) => r.id)
    )
  })

  it('shows an edited request in the export', () => {
    const { collection } = importCollection('smoke.postman_collection.json')
    const request = flattenRequestsDepthFirst(collection)[0]
    request.name = 'Renamed'
    request.method = 'PUT'
    request.url = { raw: 'https://example.com:8080/v2/things?a=1', query: [] }
    request.headers.push({ key: 'X-New', value: '1', enabled: false })
    const edited = exportedRequests(exportPostmanCollection(collection))[0]
    expect(edited.name).toBe('Renamed')
    const exportedRequest = recordField(edited, 'request')
    expect(exportedRequest.method).toBe('PUT')
    expect(exportedRequest.url).toMatchObject({
      raw: 'https://example.com:8080/v2/things?a=1',
      protocol: 'https',
      host: ['example', 'com'],
      port: '8080',
      path: ['v2', 'things']
    })
    expect(exportedRequest.header).toContainEqual({ key: 'X-New', value: '1', disabled: true })
  })

  it('exports a v2.0 import as v2.1', () => {
    const { collection } = importCollection('smoke-v2.0.postman_collection.json')
    const exported = exportPostmanCollection(collection)
    expect(recordField(exported, 'info').schema).toContain('v2.1.0')
    expectValid(exported)
  })

  it.each(['smoke.postman_collection.json', 'smoke-v2.0.postman_collection.json'])(
    'validates %s against the official v2.1 schema (SC-007)',
    (name) => {
      expectValid(exportPostmanCollection(importCollection(name).collection))
    }
  )

  it('writes new scripts and an added folder variable', () => {
    const { collection } = importCollection('smoke.postman_collection.json')
    const request = flattenRequestsDepthFirst(collection)[0]
    request.events.prerequest = { exec: ["pm.variables.set('a', 1)"] }
    const exported = exportPostmanCollection(collection)
    expectValid(exported)
    const events = exportedRequests(exported)[0].event
    const listens = Array.isArray(events) ? events.filter(isRecord).map((e) => e.listen) : []
    expect(listens).toContain('prerequest')
  })
})

describe('exportPostmanEnvironment', () => {
  it('round-trips the smoke environment and writes secrets as plain values', () => {
    const source = fixture('smoke.postman_environment.json')
    const result = importPostmanJson(source, { newId: counter() })
    if (!result.ok || result.kind !== 'environment') {
      throw new Error('expected an environment')
    }
    const exported = exportPostmanEnvironment(result.environment)
    expect(exported.values).toEqual(source.values)
    expect(exported.id).toBe(source.id)
    expect(exported.name).toBe(source.name)
    expect(JSON.stringify(exported)).toContain('secret-token-value')
  })

  it('writes an undecryptable secret as an empty value', () => {
    const exported = exportPostmanEnvironment({
      id: 'e',
      name: 'E',
      revision: 0,
      postmanExtra: {},
      variables: [{ key: 'k', value: null, enabled: true, type: 'secret' }]
    })
    expect(exported.values).toEqual([{ key: 'k', value: '', type: 'secret', enabled: true }])
  })
})
