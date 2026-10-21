import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SqlConnection } from '../../../shared/sql-client/sql-client-types'
import type { VerificationQuery } from '../../../shared/test-orchestrator/test-orchestrator-types'
import { nonLoopbackHost } from '../../sql-client/test-support/pg-test-database'
import { createAutomaticQueryRunner } from './automatic-query-runner'
import type { DatabaseQueryRunner, QueryRunContext } from './database-query-runner'

const testUrl = process.env.ORCA_TEST_PG_URL

describe.skipIf(!testUrl)('automatic query runner (postgres)', () => {
  const database = `orca_run_${randomUUID().replace(/-/g, '').slice(0, 16)}`
  let admin: URL
  let target: Client
  const runners: DatabaseQueryRunner[] = []

  const clientFor = (name: string): Client =>
    new Client({
      host: admin.hostname,
      port: Number(admin.port || 5432),
      user: decodeURIComponent(admin.username),
      password: decodeURIComponent(admin.password),
      database: name
    })

  const connectionFor = (host: string): SqlConnection => ({
    id: 'c1',
    name: 'test',
    host,
    port: Number(admin.port || 5432),
    user: decodeURIComponent(admin.username),
    database,
    sslMode: 'disable',
    password: null,
    createdAt: '',
    updatedAt: '',
    revision: 1
  })

  const prepared = async (host: string): Promise<DatabaseQueryRunner> => {
    const runner = createAutomaticQueryRunner({
      connection: connectionFor(host),
      password: decodeURIComponent(admin.password)
    })
    runners.push(runner)
    expect(await runner.prepare()).toEqual({ ok: true })
    return runner
  }

  const query = (sql: string, over: Partial<VerificationQuery> = {}): VerificationQuery => ({
    id: 'q',
    sql,
    precondition: false,
    changesData: false,
    ...over
  })
  const context = (sql: string, approved = false): QueryRunContext => ({
    sql,
    step: { stepId: 's1', approvedDataChange: approved },
    side: 'before',
    signal: new AbortController().signal,
    masker: { maskText: (text) => text }
  })
  const countRows = async (): Promise<number> =>
    Number((await target.query('SELECT count(*) AS n FROM requests')).rows[0].n)

  beforeAll(async () => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: testUrl is non-undefined inside the skipIf-guarded suite.
    admin = new URL(testUrl as string)
    const maintenance = clientFor(admin.pathname.slice(1) || 'postgres')
    await maintenance.connect()
    await maintenance.query(`CREATE DATABASE "${database}"`)
    await maintenance.end()
    target = clientFor(database)
    await target.connect()
    await target.query(
      readFileSync(fileURLToPath(new URL('../test-support/seed.sql', import.meta.url)), 'utf8')
    )
  })

  afterAll(async () => {
    await Promise.all(runners.map((runner) => runner.dispose()))
    await target?.end()
    const maintenance = clientFor('postgres')
    await maintenance.connect()
    await maintenance.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`)
    await maintenance.end()
  })

  it('runs before then after queries on one session in order', async () => {
    const runner = await prepared('127.0.0.1')
    const before = await runner.run(
      query('SELECT count(*) AS n FROM requests'),
      context('SELECT count(*) AS n FROM requests')
    )
    await runner.run(
      query("INSERT INTO requests (case_id, request_id, status) VALUES ('a', 'b', 'NEW')", {
        changesData: true
      }),
      context("INSERT INTO requests (case_id, request_id, status) VALUES ('a', 'b', 'NEW')")
    )
    const after = await runner.run(
      query('SELECT count(*) AS n FROM requests'),
      context('SELECT count(*) AS n FROM requests')
    )
    expect(before.result?.rows[0][0]).toBe('1000')
    expect(after.result?.rows[0][0]).toBe('1001')
  })

  it('truncates a 1,000-row result to 200 rows', async () => {
    const runner = await prepared('127.0.0.1')
    const evidence = await runner.run(
      query('SELECT * FROM requests ORDER BY id'),
      context('SELECT * FROM requests ORDER BY id')
    )
    expect(evidence.result?.rows).toHaveLength(200)
    expect(evidence.result?.totalRows).toBeGreaterThanOrEqual(1000)
    expect(evidence.result?.truncated).toBe(true)
  })

  it('enforces read-only on a connection treated as non-local', async () => {
    const runner = await prepared(nonLoopbackHost())
    const sql = 'SELECT count(*) AS n FROM requests'
    expect((await runner.run(query(sql), context(sql))).how).toBe('automatic')
    const bypass = await runner.run(
      query(sql),
      context('SET transaction_read_only = off; DELETE FROM requests')
    )
    expect(bypass.how).toBe('failed')
    expect(await countRows()).toBeGreaterThanOrEqual(1000)
  })

  it('skips an unapproved data change and runs the approved one', async () => {
    const runner = await prepared(nonLoopbackHost())
    const sql = "DELETE FROM requests WHERE case_id = 'a'"
    const before = await countRows()
    const skipped = await runner.run(query(sql, { changesData: true }), context(sql))
    expect(skipped.how).toBe('skipped-not-approved')
    expect(await countRows()).toBe(before)
    const approved = await runner.run(query(sql, { changesData: true }), context(sql, true))
    expect(approved.how).toBe('automatic')
    expect(await countRows()).toBeLessThanOrEqual(before)
  })
})
