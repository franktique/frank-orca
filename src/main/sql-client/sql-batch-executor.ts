import Cursor from 'pg-cursor'
import type { Client, QueryResult } from 'pg'
import { applyDefaultLimit, DEFAULT_ROW_CAP } from '../../shared/sql-client/sql-default-limit'
import {
  splitSqlStatements,
  type SqlStatement
} from '../../shared/sql-client/sql-statement-splitter'
import { containsTransactionControl } from '../../shared/sql-client/sql-transaction-control'
import type { SqlColumn, SqlRunError, SqlRunResult } from '../../shared/sql-client/sql-client-types'
import { toSqlRunError } from './pg-client-factory'
import type { SqlTypeNameCache } from './sql-type-names'

export const DEFAULT_SIZE_LIMIT_BYTES = 50 * 1024 * 1024
const CURSOR_BATCH_ROWS = 500

export type SqlBatchInterruption = { kind: 'cancelled' } | { kind: 'timed-out'; timeoutMs: number }

export type SqlBatchOptions = {
  rowCap?: number
  sizeLimitBytes?: number
  /** Wraps every run in `BEGIN READ ONLY … ROLLBACK`; never commits. */
  readOnly?: boolean
  typeNames: SqlTypeNameCache
  /** Reports why the database stopped the run, so a cancel is not shown as an error. */
  interruption?: () => SqlBatchInterruption | null
}

type LastResult =
  | { kind: 'rows'; columns: SqlColumn[]; rows: (string | null)[][]; sizeLimitReached: boolean }
  | { kind: 'command'; command: string; affectedRows: number | null }

const cellBytes = (cell: string | null): number => (cell === null ? 0 : Buffer.byteLength(cell))

/** Streams the last statement through a cursor, stopping once the size budget is spent. */
async function readLastStatement(
  client: Client,
  text: string,
  sizeLimitBytes: number,
  typeNames: SqlTypeNameCache
): Promise<LastResult> {
  const cursor = client.query(new Cursor<(string | null)[]>(text, undefined, { rowMode: 'array' }))
  const rows: (string | null)[][] = []
  let bytes = 0
  let sizeLimitReached = false
  let result: QueryResult | undefined
  try {
    for (;;) {
      const batch = await new Promise<(string | null)[][]>((resolve, reject) => {
        cursor.read(CURSOR_BATCH_ROWS, (error, read, queryResult) => {
          // A read on a finished cursor calls back without a result.
          result = queryResult ?? result
          return error ? reject(error) : resolve(read)
        })
      })
      if (batch.length === 0) {
        break
      }
      for (const row of batch) {
        const rowBytes = row.reduce((sum, cell) => sum + cellBytes(cell), 0)
        if (rows.length > 0 && bytes + rowBytes > sizeLimitBytes) {
          sizeLimitReached = true
          break
        }
        rows.push(row)
        bytes += rowBytes
      }
      if (sizeLimitReached) {
        break
      }
    }
  } finally {
    await cursor.close().catch(() => undefined)
  }
  const fields = result?.fields ?? []
  if (fields.length === 0) {
    return {
      kind: 'command',
      command: result?.command ?? '',
      affectedRows: result?.rowCount ?? null
    }
  }
  const names = await typeNames.resolve(
    client,
    fields.map((field) => field.dataTypeID)
  )
  const columns = fields.map((field) => ({
    name: field.name,
    dataTypeId: field.dataTypeID,
    dataTypeName: names.get(field.dataTypeID) ?? String(field.dataTypeID)
  }))
  return { kind: 'rows', columns, rows, sizeLimitReached }
}

function failedStatementFields(
  index: number,
  total: number,
  statement: SqlStatement | undefined
): Partial<SqlRunError> {
  return total > 1 && statement
    ? { failedStatementIndex: index, failedStatementText: statement.text }
    : {}
}

/**
 * Runs the editor text: split → cap → run. Several statements without explicit transaction control
 * are all-or-nothing; explicit control is honoured as written.
 */
export async function executeSqlBatch(
  client: Client,
  sqlText: string,
  options: SqlBatchOptions
): Promise<SqlRunResult> {
  const startedAt = Date.now()
  const elapsed = (): number => Date.now() - startedAt
  const original = splitSqlStatements(sqlText)
  const { statements, rowCapApplied } = applyDefaultLimit(
    original,
    options.rowCap ?? DEFAULT_ROW_CAP
  )
  if (statements.length === 0) {
    return {
      kind: 'command',
      command: '',
      affectedRows: null,
      statementCount: 0,
      elapsedMs: elapsed()
    }
  }
  const explicitControl = !options.readOnly && containsTransactionControl(statements)
  const wrapped = options.readOnly === true || (!explicitControl && statements.length > 1)

  let failedIndex = 0
  try {
    if (wrapped) {
      await client.query(options.readOnly ? 'BEGIN READ ONLY' : 'BEGIN')
    }
    let last: LastResult | null = null
    for (failedIndex = 0; failedIndex < statements.length; failedIndex++) {
      const isLast = failedIndex === statements.length - 1
      const { text } = statements[failedIndex]
      if (isLast) {
        last = await readLastStatement(
          client,
          text,
          options.sizeLimitBytes ?? DEFAULT_SIZE_LIMIT_BYTES,
          options.typeNames
        )
      } else {
        await client.query(text)
      }
    }
    if (wrapped) {
      await client.query(options.readOnly ? 'ROLLBACK' : 'COMMIT')
    }
    if (!last) {
      return {
        kind: 'command',
        command: '',
        affectedRows: null,
        statementCount: 0,
        elapsedMs: elapsed()
      }
    }
    const common = { statementCount: statements.length, elapsedMs: elapsed() }
    return last.kind === 'rows'
      ? {
          kind: 'rows',
          columns: last.columns,
          rows: last.rows,
          rowCount: last.rows.length,
          rowCapApplied,
          sizeLimitReached: last.sizeLimitReached,
          ...common
        }
      : { kind: 'command', command: last.command, affectedRows: last.affectedRows, ...common }
  } catch (error) {
    if (wrapped || explicitControl) {
      // An open or aborted transaction would poison the session for the next run.
      await client.query('ROLLBACK').catch(() => undefined)
    }
    const interruption = options.interruption?.()
    if (interruption) {
      return { ...interruption, elapsedMs: elapsed() }
    }
    const { position: statementPosition, ...mapped } = toSqlRunError(error)
    const failed = statements[failedIndex]
    return {
      kind: 'error',
      elapsedMs: elapsed(),
      error: {
        ...mapped,
        ...(statementPosition !== undefined && failed
          ? { position: failed.startOffset + statementPosition }
          : {}),
        ...failedStatementFields(failedIndex, statements.length, original[failedIndex]),
        // With explicit transaction control, earlier statements may already have run.
        nothingApplied: !explicitControl || failedIndex === 0
      }
    }
  }
}
