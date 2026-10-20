import type { Client } from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { backendPid, connectPgClient, toSqlRunError } from './pg-client-factory'
import { executeSqlBatch, type SqlBatchOptions } from './sql-batch-executor'
import { SqlTypeNameCache } from './sql-type-names'
import {
  createScratchDatabase,
  describeSqlIntegration,
  type ScratchDatabase
} from './test-support/pg-test-database'

const connectionFor = (
  db: ScratchDatabase,
  sslMode: 'disable' | 'prefer' | 'require' = 'disable'
) => ({
  host: db.host,
  port: db.port,
  user: db.user,
  database: db.database,
  sslMode
})

const CASES = '"CaseManagement"."SurgicalCase"'

describeSqlIntegration('sql batch executor', () => {
  let db: ScratchDatabase
  let bigDb: ScratchDatabase | null = null
  let client: Client
  const typeNames = new SqlTypeNameCache()
  const run = (sql: string, options: Partial<SqlBatchOptions> = {}, target = client) =>
    executeSqlBatch(target, sql, { typeNames, ...options })
  const countCases = async (): Promise<number> => {
    const result = await client.query(`SELECT count(*)::int AS n FROM ${CASES}`)
    // Every value arrives as text on these connections.
    return Number(result.rows[0].n)
  }

  beforeAll(async () => {
    db = await createScratchDatabase()
    client = await connectPgClient(connectionFor(db), db.password)
  })
  afterAll(async () => {
    await client?.end()
    await bigDb?.drop()
    await db?.drop()
  })

  it('returns every column in the text form psql prints', async () => {
    const result = await run(
      `SET TimeZone = 'UTC'; SELECT id, title, note, amount, payload, scheduled_at, room_ids, attachment, duration, nullable_flag FROM ${CASES} ORDER BY title`
    )
    expect(result.kind).toBe('rows')
    if (result.kind !== 'rows') {
      return
    }
    expect(result.columns.map((c) => c.dataTypeName)).toEqual([
      'uuid',
      'text',
      'text',
      'numeric',
      'jsonb',
      'timestamp with time zone',
      'integer[]',
      'bytea',
      'interval',
      'boolean'
    ])
    expect(result.rows[0]).toEqual([
      '11111111-1111-1111-1111-111111111111',
      'Appendectomy',
      'plain text',
      '12345678901234567890.1234567890',
      '{"a": 1, "b": [true, null]}',
      '2026-01-02 03:04:05.678+00',
      '{1,2,3}',
      '\\xdeadbeef',
      '1 day 02:03:04',
      't'
    ])
    // The text 'NULL' and a real NULL stay distinct.
    expect(result.rows[2][2]).toBe('NULL')
    expect(result.rows[1].slice(2)).toEqual([null, null, null, null, null, null, null, null])
    expect(result.statementCount).toBe(2)
  })

  it('caps a bare SELECT at 1000 rows and says so', async () => {
    const capped = await run('SELECT * FROM wide_rows')
    expect(capped).toMatchObject({ kind: 'rows', rowCount: 1000, rowCapApplied: true })
    const explicit = await run('SELECT * FROM wide_rows LIMIT 10')
    expect(explicit).toMatchObject({ kind: 'rows', rowCount: 10, rowCapApplied: false })
  })

  it('reports affected rows for a command', async () => {
    const result = await run("UPDATE wide_rows SET c1 = 'x' WHERE id <= 3")
    expect(result).toMatchObject({ kind: 'command', command: 'UPDATE', affectedRows: 3 })
  })

  it('rolls back the whole batch when a later statement fails', async () => {
    const before = await countCases()
    const result = await run(
      `INSERT INTO ${CASES} (id, title) VALUES (gen_random_uuid(), 'tmp'); SELECT * FROM missing_table`
    )
    expect(result).toMatchObject({
      kind: 'error',
      error: {
        code: '42P01',
        failedStatementIndex: 1,
        failedStatementText: 'SELECT * FROM missing_table',
        nothingApplied: true
      }
    })
    expect(await countCases()).toBe(before)
  })

  it('maps an error position onto the whole run text', async () => {
    const sql = 'SELECT 1;\n  SELECT FROM WHERE'
    const result = await run(sql)
    expect(result.kind).toBe('error')
    if (result.kind === 'error') {
      expect(result.error.category).toBe('syntax')
      expect(result.error.position).toBeGreaterThan(sql.indexOf('SELECT FROM'))
    }
  })

  it('honours explicit transaction control as written', async () => {
    const before = await countCases()
    const committed = await run(
      `BEGIN; INSERT INTO ${CASES} (id, title) VALUES (gen_random_uuid(), 'explicit'); COMMIT;`
    )
    expect(committed.kind).toBe('command')
    expect(await countCases()).toBe(before + 1)

    const partial = await run(
      `INSERT INTO ${CASES} (id, title) VALUES (gen_random_uuid(), 'kept'); COMMIT; SELECT * FROM missing_table`
    )
    expect(partial).toMatchObject({
      kind: 'error',
      error: { failedStatementIndex: 2, nothingApplied: false }
    })
    expect(await countCases()).toBe(before + 2)
  })

  it('leaves the session usable after an error inside an explicit transaction', async () => {
    await run('BEGIN; SELECT * FROM missing_table')
    expect(await run('SELECT 1')).toMatchObject({ kind: 'rows', rowCount: 1 })
  })

  it('wraps read-only runs in a rolled-back read-only transaction', async () => {
    const before = await countCases()
    const write = await run(`DELETE FROM ${CASES}`, { readOnly: true })
    expect(write).toMatchObject({ kind: 'error', error: { category: 'read-only', code: '25006' } })
    const show = await run('SELECT 1; SHOW transaction_read_only', { readOnly: true })
    expect(show).toMatchObject({ kind: 'rows', rows: [['on']] })
    expect(await countCases()).toBe(before)
  })

  it('falls back from prefer, rejects require, and allows disable on a server without SSL', async () => {
    const prefer = await connectPgClient(connectionFor(db, 'prefer'), db.password)
    expect(await run('SELECT 1', {}, prefer)).toMatchObject({ kind: 'rows' })
    await prefer.end()
    const disable = await connectPgClient(connectionFor(db, 'disable'), db.password)
    await disable.end()
    const failure = await connectPgClient(connectionFor(db, 'require'), db.password).then(
      () => null,
      (error: unknown) => toSqlRunError(error)
    )
    expect(failure?.category).toBe('ssl')
  })

  it('stops reading past 50 MB and never truncates a cell', async () => {
    bigDb = await createScratchDatabase({ withBigText: true })
    const bigClient = await connectPgClient(connectionFor(bigDb), bigDb.password)
    try {
      const result = await run('SELECT body FROM big_text', {}, bigClient)
      expect(result.kind).toBe('rows')
      if (result.kind === 'rows') {
        expect(result.sizeLimitReached).toBe(true)
        expect(result.rowCount).toBeLessThan(1000)
        expect(result.rows.every((row) => row[0]?.length === 65536)).toBe(true)
      }
    } finally {
      await bigClient.end()
    }
  }, 60_000)

  it('cancels a long query within two seconds', async () => {
    const worker = await connectPgClient(connectionFor(db), db.password)
    let cancelled = false
    const started = Date.now()
    const pending = run(
      'SELECT pg_sleep(60)',
      { interruption: () => (cancelled ? { kind: 'cancelled' } : null) },
      worker
    )
    await new Promise((resolve) => setTimeout(resolve, 200))
    cancelled = true
    await client.query('SELECT pg_cancel_backend($1)', [backendPid(worker)])
    expect(await pending).toMatchObject({ kind: 'cancelled' })
    expect(Date.now() - started).toBeLessThan(2000)
    await worker.end()
  })
})
