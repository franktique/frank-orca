import type {
  SqlClientErrorCode,
  SqlClientFailure
} from '../../shared/sql-client/sql-client-ipc-schemas'
import {
  findDuplicateCollectionName,
  isCollectionValidForConnection
} from '../../shared/sql-client/sql-client-schemas'
import type {
  SqlConnection,
  SqlQueryCollection,
  SqlSavedQuery
} from '../../shared/sql-client/sql-client-types'

export type QueryOpContext = { now: string; newId: () => string }

export type QueryRecords = {
  connections: readonly SqlConnection[]
  collections: SqlQueryCollection[]
  queries: SqlSavedQuery[]
}

export type RecordChange = {
  kind: 'query' | 'collection'
  id: string
  /** null = deleted. */
  revision: number | null
}

export type QueryOpSuccess<T> = {
  ok: true
  collections: SqlQueryCollection[]
  queries: SqlSavedQuery[]
  value: T
  changes: RecordChange[]
}

export type QueryOpResult<T> = QueryOpSuccess<T> | SqlClientFailure

export function sqlFailure(code: SqlClientErrorCode, message: string): SqlClientFailure {
  return { ok: false, code, message }
}

const queryNotFound = () => sqlFailure('not-found', 'Saved query not found.')
const collectionNotFound = () => sqlFailure('not-found', 'Collection not found.')
const conflict = (what: string) =>
  sqlFailure('conflict', `This ${what} was changed elsewhere. Reload and try again.`)

export function saveQuery(
  records: QueryRecords,
  input: {
    id?: string
    baseRevision?: number
    connectionId: string
    collectionId: string | null
    name: string
    sql: string
  },
  ctx: QueryOpContext
): QueryOpResult<SqlSavedQuery> {
  if (!records.connections.some((c) => c.id === input.connectionId)) {
    return sqlFailure('not-found', 'Connection not found.')
  }
  if (
    !isCollectionValidForConnection(records.collections, input.connectionId, input.collectionId)
  ) {
    return sqlFailure('invalid', 'The collection does not belong to this connection.')
  }
  const fields = { collectionId: input.collectionId, name: input.name.trim(), sql: input.sql }
  if (input.id === undefined) {
    const query: SqlSavedQuery = {
      id: ctx.newId(),
      connectionId: input.connectionId,
      ...fields,
      createdAt: ctx.now,
      updatedAt: ctx.now,
      revision: 1
    }
    return {
      ok: true,
      collections: records.collections,
      queries: [...records.queries, query],
      value: query,
      changes: [{ kind: 'query', id: query.id, revision: 1 }]
    }
  }
  const existing = records.queries.find((q) => q.id === input.id)
  if (!existing) {
    return queryNotFound()
  }
  if (existing.connectionId !== input.connectionId) {
    return sqlFailure('invalid', 'A saved query cannot move to another connection.')
  }
  if (input.baseRevision !== undefined && input.baseRevision !== existing.revision) {
    return conflict('query')
  }
  return replaceQuery(records, existing, { ...fields, updatedAt: ctx.now })
}

function replaceQuery(
  records: QueryRecords,
  existing: SqlSavedQuery,
  patch: Partial<SqlSavedQuery>
): QueryOpResult<SqlSavedQuery> {
  const next: SqlSavedQuery = { ...existing, ...patch, revision: existing.revision + 1 }
  return {
    ok: true,
    collections: records.collections,
    queries: records.queries.map((q) => (q.id === existing.id ? next : q)),
    value: next,
    changes: [{ kind: 'query', id: next.id, revision: next.revision }]
  }
}

export function renameQuery(
  records: QueryRecords,
  input: { id: string; baseRevision: number; name: string },
  ctx: QueryOpContext
): QueryOpResult<SqlSavedQuery> {
  const existing = records.queries.find((q) => q.id === input.id)
  if (!existing) {
    return queryNotFound()
  }
  if (existing.revision !== input.baseRevision) {
    return conflict('query')
  }
  return replaceQuery(records, existing, { name: input.name.trim(), updatedAt: ctx.now })
}

export function moveQuery(
  records: QueryRecords,
  input: { id: string; baseRevision: number; collectionId: string | null },
  ctx: QueryOpContext
): QueryOpResult<SqlSavedQuery> {
  const existing = records.queries.find((q) => q.id === input.id)
  if (!existing) {
    return queryNotFound()
  }
  if (existing.revision !== input.baseRevision) {
    return conflict('query')
  }
  if (
    !isCollectionValidForConnection(records.collections, existing.connectionId, input.collectionId)
  ) {
    return sqlFailure('invalid', 'The collection does not belong to this connection.')
  }
  return replaceQuery(records, existing, { collectionId: input.collectionId, updatedAt: ctx.now })
}

export function deleteQuery(records: QueryRecords, id: string): QueryOpResult<object> {
  if (!records.queries.some((q) => q.id === id)) {
    return queryNotFound()
  }
  return {
    ok: true,
    collections: records.collections,
    queries: records.queries.filter((q) => q.id !== id),
    value: {},
    changes: [{ kind: 'query', id, revision: null }]
  }
}

export function createCollection(
  records: QueryRecords,
  input: { connectionId: string; name: string },
  ctx: QueryOpContext
): QueryOpResult<SqlQueryCollection> {
  if (!records.connections.some((c) => c.id === input.connectionId)) {
    return sqlFailure('not-found', 'Connection not found.')
  }
  const name = input.name.trim()
  if (findDuplicateCollectionName(records.collections, input.connectionId, name)) {
    return sqlFailure('invalid', `A collection named "${name}" already exists for this connection.`)
  }
  const collection: SqlQueryCollection = {
    id: ctx.newId(),
    connectionId: input.connectionId,
    name,
    createdAt: ctx.now,
    revision: 1
  }
  return {
    ok: true,
    collections: [...records.collections, collection],
    queries: records.queries,
    value: collection,
    changes: [{ kind: 'collection', id: collection.id, revision: 1 }]
  }
}

export function renameCollection(
  records: QueryRecords,
  input: { id: string; baseRevision: number; name: string }
): QueryOpResult<SqlQueryCollection> {
  const existing = records.collections.find((c) => c.id === input.id)
  if (!existing) {
    return collectionNotFound()
  }
  if (existing.revision !== input.baseRevision) {
    return conflict('collection')
  }
  const name = input.name.trim()
  if (findDuplicateCollectionName(records.collections, existing.connectionId, name, existing.id)) {
    return sqlFailure('invalid', `A collection named "${name}" already exists for this connection.`)
  }
  const next: SqlQueryCollection = { ...existing, name, revision: existing.revision + 1 }
  return {
    ok: true,
    collections: records.collections.map((c) => (c.id === next.id ? next : c)),
    queries: records.queries,
    value: next,
    changes: [{ kind: 'collection', id: next.id, revision: next.revision }]
  }
}

export function deleteCollection(
  records: QueryRecords,
  input: { id: string; deleteQueries: boolean },
  ctx: QueryOpContext
): QueryOpResult<{ affectedQueries: number }> {
  if (!records.collections.some((c) => c.id === input.id)) {
    return collectionNotFound()
  }
  const members = records.queries.filter((q) => q.collectionId === input.id)
  const queries = input.deleteQueries
    ? records.queries.filter((q) => q.collectionId !== input.id)
    : records.queries.map((q) =>
        q.collectionId === input.id
          ? { ...q, collectionId: null, updatedAt: ctx.now, revision: q.revision + 1 }
          : q
      )
  const changes: RecordChange[] = [{ kind: 'collection', id: input.id, revision: null }]
  for (const member of members) {
    changes.push({
      kind: 'query',
      id: member.id,
      revision: input.deleteQueries ? null : member.revision + 1
    })
  }
  return {
    ok: true,
    collections: records.collections.filter((c) => c.id !== input.id),
    queries,
    value: { affectedQueries: members.length },
    changes
  }
}
