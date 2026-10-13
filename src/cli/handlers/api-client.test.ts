import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { callMock } = vi.hoisted(() => ({ callMock: vi.fn() }))

vi.mock('../runtime-client', async () => {
  class RuntimeClient {
    readonly isRemote = false
    call = callMock
    getCliStatus = vi.fn()
    openOrca = vi.fn()
  }
  const { RuntimeClientError, RuntimeRpcFailureError } = await import('../runtime/types.js')
  return { RuntimeClient, RuntimeClientError, RuntimeRpcFailureError }
})

import { main } from '../index'
import { okFixture } from '../test-fixtures'
import { RuntimeClientError } from '../runtime/types'

const run = (overrides: object) => ({
  ok: true,
  runId: 'run',
  state: 'completed',
  totals: { requests: 1, testsPassed: 1, testsFailed: 0, durationMs: 5 },
  results: [
    {
      requestId: 'r1',
      name: 'Get thing',
      folderPath: ['F'],
      iteration: 1,
      request: { method: 'GET', url: 'http://x/echo' },
      response: {
        status: 200,
        statusText: 'OK',
        durationMs: 5,
        sizeBytes: 2,
        body: 'ok',
        bodyTruncated: false
      },
      error: null,
      tests: [{ name: 'is ok', passed: true }]
    }
  ],
  ...overrides
})

describe('orca api CLI handlers', () => {
  let logs: string[]
  beforeEach(() => {
    callMock.mockReset()
    logs = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => void logs.push(line))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    process.exitCode = undefined
    delete process.env.ORCA_WORKTREE_ID
  })
  afterEach(() => {
    process.exitCode = undefined
    vi.restoreAllMocks()
  })

  it('runs a target with options and exits 0 when everything passed', async () => {
    callMock.mockResolvedValue(okFixture('req', run({})))
    await main(
      [
        'api',
        'run',
        'F',
        '--env',
        'Local',
        '--iterations',
        '2',
        '--delay',
        '10',
        '--stop-on-failure',
        '--worktree',
        'all'
      ],
      '/repo'
    )
    expect(callMock).toHaveBeenCalledWith(
      'apiClient.run',
      {
        worktree: undefined,
        targetId: 'F',
        environment: 'Local',
        iterations: 2,
        delayMs: 10,
        stopOnFailure: true,
        timeoutMs: undefined
      },
      { timeoutMs: 630_000 }
    )
    expect(logs.join('\n')).toContain('Run completed: 1 requests, 1 passed, 0 failed')
    expect(process.exitCode).toBeUndefined()
  })

  it('exits 1 when a test failed', async () => {
    callMock.mockResolvedValue(
      okFixture(
        'req',
        run({ totals: { requests: 1, testsPassed: 0, testsFailed: 1, durationMs: 5 } })
      )
    )
    await main(['api', 'run', 'r1', '--worktree', 'all'], '/repo')
    expect(process.exitCode).toBe(1)
  })

  it('truncates large bodies unless --full-body is given', async () => {
    const big = 'a'.repeat(70 * 1024)
    const payload = run({})
    payload.results[0].response!.body = big
    callMock.mockResolvedValue(okFixture('req', payload))
    await main(['api', 'run', 'r1', '--worktree', 'all'], '/repo')
    expect(logs.join('\n')).toContain('truncated at 64 KB')
    logs.length = 0
    await main(['api', 'run', 'r1', '--full-body', '--worktree', 'all'], '/repo')
    expect(logs.join('\n')).not.toContain('truncated at 64 KB')
  })

  it('reports a failure result with exit code 1', async () => {
    callMock.mockResolvedValue(
      okFixture('req', {
        ok: false,
        code: 'not-local',
        message: 'Remote worktrees are unsupported.'
      })
    )
    await main(['api', 'list', '--worktree', 'all'], '/repo')
    expect(process.exitCode).toBe(1)
  })

  it('explains an old host that lacks the methods', async () => {
    callMock.mockRejectedValue(new RuntimeClientError('method_not_found', 'nope'))
    await main(['api', 'list', '--worktree', 'all'], '/repo')
    expect(process.exitCode).toBe(1)
    expect(vi.mocked(console.error).mock.calls.flat().join(' ')).toContain(
      'does not support the API Client'
    )
  })

  it('prints the tree for api list', async () => {
    callMock.mockResolvedValue(
      okFixture('req', {
        ok: true,
        collections: [
          {
            id: 'c',
            name: 'Smoke',
            items: [{ id: 'r1', kind: 'request', name: 'Get', method: 'GET' }]
          }
        ]
      })
    )
    await main(['api', 'list', '--worktree', 'all'], '/repo')
    expect(logs.join('\n')).toContain('GET     Get  (r1)')
  })
})
