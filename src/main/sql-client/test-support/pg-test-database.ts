import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { fileURLToPath } from 'node:url'
import { describe } from 'vitest'
import { Client } from 'pg'

export type ScratchDatabase = {
  host: string
  port: number
  user: string
  password: string
  database: string
  drop: () => Promise<void>
}

const testUrl = process.env.ORCA_TEST_PG_URL

export function describeSqlIntegration(name: string, fn: () => void): void {
  describe.skipIf(!testUrl)(`sql-integration ${name}`, fn)
}

function readSeed(fileName: string): string {
  return readFileSync(fileURLToPath(new URL(`./${fileName}`, import.meta.url)), 'utf8')
}

async function withClient<T>(
  config: ConstructorParameters<typeof Client>[0],
  fn: (client: Client) => Promise<T>
) {
  const client = new Client(config)
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

export async function createScratchDatabase(
  options: { withBigText?: boolean } = {}
): Promise<ScratchDatabase> {
  if (!testUrl) {
    throw new Error('ORCA_TEST_PG_URL is not set')
  }
  const admin = new URL(testUrl)
  const database = `orca_sql_${randomUUID().replace(/-/g, '').slice(0, 16)}`
  const user = decodeURIComponent(admin.username)
  const password = decodeURIComponent(admin.password)
  const host = admin.hostname
  const port = Number(admin.port || 5432)

  await withClient(
    { host, port, user, password, database: admin.pathname.slice(1) || 'postgres' },
    (c) => c.query(`CREATE DATABASE "${database}"`)
  )
  await withClient({ host, port, user, password, database }, async (c) => {
    await c.query(readSeed('seed.sql'))
    if (options.withBigText) {
      await c.query(readSeed('seed-big-text.sql'))
    }
  })

  return {
    host,
    port,
    user,
    password,
    database,
    drop: () =>
      withClient({ host, port, user, password, database: 'postgres' }, (c) =>
        c.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`)
      ).then(() => undefined)
  }
}

export function nonLoopbackHost(): string {
  const configured = process.env.ORCA_TEST_PG_LAN_HOST
  if (configured) {
    return configured
  }
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) {
        return address.address
      }
    }
  }
  throw new Error('No non-loopback IPv4 address found; set ORCA_TEST_PG_LAN_HOST')
}
