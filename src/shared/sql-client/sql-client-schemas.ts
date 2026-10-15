import { z } from 'zod'
import type { SqlConnection, SqlPersistedTab, SqlQueryCollection } from './sql-client-types'

export const SQL_CLIENT_LIMITS = {
  connectionNameMax: 100,
  hostMax: 255,
  userMax: 63,
  databaseMax: 63,
  collectionNameMax: 100,
  queryNameMax: 200,
  querySqlMax: 1024 * 1024,
  splitRatioMin: 0.15,
  splitRatioMax: 0.85,
  defaultSplitRatio: 0.5,
  defaultPort: 5432
} as const

export const SQL_SCHEMA_VERSION = 1

export const sqlSslModeSchema = z.enum(['disable', 'prefer', 'require'])

const idSchema = z.string().min(1)
const timestampSchema = z.string().min(1)
const revisionSchema = z.number().int().nonnegative()

export const connectionNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(SQL_CLIENT_LIMITS.connectionNameMax)
export const connectionHostSchema = z.string().min(1).max(SQL_CLIENT_LIMITS.hostMax)
export const connectionPortSchema = z.number().int().min(1).max(65535)
export const connectionUserSchema = z.string().min(1).max(SQL_CLIENT_LIMITS.userMax)
export const connectionDatabaseSchema = z.string().min(1).max(SQL_CLIENT_LIMITS.databaseMax)
export const collectionNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(SQL_CLIENT_LIMITS.collectionNameMax)
export const queryNameSchema = z.string().trim().min(1).max(SQL_CLIENT_LIMITS.queryNameMax)
export const querySqlSchema = z.string().min(1).max(SQL_CLIENT_LIMITS.querySqlMax)

export const sealedSecretSchema = z.object({ cipher: z.string() })

export const connectionFieldsSchema = z.object({
  name: connectionNameSchema,
  host: connectionHostSchema,
  port: connectionPortSchema.default(SQL_CLIENT_LIMITS.defaultPort),
  user: connectionUserSchema,
  database: connectionDatabaseSchema,
  sslMode: sqlSslModeSchema.default('prefer')
})

export const sqlConnectionSchema = connectionFieldsSchema.extend({
  id: idSchema,
  password: sealedSecretSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  revision: revisionSchema
})

export const sqlQueryCollectionSchema = z.object({
  id: idSchema,
  connectionId: idSchema,
  name: collectionNameSchema,
  createdAt: timestampSchema,
  revision: revisionSchema
})

export const sqlSavedQuerySchema = z.object({
  id: idSchema,
  connectionId: idSchema,
  collectionId: idSchema.nullable(),
  name: queryNameSchema,
  sql: querySqlSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  revision: revisionSchema
})

export const sqlPersistedTabSchema = z.object({
  draftText: z.string(),
  connectionId: idSchema.nullable().default(null),
  savedQueryId: idSchema.nullable().default(null),
  savedQueryRevision: revisionSchema.nullable().default(null),
  splitRatio: z
    .number()
    .min(SQL_CLIENT_LIMITS.splitRatioMin)
    .max(SQL_CLIENT_LIMITS.splitRatioMax)
    .default(SQL_CLIENT_LIMITS.defaultSplitRatio)
})

export const sqlMetaFileSchema = z.object({
  schemaVersion: z.number().int(),
  projectKey: z.string().min(1),
  createdAt: timestampSchema
})

export const sqlConnectionsFileSchema = z.object({
  schemaVersion: z.number().int(),
  connections: z.array(sqlConnectionSchema)
})

export const sqlQueriesFileSchema = z.object({
  schemaVersion: z.number().int(),
  collections: z.array(sqlQueryCollectionSchema),
  queries: z.array(sqlSavedQuerySchema)
})

export type SqlMetaFile = z.infer<typeof sqlMetaFileSchema>

export const defaultSqlPersistedTab = (): SqlPersistedTab => ({
  draftText: '',
  connectionId: null,
  savedQueryId: null,
  savedQueryRevision: null,
  splitRatio: SQL_CLIENT_LIMITS.defaultSplitRatio
})

/** Case-insensitive uniqueness of connection names within a project. */
export function findDuplicateConnectionName(
  connections: readonly Pick<SqlConnection, 'id' | 'name'>[],
  name: string,
  ignoreId?: string
): boolean {
  const wanted = name.trim().toLowerCase()
  return connections.some((c) => c.id !== ignoreId && c.name.trim().toLowerCase() === wanted)
}

/** Collection names are unique within their connection. */
export function findDuplicateCollectionName(
  collections: readonly Pick<SqlQueryCollection, 'id' | 'connectionId' | 'name'>[],
  connectionId: string,
  name: string,
  ignoreId?: string
): boolean {
  const wanted = name.trim().toLowerCase()
  return collections.some(
    (c) =>
      c.id !== ignoreId && c.connectionId === connectionId && c.name.trim().toLowerCase() === wanted
  )
}

/** A query's collection must exist and belong to the query's connection. */
export function isCollectionValidForConnection(
  collections: readonly Pick<SqlQueryCollection, 'id' | 'connectionId'>[],
  connectionId: string,
  collectionId: string | null
): boolean {
  if (collectionId === null) {
    return true
  }
  return collections.some((c) => c.id === collectionId && c.connectionId === connectionId)
}
