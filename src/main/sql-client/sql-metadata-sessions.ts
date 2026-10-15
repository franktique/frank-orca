import type { Client } from 'pg'
import type { SqlClientResult } from '../../shared/sql-client/sql-client-ipc-schemas'
import type { SqlConnection } from '../../shared/sql-client/sql-client-types'
import { sqlFailure } from './sql-client-query-ops'
import { toSqlRunError } from './pg-client-factory'
import { SqlSchemaCache } from './sql-schema-introspection'
import {
  resolveOpenableConnection,
  type SqlConnectionSource,
  type SqlMetadataSession
} from './sql-session-types'
import { SqlTypeNameCache } from './sql-type-names'

export type SqlMetadataSessionDeps = {
  getConnection: SqlConnectionSource
  open: (
    projectKey: string,
    connection: SqlConnection,
    password: string,
    onLost: () => void
  ) => Promise<Client>
  /** Reports a dropped client so the connection status stops showing "connected". */
  onLost: (projectKey: string, connectionId: string) => void
  /** Called after a client is closed on purpose, so the status can fall back to idle. */
  onClosed: (projectKey: string, connectionId: string) => void
}

type MetadataHandle = {
  client: Client
  typeNames: SqlTypeNameCache
  schemaCache: SqlSchemaCache
}

/** Per-connection clients for schema browsing, separate from any tab's session. */
export class SqlMetadataSessions {
  private readonly sessions = new Map<string, SqlMetadataSession>()

  constructor(private readonly deps: SqlMetadataSessionDeps) {}

  hasLiveClient(connectionId: string): boolean {
    return (this.sessions.get(connectionId)?.client ?? null) !== null
  }

  /** Opened on demand; reused while its client is alive. */
  async get(projectKey: string, connectionId: string): Promise<SqlClientResult<MetadataHandle>> {
    const existing = this.sessions.get(connectionId)
    if (existing?.client) {
      return {
        ok: true,
        client: existing.client,
        typeNames: existing.typeNames,
        schemaCache: existing.schemaCache
      }
    }
    const resolved = await resolveOpenableConnection(
      this.deps.getConnection,
      projectKey,
      connectionId
    )
    if ('ok' in resolved) {
      return resolved
    }
    const entry: SqlMetadataSession = {
      projectKey,
      client: null,
      typeNames: new SqlTypeNameCache(),
      schemaCache: new SqlSchemaCache()
    }
    try {
      entry.client = await this.deps.open(
        projectKey,
        resolved.connection,
        resolved.password,
        () => {
          entry.client = null
          this.sessions.delete(connectionId)
          this.deps.onLost(projectKey, connectionId)
        }
      )
    } catch (error) {
      return sqlFailure('invalid', toSqlRunError(error).message)
    }
    this.sessions.set(connectionId, entry)
    return {
      ok: true,
      client: entry.client,
      typeNames: entry.typeNames,
      schemaCache: entry.schemaCache
    }
  }

  /** Drops a client that failed, so the next browse reconnects instead of reusing it. */
  reset(connectionId: string): void {
    const meta = this.sessions.get(connectionId)
    if (meta) {
      this.close(connectionId, meta)
      this.deps.onClosed(meta.projectKey, connectionId)
    }
  }

  closeConnection(connectionId: string): void {
    const meta = this.sessions.get(connectionId)
    if (meta) {
      this.close(connectionId, meta)
    }
  }

  closeProject(projectKey: string): string[] {
    const closed: string[] = []
    for (const [connectionId, meta] of this.sessions) {
      if (meta.projectKey === projectKey) {
        this.close(connectionId, meta)
        closed.push(connectionId)
      }
    }
    return closed
  }

  closeAll(): void {
    for (const meta of this.sessions.values()) {
      void meta.client?.end().catch(() => undefined)
    }
    this.sessions.clear()
  }

  private close(connectionId: string, meta: SqlMetadataSession): void {
    this.sessions.delete(connectionId)
    const { client } = meta
    meta.client = null
    void client?.end().catch(() => undefined)
  }
}
