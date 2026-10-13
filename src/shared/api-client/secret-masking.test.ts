import { describe, expect, it } from 'vitest'
import type { Environment } from './api-client-types'
import {
  collectSecretValues,
  maskAuthorizationHeader,
  maskHeaders,
  maskSecrets
} from './secret-masking'

function envWith(...secrets: string[]): Environment {
  return {
    id: 'e',
    name: 'e',
    revision: 0,
    postmanExtra: {},
    variables: [
      { key: 'plain', value: 'visible', enabled: true, type: 'default' },
      ...secrets.map((value, index) => ({
        key: `s${index}`,
        value,
        enabled: true,
        type: 'secret' as const
      }))
    ]
  }
}

describe('secret masking', () => {
  it('only collects enabled secret values, never plain variables', () => {
    const env = envWith('abc12345')
    expect(collectSecretValues(env)).toContain('abc12345')
    expect(collectSecretValues(env)).not.toContain('visible')
    expect(collectSecretValues(null)).toEqual([])
  })

  it('masks a secret inside a longer string', () => {
    const secrets = collectSecretValues(envWith('abc123'))
    expect(maskSecrets('Bearer abc123', secrets)).toBe('Bearer ••••')
  })

  it('masks a secret in a URL query, a JSON body, a response body and a script log', () => {
    const secrets = collectSecretValues(envWith('tok-ABCD'))
    expect(maskSecrets('http://x/echo?token=tok-ABCD&a=1', secrets)).toBe(
      'http://x/echo?token=••••&a=1'
    )
    expect(maskSecrets('{"auth":"tok-ABCD"}', secrets)).toBe('{"auth":"••••"}')
    expect(maskSecrets('{"headers":{"x-token":"tok-ABCD"}}', secrets)).toBe(
      '{"headers":{"x-token":"••••"}}'
    )
    expect(maskSecrets('token is tok-ABCD', secrets)).toBe('token is ••••')
  })

  it('masks a percent-encoded secret in a query string', () => {
    const secrets = collectSecretValues(envWith('p@ss word&1'))
    const encoded = encodeURIComponent('p@ss word&1')
    expect(maskSecrets(`http://x/?pw=${encoded}`, secrets)).toBe('http://x/?pw=••••')
    expect(maskSecrets('pw=p%40ss+word%261', secrets)).toBe('pw=••••')
  })

  it('masks a secret with quotes or backslashes inside a JSON body', () => {
    const value = 'a"b\\c-secret'
    const secrets = collectSecretValues(envWith(value))
    const body = JSON.stringify({ password: value })
    expect(body).not.toContain(value)
    expect(maskSecrets(body, secrets)).toBe('{"password":"••••"}')
  })

  it('masks Basic auth whose password is a secret, not the whole header otherwise', () => {
    const secrets = collectSecretValues(envWith('hunter2-pass'))
    const header = `Basic ${btoa('alice:hunter2-pass')}`
    expect(maskAuthorizationHeader(header, secrets)).toBe('Basic ••••')
    const other = `Basic ${btoa('alice:other')}`
    expect(maskAuthorizationHeader(other, secrets)).toBe(other)
    expect(
      maskHeaders(
        [
          ['Authorization', header],
          ['X-Other', 'hunter2-pass']
        ],
        secrets
      )
    ).toEqual([
      ['Authorization', 'Basic ••••'],
      ['X-Other', '••••']
    ])
  })

  it('masks values under four characters only when they fill a whole field', () => {
    const secrets = collectSecretValues(envWith('ab1'))
    expect(maskSecrets('ab1', secrets)).toBe('••••')
    expect(maskSecrets('prefix-ab1-suffix', secrets)).toBe('prefix-ab1-suffix')
  })

  it('masks the longer secret first when two secrets overlap', () => {
    const secrets = collectSecretValues(envWith('abcd', 'abcd-extended'))
    expect(maskSecrets('x abcd-extended y abcd z', secrets)).toBe('x •••• y •••• z')
  })

  it('leaves text without secrets untouched', () => {
    expect(maskSecrets('nothing here', collectSecretValues(envWith('abcdef')))).toBe('nothing here')
    expect(maskSecrets('anything', [])).toBe('anything')
  })
})
