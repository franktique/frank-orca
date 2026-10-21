import { describe, expect, it } from 'vitest'
import type { ExecutionOutcome } from '../api-client/api-client-types'
import { decideExpectAllVerdict, decideStepVerdict } from './step-verdict'

function response(status: number, body?: string): ExecutionOutcome {
  return {
    kind: 'response',
    response: {
      status,
      statusText: '',
      headers: [],
      sizeBytes: body?.length ?? 0,
      contentType: null,
      body: { encoding: 'utf8', text: body, truncated: false },
      redirects: []
    }
  }
}

describe('decideStepVerdict', () => {
  it('fails on a transport error first', () => {
    const verdict = decideStepVerdict({
      outcome: { kind: 'error', code: 'network', message: 'ECONNREFUSED' },
      tests: [{ name: 'a', passed: true }],
      expect: { status: 200 }
    })
    expect(verdict).toMatchObject({ result: 'fail', reason: 'ECONNREFUSED', expectedText: '200' })
  })

  it('fails on a failed pm.test and names it', () => {
    const verdict = decideStepVerdict({
      outcome: response(200),
      tests: [
        { name: 'has id', passed: false },
        { name: 'ok', passed: true }
      ]
    })
    expect(verdict.result).toBe('fail')
    expect(verdict.reason).toContain('has id')
    expect(verdict.expectedText).toBe('has id, ok')
  })

  it('passes with passing tests even on non-2xx', () => {
    expect(
      decideStepVerdict({ outcome: response(404), tests: [{ name: 'gone', passed: true }] }).result
    ).toBe('pass')
  })

  it('matches status and errorCode with the default lookup', () => {
    const verdict = decideStepVerdict({
      outcome: response(422, '{"error":{"code":"AM00109"}}'),
      tests: [],
      expect: { status: 422, errorCode: 'AM00109' }
    })
    expect(verdict).toEqual({
      result: 'pass',
      expectedText: '422 · AM00109',
      actualText: '422 · AM00109'
    })
  })

  it('reads errors[0].code and honours errorCodePath', () => {
    expect(
      decideStepVerdict({
        outcome: response(400, '{"errors":[{"code":"X1"}]}'),
        tests: [],
        expect: { status: [400, 422], errorCode: 'X1' }
      }).result
    ).toBe('pass')
    expect(
      decideStepVerdict({
        outcome: response(400, '{"meta":{"c":"Z"},"code":"other"}'),
        tests: [],
        expect: { status: 400, errorCode: 'Z', errorCodePath: 'meta.c' }
      }).result
    ).toBe('pass')
  })

  it('fails on wrong status or wrong code', () => {
    const wrongStatus = decideStepVerdict({
      outcome: response(200),
      tests: [],
      expect: { status: 201 }
    })
    expect(wrongStatus.result).toBe('fail')
    const wrongCode = decideStepVerdict({
      outcome: response(422, '{"code":"B"}'),
      tests: [],
      expect: { status: 422, errorCode: 'A' }
    })
    expect(wrongCode).toMatchObject({ result: 'fail', actualText: '422 · B' })
  })

  it('defaults to 2xx when nothing is declared', () => {
    expect(decideStepVerdict({ outcome: response(204), tests: [] })).toMatchObject({
      result: 'pass',
      expectedText: '2xx'
    })
    expect(decideStepVerdict({ outcome: response(500), tests: [] }).result).toBe('fail')
  })
})

describe('decideExpectAllVerdict', () => {
  const expectAll = [{ status: 201 }, { status: 409, errorCode: 'AM00107' }]
  const conflict = response(409, '{"code":"AM00107"}')

  it('passes in either arrival order', () => {
    for (const outcomes of [
      [response(201), conflict],
      [conflict, response(201)]
    ]) {
      expect(decideExpectAllVerdict({ expectAll, outcomes }).result).toBe('pass')
    }
  })

  it('finds a perfect matching when a greedy pick would block it', () => {
    const verdict = decideExpectAllVerdict({
      expectAll: [{ status: [200, 201] }, { status: 201 }],
      outcomes: [response(201), response(200)]
    })
    expect(verdict.result).toBe('pass')
  })

  it('fails and names the expectation nobody satisfied', () => {
    const verdict = decideExpectAllVerdict({
      expectAll,
      outcomes: [response(201), response(409, '{"code":"OTHER"}')]
    })
    expect(verdict).toMatchObject({ result: 'fail', actualText: '201 + 409 · OTHER' })
    expect(verdict.reason).toContain('409 · AM00107')
  })

  it('does not let one response satisfy two expectations', () => {
    const verdict = decideExpectAllVerdict({
      expectAll: [{ status: 201 }, { status: 201 }],
      outcomes: [response(201), response(500)]
    })
    expect(verdict.result).toBe('fail')
  })

  it('fails on a count mismatch and on transport errors', () => {
    expect(decideExpectAllVerdict({ expectAll, outcomes: [response(201)] }).reason).toContain(
      'got 1'
    )
    const verdict = decideExpectAllVerdict({
      expectAll,
      outcomes: [response(201), { kind: 'error', code: 'network', message: 'ECONNREFUSED' }]
    })
    expect(verdict.result).toBe('fail')
    expect(verdict.actualText).toContain('ECONNREFUSED')
  })
})
