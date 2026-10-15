import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'

export type ScratchDatabase = {
  host: string
  port: number
  user: string
  password: string
  database: string
  /** Runs `sql` against the scratch database as the superuser and returns the rows. */
  query: (sql: string) => Promise<Record<string, unknown>[]>
  drop: () => Promise<void>
}

const SEED = path.join(process.cwd(), 'src', 'main', 'sql-client', 'test-support', 'seed.sql')

async function withClient<T>(
  config: ConstructorParameters<typeof Client>[0],
  fn: (client: Client) => Promise<T>
): Promise<T> {
  const client = new Client(config)
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

/** A throwaway database seeded like the integration suites, built from ORCA_TEST_PG_URL. */
export async function createScratchDatabase(): Promise<ScratchDatabase> {
  const url = new URL(process.env.ORCA_TEST_PG_URL ?? '')
  const base = {
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password)
  }
  const database = `orca_e2e_${randomUUID().replace(/-/g, '').slice(0, 12)}`
  await withClient({ ...base, database: 'postgres' }, (c) =>
    c.query(`CREATE DATABASE "${database}"`)
  )
  await withClient({ ...base, database }, (c) => c.query(readFileSync(SEED, 'utf8')))
  return {
    ...base,
    database,
    query: (sql) => withClient({ ...base, database }, async (c) => (await c.query(sql)).rows),
    drop: () =>
      withClient({ ...base, database: 'postgres' }, (c) =>
        c.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`)
      ).then(() => undefined)
  }
}
