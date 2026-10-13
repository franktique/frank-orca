import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ApiItem, Collection } from './api-client-types'
import { flattenRequestsDepthFirst } from './collection-tree'
import { importPostmanJson } from './postman-import'

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(__dirname, '__fixtures__', name), 'utf8'))
}

function counter(): () => string {
  let n = 0
  return () => `gen-${++n}`
}

function importCollection(name: string, takenIds?: Set<string>): Collection {
  const result = importPostmanJson(fixture(name), { newId: counter(), takenIds })
  if (!result.ok || result.kind !== 'collection') {
    throw new Error(`expected a collection: ${JSON.stringify(result)}`)
  }
  return result.collection
}

function namesOf(items: ApiItem[]): string[] {
  return items.map((item) => item.name)
}

describe('importPostmanJson — collections', () => {
  it('imports the smoke fixture with the original structure, order and nesting (SC-001)', () => {
    const collection = importCollection('smoke.postman_collection.json')
    expect(collection.name).toBe('Smoke')
    expect(namesOf(collection.items)).toEqual(['MAIN', 'SECONDARY'])
    const main = collection.items[0]
    const secondary = collection.items[1]
    if (main.kind !== 'folder' || secondary.kind !== 'folder') {
      throw new Error('expected folders')
    }
    expect(namesOf(main.items)).toEqual(['G1', 'G2', 'G3', 'G4', 'G6'])
    expect(namesOf(secondary.items)).toEqual(['G7', 'G8', 'G9', 'G10'])
    expect(flattenRequestsDepthFirst(collection)).toHaveLength(37)
    const g2 = main.items[1]
    if (g2.kind !== 'folder') {
      throw new Error('expected folder')
    }
    expect(namesOf(g2.items)).toEqual(['G2 - urlencoded', 'G2 - formdata', 'G2-1'])
  })

  it('keeps headers, bodies, scripts and variables', () => {
    const collection = importCollection('smoke.postman_collection.json')
    const requests = flattenRequestsDepthFirst(collection)
    const login = requests[0]
    expect(login.name).toBe('G1 - login')
    expect(login.events.test?.exec.join('\n')).toContain('pm.environment.set("token"')
    const create = requests.find((r) => r.name === 'G1 - create')!
    expect(create.method).toBe('POST')
    expect(create.headers.map((h) => [h.key, h.value])).toEqual([
      ['X-Tenant', '{{tenantId}}'],
      ['Authorization', 'Bearer {{token}}']
    ])
    expect(create.body).toMatchObject({ mode: 'raw', language: 'json' })
    expect(JSON.parse(create.body?.raw ?? '{}')).toEqual({ name: 'item', tenant: '{{tenantId}}' })
    expect(create.events.prerequest?.exec).toEqual(['pm.variables.set("created", "yes");'])
    expect(requests.every((r) => r.events.test !== undefined)).toBe(true)
    expect(collection.variables.map((v) => v.key)).toEqual(['apiVersion', 'pageSize'])
    expect(collection.events.prerequest?.exec.join('')).toContain('collection prerequest')
    expect(collection.auth).toMatchObject({ type: 'bearer', params: { token: '{{token}}' } })
  })

  it('maps urlencoded and formdata bodies, disabled rows and folder variables', () => {
    const collection = importCollection('smoke.postman_collection.json')
    const requests = flattenRequestsDepthFirst(collection)
    const urlencoded = requests.find((r) => r.name === 'G2 - urlencoded')!
    expect(urlencoded.body?.urlencoded).toMatchObject([
      { key: 'a', value: '1', enabled: true },
      { key: 'b', value: '{{tenantId}}', enabled: false }
    ])
    const formdata = requests.find((r) => r.name === 'G2 - formdata')!
    expect(formdata.body?.formdata?.[1]).toMatchObject({ key: 'note', description: 'free text' })
    const main = collection.items[0]
    if (main.kind !== 'folder' || main.items[0].kind !== 'folder') {
      throw new Error('expected folders')
    }
    expect(main.items[0].variables).toMatchObject([{ key: 'groupVar', value: 'g1' }])
    expect(main.events.prerequest?.exec).toEqual(['console.log("MAIN folder prerequest");'])
  })

  it('maps strictSSL and followRedirects into request settings', () => {
    const requests = flattenRequestsDepthFirst(importCollection('smoke.postman_collection.json'))
    const insecure = requests.find((r) => r.name === 'G5 - insecure ssl')!
    expect(insecure.settings).toEqual({ sslVerification: false, followRedirects: false })
  })

  it('keeps unknown fields for export', () => {
    const collection = importCollection('smoke.postman_collection.json')
    expect(collection.postmanExtra).toMatchObject({
      root: { 'x-orca-unknown': { keep: ['me', 1, true] } }
    })
    const echo = flattenRequestsDepthFirst(collection)[1]
    expect(echo.postmanExtra).toMatchObject({
      request: { 'x-orca-request-extra': { note: 'preserve' } }
    })
  })

  it('syncs the query list with the raw URL', () => {
    const requests = flattenRequestsDepthFirst(importCollection('smoke.postman_collection.json'))
    const echo = requests.find((r) => r.name === 'G1 - echo with token')!
    expect(echo.url.raw).toBe('{{baseUrl}}/echo?who=me')
    expect(echo.url.query).toMatchObject([{ key: 'who', value: 'me', enabled: true }])
  })

  it('normalizes a v2.0 collection to the same model', () => {
    const collection = importCollection('smoke-v2.0.postman_collection.json')
    const requests = flattenRequestsDepthFirst(collection)
    expect(requests.map((r) => [r.name, r.method, r.url.raw])).toEqual([
      ['Get thing', 'GET', 'http://localhost:3000/echo?x=1'],
      ['Post thing', 'POST', 'http://localhost:3000/echo']
    ])
    expect(requests[0].url.query).toMatchObject([{ key: 'x', value: '1' }])
    expect(requests[0].auth).toMatchObject({ type: 'bearer', params: { token: 'abc' } })
    expect(requests[1].body).toMatchObject({ mode: 'raw', raw: '{"a":1}' })
  })

  it('reuses unique Postman ids and regenerates missing or clashing ones', () => {
    const collection = importCollection('smoke.postman_collection.json')
    expect(collection.id).toBe('col-smoke-0000-4000-8000-000000000000')
    const requests = flattenRequestsDepthFirst(collection)
    expect(requests[0].id).toMatch(/^req-/)

    const clashing = importCollection(
      'smoke.postman_collection.json',
      new Set(['col-smoke-0000-4000-8000-000000000000', requests[0].id])
    )
    expect(clashing.id).toMatch(/^gen-/)
    expect(flattenRequestsDepthFirst(clashing)[0].id).toMatch(/^gen-/)

    const ids = [clashing.id, ...flattenRequestsDepthFirst(clashing).map((r) => r.id)]
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('regenerates ids that repeat inside one file', () => {
    const json = {
      info: {
        name: 'Dupes',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
      },
      item: [
        { id: 'same', name: 'a', request: { method: 'GET', url: 'http://x' } },
        { id: 'same', name: 'b', request: { method: 'GET', url: 'http://x' } }
      ]
    }
    const result = importPostmanJson(json, { newId: counter() })
    if (!result.ok || result.kind !== 'collection') {
      throw new Error('expected collection')
    }
    const ids = flattenRequestsDepthFirst(result.collection).map((r) => r.id)
    expect(ids[0]).toBe('same')
    expect(ids[1]).toBe('gen-2')
  })

  it('warns about pm.sendRequest and names the request', () => {
    const result = importPostmanJson(fixture('smoke.postman_collection.json'), { newId: counter() })
    if (!result.ok) {
      throw new Error('expected success')
    }
    expect(
      result.warnings.some(
        (w) => w.includes('G6 - uses sendRequest') && w.includes('pm.sendRequest')
      )
    ).toBe(true)
  })

  it('reports the path of an invalid request and imports nothing', () => {
    const result = importPostmanJson(fixture('invalid.postman_collection.json'), {
      newId: counter()
    })
    expect(result).toEqual({
      ok: false,
      message: 'item[3].request.url: expected string or object'
    })
  })

  it('rejects files that are neither a collection nor an environment', () => {
    expect(importPostmanJson({ hello: 'world' }, { newId: counter() })).toMatchObject({ ok: false })
    expect(importPostmanJson([], { newId: counter() })).toMatchObject({ ok: false })
  })
})

describe('importPostmanJson — environments', () => {
  it('keeps name, values, enabled flag and type', () => {
    const result = importPostmanJson(fixture('smoke.postman_environment.json'), {
      newId: counter()
    })
    if (!result.ok || result.kind !== 'environment') {
      throw new Error('expected environment')
    }
    const { environment } = result
    expect(environment.name).toBe('Smoke Env')
    expect(environment.id).toBe('env-smoke-0000-4000-8000-000000000000')
    expect(environment.variables).toHaveLength(27)
    expect(environment.variables.filter((v) => v.type === 'secret').map((v) => v.key)).toEqual([
      'token',
      'apiKey',
      'password'
    ])
    expect(environment.variables.filter((v) => !v.enabled)).toHaveLength(1)
    expect(environment.variables[0]).toMatchObject({
      key: 'baseUrl',
      value: 'http://localhost:3000',
      enabled: true,
      type: 'default'
    })
    expect(environment.postmanExtra).toMatchObject({ _postman_variable_scope: 'environment' })
  })
})
