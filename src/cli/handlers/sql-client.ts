import { readFileSync } from 'node:fs'
import type { CommandHandler } from '../dispatch'
import {
  getOptionalPositiveIntegerFlag,
  getOptionalStringFlag,
  getRequiredStringFlag
} from '../flags'
import { printResult } from '../format'
import type { RuntimeClient } from '../runtime/client'
import { RuntimeClientError, type RuntimeRpcSuccess } from '../runtime/types'
import { getEmulatorWorktreeSelector } from '../selectors'

const TABLE_ROW_LIMIT = 100
const DEFAULT_TIMEOUT_SECONDS = 30

// Exit codes an agent can rely on (contracts/cli-rpc.md).
const EXIT_RPC_FAILURE = 1
const EXIT_SQL_ERROR = 2
const EXIT_READ_ONLY = 3
const EXIT_TIMED_OUT = 4

type Failure = { ok: false; code: string; message: string }
type Connection = {
  id: string
  name: string
  host: string
  port: number
  database: string
  user: string
  sslMode: string
  agentAccess: string
  passwordState: string
}
type ConnectionsPayload = { projectKey: string; connections: Connection[] }
type QueriesPayload = {
  collections: { id: string; connectionId: string; name: string }[]
  queries: {
    id: string
    connectionId: string
    collectionId: string | null
    name: string
    sql: string
    updatedAt: string
  }[]
}
type RunError = {
  message: string
  code?: string
  position?: number
  detail?: string
  hint?: string
  failedStatementIndex?: number
  failedStatementText?: string
  nothingApplied?: boolean
  category: string
}
type RunResult =
  | {
      kind: 'rows'
      columns: { name: string }[]
      rows: (string | null)[][]
      rowCount: number
      rowCapApplied: boolean
      sizeLimitReached: boolean
      elapsedMs: number
    }
  | { kind: 'command'; command: string; affectedRows: number | null; elapsedMs: number }
  | { kind: 'error'; error: RunError; elapsedMs: number }
  | { kind: 'cancelled'; elapsedMs: number }
  | { kind: 'timed-out'; timeoutMs: number; elapsedMs: number }
type RunPayload = { connectionId: string; agentAccess: string; result: RunResult }

function isFailure(value: unknown): value is Failure {
  return typeof value === 'object' && value !== null && 'ok' in value && value.ok === false
}

/** Old hosts reject the method outright; say so instead of a raw RPC error. */
async function callSql<T>(
  client: RuntimeClient,
  method: string,
  params: unknown,
  options?: { timeoutMs?: number }
): Promise<RuntimeRpcSuccess<T | Failure>> {
  try {
    return await client.call<T | Failure>(method, params, options)
  } catch (error) {
    if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
      throw new RuntimeClientError(
        'method_not_found',
        'This Orca version does not support `orca sql`; update Orca.'
      )
    }
    throw error
  }
}

function render<T>(
  res: RuntimeRpcSuccess<T | Failure>,
  json: boolean,
  format: (value: T) => string
): void {
  if (isFailure(res.result)) {
    process.exitCode = EXIT_RPC_FAILURE
    if (!json) {
      console.error(res.result.message)
    }
  }
  printResult(res, json, (value) => (isFailure(value) ? '' : format(value)))
}

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => row[column]?.length ?? 0))
  )
  const line = (cells: string[]): string =>
    cells
      .map((cell, column) => cell.padEnd(widths[column]))
      .join('  ')
      .trimEnd()
  return [line(headers), line(widths.map((width) => '-'.repeat(width))), ...rows.map(line)].join(
    '\n'
  )
}

function formatConnections(value: ConnectionsPayload): string {
  if (value.connections.length === 0) {
    return 'No connections.'
  }
  return table(
    ['NAME', 'ID', 'TARGET', 'ACCESS', 'PASSWORD'],
    value.connections.map((c) => [
      c.name,
      c.id,
      `${c.user}@${c.host}:${c.port}/${c.database}`,
      c.agentAccess,
      c.passwordState
    ])
  )
}

function formatQueries(value: QueriesPayload): string {
  if (value.queries.length === 0 && value.collections.length === 0) {
    return 'No saved queries.'
  }
  const collectionName = new Map(value.collections.map((c) => [c.id, c.name]))
  const lines = value.collections.map((c) => `Collection: ${c.name}  (${c.id})`)
  for (const query of value.queries) {
    const where = query.collectionId ? ` [${collectionName.get(query.collectionId) ?? '?'}]` : ''
    lines.push(
      `${query.name}${where}  (${query.id})`,
      `  ${query.sql.replace(/\s+/g, ' ').slice(0, 100)}`
    )
  }
  return lines.join('\n')
}

function describeError(error: RunError): string {
  const lines = [`Error: ${error.message}`]
  if (error.code) {
    lines.push(`  SQLSTATE: ${error.code}`)
  }
  if (error.position) {
    lines.push(`  Position: ${error.position}`)
  }
  if (error.detail) {
    lines.push(`  Detail: ${error.detail}`)
  }
  if (error.hint) {
    lines.push(`  Hint: ${error.hint}`)
  }
  if (error.failedStatementIndex !== undefined) {
    lines.push(
      `  Failed statement ${error.failedStatementIndex + 1}: ${error.failedStatementText ?? ''}`
    )
  }
  if (error.nothingApplied === true) {
    lines.push('  Nothing was applied.')
  }
  return lines.join('\n')
}

function formatRun(payload: RunPayload): string {
  const { result } = payload
  switch (result.kind) {
    case 'rows': {
      const shown = result.rows.slice(0, TABLE_ROW_LIMIT)
      const notes = [
        ...(result.rows.length > TABLE_ROW_LIMIT
          ? [`showing first ${TABLE_ROW_LIMIT} rows (use --json for all)`]
          : []),
        ...(result.rowCapApplied ? ['row cap 1000 applied'] : []),
        ...(result.sizeLimitReached ? ['size limit 50 MB reached'] : [])
      ]
      return [
        table(
          result.columns.map((column) => column.name),
          shown.map((row) => row.map((cell) => cell ?? 'NULL'))
        ),
        '',
        [`${result.rowCount} rows`, `${result.elapsedMs} ms`, ...notes].join(' · ')
      ].join('\n')
    }
    case 'command':
      return [
        result.affectedRows === null
          ? `${result.command || 'Command'} completed`
          : `${result.affectedRows} rows affected`,
        `${result.elapsedMs} ms`
      ].join(' · ')
    case 'error':
      return describeError(result.error)
    case 'cancelled':
      return 'Query cancelled.'
    case 'timed-out':
      return `Query timed out after ${Math.round(result.timeoutMs / 1000)} s; the database cancelled it and nothing it changed was kept.`
  }
}

function exitCodeFor(result: RunResult): number {
  if (result.kind === 'timed-out') {
    return EXIT_TIMED_OUT
  }
  if (result.kind === 'error') {
    return result.error.category === 'read-only' ? EXIT_READ_ONLY : EXIT_SQL_ERROR
  }
  return result.kind === 'cancelled' ? EXIT_SQL_ERROR : 0
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Pass --sql, --file or --query, or pipe SQL on stdin.'
    )
  }
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Exactly one source of SQL: --sql, --file, --query (saved), or stdin. */
async function readSource(
  flags: Map<string, string | boolean>
): Promise<{ sql?: string; savedQuery?: string }> {
  const sql = getOptionalStringFlag(flags, 'sql')
  const file = getOptionalStringFlag(flags, 'file')
  const savedQuery = getOptionalStringFlag(flags, 'query')
  const given = [sql, file, savedQuery].filter((value) => value !== undefined).length
  if (given > 1) {
    throw new RuntimeClientError('invalid_argument', 'Use only one of --sql, --file and --query.')
  }
  if (savedQuery !== undefined) {
    return { savedQuery }
  }
  if (sql !== undefined) {
    return { sql }
  }
  if (file !== undefined) {
    try {
      return { sql: readFileSync(file, 'utf8') }
    } catch (error) {
      throw new RuntimeClientError(
        'invalid_argument',
        `Cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
  const piped = await readStdin()
  if (piped.trim().length === 0) {
    throw new RuntimeClientError('invalid_argument', 'No SQL was given.')
  }
  return { sql: piped }
}

export const SQL_CLIENT_HANDLERS: Record<string, CommandHandler> = {
  'sql connections': async ({ flags, client, cwd, json }) => {
    const worktree = await getEmulatorWorktreeSelector(flags, cwd, client)
    render(
      await callSql<ConnectionsPayload>(client, 'sql.connections', { worktree }),
      json,
      formatConnections
    )
  },
  'sql queries': async ({ flags, client, cwd, json }) => {
    const worktree = await getEmulatorWorktreeSelector(flags, cwd, client)
    const connection = getOptionalStringFlag(flags, 'connection')
    render(
      await callSql<QueriesPayload>(client, 'sql.queries', { worktree, connection }),
      json,
      formatQueries
    )
  },
  'sql run': async ({ flags, client, cwd, json }) => {
    const worktree = await getEmulatorWorktreeSelector(flags, cwd, client)
    const source = await readSource(flags)
    const timeoutSeconds = getOptionalPositiveIntegerFlag(flags, 'timeout')
    const res = await callSql<RunPayload>(
      client,
      'sql.run',
      {
        worktree,
        connection: getRequiredStringFlag(flags, 'connection'),
        ...source,
        timeoutSeconds
      },
      // The host stops the run at --timeout, so the client waits slightly longer for the reply.
      { timeoutMs: (timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000 + 30_000 }
    )
    if (!isFailure(res.result)) {
      const code = exitCodeFor(res.result.result)
      if (code !== 0) {
        process.exitCode = code
      }
    }
    render(res, json, formatRun)
  }
}
