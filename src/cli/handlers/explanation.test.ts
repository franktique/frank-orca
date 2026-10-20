import { Readable } from 'node:stream'
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

const publishResult = (overrides: object = {}) => ({
  ok: true,
  published: true,
  explanationId: 'e1',
  replacedPrevious: false,
  changeSetBase: { kind: 'uncommitted-only', baseRef: null, mergeBase: 'abc', headOid: null },
  counts: { changes: 1, files: 1, items: 2, rejected: 1, warnings: 0 },
  labels: [],
  rejected: [
    {
      code: 'line_out_of_range',
      message: 'Line 99 is past the end.',
      changeIndex: 1,
      itemIndex: 2
    }
  ],
  warnings: [],
  ...overrides
})

function pipeStdin(text: string): void {
  Object.defineProperty(process, 'stdin', {
    value: Readable.from([Buffer.from(text)]),
    configurable: true
  })
}

describe('orca explain CLI handlers', () => {
  let logs: string[]
  const realStdin = Object.getOwnPropertyDescriptor(process, 'stdin')

  beforeEach(() => {
    callMock.mockReset()
    logs = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => void logs.push(line))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    process.exitCode = undefined
    delete process.env.ORCA_TERMINAL_HANDLE
  })
  afterEach(() => {
    process.exitCode = undefined
    delete process.env.ORCA_TERMINAL_HANDLE
    if (realStdin) {
      Object.defineProperty(process, 'stdin', realStdin)
    }
    vi.restoreAllMocks()
  })

  it('requires --input-stdin for publish', async () => {
    await main(['explain', 'publish', '--worktree', 'id:r::/p'], '/repo')
    expect(callMock).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('rejects stdin over 900 KB without calling the runtime', async () => {
    pipeStdin('x'.repeat(900 * 1024 + 1))
    await main(['explain', 'publish', '--input-stdin', '--worktree', 'id:r::/p'], '/repo')
    expect(callMock).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('forwards the terminal handle and agent, and exits 0 with rejections', async () => {
    process.env.ORCA_TERMINAL_HANDLE = 'term_1'
    pipeStdin('{"version":1}')
    callMock.mockResolvedValue(okFixture('req', publishResult()))
    await main(
      ['explain', 'publish', '--input-stdin', '--agent', 'claude', '--worktree', 'id:r::/p'],
      '/repo'
    )
    expect(callMock).toHaveBeenCalledWith('explanation.publish', {
      worktree: 'id:r::/p',
      payload: { version: 1 },
      agent: 'claude',
      terminalHandle: 'term_1'
    })
    expect(logs.join('\n')).toContain('Published 2 items across 1 files in 1 changes')
    expect(logs.join('\n')).toContain('rejected B item 3: line_out_of_range — Line 99')
    expect(process.exitCode).toBeUndefined()
  })

  it('exits 1 when nothing was published', async () => {
    pipeStdin('{"version":1}')
    callMock.mockResolvedValue(okFixture('req', publishResult({ published: false })))
    await main(['explain', 'publish', '--input-stdin', '--worktree', 'id:r::/p'], '/repo')
    expect(process.exitCode).toBe(1)
  })

  it('exits 1 on a fatal publish failure', async () => {
    pipeStdin('{"version":1}')
    callMock.mockResolvedValue(
      okFixture('req', { ok: false, code: 'no_changes', message: 'Nothing changed.' })
    )
    await main(['explain', 'publish', '--input-stdin', '--worktree', 'id:r::/p'], '/repo')
    expect(process.exitCode).toBe(1)
  })

  it('maps method_not_found to the unsupported message', async () => {
    callMock.mockRejectedValue(new RuntimeClientError('method_not_found', 'raw'))
    const errors: string[] = []
    vi.spyOn(console, 'error').mockImplementation((line: string) => void errors.push(String(line)))
    await main(['explain', 'changes', '--worktree', 'id:r::/p'], '/repo')
    expect(errors.join('\n')).toContain('This Orca version does not support agent explanations.')
    expect(process.exitCode).toBe(1)
  })

  it('prints the change set base and files', async () => {
    callMock.mockResolvedValue(
      okFixture('req', {
        ok: true,
        base: { kind: 'uncommitted-only', baseRef: null, mergeBase: 'abc', headOid: null },
        files: [
          { path: 'a.ts', status: 'modified' },
          { path: 'b.ts', oldPath: 'c.ts', status: 'renamed' }
        ]
      })
    )
    await main(['explain', 'changes', '--worktree', 'id:r::/p'], '/repo')
    expect(logs[0]).toBe(
      ['Base: uncommitted changes only', 'modified a.ts', 'renamed b.ts ← c.ts'].join('\n')
    )
  })

  it('clears the explanation and says whether one existed', async () => {
    callMock.mockResolvedValue(okFixture('req', { ok: true, cleared: true }))
    await main(['explain', 'clear', '--worktree', 'id:r::/p'], '/repo')
    expect(callMock).toHaveBeenCalledWith('explanation.clear', { worktree: 'id:r::/p' })
    expect(logs[0]).toBe('Explanation cleared.')

    callMock.mockResolvedValue(okFixture('req', { ok: true, cleared: false }))
    await main(['explain', 'clear', '--worktree', 'id:r::/p'], '/repo')
    expect(logs[1]).toBe('No explanation to clear.')
  })

  it('prints the schema without calling the runtime', async () => {
    await main(['explain', 'schema'], '/repo')
    expect(callMock).not.toHaveBeenCalled()
    expect(JSON.parse(logs[0])).toHaveProperty('type', 'object')
  })
})
