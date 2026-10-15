import type { Client } from 'pg'
import type {
  SqlClientResult,
  SqlConnectionStatusEvent
} from '../../shared/sql-client/sql-client-ipc-schemas'
import type {
  SqlConnection,
  SqlConnectionStatus,
  SqlRunResult
} from '../../shared/sql-client/sql-client-types'
import { backendPid, connectPgClient, toSqlRunError } from './pg-client-factory'
import { executeSqlBatch } from './sql-batch-executor'
import { sqlFailure } from './sql-client-query-ops'
import { SqlConnectionStatusTracker } from './sql-connection-status'
import type { SqlSchemaCache } from './sql-schema-introspection'
import { SqlMetadataSessions } from './sql-metadata-sessions'
import { cancelBackend } from './sql-backend-cancel'
import {
  resolveOpenableConnection,
  type SqlConnectionSource,
  type SqlSession
} from './sql-session-types'
import { SqlTypeNameCache } from './sql-type-names'

export type SqlSessionManagerDeps = {
  getConnection: SqlConnectionSource
  emitStatus: (event: SqlConnectionStatusEvent) => void
  connectClient?: typeof connectPgClient
}

// A connection idle this long is probed before use, so a silent drop reconnects instead of failing.
const PROBE_AFTER_IDLE_MS = 3000

/** One database session per SQL tab; settings like `SET` never leak between tabs. */
export class SqlSessionManager {
  private readonly sessions = new Map<string, SqlSession>()
  private readonly metadata: SqlMetadataSessions
  private readonly status: SqlConnectionStatusTracker
  private readonly connectClient: typeof connectPgClient

  constructor(private readonly deps: SqlSessionManagerDeps) {
    this.status = new SqlConnectionStatusTracker(deps.emitStatus)
    this.connectClient = deps.connectClient ?? connectPgClient
    this.metadata = new SqlMetadataSessions({
      getConnection: deps.getConnection,
      open: (projectKey, connection, password, onLost) =>
        this.open(projectKey, connection, password, onLost),
      onLost: (projectKey, connectionId) => this.markLost(projectKey, connectionId),
      onClosed: (projectKey, connectionId) => this.refreshStatus(projectKey, connectionId)
    })
  }

  getStatus(connectionId: string): SqlConnectionStatus {
    return this.status.get(connectionId)
  }

  private hasLiveClient(connectionId: string): boolean {
    return (
      [...this.sessions.values()].some(
        (s) => s.connection.id === connectionId && s.client !== null && !s.lost
      ) || this.metadata.hasLiveClient(connectionId)
    )
  }

  /** A dropped client leaves "connected" only once no other live client remains. */
  private markLost(projectKey: string, connectionId: string): void {
    if (!this.hasLiveClient(connectionId)) {
      this.status.set(projectKey, connectionId, {
        state: 'error',
        message: 'Connection lost'
      })
    }
  }

  private refreshStatus(projectKey: string, connectionId: string): void {
    if (!this.hasLiveClient(connectionId)) {
      const current = this.status.get(connectionId)
      // An error stays visible until the user acts; only a clean close returns to idle.
      if (current.state !== 'error') {
        this.status.set(projectKey, connectionId, { state: 'idle' })
      }
    }
  }

  private async open(
    projectKey: string,
    connection: SqlConnection,
    password: string,
    onLost: () => void
  ): Promise<Client> {
    this.status.set(projectKey, connection.id, { state: 'connecting' })
    try {
      const client = await this.connectClient(connection, password, {
        onError: onLost
      })
      client.on('end', onLost)
      this.status.set(projectKey, connection.id, { state: 'connected' })
      return client
    } catch (error) {
      const mapped = toSqlRunError(error)
      this.status.set(projectKey, connection.id, {
        state: 'error',
        message: mapped.message,
        ...(mapped.code ? { code: mapped.code } : {})
      })
      throw error
    }
  }

  private discard(session: SqlSession): void {
    const { client } = session
    session.client = null
    void client?.end().catch(() => undefined)
    this.refreshStatus(session.projectKey, session.connection.id)
  }

  private async ensureClient(session: SqlSession): Promise<Client> {
    const stale = session.client !== null && Date.now() - session.lastUsedAt > PROBE_AFTER_IDLE_MS
    if (session.client && !session.lost && stale) {
      try {
        await session.client.query('SELECT 1')
      } catch {
        session.lost = true
      }
    }
    if (session.client && !session.lost) {
      return session.client
    }
    // Reconnect once, only here: nothing of the next batch has been sent yet.
    this.discard(session)
    session.lost = false
    let opened: Client | null = null
    // Ignore events from a client already replaced or closed on purpose.
    const onLost = (): void => {
      if (opened === null || session.client !== opened) {
        return
      }
      session.lost = true
      this.markLost(session.projectKey, session.connection.id)
    }
    opened = await this.open(session.projectKey, session.connection, session.password, onLost)
    session.client = opened
    return opened
  }

  async run(
    projectKey: string,
    tabId: string,
    connectionId: string,
    runId: string,
    sqlText: string
  ): Promise<SqlClientResult<{ result: SqlRunResult }>> {
    let session = this.sessions.get(tabId)
    if (session?.activeRun) {
      return sqlFailure('invalid', 'A query is already running in this tab.')
    }
    if (session && session.connection.id !== connectionId) {
      this.closeTabSession(tabId)
      session = undefined
    }
    if (!session) {
      const resolved = await resolveOpenableConnection(
        this.deps.getConnection,
        projectKey,
        connectionId
      )
      if ('ok' in resolved) {
        return resolved
      }
      session = {
        projectKey,
        connection: resolved.connection,
        password: resolved.password,
        client: null,
        lost: false,
        lastUsedAt: Date.now(),
        typeNames: new SqlTypeNameCache(),
        activeRun: null
      }
      this.sessions.set(tabId, session)
    }
    const active = { runId, cancelRequested: false }
    session.activeRun = active
    const startedAt = Date.now()
    try {
      const client = await this.ensureClient(session)
      const result = await executeSqlBatch(client, sqlText, {
        typeNames: session.typeNames,
        interruption: () => (active.cancelRequested ? { kind: 'cancelled' } : null)
      })
      if (result.kind === 'error' && result.error.category === 'connection') {
        session.lost = true
        this.markLost(projectKey, connectionId)
        const message = `Connection lost: ${result.error.message}`
        return { ok: true, result: { ...result, error: { ...result.error, message } } }
      }
      return { ok: true, result }
    } catch (error) {
      session.lost = true
      this.markLost(projectKey, connectionId)
      const elapsedMs = Date.now() - startedAt
      return { ok: true, result: { kind: 'error', error: toSqlRunError(error), elapsedMs } }
    } finally {
      session.activeRun = null
      session.lastUsedAt = Date.now()
    }
  }

  /** Cancels from a short-lived second connection, since the busy one cannot answer. */
  async cancel(tabId: string, runId: string): Promise<void> {
    const session = this.sessions.get(tabId)
    if (!session?.activeRun || session.activeRun.runId !== runId || !session.client) {
      return
    }
    session.activeRun.cancelRequested = true
    const pid = backendPid(session.client)
    if (pid === null) {
      return
    }
    if (!(await cancelBackend(this.connectClient, session.connection, session.password, pid))) {
      // The run keeps going; the user can retry the cancel.
      session.activeRun.cancelRequested = false
    }
  }

  closeTabSession(tabId: string): void {
    const session = this.sessions.get(tabId)
    if (session) {
      this.sessions.delete(tabId)
      this.discard(session)
    }
  }

  /** Metadata client for schema browsing; opened on demand, separate from any tab's session. */
  getMetadataSession(
    projectKey: string,
    connectionId: string
  ): Promise<
    SqlClientResult<{
      client: Client
      typeNames: SqlTypeNameCache
      schemaCache: SqlSchemaCache
    }>
  > {
    return this.metadata.get(projectKey, connectionId)
  }

  resetMetadataSession(connectionId: string): void {
    this.metadata.reset(connectionId)
  }

  async connect(
    projectKey: string,
    connectionId: string
  ): Promise<SqlClientResult<{ status: SqlConnectionStatus }>> {
    const result = await this.getMetadataSession(projectKey, connectionId)
    return result.ok ? { ok: true, status: this.status.get(connectionId) } : result
  }

  /** Closes every session of a connection, including its metadata client. */
  disconnect(projectKey: string, connectionId: string): void {
    for (const [tabId, session] of this.sessions) {
      if (session.connection.id === connectionId) {
        this.sessions.delete(tabId)
        this.discard(session)
      }
    }
    this.metadata.closeConnection(connectionId)
    this.status.set(projectKey, connectionId, { state: 'idle' })
  }

  /** Closes every session and metadata client of a project, e.g. when the project is removed. */
  closeProject(projectKey: string): void {
    for (const [tabId, session] of this.sessions) {
      if (session.projectKey === projectKey) {
        this.sessions.delete(tabId)
        this.discard(session)
      }
    }
    for (const connectionId of this.metadata.closeProject(projectKey)) {
      this.status.set(projectKey, connectionId, { state: 'idle' })
    }
  }

  closeAll(): void {
    for (const session of this.sessions.values()) {
      void session.client?.end().catch(() => undefined)
    }
    this.metadata.closeAll()
    this.sessions.clear()
  }
}
