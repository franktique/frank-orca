import { defineMethod, type RpcContext } from '../core'
import {
  SqlConnectionsParams,
  SqlQueriesParams,
  SqlRunParams
} from '../../../../shared/rpc-contract/sql-client-params'
import type { SqlConnectionView } from '../../../../shared/sql-client/sql-client-types'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import { runAgentQuery } from '../../../sql-client/sql-agent-runner'
import { getSqlClientService, type SqlClientService } from '../../../sql-client/sql-client-service'

const DEFAULT_TIMEOUT_SECONDS = 30

type Failure = { ok: false; code: string; message: string }
const fail = (code: string, message: string): Failure => ({ ok: false, code, message })

type Resolved = { ok: true; service: SqlClientService; projectKey: string } | Failure

/** Resolves the worktree selector and enforces the local-only rule for every method. */
async function resolveTarget(runtime: RpcContext['runtime'], worktree?: string): Promise<Resolved> {
  let service: SqlClientService
  try {
    service = getSqlClientService()
  } catch {
    return fail('unavailable', 'The SQL tab is not available on this host.')
  }
  if (!worktree) {
    return fail('selector_not_found', 'No worktree was given and none could be inferred.')
  }
  const scope = await runtime.showTerminalWorkspaceLaunchScope(worktree)
  const worktreeId = scope.folderWorkspace ? folderWorkspaceKey(scope.folderWorkspace.id) : scope.id
  const project = service.resolveProject(worktreeId)
  return project.ok
    ? { ok: true, service, projectKey: project.projectKey }
    : fail(project.code, project.message)
}

/** A connection by exact id, else by case-insensitive name; an ambiguous name lists its ids. */
function findConnection(
  connections: readonly SqlConnectionView[],
  selector: string
): { ok: true; connection: SqlConnectionView } | Failure {
  const byId = connections.find((connection) => connection.id === selector)
  if (byId) {
    return { ok: true, connection: byId }
  }
  const wanted = selector.trim().toLowerCase()
  const byName = connections.filter((connection) => connection.name.toLowerCase() === wanted)
  if (byName.length === 1) {
    return { ok: true, connection: byName[0] }
  }
  if (byName.length > 1) {
    return fail(
      'ambiguous',
      `Several connections are named "${selector}": ${byName.map((c) => c.id).join(', ')}. Pass an id.`
    )
  }
  return fail('not-found', `No connection has the id or name "${selector}".`)
}

function describeConnection(connection: SqlConnectionView) {
  return {
    id: connection.id,
    name: connection.name,
    host: connection.host,
    port: connection.port,
    database: connection.database,
    user: connection.user,
    sslMode: connection.sslMode,
    agentAccess: connection.agentAccess,
    passwordState: connection.passwordState
  }
}

export const SQL_CLIENT_METHODS = [
  defineMethod({
    name: 'sql.connections',
    params: SqlConnectionsParams,
    handler: async (params, { runtime }) => {
      const target = await resolveTarget(runtime, params.worktree)
      if (!target.ok) {
        return target
      }
      const connections = await target.service.store.listConnectionViews(target.projectKey)
      if ('ok' in connections) {
        return connections
      }
      return {
        ok: true as const,
        projectKey: target.projectKey,
        connections: connections.map(describeConnection)
      }
    }
  }),
  defineMethod({
    name: 'sql.queries',
    params: SqlQueriesParams,
    handler: async (params, { runtime }) => {
      const target = await resolveTarget(runtime, params.worktree)
      if (!target.ok) {
        return target
      }
      const { store } = target.service
      let connectionId: string | null = null
      if (params.connection) {
        const views = await store.listConnectionViews(target.projectKey)
        if ('ok' in views) {
          return views
        }
        const found = findConnection(views, params.connection)
        if (!found.ok) {
          return found
        }
        connectionId = found.connection.id
      }
      const records = await store.getRecords(target.projectKey)
      if ('ok' in records) {
        return records
      }
      const keep = (owner: string): boolean => connectionId === null || owner === connectionId
      return {
        ok: true as const,
        collections: records.collections
          .filter((collection) => keep(collection.connectionId))
          .map((c) => ({ id: c.id, connectionId: c.connectionId, name: c.name })),
        queries: records.queries
          .filter((query) => keep(query.connectionId))
          .map((q) => ({
            id: q.id,
            connectionId: q.connectionId,
            collectionId: q.collectionId,
            name: q.name,
            sql: q.sql,
            updatedAt: q.updatedAt
          }))
      }
    }
  }),
  defineMethod({
    name: 'sql.run',
    params: SqlRunParams,
    handler: async (params, { runtime }) => {
      const target = await resolveTarget(runtime, params.worktree)
      if (!target.ok) {
        return target
      }
      const { store } = target.service
      const views = await store.listConnectionViews(target.projectKey)
      if ('ok' in views) {
        return views
      }
      const found = findConnection(views, params.connection)
      if (!found.ok) {
        return found
      }
      let sqlText = params.sql
      if (params.savedQuery !== undefined) {
        const records = await store.getRecords(target.projectKey)
        if ('ok' in records) {
          return records
        }
        const wanted = params.savedQuery.trim().toLowerCase()
        const owned = records.queries.filter((q) => q.connectionId === found.connection.id)
        const saved =
          owned.find((q) => q.id === params.savedQuery) ??
          owned.find((q) => q.name.toLowerCase() === wanted)
        if (!saved) {
          return fail('not-found', `No saved query "${params.savedQuery}" under this connection.`)
        }
        sqlText = saved.sql
      }
      const stored = await store.getConnectionForRun(target.projectKey, found.connection.id)
      if ('ok' in stored) {
        return stored
      }
      if (stored.password === null) {
        return fail(
          'unavailable',
          'The saved password cannot be read. Edit the connection in Orca and enter it again.'
        )
      }
      const result = await runAgentQuery({
        connection: stored.connection,
        password: stored.password,
        sql: sqlText ?? '',
        timeoutMs: (params.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000
      })
      return {
        ok: true as const,
        connectionId: found.connection.id,
        agentAccess: found.connection.agentAccess,
        result
      }
    }
  })
]
