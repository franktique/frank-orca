import { z } from 'zod'
import {
  collectionNameSchema,
  connectionDatabaseSchema,
  connectionFieldsSchema,
  connectionHostSchema,
  connectionNameSchema,
  connectionPortSchema,
  connectionUserSchema,
  queryNameSchema,
  querySqlSchema,
  sqlSslModeSchema
} from './sql-client-schemas'
import type {
  SqlColumnInfo,
  SqlConnectionStatus,
  SqlConnectionView,
  SqlQueryCollection,
  SqlRelation,
  SqlRunResult,
  SqlSavedQuery,
  SqlSchema
} from './sql-client-types'

export const SQL_CLIENT_ERROR_CODES = [
  'not-local',
  'not-found',
  'conflict',
  'invalid',
  'storage',
  'encryption-unavailable'
] as const

export type SqlClientErrorCode = (typeof SQL_CLIENT_ERROR_CODES)[number]

export type SqlClientFailure = {
  ok: false
  code: SqlClientErrorCode
  message: string
}

export type SqlClientSuccess<T extends object> = { ok: true } & T
export type SqlClientResult<T extends object = object> = SqlClientSuccess<T> | SqlClientFailure

export type SqlSnapshot = {
  projectKey: string
  connections: SqlConnectionView[]
  collections: SqlQueryCollection[]
  queries: SqlSavedQuery[]
  encryptionAvailable: boolean
  protectionGapMessage?: string
}

const idSchema = z.string().min(1)
const revisionSchema = z.number().int().nonnegative()
const base = { worktreeId: z.string().min(1) }

export const worktreeOnlyParamsSchema = z.object(base)

export const connectionInputSchema = connectionFieldsSchema.extend({
  password: z.string()
})
export type SqlConnectionInput = z.infer<typeof connectionInputSchema>

// `password` omitted keeps the stored one; '' clears it.
export const connectionUpdateInputSchema = z.object({
  name: connectionNameSchema.optional(),
  host: connectionHostSchema.optional(),
  port: connectionPortSchema.optional(),
  user: connectionUserSchema.optional(),
  database: connectionDatabaseSchema.optional(),
  sslMode: sqlSslModeSchema.optional(),
  password: z.string().optional()
})
export type SqlConnectionUpdateInput = z.infer<typeof connectionUpdateInputSchema>

export const createConnectionParamsSchema = z.object({ ...base, input: connectionInputSchema })
export const updateConnectionParamsSchema = z.object({
  ...base,
  id: idSchema,
  baseRevision: revisionSchema,
  input: connectionUpdateInputSchema
})
export const deleteConnectionParamsSchema = z.object({ ...base, id: idSchema })

// With `id`, the saved connection is tested with `input` overriding it (password omitted keeps
// the stored one). Without `id`, `input` is a complete unsaved connection.
export const testConnectionParamsSchema = z.object({
  ...base,
  id: idSchema.optional(),
  input: connectionUpdateInputSchema.optional()
})

export const saveQueryParamsSchema = z.object({
  ...base,
  id: idSchema.optional(),
  baseRevision: revisionSchema.optional(),
  connectionId: idSchema,
  collectionId: idSchema.nullable(),
  name: queryNameSchema,
  sql: querySqlSchema
})
export const renameQueryParamsSchema = z.object({
  ...base,
  id: idSchema,
  baseRevision: revisionSchema,
  name: queryNameSchema
})
export const moveQueryParamsSchema = z.object({
  ...base,
  id: idSchema,
  baseRevision: revisionSchema,
  collectionId: idSchema.nullable()
})
export const deleteQueryParamsSchema = z.object({ ...base, id: idSchema })

export const createCollectionParamsSchema = z.object({
  ...base,
  connectionId: idSchema,
  name: collectionNameSchema
})
export const renameCollectionParamsSchema = z.object({
  ...base,
  id: idSchema,
  baseRevision: revisionSchema,
  name: collectionNameSchema
})
export const deleteCollectionParamsSchema = z.object({
  ...base,
  id: idSchema,
  deleteQueries: z.boolean()
})

export const connectionTargetParamsSchema = z.object({ ...base, connectionId: idSchema })
export const listSchemasParamsSchema = z.object({
  ...base,
  connectionId: idSchema,
  refresh: z.boolean().optional()
})
export const listRelationsParamsSchema = z.object({
  ...base,
  connectionId: idSchema,
  schema: z.string().min(1)
})
export const listColumnsParamsSchema = z.object({
  ...base,
  connectionId: idSchema,
  schema: z.string().min(1),
  relation: z.string().min(1)
})

export const runParamsSchema = z.object({
  ...base,
  tabId: idSchema,
  connectionId: idSchema,
  runId: idSchema,
  sql: z.string()
})
export const cancelParamsSchema = z.object({ ...base, tabId: idSchema, runId: idSchema })
export const closeTabSessionParamsSchema = z.object({ ...base, tabId: idSchema })

const connectionStatusSchema = z.union([
  z.strictObject({ state: z.enum(['idle', 'connecting', 'connected']) }),
  z.strictObject({ state: z.literal('error'), message: z.string(), code: z.string().optional() })
])

// Strict on purpose: a password or cipher key must never validate as part of a response.
export const sqlConnectionViewSchema = z.strictObject({
  id: idSchema,
  name: z.string(),
  host: z.string(),
  port: z.number(),
  user: z.string(),
  database: z.string(),
  sslMode: sqlSslModeSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  revision: revisionSchema,
  passwordState: z.enum(['set', 'empty', 'needs-reentry', 'session-only']),
  agentAccess: z.enum(['full', 'read-only']),
  status: connectionStatusSchema
})

export type SqlChangedEvent = {
  projectKey: string
  kind: 'connection' | 'query' | 'collection'
  id: string
  /** null = deleted. */
  revision: number | null
}

export type SqlConnectionStatusEvent = {
  projectKey: string
  connectionId: string
  status: SqlConnectionStatus
  error?: { message: string; code?: string }
}

export type SqlTestConnectionResult = { serverVersion: string }

export type SqlClientResponses = {
  getSnapshot: SqlSnapshot
  createConnection: { connection: SqlConnectionView }
  updateConnection: { connection: SqlConnectionView }
  deleteConnection: { deletedQueries: number; deletedCollections: number }
  testConnection: SqlTestConnectionResult
  saveQuery: { query: SqlSavedQuery }
  renameQuery: { query: SqlSavedQuery }
  moveQuery: { query: SqlSavedQuery }
  deleteQuery: object
  createCollection: { collection: SqlQueryCollection }
  renameCollection: { collection: SqlQueryCollection }
  deleteCollection: { affectedQueries: number }
  connect: { status: SqlConnectionStatus }
  disconnect: object
  listSchemas: { schemas: SqlSchema[] }
  listRelations: { relations: SqlRelation[] }
  listColumns: { columns: SqlColumnInfo[] }
  run: { result: SqlRunResult }
  cancel: object
  closeTabSession: object
}
