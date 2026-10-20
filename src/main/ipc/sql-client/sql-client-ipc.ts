import { app } from 'electron'
import {
  createCollectionParamsSchema,
  createConnectionParamsSchema,
  deleteCollectionParamsSchema,
  deleteConnectionParamsSchema,
  deleteQueryParamsSchema,
  moveQueryParamsSchema,
  renameCollectionParamsSchema,
  renameQueryParamsSchema,
  saveQueryParamsSchema,
  updateConnectionParamsSchema,
  testConnectionParamsSchema,
  connectionTargetParamsSchema,
  runParamsSchema,
  cancelParamsSchema,
  closeTabSessionParamsSchema,
  listColumnsParamsSchema,
  listRelationsParamsSchema,
  listSchemasParamsSchema,
  worktreeOnlyParamsSchema
} from '../../../shared/sql-client/sql-client-ipc-schemas'
import {
  initSqlClientService,
  type SqlClientServiceDeps
} from '../../sql-client/sql-client-service'
import { broadcastSqlEvent, handleSqlChannel } from './sql-client-ipc-handle'
import { testSqlConnection } from '../../sql-client/sql-connection-test'
import {
  cachedListColumns,
  cachedListRelations,
  cachedListSchemas
} from '../../sql-client/sql-schema-introspection'
import { sqlFailure } from '../../sql-client/sql-client-query-ops'

export function registerSqlClientHandlers(orcaStore: SqlClientServiceDeps['orcaStore']): void {
  const service = initSqlClientService({ orcaStore })
  service.onEvent((event) => broadcastSqlEvent(event.channel, event.payload))
  const { store } = service

  handleSqlChannel('sqlClient:getSnapshot', worktreeOnlyParamsSchema, (_params, projectKey) =>
    store.getSnapshot(projectKey)
  )

  handleSqlChannel('sqlClient:createConnection', createConnectionParamsSchema, (params, key) =>
    store.createConnection(key, params.input)
  )

  handleSqlChannel(
    'sqlClient:updateConnection',
    updateConnectionParamsSchema,
    async (params, key) => {
      const result = await store.updateConnection(key, params.id, params.baseRevision, params.input)
      if (result.ok) {
        // Open sessions were built from the old settings.
        service.sessions.disconnect(key, params.id)
      }
      return result
    }
  )

  handleSqlChannel(
    'sqlClient:deleteConnection',
    deleteConnectionParamsSchema,
    async (params, key) => {
      const result = await store.deleteConnection(key, params.id)
      if (result.ok) {
        service.sessions.disconnect(key, params.id)
      }
      return result
    }
  )

  handleSqlChannel('sqlClient:saveQuery', saveQueryParamsSchema, (params, key) =>
    store.saveQuery(key, params)
  )
  handleSqlChannel('sqlClient:renameQuery', renameQueryParamsSchema, (params, key) =>
    store.renameQuery(key, params)
  )
  handleSqlChannel('sqlClient:moveQuery', moveQueryParamsSchema, (params, key) =>
    store.moveQuery(key, params)
  )
  handleSqlChannel('sqlClient:deleteQuery', deleteQueryParamsSchema, (params, key) =>
    store.deleteQuery(key, params.id)
  )
  handleSqlChannel('sqlClient:createCollection', createCollectionParamsSchema, (params, key) =>
    store.createCollection(key, params)
  )
  handleSqlChannel('sqlClient:renameCollection', renameCollectionParamsSchema, (params, key) =>
    store.renameCollection(key, params)
  )
  handleSqlChannel('sqlClient:deleteCollection', deleteCollectionParamsSchema, (params, key) =>
    store.deleteCollection(key, params)
  )

  handleSqlChannel('sqlClient:testConnection', testConnectionParamsSchema, (params, key) =>
    testSqlConnection(store, key, params)
  )

  handleSqlChannel('sqlClient:connect', connectionTargetParamsSchema, (params, key) =>
    service.sessions.connect(key, params.connectionId)
  )

  handleSqlChannel('sqlClient:disconnect', connectionTargetParamsSchema, (params, key) => {
    service.sessions.disconnect(key, params.connectionId)
    return { ok: true as const }
  })

  handleSqlChannel('sqlClient:run', runParamsSchema, (params, key) =>
    service.sessions.run(key, params.tabId, params.connectionId, params.runId, params.sql)
  )

  handleSqlChannel('sqlClient:cancel', cancelParamsSchema, async (params) => {
    await service.sessions.cancel(params.tabId, params.runId)
    return { ok: true as const }
  })

  handleSqlChannel('sqlClient:closeTabSession', closeTabSessionParamsSchema, (params) => {
    service.sessions.closeTabSession(params.tabId)
    return { ok: true as const }
  })

  // Schema browsing connects the metadata client on demand and reuses it across levels.
  async function browse<T extends object>(
    projectKey: string,
    connectionId: string,
    read: (
      session: Extract<
        Awaited<ReturnType<typeof service.sessions.getMetadataSession>>,
        { ok: true }
      >
    ) => Promise<T>
  ) {
    const session = await service.sessions.getMetadataSession(projectKey, connectionId)
    if (!session.ok) {
      return session
    }
    try {
      return { ok: true as const, ...(await read(session)) }
    } catch (error) {
      service.sessions.resetMetadataSession(connectionId)
      return sqlFailure(
        'invalid',
        error instanceof Error ? error.message : 'Could not read the schema.'
      )
    }
  }

  handleSqlChannel('sqlClient:listSchemas', listSchemasParamsSchema, (params, key) =>
    browse(key, params.connectionId, async ({ client, schemaCache }) => {
      if (params.refresh) {
        schemaCache.clear()
      }
      return { schemas: await cachedListSchemas(client, schemaCache) }
    })
  )

  handleSqlChannel('sqlClient:listRelations', listRelationsParamsSchema, (params, key) =>
    browse(key, params.connectionId, async ({ client, schemaCache }) => ({
      relations: await cachedListRelations(client, schemaCache, params.schema)
    }))
  )

  handleSqlChannel('sqlClient:listColumns', listColumnsParamsSchema, (params, key) =>
    browse(key, params.connectionId, async ({ client, schemaCache }) => ({
      columns: await cachedListColumns(client, schemaCache, params.schema, params.relation)
    }))
  )

  app.on('before-quit', () => service.sessions.closeAll())
}
