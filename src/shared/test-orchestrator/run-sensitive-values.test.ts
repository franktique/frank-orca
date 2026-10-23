import { describe, expect, it } from 'vitest'
import { createRunSensitiveValues } from './run-sensitive-values'

describe('createRunSensitiveValues', () => {
  it('masks secret environment variables', () => {
    const set = createRunSensitiveValues()
    set.addEnvironment({
      variables: [
        { key: 'pw', value: 'hunter2xyz', type: 'secret', enabled: true },
        { key: 'plain', value: 'visible', type: 'default', enabled: true }
      ]
    })
    expect(set.maskText('p=hunter2xyz v=visible')).toBe('p=•••• v=visible')
  })

  it('learns values sent in auth headers, including the Bearer payload', () => {
    const set = createRunSensitiveValues()
    set.addSentHeaders([
      ['Authorization', 'Bearer abc123token'],
      ['X-Custom-Token', 'tok-9999'],
      ['x-tenant-key', 'k-5555'],
      ['Content-Type', 'application/json']
    ])
    expect(set.maskText('body abc123token tok-9999 k-5555 application/json')).toBe(
      'body •••• •••• •••• application/json'
    )
  })

  it('learns Basic payload, decoded form and password', () => {
    const set = createRunSensitiveValues()
    set.addSentHeaders([['Authorization', `Basic ${btoa('user:p4ssw0rd')}`]])
    expect(set.maskText('pw p4ssw0rd')).toBe('pw ••••')
  })

  it('learns cookie values individually', () => {
    const set = createRunSensitiveValues()
    set.addSentHeaders([['Cookie', 'sid=session-abc; theme=dark-mode']])
    expect(set.maskText('session-abc dark-mode')).toBe('•••• ••••')
  })

  it('learns captured values only when the variable name matches', () => {
    const set = createRunSensitiveValues()
    set.addCaptured('accessToken', 'captured-token-1')
    set.addCaptured('API_KEY', 'captured-key-2')
    set.addCaptured('requestId', 'r-12345')
    expect(set.maskText('captured-token-1 captured-key-2 r-12345')).toBe('•••• •••• r-12345')
  })

  it('masks percent, plus and JSON-escaped spellings', () => {
    const set = createRunSensitiveValues()
    set.addSecret('a b"c&d')
    expect(set.maskText('q=a%20b%22c%26d')).toBe('q=••••')
    expect(set.maskText('q=a+b%22c%26d')).toBe('q=••••')
    expect(set.maskText('{"x":"a b\\"c&d"}')).toBe('{"x":"••••"}')
  })

  it('masks short values only when they are the whole field', () => {
    const set = createRunSensitiveValues()
    set.addSecret('ab')
    expect(set.maskText('about')).toBe('about')
    expect(set.maskText('ab')).toBe('••••')
  })

  it('masks headers and only grows', () => {
    const set = createRunSensitiveValues()
    set.addSecret('first-secret')
    expect(set.maskHeaders([['X', 'first-secret']])).toEqual([['X', '••••']])
    set.addSecret('second-secret')
    expect(set.maskText('first-secret second-secret')).toBe('•••• ••••')
  })
})
