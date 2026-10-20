import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

const rowsResult = (overrides: object = {}) => ({
  kind: 'rows',
  columns: [{ name: 'id' }, { name: 'title' }],
  rows: [
    ['1', 'Appendectomy'],
    ['2', null]
  ],
  rowCount: 2,
  rowCapApplied: false,
  sizeLimitReached: false,
  statementCount: 1,
  elapsedMs: 18,
  ...overrides
})

const runPayload = (result: object) => ({
  ok: true,
  connectionId: 'c1',
  agentAccess: 'full',
  result
})

describe('orca sql CLI handlers', () => {
  let logs: string[]
  let scratch: string

  beforeEach(() => {
    callMock.mockReset()
    logs = []
    scratch = mkdtempSync(join(tmpdir(), 'orca-sql-cli-'))
    vi.spyOn(console, 'log').mockImplementation((line: string) => void logs.push(line))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    process.exitCode = undefined
    delete process.env.ORCA_WORKTREE_ID
  })
  afterEach(() => {
    process.exitCode = undefined
    rmSync(scratch, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  const invoke = (...args: string[]) => main(['sql', ...args, '--worktree', 'all'], '/repo')

  it('prints connections without a password and sends the worktree selector', async () => {
    callMock.mockResolvedValue(
      okFixture('req', {
        ok: true,
        projectKey: 'repo:1',
        connections: [
          {
            id: 'c1',
            name: 'Local cases DB',
            host: 'localhost',
            port: 5432,
            database: 'cases',
            user: 'postgres',
            sslMode: 'disable',
            agentAccess: 'full',
            passwordState: 'set'
          }
        ]
      })
    )
    await invoke('connections')
    expect(callMock).toHaveBeenCalledWith('sql.connections', { worktree: undefined }, undefined)
    const output = logs.join('\n')
    expect(output).toContain('Local cases DB')
    expect(output).toContain('postgres@localhost:5432/cases')
    expect(output).toContain('full')
    expect(output).not.toMatch(/password"?:/i)
  })

  it('lists saved queries, optionally for one connection', async () => {
    callMock.mockResolvedValue(
      okFixture('req', {
        ok: true,
        collections: [{ id: 'k1', connectionId: 'c1', name: 'Cleanup' }],
        queries: [
          {
            id: 'q1',
            connectionId: 'c1',
            collectionId: 'k1',
            name: 'Delete test cases',
            sql: 'delete   from t',
            updatedAt: 't'
          }
        ]
      })
    )
    await invoke('queries', '--connection', 'Local')
    expect(callMock).toHaveBeenCalledWith(
      'sql.queries',
      { worktree: undefined, connection: 'Local' },
      undefined
    )
    expect(logs.join('\n')).toContain('Delete test cases [Cleanup]  (q1)')
    expect(logs.join('\n')).toContain('delete from t')
  })

  it('prints rows as an aligned table with a footer and exits 0', async () => {
    callMock.mockResolvedValue(okFixture('req', runPayload(rowsResult())))
    await invoke('run', '--connection', 'Local', '--sql', 'select * from t')
    expect(callMock).toHaveBeenCalledWith(
      'sql.run',
      {
        worktree: undefined,
        connection: 'Local',
        sql: 'select * from t',
        timeoutSeconds: undefined
      },
      { timeoutMs: 60_000 }
    )
    const output = logs.join('\n')
    expect(output).toContain('id  title')
    expect(output).toContain('2   NULL')
    expect(output).toContain('2 rows · 18 ms')
    expect(process.exitCode).toBeUndefined()
  })

  it('flags the row cap and the size limit in the footer', async () => {
    callMock.mockResolvedValue(
      okFixture('req', runPayload(rowsResult({ rowCapApplied: true, sizeLimitReached: true })))
    )
    await invoke('run', '--connection', 'c', '--sql', 'select 1')
    expect(logs.join('\n')).toContain('row cap 1000 applied')
    expect(logs.join('\n')).toContain('size limit 50 MB reached')
  })

  it('shows only the first 100 rows in the table and points to --json', async () => {
    const rows = Array.from({ length: 150 }, (_unused, index) => [String(index), 'x'])
    callMock.mockResolvedValue(okFixture('req', runPayload(rowsResult({ rows, rowCount: 150 }))))
    await invoke('run', '--connection', 'c', '--sql', 'select 1')
    const output = logs.join('\n')
    expect(output).toContain('99  x')
    expect(output).not.toContain('100  x')
    expect(output).toContain('showing first 100 rows')
  })

  it('prints the full result as JSON with --json', async () => {
    callMock.mockResolvedValue(okFixture('req', runPayload(rowsResult())))
    await main(
      ['sql', 'run', '--connection', 'c', '--sql', 'select 1', '--json', '--worktree', 'all'],
      '/repo'
    )
    const parsed = JSON.parse(logs.join('\n'))
    expect(parsed.result.result.rows).toHaveLength(2)
    expect(parsed.result.agentAccess).toBe('full')
  })

  it('reports affected rows for a command', async () => {
    callMock.mockResolvedValue(
      okFixture(
        'req',
        runPayload({ kind: 'command', command: 'DELETE', affectedRows: 3, elapsedMs: 4 })
      )
    )
    await invoke('run', '--connection', 'c', '--sql', 'delete from t')
    expect(logs.join('\n')).toContain('3 rows affected · 4 ms')
  })

  it('passes --timeout through and waits a little longer for the reply', async () => {
    callMock.mockResolvedValue(okFixture('req', runPayload(rowsResult())))
    await invoke('run', '--connection', 'c', '--sql', 'select 1', '--timeout', '90')
    expect(callMock).toHaveBeenCalledWith(
      'sql.run',
      expect.objectContaining({ timeoutSeconds: 90 }),
      { timeoutMs: 120_000 }
    )
  })

  it('exits 3 on a read-only refusal', async () => {
    callMock.mockResolvedValue(
      okFixture(
        'req',
        runPayload({
          kind: 'error',
          elapsedMs: 1,
          error: {
            message: 'Agents only have read access to non-local connections.',
            category: 'read-only',
            nothingApplied: true
          }
        })
      )
    )
    await invoke('run', '--connection', 'c', '--sql', 'delete from t')
    expect(process.exitCode).toBe(3)
    expect(logs.join('\n')).toContain('Agents only have read access')
    expect(logs.join('\n')).toContain('Nothing was applied.')
  })

  it('exits 4 on a timeout and says nothing it changed was kept', async () => {
    callMock.mockResolvedValue(
      okFixture('req', runPayload({ kind: 'timed-out', timeoutMs: 30_000, elapsedMs: 30_001 }))
    )
    await invoke('run', '--connection', 'c', '--sql', 'select pg_sleep(60)')
    expect(process.exitCode).toBe(4)
    expect(logs.join('\n')).toContain('timed out after 30 s')
    expect(logs.join('\n')).toContain('nothing it changed was kept')
  })

  it('exits 2 on a database error and prints its details', async () => {
    callMock.mockResolvedValue(
      okFixture(
        'req',
        runPayload({
          kind: 'error',
          elapsedMs: 2,
          error: {
            message: 'relation "t" does not exist',
            code: '42P01',
            position: 15,
            hint: 'Check the name.',
            failedStatementIndex: 1,
            failedStatementText: 'select * from t',
            category: 'other',
            nothingApplied: true
          }
        })
      )
    )
    await invoke('run', '--connection', 'c', '--sql', 'select 1; select * from t')
    expect(process.exitCode).toBe(2)
    const output = logs.join('\n')
    expect(output).toContain('SQLSTATE: 42P01')
    expect(output).toContain('Position: 15')
    expect(output).toContain('Failed statement 2: select * from t')
  })

  it('exits 1 for an RPC failure such as a non-local worktree', async () => {
    callMock.mockResolvedValue(
      okFixture('req', { ok: false, code: 'not-local', message: 'Local workspaces only.' })
    )
    await invoke('run', '--connection', 'c', '--sql', 'select 1')
    expect(process.exitCode).toBe(1)
    expect(vi.mocked(console.error).mock.calls.flat().join(' ')).toContain('Local workspaces only.')
  })

  it('reads the SQL from --file and sends a saved query by --query', async () => {
    callMock.mockResolvedValue(okFixture('req', runPayload(rowsResult())))
    const file = join(scratch, 'q.sql')
    writeFileSync(file, 'select from_file')
    await invoke('run', '--connection', 'c', '--file', file)
    expect(callMock).toHaveBeenLastCalledWith(
      'sql.run',
      expect.objectContaining({ sql: 'select from_file' }),
      expect.anything()
    )
    await invoke('run', '--connection', 'c', '--query', 'Delete test cases')
    expect(callMock).toHaveBeenLastCalledWith(
      'sql.run',
      expect.objectContaining({ savedQuery: 'Delete test cases' }),
      expect.anything()
    )
    expect(callMock.mock.calls.at(-1)?.[1]).not.toHaveProperty('sql')
  })

  it('refuses more than one SQL source', async () => {
    await invoke('run', '--connection', 'c', '--sql', 'select 1', '--query', 'q')
    expect(process.exitCode).toBeDefined()
    expect(callMock).not.toHaveBeenCalled()
  })

  it('explains an old host that lacks the methods', async () => {
    callMock.mockRejectedValue(new RuntimeClientError('method_not_found', 'nope'))
    await invoke('connections')
    expect(process.exitCode).toBe(1)
    expect(vi.mocked(console.error).mock.calls.flat().join(' ')).toContain(
      'does not support `orca sql`; update Orca'
    )
  })
})
