import type { Client } from 'pg'
import { splitSqlStatements } from '../../shared/sql-client/sql-statement-splitter'
import {
  isReadOnlyBypassStatement,
  isTransactionControlStatement
} from '../../shared/sql-client/sql-transaction-control'
import { getSqlAgentAccess } from '../../shared/sql-client/sql-connection-locality'
import type {
  SqlAgentAccess,
  SqlConnection,
  SqlRunResult
} from '../../shared/sql-client/sql-client-types'
import { backendPid, connectPgClient, toSqlRunError } from './pg-client-factory'
import { cancelBackend } from './sql-backend-cancel'
import { executeSqlBatch } from './sql-batch-executor'
import { SqlTypeNameCache } from './sql-type-names'

export const AGENT_READ_ONLY_MESSAGE = 'Agents only have read access to non-local connections.'

// `statement_timeout` is per statement, so the run has its own deadline; the server gets this long
// to answer the cancel before the connection is closed on it.
const FORCE_CLOSE_GRACE_MS = 5000

export type AgentRunOptions = {
  connection: SqlConnection
  password: string
  sql: string
  timeoutMs: number
}

const readOnlyRejection = (elapsedMs: number): SqlRunResult => ({
  kind: 'error',
  elapsedMs,
  error: { message: AGENT_READ_ONLY_MESSAGE, category: 'read-only', nothingApplied: true }
})

/** `end()` waits for the server; a stuck one must not hold the agent's answer hostage. */
function closeQuietly(client: Client): Promise<void> {
  return Promise.race([
    client.end().catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, 2000).unref?.())
  ])
}

/** Rejects text that could lift the read-only session before anything is sent. */
export function rejectsBypass(sql: string): boolean {
  return splitSqlStatements(sql).some(
    (statement) =>
      isTransactionControlStatement(statement.text) || isReadOnlyBypassStatement(statement.text)
  )
}

export function resolveAgentAccess(connection: Pick<SqlConnection, 'host'>): SqlAgentAccess {
  return getSqlAgentAccess(connection.host)
}

export type IsolatedQueryOptions = AgentRunOptions & {
  readOnly: boolean
  applicationName: string
}

/** Runs agent SQL on a fresh connection; local hosts allow any statement, others are read-only. */
export function runAgentQuery(options: AgentRunOptions): Promise<SqlRunResult> {
  return runIsolatedQuery({
    ...options,
    readOnly: resolveAgentAccess(options.connection) === 'read-only',
    applicationName: 'Orca SQL (agent)'
  })
}

/**
 * Runs SQL on a fresh connection that is always closed afterwards. A read-only session rejects
 * bypass text up front and ends in a rollback.
 */
export async function runIsolatedQuery(options: IsolatedQueryOptions): Promise<SqlRunResult> {
  const { connection, password, sql, timeoutMs, readOnly, applicationName } = options
  const startedAt = Date.now()
  if (readOnly && rejectsBypass(sql)) {
    return readOnlyRejection(Date.now() - startedAt)
  }
  const serverOptions = [
    `-c statement_timeout=${timeoutMs}`,
    ...(readOnly ? ['-c default_transaction_read_only=on'] : [])
  ].join(' ')

  let client: Client
  try {
    client = await connectPgClient(connection, password, {
      applicationName,
      options: serverOptions
    })
  } catch (error) {
    return { kind: 'error', error: toSqlRunError(error), elapsedMs: Date.now() - startedAt }
  }

  let timedOut = false
  let forceCloseTimer: ReturnType<typeof setTimeout> | null = null
  const deadline = setTimeout(() => {
    timedOut = true
    const pid = backendPid(client)
    if (pid !== null) {
      void cancelBackend(connectPgClient, connection, password, pid)
    }
    forceCloseTimer = setTimeout(
      () => void client.end().catch(() => undefined),
      FORCE_CLOSE_GRACE_MS
    )
  }, timeoutMs)

  try {
    const result = await executeSqlBatch(client, sql, {
      readOnly,
      typeNames: new SqlTypeNameCache(),
      interruption: () => (timedOut ? { kind: 'timed-out', timeoutMs } : null)
    })
    if (result.kind === 'error') {
      if (result.error.code === '57014' && /statement timeout/i.test(result.error.message)) {
        return { kind: 'timed-out', timeoutMs, elapsedMs: result.elapsedMs }
      }
      if (result.error.category === 'read-only') {
        return { ...result, error: { ...result.error, message: AGENT_READ_ONLY_MESSAGE } }
      }
    }
    return result
  } finally {
    clearTimeout(deadline)
    if (forceCloseTimer) {
      clearTimeout(forceCloseTimer)
    }
    await closeQuietly(client)
  }
}
