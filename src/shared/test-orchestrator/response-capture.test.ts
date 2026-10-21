import { describe, expect, it } from 'vitest'
import { captureFromResponse } from './response-capture'

const response = {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Literal pairs are string tuples.
  headers: [['X-Request-Id', 'abc']] as [string, string][],
  body: {
    encoding: 'utf8' as const,
    text: '{"id":7,"data":{"items":[{"id":"a"},{"id":"b"}]},"flag":false,"nil":null}',
    truncated: false
  }
}

describe('captureFromResponse', () => {
  it('reads top-level and nested paths', () => {
    expect(captureFromResponse('v', 'id', response)).toEqual({ ok: true, value: '7' })
    expect(captureFromResponse('v', 'data.items[1].id', response)).toEqual({ ok: true, value: 'b' })
    expect(captureFromResponse('v', 'flag', response)).toEqual({ ok: true, value: 'false' })
  })

  it('reads headers case-insensitively', () => {
    expect(captureFromResponse('v', 'header:x-request-id', response)).toEqual({
      ok: true,
      value: 'abc'
    })
  })

  it('reports a missing value', () => {
    for (const from of ['nope', 'nil', 'data.items[5].id', 'header:missing']) {
      expect(captureFromResponse('caseId', from, response)).toEqual({
        ok: false,
        error: 'could not capture caseId from response'
      })
    }
  })

  it('fails on a non-JSON or omitted body', () => {
    const text = { ...response, body: { encoding: 'utf8' as const, text: 'x', truncated: false } }
    expect(captureFromResponse('v', 'id', text).ok).toBe(false)
    const omitted = { ...response, body: { encoding: 'omitted' as const, truncated: false } }
    expect(captureFromResponse('v', 'id', omitted).ok).toBe(false)
  })
})
