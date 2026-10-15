import type {
  SqlClientFailure,
  SqlConnectionUpdateInput,
  SqlTestConnectionResult
} from '../../shared/sql-client/sql-client-ipc-schemas'
import { connectionInputSchema } from '../../shared/sql-client/sql-client-ipc-schemas'
import { connectPgClient, toSqlRunError } from './pg-client-factory'
import { sqlFailure } from './sql-client-query-ops'
import type { SqlClientStore } from './sql-client-store'

/** Tests unsaved form values, or a saved connection with the form's edits layered on top. */
export async function testSqlConnection(
  store: SqlClientStore,
  projectKey: string,
  params: { id?: string; input?: SqlConnectionUpdateInput }
): Promise<({ ok: true } & SqlTestConnectionResult) | SqlClientFailure> {
  let target
  let password: string
  if (params.id) {
    const saved = await store.getConnectionForRun(projectKey, params.id)
    if ('ok' in saved) {
      return saved
    }
    const { input = {} } = params
    target = { ...saved.connection, ...definedOnly(input) }
    password = input.password ?? saved.password ?? ''
  } else {
    const parsed = connectionInputSchema.safeParse(params.input)
    if (!parsed.success) {
      return sqlFailure('invalid', parsed.error.issues[0]?.message ?? 'Invalid connection')
    }
    target = parsed.data
    password = parsed.data.password
  }
  try {
    const client = await connectPgClient(target, password, { applicationName: 'Orca SQL (test)' })
    try {
      const result = await client.query<{ server_version: string }>('SHOW server_version')
      return { ok: true, serverVersion: result.rows[0]?.server_version ?? 'unknown' }
    } finally {
      await client.end().catch(() => undefined)
    }
  } catch (error) {
    return sqlFailure('invalid', toSqlRunError(error).message)
  }
}

function definedOnly(input: SqlConnectionUpdateInput): SqlConnectionUpdateInput {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}
