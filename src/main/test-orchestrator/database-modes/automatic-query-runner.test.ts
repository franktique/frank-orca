import { describe, expect, it, vi } from 'vitest'
import type { SqlConnection, SqlRunResult } from '../../../shared/sql-client/sql-client-types'
import type { VerificationQuery } from '../../../shared/test-orchestrator/test-orchestrator-types'
import { classifyDataChange, createAutomaticQueryRunner } from './automatic-query-runner'
import type { QueryRunContext } from './database-query-runner'

const connectionFor = (host: string): SqlConnection => ({
  id: 'c1',
  name: 'test',
  host,
  port: 5432,
  user: 'u',
  database: 'd',
  sslMode: 'disable',
  password: null,
  createdAt: '',
  updatedAt: '',
  revision: 1
})

const query = (over: Partial<VerificationQuery> = {}): VerificationQuery => ({
  id: 'q1',
  sql: 'SELECT 1',
  precondition: false,
  changesData: false,
  ...over
})

const context = (over: Partial<QueryRunContext> = {}): QueryRunContext => ({
  sql: 'SELECT 1',
  step: { stepId: 's1', approvedDataChange: false },
  side: 'before',
  signal: new AbortController().signal,
  masker: { maskText: (text) => text.replaceAll('hunter2', '***') },
  ...over
})

const rowsResult = (count: number): SqlRunResult => ({
  kind: 'rows',
  columns: [{ name: 'n', dataTypeId: 23, dataTypeName: 'int4' }],
  rows: Array.from({ length: count }, (_, i) => [String(i)]),
  rowCount: count,
  rowCapApplied: false,
  sizeLimitReached: false,
  statementCount: 1,
  elapsedMs: 1
})

function setup(host: string, execute = vi.fn().mockResolvedValue(rowsResult(1))) {
  const end = vi.fn().mockResolvedValue(undefined)
  const fakeClient = { end }
  const connect = vi.fn().mockResolvedValue(fakeClient)
  const runner = createAutomaticQueryRunner({
    connection: connectionFor(host),
    password: 'pw',
    connect,
    execute
  })
  return { runner, execute, connect, end }
}

describe('classifyDataChange', () => {
  it.each([
    ['SELECT * FROM t', false],
    ['  -- note\nselect 1', false],
    ['SELECT 1; SHOW server_version', false],
    ['INSERT INTO t VALUES (1)', true],
    ['UPDATE t SET a = 1', true],
    ['WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x', true],
    ['SELECT * INTO copy FROM t', true],
    ["SELECT 'insert into' AS s", false],
    ['CREATE TABLE x (a int)', true],
    ['EXPLAIN ANALYZE SELECT 1', true]
  ])('%s -> %s', (sql, expected) => {
    expect(classifyDataChange(sql)).toBe(expected)
  })
})

describe('automatic query runner', () => {
  it('runs a read as automatic evidence with masked SQL and one client per run', async () => {
    const { runner, execute, connect } = setup('db.example.com')
    expect(await runner.prepare()).toEqual({ ok: true })
    const evidence = await runner.run(query(), context({ sql: "SELECT 'hunter2'" }))
    await runner.run(query({ id: 'q2' }), context())
    expect(evidence).toMatchObject({ how: 'automatic', sqlResolved: "SELECT '***'" })
    expect(evidence.result).toEqual({
      columns: ['n'],
      rows: [['0']],
      totalRows: 1,
      truncated: false
    })
    expect(connect).toHaveBeenCalledTimes(1)
    expect(connect.mock.calls[0][2]).toMatchObject({ applicationName: 'Orca Test Run' })
    expect(execute.mock.calls[0][2]).toMatchObject({ readOnly: true })
  })

  it('truncates a 1,000-row result to 200 rows and keeps the total', async () => {
    const { runner } = setup('127.0.0.1', vi.fn().mockResolvedValue(rowsResult(1000)))
    await runner.prepare()
    const evidence = await runner.run(query(), context())
    expect(evidence.result?.rows).toHaveLength(200)
    expect(evidence.result).toMatchObject({ totalRows: 1000, truncated: true })
  })

  it('skips a data-changing query on a non-local connection without approval', async () => {
    const { runner, execute } = setup('db.example.com')
    await runner.prepare()
    const flagged = await runner.run(query({ changesData: true }), context())
    const detected = await runner.run(query(), context({ sql: 'DELETE FROM t' }))
    expect(flagged.how).toBe('skipped-not-approved')
    expect(detected.how).toBe('skipped-not-approved')
    expect(execute).not.toHaveBeenCalled()
  })

  it('runs an approved data change read-write, and local connections need no approval', async () => {
    const remote = setup('db.example.com')
    await remote.runner.prepare()
    const approved = context({ step: { stepId: 's1', approvedDataChange: true } })
    expect((await remote.runner.run(query({ changesData: true }), approved)).how).toBe('automatic')
    expect(remote.execute.mock.calls[0][2]).toMatchObject({ readOnly: false })

    const local = setup('127.0.0.1')
    await local.runner.prepare()
    await local.runner.run(query({ changesData: true }), context())
    expect(local.execute.mock.calls[0][2]).toMatchObject({ readOnly: false })
  })

  it('rejects read-only bypass text before sending it', async () => {
    const { runner, execute } = setup('db.example.com')
    await runner.prepare()
    const evidence = await runner.run(query(), context({ sql: 'SET transaction_read_only = off' }))
    expect(evidence.how).toBe('failed')
    expect(execute).not.toHaveBeenCalled()
  })

  it('fails remaining queries with the connection error after a drop', async () => {
    const execute = vi.fn().mockResolvedValueOnce({
      kind: 'error',
      elapsedMs: 1,
      error: { message: 'Connection terminated', category: 'connection' }
    })
    const { runner } = setup('db.example.com', execute)
    await runner.prepare()
    const first = await runner.run(query(), context())
    const second = await runner.run(query({ id: 'q2' }), context())
    expect(first).toMatchObject({ how: 'failed', error: 'Connection terminated' })
    expect(second).toMatchObject({ how: 'failed', error: 'Connection terminated' })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('reports a failed pre-flight test and fails every query', async () => {
    const connect = vi.fn()
    const runner = createAutomaticQueryRunner({
      connection: connectionFor('db.example.com'),
      password: 'pw',
      connect,
      testConnection: async () => ({ ok: false, message: 'password authentication failed' })
    })
    expect(await runner.prepare()).toEqual({ ok: false, message: 'password authentication failed' })
    expect(await runner.run(query(), context())).toMatchObject({
      how: 'failed',
      error: 'password authentication failed'
    })
    expect(connect).not.toHaveBeenCalled()
  })

  it('closes the client on dispose', async () => {
    const { runner, end } = setup('db.example.com')
    await runner.prepare()
    await runner.dispose()
    expect(end).toHaveBeenCalledTimes(1)
  })
})
