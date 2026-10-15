import type { Client } from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { connectPgClient } from './pg-client-factory'
import {
  cachedListRelations,
  listColumns,
  listRelations,
  listSchemas,
  SqlSchemaCache
} from './sql-schema-introspection'
import {
  createScratchDatabase,
  describeSqlIntegration,
  type ScratchDatabase
} from './test-support/pg-test-database'

describeSqlIntegration('sql schema introspection', () => {
  let db: ScratchDatabase
  let client: Client

  beforeAll(async () => {
    db = await createScratchDatabase()
    client = await connectPgClient(
      { host: db.host, port: db.port, user: db.user, database: db.database, sslMode: 'disable' },
      db.password
    )
  })
  afterAll(async () => {
    await client?.end()
    await db?.drop()
  })

  it('hides the system schemas', async () => {
    const names = (await listSchemas(client)).map((schema) => schema.name)
    expect(names).toContain('CaseManagement')
    expect(names).toContain('public')
    for (const hidden of ['pg_catalog', 'information_schema', 'pg_toast']) {
      expect(names).not.toContain(hidden)
    }
    expect(
      names.some((name) => name.startsWith('pg_temp_') || name.startsWith('pg_toast_temp_'))
    ).toBe(false)
  })

  it('hides temp schemas even while a session has a temp table', async () => {
    await client.query('CREATE TEMP TABLE scratch_temp (id int)')
    const names = (await listSchemas(client)).map((schema) => schema.name)
    expect(names.some((name) => name.startsWith('pg_temp'))).toBe(false)
  })

  it('classifies tables, views and materialized views', async () => {
    const relations = await listRelations(client, 'CaseManagement')
    expect(relations).toEqual([
      { schema: 'CaseManagement', name: 'CaseTitleCount', kind: 'materialized-view' },
      { schema: 'CaseManagement', name: 'ScheduledCase', kind: 'view' },
      { schema: 'CaseManagement', name: 'SurgicalCase', kind: 'table' }
    ])
  })

  it('classifies partitioned and foreign tables', async () => {
    await client.query('CREATE TABLE public.events (id int, at date) PARTITION BY RANGE (at)')
    const relations = await listRelations(client, 'public')
    expect(relations.find((relation) => relation.name === 'events')?.kind).toBe('partitioned-table')
  })

  it('lists columns in ordinal order with type, nullability and primary key', async () => {
    const columns = await listColumns(client, 'CaseManagement', 'SurgicalCase')
    expect(columns.map((column) => column.name)).toEqual([
      'id',
      'title',
      'note',
      'amount',
      'payload',
      'scheduled_at',
      'room_ids',
      'attachment',
      'duration',
      'nullable_flag'
    ])
    expect(columns[0]).toMatchObject({
      name: 'id',
      dataTypeName: 'uuid',
      nullable: false,
      isPrimaryKey: true,
      ordinal: 1
    })
    expect(columns[1]).toMatchObject({ dataTypeName: 'text', nullable: false, isPrimaryKey: false })
    expect(columns[2]).toMatchObject({ nullable: true })
    expect(columns[3].dataTypeName).toBe('numeric(30,10)')
    expect(columns[6].dataTypeName).toBe('integer[]')
  })

  it('sees a table created elsewhere after the cache is cleared', async () => {
    const cache = new SqlSchemaCache()
    const load = () => cachedListRelations(client, cache, 'public')
    const before = (await load()).map((relation) => relation.name)
    expect(before).not.toContain('created_later')

    const other = await connectPgClient(
      { host: db.host, port: db.port, user: db.user, database: db.database, sslMode: 'disable' },
      db.password
    )
    await other.query('CREATE TABLE public.created_later (id int)')
    await other.end()

    expect((await load()).map((relation) => relation.name)).not.toContain('created_later')
    cache.clear()
    expect((await load()).map((relation) => relation.name)).toContain('created_later')
  })
})
