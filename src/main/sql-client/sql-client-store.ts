import { SqlClientQueryStore } from './sql-client-query-store'
export type { SqlClientStoreOptions } from './sql-client-store-base'
import type {
  SqlClientFailure,
  SqlClientResult,
  SqlConnectionInput,
  SqlConnectionUpdateInput,
  SqlSnapshot
} from '../../shared/sql-client/sql-client-ipc-schemas'
import { findDuplicateConnectionName } from '../../shared/sql-client/sql-client-schemas'
import type { SqlConnection, SqlConnectionView } from '../../shared/sql-client/sql-client-types'
import { getSecretProtection, openSecretCipher } from '../secret-value-codec'
import { definedFields } from './sql-connection-fields'
import { toSqlStoreFailure } from './sql-client-project-files'
import { sqlFailure } from './sql-client-query-ops'

export class SqlClientStore extends SqlClientQueryStore {
  async getSnapshot(projectKey: string): Promise<SqlClientResult<SqlSnapshot>> {
    return this.serialized(projectKey, (state) => {
      const protection = getSecretProtection(this.secretStore)
      return {
        ok: true,
        projectKey,
        connections: state.connections.map((c) => this.toView(state, c)),
        collections: state.collections,
        queries: state.queries,
        encryptionAvailable: this.secretStore.isEncryptionAvailable(),
        ...(protection ? { protectionGapMessage: protection.message } : {})
      }
    })
  }

  async createConnection(
    projectKey: string,
    input: SqlConnectionInput
  ): Promise<SqlClientResult<{ connection: SqlConnectionView }>> {
    return this.serialized(projectKey, async (state) => {
      if (findDuplicateConnectionName(state.connections, input.name)) {
        return sqlFailure('invalid', `A connection named "${input.name.trim()}" already exists.`)
      }
      const ctx = this.ctx()
      const id = ctx.newId()
      const connection: SqlConnection = {
        id,
        name: input.name.trim(),
        host: input.host,
        port: input.port,
        user: input.user,
        database: input.database,
        sslMode: input.sslMode,
        password: this.storePassword(state, id, input.password),
        createdAt: ctx.now,
        updatedAt: ctx.now,
        revision: 1
      }
      return this.commit(
        state,
        { ...state, connections: [...state.connections, connection] },
        {
          connections: true,
          queries: false
        },
        [{ kind: 'connection', id, revision: 1 }],
        () => ({
          connection: this.toView(state, connection)
        })
      )
    })
  }

  async updateConnection(
    projectKey: string,
    id: string,
    baseRevision: number,
    input: SqlConnectionUpdateInput
  ): Promise<SqlClientResult<{ connection: SqlConnectionView }>> {
    return this.serialized(projectKey, async (state) => {
      const existing = state.connections.find((c) => c.id === id)
      if (!existing) {
        return sqlFailure('not-found', 'Connection not found.')
      }
      if (existing.revision !== baseRevision) {
        return sqlFailure(
          'conflict',
          'This connection was changed elsewhere. Reload and try again.'
        )
      }
      if (
        input.name !== undefined &&
        findDuplicateConnectionName(state.connections, input.name, id)
      ) {
        return sqlFailure('invalid', `A connection named "${input.name.trim()}" already exists.`)
      }
      const { password, ...fields } = input
      const next: SqlConnection = {
        ...existing,
        ...definedFields(fields),
        name: (input.name ?? existing.name).trim(),
        password:
          password === undefined ? existing.password : this.storePassword(state, id, password),
        updatedAt: this.ctx().now,
        revision: existing.revision + 1
      }
      return this.commit(
        state,
        { ...state, connections: state.connections.map((c) => (c.id === id ? next : c)) },
        { connections: true, queries: false },
        [{ kind: 'connection', id, revision: next.revision }],
        () => ({ connection: this.toView(state, next) })
      )
    })
  }

  async deleteConnection(
    projectKey: string,
    id: string
  ): Promise<SqlClientResult<{ deletedQueries: number; deletedCollections: number }>> {
    return this.serialized(projectKey, async (state) => {
      if (!state.connections.some((c) => c.id === id)) {
        return sqlFailure('not-found', 'Connection not found.')
      }
      const queries = state.queries.filter((q) => q.connectionId !== id)
      const collections = state.collections.filter((c) => c.connectionId !== id)
      const counts = {
        deletedQueries: state.queries.length - queries.length,
        deletedCollections: state.collections.length - collections.length
      }
      const result = await this.commit(
        state,
        {
          ...state,
          connections: state.connections.filter((c) => c.id !== id),
          collections,
          queries
        },
        { connections: true, queries: true },
        [{ kind: 'connection', id, revision: null }],
        () => counts
      )
      state.sessionPasswords.delete(id)
      return result
    })
  }

  /** Main-process only: the connection with its opened password. `null` password = re-enter it. */
  async getConnectionForRun(
    projectKey: string,
    connectionId: string
  ): Promise<{ connection: SqlConnection; password: string | null } | SqlClientFailure> {
    try {
      const state = await this.load(projectKey)
      const connection = state.connections.find((c) => c.id === connectionId)
      if (!connection) {
        return sqlFailure('not-found', 'Connection not found.')
      }
      if (connection.password === null) {
        return { connection, password: state.sessionPasswords.get(connectionId) ?? '' }
      }
      return {
        connection,
        password: openSecretCipher(connection.password.cipher, this.secretStore)
      }
    } catch (error) {
      return toSqlStoreFailure(error)
    }
  }

  async listConnectionViews(projectKey: string): Promise<SqlConnectionView[] | SqlClientFailure> {
    try {
      const state = await this.load(projectKey)
      return state.connections.map((c) => this.toView(state, c))
    } catch (error) {
      return toSqlStoreFailure(error)
    }
  }
}
