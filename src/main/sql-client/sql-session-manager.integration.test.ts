import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import type { SqlConnectionStatusEvent } from '../../shared/sql-client/sql-client-ipc-schemas'
import type { SqlConnection } from '../../shared/sql-client/sql-client-types'
import { connectPgClient } from './pg-client-factory'
import { SqlSessionManager } from './sql-session-manager'
import {
  createScratchDatabase,
  describeSqlIntegration,
  type ScratchDatabase
} from './test-support/pg-test-database'

const PROJECT = 'repo:test'

describeSqlIntegration('sql session manager', () => {
  let db: ScratchDatabase
  let connection: SqlConnection
  let events: SqlConnectionStatusEvent[]
  let manager: SqlSessionManager

  beforeAll(async () => {
    db = await createScratchDatabase()
    connection = {
      id: 'conn-1',
      name: 'Test',
      host: db.host,
      port: db.port,
      user: db.user,
      database: db.database,
      sslMode: 'disable',
      password: null,
      createdAt: '',
      updatedAt: '',
      revision: 1
    }
  })
  afterAll(async () => {
    manager?.closeAll()
    await db?.drop()
  })
  beforeEach(() => {
    manager?.closeAll()
    events = []
    manager = new SqlSessionManager({
      getConnection: async () => ({ connection, password: db.password }),
      emitStatus: (event) => events.push(event)
    })
  })

  const states = (): string[] => events.map((e) => e.status.state)

  it('connects lazily on the first run and reports status transitions', async () => {
    const result = await manager.run(PROJECT, 'tab-1', 'conn-1', 'run-1', 'SELECT 42')
    expect(result).toMatchObject({ ok: true, result: { kind: 'rows', rows: [['42']] } })
    expect(states()).toEqual(['connecting', 'connected'])
    manager.closeTabSession('tab-1')
    expect(states()).toEqual(['connecting', 'connected', 'idle'])
  })

  it('keeps session settings per tab', async () => {
    await manager.run(PROJECT, 'tab-a', 'conn-1', 'r1', "SET application_name = 'tab-a-only'")
    const a = await manager.run(PROJECT, 'tab-a', 'conn-1', 'r2', 'SHOW application_name')
    const b = await manager.run(PROJECT, 'tab-b', 'conn-1', 'r3', 'SHOW application_name')
    expect(a).toMatchObject({ result: { rows: [['tab-a-only']] } })
    expect(b).toMatchObject({ result: { rows: [['Orca SQL']] } })
  })

  it('rejects a second run while one is active in the same tab', async () => {
    const first = manager.run(PROJECT, 'tab-1', 'conn-1', 'r1', 'SELECT pg_sleep(1)')
    await new Promise((resolve) => setTimeout(resolve, 100))
    const second = await manager.run(PROJECT, 'tab-1', 'conn-1', 'r2', 'SELECT 1')
    expect(second).toMatchObject({ ok: false, code: 'invalid' })
    expect(await first).toMatchObject({ ok: true, result: { kind: 'rows' } })
  })

  it('cancels a running query from a second connection', async () => {
    const started = Date.now()
    const pending = manager.run(PROJECT, 'tab-1', 'conn-1', 'run-9', 'SELECT pg_sleep(60)')
    await new Promise((resolve) => setTimeout(resolve, 300))
    await manager.cancel('tab-1', 'run-9')
    expect(await pending).toMatchObject({ ok: true, result: { kind: 'cancelled' } })
    expect(Date.now() - started).toBeLessThan(2500)
    // The session stays usable.
    expect(await manager.run(PROJECT, 'tab-1', 'conn-1', 'run-10', 'SELECT 1')).toMatchObject({
      result: { kind: 'rows' }
    })
  })

  it('ignores a cancel for a run that already finished', async () => {
    await manager.run(PROJECT, 'tab-1', 'conn-1', 'done', 'SELECT 1')
    await expect(manager.cancel('tab-1', 'done')).resolves.toBeUndefined()
  })

  it('reconnects once when the server dropped an idle connection', async () => {
    await manager.run(PROJECT, 'tab-1', 'conn-1', 'r1', 'SELECT 1')
    const admin = await connectPgClient(
      { host: db.host, port: db.port, user: db.user, database: db.database, sslMode: 'disable' },
      db.password
    )
    await admin.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'Orca SQL' AND datname = $1 AND pid <> pg_backend_pid()",
      [db.database]
    )
    await admin.end()
    await new Promise((resolve) => setTimeout(resolve, 200))
    const result = await manager.run(PROJECT, 'tab-1', 'conn-1', 'r2', 'SELECT 2')
    expect(result).toMatchObject({ ok: true, result: { kind: 'rows', rows: [['2']] } })
  })

  it('shows an auth failure as a result and a connection error status', async () => {
    const wrong = new SqlSessionManager({
      getConnection: async () => ({ connection, password: 'definitely-wrong' }),
      emitStatus: (event) => events.push(event)
    })
    const result = await wrong.run(PROJECT, 'tab-1', 'conn-1', 'r1', 'SELECT 1')
    expect(result).toMatchObject({
      ok: true,
      result: { kind: 'error', error: { category: 'auth' } }
    })
    expect(events.at(-1)?.status.state).toBe('error')
    wrong.closeAll()
  })

  it('closes every session when a connection is disconnected', async () => {
    await manager.run(PROJECT, 'tab-1', 'conn-1', 'r1', 'SELECT 1')
    await manager.connect(PROJECT, 'conn-1')
    manager.disconnect(PROJECT, 'conn-1')
    expect(manager.getStatus('conn-1')).toEqual({ state: 'idle' })
  })
})
