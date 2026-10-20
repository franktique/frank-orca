import type { Client } from 'pg'
import type { SqlClientFailure } from '../../shared/sql-client/sql-client-ipc-schemas'
import type { SqlConnection } from '../../shared/sql-client/sql-client-types'
import { sqlFailure } from './sql-client-query-ops'
import type { SqlSchemaCache } from './sql-schema-introspection'
import type { SqlTypeNameCache } from './sql-type-names'

export type SqlSession = {
  projectKey: string
  connection: SqlConnection
  password: string
  client: Client | null
  /** Set when the server dropped the connection; the next run reconnects once. */
  lost: boolean
  lastUsedAt: number
  typeNames: SqlTypeNameCache
  activeRun: { runId: string; cancelRequested: boolean } | null
}

export type SqlMetadataSession = Pick<SqlSession, 'projectKey' | 'client' | 'typeNames'> & {
  schemaCache: SqlSchemaCache
}

export type SqlConnectionSource = (
  projectKey: string,
  connectionId: string
) => Promise<{ connection: SqlConnection; password: string | null } | SqlClientFailure>

/** The connection with a usable password, or a failure telling the user to re-enter it. */
export async function resolveOpenableConnection(
  getConnection: SqlConnectionSource,
  projectKey: string,
  connectionId: string
): Promise<{ connection: SqlConnection; password: string } | SqlClientFailure> {
  const found = await getConnection(projectKey, connectionId)
  if ('ok' in found) {
    return found
  }
  if (found.password === null) {
    return sqlFailure(
      'invalid',
      'The saved password cannot be read. Edit the connection and enter it again.'
    )
  }
  return { connection: found.connection, password: found.password }
}
