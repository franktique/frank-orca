import { describe, expect, it } from 'vitest'
import type { ApiFolder, ApiRequest, Auth, Collection } from './api-client-types'
import { isAuthSupported, resolveEffectiveAuth } from './request-auth'
import { prepareRequest } from './request-preparation'
import { buildScopeChain } from './variable-resolution'

function request(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return {
    id: 'r',
    kind: 'request',
    name: 'r',
    method: 'get',
    url: { raw: '{{baseUrl}}/items', query: [] },
    pathVariables: [],
    headers: [],
    events: {},
    settings: {},
    revision: 0,
    postmanExtra: {},
    ...overrides
  }
}

const scopes = buildScopeChain({
  environment: [
    { key: 'baseUrl', value: 'http://x', enabled: true },
    { key: 'token', value: 'tkn', enabled: true },
    { key: 'user', value: 'alice', enabled: true },
    { key: 'pass', value: 'pw', enabled: true }
  ]
})

const bearer = (token: string): Auth => ({ type: 'bearer', params: { token } })

describe('prepareRequest', () => {
  it('resolves the URL, headers and drops disabled rows', () => {
    const prepared = prepareRequest(
      request({
        headers: [
          { key: 'X-A', value: '{{user}}', enabled: true },
          { key: 'X-B', value: 'skip', enabled: false }
        ]
      }),
      scopes,
      undefined
    )
    expect(prepared.method).toBe('GET')
    expect(prepared.url).toBe('http://x/items')
    expect(prepared.headers).toEqual([['X-A', 'alice']])
  })

  it('replaces :path variables in the path only', () => {
    const prepared = prepareRequest(
      request({
        url: { raw: '{{baseUrl}}/items/:id?next=:id', query: [] },
        pathVariables: [{ key: 'id', value: '42', enabled: true }]
      }),
      scopes,
      undefined
    )
    expect(prepared.url).toBe('http://x/items/42?next=:id')
  })

  it('sets the content type from the body unless a header already does', () => {
    const json = prepareRequest(
      request({ method: 'POST', body: { mode: 'raw', raw: '{"a":"{{user}}"}', language: 'json' } }),
      scopes,
      undefined
    )
    expect(json.body).toEqual({ kind: 'text', text: '{"a":"alice"}' })
    expect(json.headers).toContainEqual(['Content-Type', 'application/json'])
    const explicit = prepareRequest(
      request({
        headers: [{ key: 'content-type', value: 'text/custom', enabled: true }],
        body: { mode: 'raw', raw: 'x', language: 'json' }
      }),
      scopes,
      undefined
    )
    expect(explicit.headers).toEqual([['content-type', 'text/custom']])
  })

  it('encodes urlencoded rows and builds form-data fields', () => {
    const urlencoded = prepareRequest(
      request({
        body: {
          mode: 'urlencoded',
          urlencoded: [
            { key: 'a b', value: '{{user}}&', enabled: true },
            { key: 'off', value: '1', enabled: false }
          ]
        }
      }),
      scopes,
      undefined
    )
    expect(urlencoded.body).toEqual({ kind: 'text', text: 'a%20b=alice%26' })
    const form = prepareRequest(
      request({
        body: {
          mode: 'formdata',
          formdata: [
            { key: 'field', value: '{{user}}', enabled: true },
            { key: 'file', value: '', enabled: true, type: 'file' }
          ]
        }
      }),
      scopes,
      undefined
    )
    expect(form.body).toEqual({ kind: 'form-data', fields: [{ name: 'field', value: 'alice' }] })
  })

  it('applies bearer, basic and api-key auth with variables resolved', () => {
    expect(prepareRequest(request(), scopes, bearer('{{token}}')).headers).toEqual([
      ['Authorization', 'Bearer tkn']
    ])
    const basic = prepareRequest(request(), scopes, {
      type: 'basic',
      params: { username: '{{user}}', password: '{{pass}}' }
    })
    expect(basic.headers).toEqual([['Authorization', `Basic ${btoa('alice:pw')}`]])
    const apiKeyQuery = prepareRequest(request(), scopes, {
      type: 'apikey',
      params: { key: 'k', value: '{{token}}', in: 'query' }
    })
    expect(apiKeyQuery.url).toBe('http://x/items?k=tkn')
    const apiKeyHeader = prepareRequest(request(), scopes, {
      type: 'apikey',
      params: { key: 'X-Key', value: 'v' }
    })
    expect(apiKeyHeader.headers).toEqual([['X-Key', 'v']])
  })

  it('reports unresolved variables once', () => {
    const prepared = prepareRequest(
      request({ url: { raw: '{{missing}}/{{missing}}/{{other}}', query: [] } }),
      scopes,
      undefined
    )
    expect(prepared.unresolved).toEqual(['missing', 'other'])
  })
})

describe('resolveEffectiveAuth', () => {
  const collection = {
    id: 'c',
    name: 'c',
    variables: [],
    events: {},
    items: [],
    revision: 0,
    postmanExtra: {},
    importWarnings: [],
    auth: bearer('collection')
  } satisfies Collection
  const folder = (auth?: Auth): ApiFolder => ({
    id: 'f',
    kind: 'folder',
    name: 'f',
    variables: [],
    events: {},
    items: [],
    postmanExtra: {},
    ...(auth ? { auth } : {})
  })

  it('inherits from the nearest folder, then the collection', () => {
    expect(
      resolveEffectiveAuth([collection, folder(bearer('folder')), request()])?.params.token
    ).toBe('folder')
    expect(resolveEffectiveAuth([collection, folder(), request()])?.params.token).toBe('collection')
    expect(
      resolveEffectiveAuth([
        collection,
        folder(),
        request({ auth: { type: 'inherit', params: {} } })
      ])?.params.token
    ).toBe('collection')
  })

  it('stops at noauth at any level', () => {
    const none: Auth = { type: 'noauth', params: {} }
    expect(resolveEffectiveAuth([collection, folder(none), request()])).toBeUndefined()
    expect(resolveEffectiveAuth([collection, folder(), request({ auth: none })])).toBeUndefined()
  })

  it('lets a request override its parents', () => {
    expect(
      resolveEffectiveAuth([collection, folder(bearer('folder')), request({ auth: bearer('own') })])
        ?.params.token
    ).toBe('own')
  })

  it('flags unsupported types', () => {
    expect(isAuthSupported({ type: 'oauth2', params: {} })).toBe(false)
    expect(isAuthSupported(bearer('x'))).toBe(true)
  })
})
