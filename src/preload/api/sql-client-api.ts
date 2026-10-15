import type { z } from 'zod'
import type {
  SqlChangedEvent,
  SqlClientResponses,
  SqlClientResult,
  SqlConnectionStatusEvent,
  cancelParamsSchema,
  closeTabSessionParamsSchema,
  connectionTargetParamsSchema,
  createCollectionParamsSchema,
  createConnectionParamsSchema,
  deleteCollectionParamsSchema,
  deleteConnectionParamsSchema,
  deleteQueryParamsSchema,
  listColumnsParamsSchema,
  listRelationsParamsSchema,
  listSchemasParamsSchema,
  moveQueryParamsSchema,
  renameCollectionParamsSchema,
  renameQueryParamsSchema,
  runParamsSchema,
  saveQueryParamsSchema,
  testConnectionParamsSchema,
  updateConnectionParamsSchema,
  worktreeOnlyParamsSchema
} from '../../shared/sql-client/sql-client-ipc-schemas'

type Call<S extends z.ZodType, K extends keyof SqlClientResponses> = (
  args: z.input<S>
) => Promise<SqlClientResult<SqlClientResponses[K]>>

export type SqlClientApi = {
  getSnapshot: Call<typeof worktreeOnlyParamsSchema, 'getSnapshot'>
  createConnection: Call<typeof createConnectionParamsSchema, 'createConnection'>
  updateConnection: Call<typeof updateConnectionParamsSchema, 'updateConnection'>
  deleteConnection: Call<typeof deleteConnectionParamsSchema, 'deleteConnection'>
  testConnection: Call<typeof testConnectionParamsSchema, 'testConnection'>
  saveQuery: Call<typeof saveQueryParamsSchema, 'saveQuery'>
  renameQuery: Call<typeof renameQueryParamsSchema, 'renameQuery'>
  moveQuery: Call<typeof moveQueryParamsSchema, 'moveQuery'>
  deleteQuery: Call<typeof deleteQueryParamsSchema, 'deleteQuery'>
  createCollection: Call<typeof createCollectionParamsSchema, 'createCollection'>
  renameCollection: Call<typeof renameCollectionParamsSchema, 'renameCollection'>
  deleteCollection: Call<typeof deleteCollectionParamsSchema, 'deleteCollection'>
  connect: Call<typeof connectionTargetParamsSchema, 'connect'>
  disconnect: Call<typeof connectionTargetParamsSchema, 'disconnect'>
  listSchemas: Call<typeof listSchemasParamsSchema, 'listSchemas'>
  listRelations: Call<typeof listRelationsParamsSchema, 'listRelations'>
  listColumns: Call<typeof listColumnsParamsSchema, 'listColumns'>
  run: Call<typeof runParamsSchema, 'run'>
  cancel: Call<typeof cancelParamsSchema, 'cancel'>
  closeTabSession: Call<typeof closeTabSessionParamsSchema, 'closeTabSession'>
  onChanged: (callback: (event: SqlChangedEvent) => void) => () => void
  onConnectionStatus: (callback: (event: SqlConnectionStatusEvent) => void) => () => void
}
