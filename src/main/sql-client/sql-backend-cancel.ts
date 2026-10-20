import type { Client } from 'pg'
import type { SqlConnection } from '../../shared/sql-client/sql-client-types'
import type { connectPgClient } from './pg-client-factory'

/** Cancels from a short-lived second connection, since the busy one cannot answer. */
export async function cancelBackend(
  connect: typeof connectPgClient,
  connection: SqlConnection,
  password: string,
  pid: number
): Promise<boolean> {
  let canceller: Client | null = null
  try {
    canceller = await connect(connection, password, { applicationName: 'Orca SQL (cancel)' })
    await canceller.query('SELECT pg_cancel_backend($1)', [pid])
    return true
  } catch {
    return false
  } finally {
    await canceller?.end().catch(() => undefined)
  }
}
