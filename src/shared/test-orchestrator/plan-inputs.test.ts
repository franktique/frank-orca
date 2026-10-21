import { describe, expect, it } from 'vitest'
import type { ApiRequest, EnvironmentVariable } from '../api-client/api-client-types'
import {
  collectQueryVariables,
  collectRequestVariables,
  deriveRunInputs,
  scanReferencedVariables
} from './plan-inputs'

function request(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return {
    id: 'r',
    kind: 'request',
    name: 'r',
    method: 'GET',
    url: { raw: '{{baseUrl}}/x', query: [] },
    pathVariables: [],
    headers: [],
    events: {},
    settings: {},
    revision: 0,
    postmanExtra: {},
    ...overrides
  }
}

const env = (key: string, value: string | null, type: 'default' | 'secret' = 'default') =>
  ({ key, value, enabled: true, type }) satisfies EnvironmentVariable

describe('scanReferencedVariables', () => {
  it('returns distinct names and skips dynamic variables', () => {
    expect(scanReferencedVariables('{{a}} {{ b }} {{a}} {{$guid}}')).toEqual(['a', 'b'])
  })
})

describe('collectRequestVariables', () => {
  it('scans url, headers, body, and auth', () => {
    const found = collectRequestVariables(
      request({
        headers: [{ key: 'X-{{h}}', value: '1', enabled: true }],
        body: { mode: 'raw', raw: '{"a":"{{bodyVar}}"}' }
      }),
      { type: 'bearer', params: { token: '{{token}}' } }
    )
    expect(found.toSorted()).toEqual(['baseUrl', 'bodyVar', 'h', 'token'])
  })

  it('ignores disabled rows', () => {
    const found = collectRequestVariables(
      request({ headers: [{ key: 'A', value: '{{off}}', enabled: false }] }),
      undefined
    )
    expect(found).toEqual(['baseUrl'])
  })
})

describe('collectQueryVariables', () => {
  it('scans SQL', () => {
    expect(
      collectQueryVariables([
        {
          id: 'q',
          sql: "select * from t where id = '{{orderId}}'",
          precondition: false,
          changesData: false
        }
      ])
    ).toEqual(['orderId'])
  })
})

describe('deriveRunInputs', () => {
  it('turns empty enabled variables into inputs', () => {
    const inputs = deriveRunInputs({
      environment: [
        env('baseUrl', 'http://x'),
        env('user', ''),
        env('password', null, 'secret'),
        { ...env('off', ''), enabled: false }
      ],
      referenced: new Set(['password']),
      provided: { user: 'frank' }
    })
    expect(inputs).toEqual([
      { name: 'user', secret: false, required: false, value: 'frank' },
      { name: 'password', secret: true, required: true, value: '' }
    ])
  })
})
