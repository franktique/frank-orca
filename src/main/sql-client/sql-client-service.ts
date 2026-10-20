import type {
  SqlChangedEvent,
  SqlClientFailure,
  SqlConnectionStatusEvent
} from '../../shared/sql-client/sql-client-ipc-schemas'
import { assertLocalWorkspace, type WorkspaceHostGuardStore } from '../workspace-local-host-guard'
import { SqlClientStore, type SqlClientStoreOptions } from './sql-client-store'
import { setSqlProjectDeletionListener } from './sql-client-data-deletion'
import { SqlSessionManager } from './sql-session-manager'
import { sqlFailure } from './sql-client-query-ops'
import { resolveSqlProjectKey, type SqlProjectKeyStore } from './sql-project-key'

export type SqlClientServiceDeps = {
  orcaStore: WorkspaceHostGuardStore & SqlProjectKeyStore
  /** Tests point the store at a temp dir and a fake secret store. */
  storeOptions?: Omit<SqlClientStoreOptions, 'emit' | 'getConnectionStatus'>
}

export type SqlClientEvent =
  | { channel: 'sqlClient:changed'; payload: SqlChangedEvent }
  | { channel: 'sqlClient:connectionStatus'; payload: SqlConnectionStatusEvent }

/** Shared by the renderer IPC handlers and the agent RPC methods. */
export class SqlClientService {
  readonly store: SqlClientStore
  readonly sessions: SqlSessionManager
  private readonly listeners = new Set<(event: SqlClientEvent) => void>()

  constructor(private readonly deps: SqlClientServiceDeps) {
    this.store = new SqlClientStore({
      ...deps.storeOptions,
      emit: (payload) => this.emit({ channel: 'sqlClient:changed', payload }),
      getConnectionStatus: (_projectKey, connectionId) => this.sessions.getStatus(connectionId)
    })
    this.sessions = new SqlSessionManager({
      getConnection: (projectKey, connectionId) =>
        this.store.getConnectionForRun(projectKey, connectionId),
      emitStatus: (payload) => this.emit({ channel: 'sqlClient:connectionStatus', payload })
    })
    setSqlProjectDeletionListener((projectKey) => {
      this.sessions.closeProject(projectKey)
      this.store.evict(projectKey)
    })
  }

  onEvent(listener: (event: SqlClientEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(event: SqlClientEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  /** Every entry point rejects non-local workspaces (FR-002) and derives the project key itself. */
  resolveProject(worktreeId: string): { ok: true; projectKey: string } | SqlClientFailure {
    const guard = assertLocalWorkspace(this.deps.orcaStore, worktreeId, 'The SQL tab')
    if (!guard.ok) {
      return guard
    }
    const projectKey = resolveSqlProjectKey(this.deps.orcaStore, worktreeId)
    return projectKey ? { ok: true, projectKey } : sqlFailure('not-found', 'Workspace not found.')
  }
}

let service: SqlClientService | null = null

export function initSqlClientService(deps: SqlClientServiceDeps): SqlClientService {
  service = new SqlClientService(deps)
  return service
}

export function getSqlClientService(): SqlClientService {
  if (!service) {
    throw new Error('SQL client service is not initialized')
  }
  return service
}

export function resetSqlClientServiceForTests(): void {
  service = null
}
