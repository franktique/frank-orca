import { randomUUID } from 'node:crypto'
import { getSecretStore, type SecretStore } from '../../shared/secret-store'
import type {
  SqlChangedEvent,
  SqlClientResult
} from '../../shared/sql-client/sql-client-ipc-schemas'
import type {
  SqlConnection,
  SqlConnectionStatus,
  SqlConnectionView
} from '../../shared/sql-client/sql-client-types'
import { derivePasswordState, storePassword, toConnectionView } from './sql-connection-fields'
import {
  loadProjectState,
  persistProjectRecords,
  toSqlStoreFailure,
  type ProjectSqlRecords,
  type ProjectState
} from './sql-client-project-files'
import type * as queryOps from './sql-client-query-ops'

export type SqlClientStoreOptions = {
  root?: string
  secretStore?: SecretStore
  emit?: (event: SqlChangedEvent) => void
  getConnectionStatus?: (projectKey: string, connectionId: string) => SqlConnectionStatus
  now?: () => string
  newId?: () => string
}

export const IDLE: SqlConnectionStatus = { state: 'idle' }

export class SqlClientStoreBase {
  private readonly projects = new Map<string, Promise<ProjectState>>()

  constructor(protected readonly options: SqlClientStoreOptions = {}) {}

  protected get secretStore(): SecretStore {
    return this.options.secretStore ?? getSecretStore()
  }

  protected ctx(): queryOps.QueryOpContext {
    return {
      now: (this.options.now ?? (() => new Date().toISOString()))(),
      newId: this.options.newId ?? randomUUID
    }
  }

  protected load(projectKey: string): Promise<ProjectState> {
    let loaded = this.projects.get(projectKey)
    if (!loaded) {
      loaded = loadProjectState(projectKey, this.options.root)
      this.projects.set(projectKey, loaded)
      // A failed load must not be cached: the next call retries.
      loaded.catch(() => this.projects.delete(projectKey))
    }
    return loaded
  }

  /** Drops the cached project so deleted data is not resurrected by the next write. */
  evict(projectKey: string): void {
    this.projects.delete(projectKey)
  }

  protected async serialized<T extends object>(
    projectKey: string,
    fn: (state: ProjectState) => Promise<SqlClientResult<T>> | SqlClientResult<T>
  ): Promise<SqlClientResult<T>> {
    try {
      const state = await this.load(projectKey)
      const result = state.queue.then(() => fn(state))
      state.queue = result.catch(() => undefined)
      return await result
    } catch (error) {
      return toSqlStoreFailure(error)
    }
  }

  protected emit(
    projectKey: string,
    changes: readonly Omit<SqlChangedEvent, 'projectKey'>[]
  ): void {
    for (const change of changes) {
      this.options.emit?.({ projectKey, ...change })
    }
  }

  protected toView(state: ProjectState, connection: SqlConnection): SqlConnectionView {
    return toConnectionView(
      connection,
      derivePasswordState(connection, state.sessionPasswords, this.secretStore),
      this.options.getConnectionStatus?.(state.projectKey, connection.id) ?? IDLE
    )
  }

  protected storePassword(
    state: ProjectState,
    connectionId: string,
    password: string
  ): SqlConnection['password'] {
    return storePassword(state.sessionPasswords, connectionId, password, this.secretStore)
  }

  protected async commit<R extends object>(
    state: ProjectState,
    next: ProjectSqlRecords,
    which: { connections: boolean; queries: boolean },
    changes: readonly Omit<SqlChangedEvent, 'projectKey'>[],
    respond: () => R
  ): Promise<SqlClientResult<R>> {
    await persistProjectRecords(state, next, which)
    state.connections = next.connections
    state.collections = next.collections
    state.queries = next.queries
    this.emit(state.projectKey, changes)
    return { ok: true, ...respond() }
  }
}
