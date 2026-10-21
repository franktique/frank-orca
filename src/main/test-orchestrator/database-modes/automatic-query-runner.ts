import type { Client } from 'pg'
import { getSqlAgentAccess } from '../../../shared/sql-client/sql-connection-locality'
import { splitSqlStatements } from '../../../shared/sql-client/sql-statement-splitter'
import { maskSqlText } from '../../../shared/sql-client/sql-text-masking'
import type { SqlConnection, SqlRunResult } from '../../../shared/sql-client/sql-client-types'
import { truncateRows } from '../../../shared/test-orchestrator/evidence-truncation'
import type {
  QueryEvidence,
  QueryResultTable,
  VerificationQuery
} from '../../../shared/test-orchestrator/test-orchestrator-types'
import { backendPid, connectPgClient } from '../../sql-client/pg-client-factory'
import { cancelBackend } from '../../sql-client/sql-backend-cancel'
import { AGENT_READ_ONLY_MESSAGE, rejectsBypass } from '../../sql-client/sql-agent-runner'
import { executeSqlBatch } from '../../sql-client/sql-batch-executor'
import { SqlTypeNameCache } from '../../sql-client/sql-type-names'
import type {
  DatabaseQueryRunner,
  QueryRunContext,
  QueryRunnerPrepareResult
} from './database-query-runner'

export const TEST_RUN_APPLICATION_NAME = 'Orca Test Run'
export const NOT_APPROVED_MESSAGE = 'Skipped: data change not approved'
const STATEMENT_TIMEOUT_MS = 30_000
const CLOSE_GRACE_MS = 2000

const READ_ONLY_HEADS = new Set(['select', 'show', 'values', 'table'])
const DATA_CHANGE_KEYWORDS = /\b(?:insert|update|delete|merge|into)\b/

/** True for anything but a plain read; the strictest reading wins (R8). */
export function classifyDataChange(sql: string): boolean {
  const statements = splitSqlStatements(sql)
  return statements.some((statement) => {
    const code = maskSqlText(statement.text).trim().toLowerCase()
    if (code === '') {
      return false
    }
    const head = code.match(/^\w+/)?.[0] ?? ''
    if (head === 'select' || head === 'with') {
      // Data-modifying CTEs and SELECT ... INTO create or write rows.
      return DATA_CHANGE_KEYWORDS.test(code)
    }
    return !READ_ONLY_HEADS.has(head)
  })
}

export type AutomaticQueryRunnerOptions = {
  connection: SqlConnection
  password: string
  /** Pre-flight check (feature 002's connection test) run before the dedicated client opens. */
  testConnection?: () => Promise<QueryRunnerPrepareResult>
  connect?: typeof connectPgClient
  execute?: typeof executeSqlBatch
  statementTimeoutMs?: number
}

function baseEvidence(query: VerificationQuery, context: QueryRunContext) {
  return {
    queryId: query.id,
    ...(query.description === undefined
      ? {}
      : { description: context.masker.maskText(query.description) }),
    sqlResolved: context.masker.maskText(context.sql),
    partial: false,
    screenshot: null
  }
}

function toTable(
  result: Extract<SqlRunResult, { kind: 'rows' | 'command' }>,
  mask: (text: string) => string
): QueryResultTable {
  if (result.kind === 'command') {
    const affected = result.affectedRows === null ? '' : String(result.affectedRows)
    return {
      columns: ['command', 'affected rows'],
      rows: [[mask(result.command), affected]],
      totalRows: 1,
      truncated: false
    }
  }
  const truncated = truncateRows(result.rows, result.rowCount)
  return {
    columns: result.columns.map((column) => mask(column.name)),
    rows: truncated.rows.map((row) => row.map((cell) => (cell === null ? 'NULL' : mask(cell)))),
    totalRows: Math.max(result.rowCount, truncated.rows.length),
    truncated: truncated.note !== null || result.rowCapApplied || result.sizeLimitReached
  }
}

function closeQuietly(client: Client): Promise<void> {
  return Promise.race([
    client.end().catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, CLOSE_GRACE_MS).unref?.())
  ])
}

export function createAutomaticQueryRunner(
  options: AutomaticQueryRunnerOptions
): DatabaseQueryRunner {
  const { connection, password } = options
  const connect = options.connect ?? connectPgClient
  const execute = options.execute ?? executeSqlBatch
  const timeoutMs = options.statementTimeoutMs ?? STATEMENT_TIMEOUT_MS
  const isLocal = getSqlAgentAccess(connection.host) === 'full'
  const typeNames = new SqlTypeNameCache()
  let client: Client | null = null
  // Why: once the link is gone every later query fails with the same cause instead of hanging.
  let unavailableReason: string | null = null

  const failed = (query: VerificationQuery, context: QueryRunContext, message: string) =>
    ({
      ...baseEvidence(query, context),
      how: 'failed',
      result: null,
      error: context.masker.maskText(message)
    }) satisfies QueryEvidence

  return {
    async prepare() {
      const tested = (await options.testConnection?.()) ?? { ok: true }
      if (!tested.ok) {
        unavailableReason = tested.message
        return tested
      }
      try {
        client = await connect(connection, password, {
          applicationName: TEST_RUN_APPLICATION_NAME,
          options: `-c statement_timeout=${timeoutMs}`,
          onError: (error) => {
            unavailableReason = error.message
          }
        })
        return { ok: true }
      } catch (error) {
        unavailableReason = error instanceof Error ? error.message : String(error)
        return { ok: false, message: unavailableReason }
      }
    },

    async run(query, context) {
      const approvedOrLocal = isLocal || context.step.approvedDataChange
      const readOnly = !approvedOrLocal
      if (readOnly && rejectsBypass(context.sql)) {
        return failed(query, context, AGENT_READ_ONLY_MESSAGE)
      }
      if (readOnly && (query.changesData || classifyDataChange(context.sql))) {
        return {
          ...baseEvidence(query, context),
          how: 'skipped-not-approved',
          result: null,
          error: NOT_APPROVED_MESSAGE
        }
      }
      if (unavailableReason !== null || client === null) {
        return failed(query, context, unavailableReason ?? 'Database connection is not ready')
      }
      if (context.signal.aborted) {
        return failed(query, context, 'Query cancelled')
      }

      const active = client
      const onAbort = (): void => {
        const pid = backendPid(active)
        if (pid !== null) {
          void cancelBackend(connect, connection, password, pid)
        }
      }
      context.signal.addEventListener('abort', onAbort, { once: true })
      try {
        const result = await execute(active, context.sql, {
          readOnly,
          typeNames,
          interruption: () => (context.signal.aborted ? { kind: 'cancelled' } : null)
        })
        if (result.kind === 'rows' || result.kind === 'command') {
          return {
            ...baseEvidence(query, context),
            how: 'automatic',
            result: toTable(result, context.masker.maskText),
            partial: result.kind === 'rows' && result.sizeLimitReached
          }
        }
        if (result.kind === 'error') {
          if (result.error.category === 'connection') {
            unavailableReason = result.error.message
          }
          return failed(query, context, result.error.message)
        }
        return failed(
          query,
          context,
          result.kind === 'cancelled' ? 'Query cancelled' : `Query timed out after ${timeoutMs} ms`
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        unavailableReason = message
        return failed(query, context, message)
      } finally {
        context.signal.removeEventListener('abort', onAbort)
      }
    },

    async dispose() {
      const closing = client
      client = null
      if (closing) {
        await closeQuietly(closing)
      }
    }
  }
}
