import type { Client } from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { SqlConnection } from '../../shared/sql-client/sql-client-types'
import { connectPgClient } from './pg-client-factory'
import { AGENT_READ_ONLY_MESSAGE, runAgentQuery } from './sql-agent-runner'
import {
  createScratchDatabase,
  describeSqlIntegration,
  nonLoopbackHost,
  type ScratchDatabase
} from './test-support/pg-test-database'

const CASES = '"CaseManagement"."SurgicalCase"'

describeSqlIntegration('sql agent runner', () => {
  let db: ScratchDatabase
  let admin: Client
  let big: ScratchDatabase | null = null

  const connectionFor = (host: string, target: ScratchDatabase = db): SqlConnection => ({
    id: 'c1',
    name: 'test',
    host,
    port: target.port,
    user: target.user,
    database: target.database,
    sslMode: 'disable',
    password: null,
    createdAt: '',
    updatedAt: '',
    revision: 1
  })
  const local = () => connectionFor('127.0.0.1')
  const remote = () => connectionFor(nonLoopbackHost())
  const run = (
    connection: SqlConnection,
    sql: string,
    timeoutMs = 30_000,
    password = db.password
  ) => runAgentQuery({ connection, password, sql, timeoutMs })
  const countCases = async (): Promise<number> =>
    Number((await admin.query(`SELECT count(*) AS n FROM ${CASES}`)).rows[0].n)
  const agentBackends = async (): Promise<number> =>
    Number(
      (
        await admin.query(
          "SELECT count(*) AS n FROM pg_stat_activity WHERE application_name = 'Orca SQL (agent)' AND datname = $1",
          [db.database]
        )
      ).rows[0].n
    )

  beforeAll(async () => {
    db = await createScratchDatabase()
    admin = await connectPgClient(local(), db.password)
  })
  afterAll(async () => {
    await admin?.end()
    await big?.drop()
    await db?.drop()
  })

  it('runs any statement on a local host', async () => {
    const before = await countCases()
    const result = await run(
      local(),
      `INSERT INTO ${CASES} (id, title) VALUES (gen_random_uuid(), 'agent-local')`
    )
    expect(result).toMatchObject({ kind: 'command', command: 'INSERT', affectedRows: 1 })
    expect(await countCases()).toBe(before + 1)
  })

  it('refuses writes on a non-local host and leaves the data alone', async () => {
    const before = await countCases()
    const result = await run(remote(), `DELETE FROM ${CASES}`)
    expect(result).toMatchObject({
      kind: 'error',
      error: { category: 'read-only', message: AGENT_READ_ONLY_MESSAGE }
    })
    expect(await countCases()).toBe(before)
  })

  it('reads on a non-local host, including several statements in one run', async () => {
    expect(
      await run(remote(), `SELECT title FROM ${CASES} WHERE title = 'Appendectomy'`)
    ).toMatchObject({
      kind: 'rows',
      rows: [['Appendectomy']]
    })
    const multi = await run(remote(), 'SELECT 1; SELECT 2;')
    expect(multi).toMatchObject({ kind: 'rows', rows: [['2']], statementCount: 2 })
    expect(await run(remote(), 'SELECT 1; SHOW transaction_read_only')).toMatchObject({
      kind: 'rows',
      rows: [['on']]
    })
  })

  it.each([
    'BEGIN',
    'COMMIT',
    'SELECT 1; ROLLBACK',
    'SET transaction_read_only = off',
    'SET LOCAL default_transaction_read_only TO off',
    'RESET transaction_read_only',
    'RESET ALL',
    'SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE',
    "SELECT set_config('transaction_read_only', 'off', false)",
    'DO $$ BEGIN PERFORM 1; END $$'
  ])('rejects %s on a non-local host before sending it', async (sql) => {
    const before = await agentBackends()
    const result = await run(remote(), sql)
    expect(result).toMatchObject({ kind: 'error', error: { category: 'read-only' } })
    expect(await agentBackends()).toBe(before)
  })

  it('cannot write even if a later statement tries after a rejected bypass', async () => {
    const before = await countCases()
    await run(remote(), `SET transaction_read_only = off; DELETE FROM ${CASES}`)
    expect(await countCases()).toBe(before)
  })

  it('times out a slow query and leaves no backend running', async () => {
    const result = await run(local(), 'SELECT pg_sleep(5)', 1000)
    expect(result).toMatchObject({ kind: 'timed-out', timeoutMs: 1000 })
    await expect.poll(agentBackends, { timeout: 3000, interval: 100 }).toBe(0)
  })

  it('applies the limit to the whole run, not each statement', async () => {
    const started = Date.now()
    const result = await run(local(), 'SELECT pg_sleep(0.8); SELECT pg_sleep(0.8)', 1000)
    expect(result.kind).toBe('timed-out')
    expect(Date.now() - started).toBeLessThan(4000)
  })

  it('keeps what a local run committed before it timed out', async () => {
    const before = await countCases()
    const result = await run(
      local(),
      `INSERT INTO ${CASES} (id, title) VALUES (gen_random_uuid(), 'committed-before-timeout'); COMMIT; SELECT pg_sleep(5)`,
      1000
    )
    expect(result.kind).toBe('timed-out')
    expect(await countCases()).toBe(before + 1)
  })

  it('flags the 50 MB size limit', async () => {
    big = await createScratchDatabase({ withBigText: true })
    const result = await run(
      connectionFor('127.0.0.1', big),
      'SELECT body FROM big_text',
      30_000,
      big.password
    )
    expect(result).toMatchObject({ kind: 'rows', sizeLimitReached: true })
  }, 60_000)

  it('reports a wrong password as an auth error', async () => {
    expect(await run(local(), 'SELECT 1', 5000, 'nope')).toMatchObject({
      kind: 'error',
      error: { category: 'auth' }
    })
  })
})
