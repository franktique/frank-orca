import path from 'node:path'
import { Client, DatabaseError, type ClientConfig } from 'pg'
import type {
  SqlConnection,
  SqlRunError,
  SqlRunErrorCategory
} from '../../shared/sql-client/sql-client-types'

export type PgClientExtras = {
  /** Raw server `options` startup parameter, e.g. `-c statement_timeout=30000`. */
  options?: string
  applicationName?: string
  /** Called for errors on a connection with no query in flight (server restart, network drop). */
  onError?: (error: Error) => void
}

type ConnectionTarget = Pick<SqlConnection, 'host' | 'port' | 'user' | 'database' | 'sslMode'>

const CONNECT_TIMEOUT_MS = 10_000

// Every value stays in PostgreSQL's text form so copies match `psql` (FR-016).
const rawTextTypes = { getTypeParser: () => (value: string) => value }

const isSocketHost = (host: string): boolean => path.posix.isAbsolute(host)

function buildConfig(
  connection: ConnectionTarget,
  password: string,
  ssl: ClientConfig['ssl'],
  extras: PgClientExtras
): ClientConfig {
  return {
    host: connection.host,
    port: connection.port,
    user: connection.user,
    database: connection.database,
    password,
    ssl,
    application_name: extras.applicationName ?? 'Orca SQL',
    options: extras.options,
    types: rawTextTypes,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    keepAlive: true
  }
}

function sslFor(connection: ConnectionTarget, preferEncrypted: boolean): ClientConfig['ssl'] {
  if (isSocketHost(connection.host) || connection.sslMode === 'disable' || !preferEncrypted) {
    return false
  }
  // Certificates are not verified, as with libpq's `prefer` and `require`.
  return { rejectUnauthorized: false }
}

export function isSslUnsupportedError(error: unknown): boolean {
  return error instanceof Error && /does not support SSL/i.test(error.message)
}

function newClient(
  connection: ConnectionTarget,
  password: string,
  encrypted: boolean,
  extras: PgClientExtras
): Client {
  const client = new Client(
    buildConfig(connection, password, sslFor(connection, encrypted), extras)
  )
  // An unhandled 'error' event would crash the main process.
  client.on('error', (error) => extras.onError?.(error))
  return client
}

/** `prefer` falls back to an unencrypted connection only when the server has no SSL, like libpq. */
export async function connectPgClient(
  connection: ConnectionTarget,
  password: string,
  extras: PgClientExtras = {}
): Promise<Client> {
  const client = newClient(connection, password, true, extras)
  try {
    await client.connect()
    return client
  } catch (error) {
    await client.end().catch(() => undefined)
    if (connection.sslMode === 'prefer' && isSslUnsupportedError(error)) {
      const plain = newClient(connection, password, false, extras)
      try {
        await plain.connect()
        return plain
      } catch (plainError) {
        await plain.end().catch(() => undefined)
        throw plainError
      }
    }
    throw error
  }
}

/** The backend pid the server reported at connect time; `pg` exposes it untyped. */
export function backendPid(client: Client): number | null {
  return 'processID' in client && typeof client.processID === 'number' ? client.processID : null
}

const NETWORK_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EPIPE'])

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}

function categorize(error: unknown): SqlRunErrorCategory {
  const code = errorCode(error)
  const message = error instanceof Error ? error.message : ''
  if (/SSL|encryption/i.test(message) && (code === '28000' || isSslUnsupportedError(error))) {
    return 'ssl'
  }
  if (code === '28P01' || code === '28000') {
    return 'auth'
  }
  if (code === '25006') {
    return 'read-only'
  }
  if (code === '42601') {
    return 'syntax'
  }
  if (
    (code && NETWORK_CODES.has(code)) ||
    code === '57P01' ||
    code === '57P02' ||
    code === '57P03' ||
    code?.startsWith('08') ||
    /Connection terminated|timeout expired|Client has encountered a connection error/i.test(message)
  ) {
    return 'connection'
  }
  return 'other'
}

/** Maps any pg or Node error into the shape the grid shows; `position` is relative to its statement. */
export function toSqlRunError(error: unknown): SqlRunError {
  const message = error instanceof Error ? error.message : String(error)
  const code = errorCode(error)
  const result: SqlRunError = { message, category: categorize(error) }
  if (code) {
    result.code = code
  }
  if (error instanceof DatabaseError) {
    const position = error.position ? Number.parseInt(error.position, 10) : Number.NaN
    if (Number.isInteger(position) && position > 0) {
      result.position = position
    }
    if (error.detail) {
      result.detail = error.detail
    }
    if (error.hint) {
      result.hint = error.hint
    }
  }
  return result
}
