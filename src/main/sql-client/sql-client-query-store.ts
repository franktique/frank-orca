import type {
  SqlClientFailure,
  SqlClientResult
} from '../../shared/sql-client/sql-client-ipc-schemas'
import type { SqlQueryCollection, SqlSavedQuery } from '../../shared/sql-client/sql-client-types'
import * as queryOps from './sql-client-query-ops'
import type { QueryOpResult } from './sql-client-query-ops'
import { toSqlStoreFailure } from './sql-client-project-files'
import { SqlClientStoreBase } from './sql-client-store-base'

/** Saved queries and collections; every write goes through the serialized, write-first commit. */
export class SqlClientQueryStore extends SqlClientStoreBase {
  async getRecords(
    projectKey: string
  ): Promise<{ collections: SqlQueryCollection[]; queries: SqlSavedQuery[] } | SqlClientFailure> {
    try {
      const { collections, queries } = await this.load(projectKey)
      return { collections, queries }
    } catch (error) {
      return toSqlStoreFailure(error)
    }
  }

  saveQuery(projectKey: string, input: Parameters<typeof queryOps.saveQuery>[1]) {
    return this.mutateQueries(
      projectKey,
      (records, ctx) => queryOps.saveQuery(records, input, ctx),
      (v) => ({ query: v })
    )
  }

  renameQuery(projectKey: string, input: Parameters<typeof queryOps.renameQuery>[1]) {
    return this.mutateQueries(
      projectKey,
      (records, ctx) => queryOps.renameQuery(records, input, ctx),
      (v) => ({ query: v })
    )
  }

  moveQuery(projectKey: string, input: Parameters<typeof queryOps.moveQuery>[1]) {
    return this.mutateQueries(
      projectKey,
      (records, ctx) => queryOps.moveQuery(records, input, ctx),
      (v) => ({ query: v })
    )
  }

  deleteQuery(projectKey: string, id: string) {
    return this.mutateQueries(
      projectKey,
      (records) => queryOps.deleteQuery(records, id),
      () => ({})
    )
  }

  createCollection(projectKey: string, input: Parameters<typeof queryOps.createCollection>[1]) {
    return this.mutateQueries(
      projectKey,
      (records, ctx) => queryOps.createCollection(records, input, ctx),
      (v) => ({ collection: v })
    )
  }

  renameCollection(projectKey: string, input: Parameters<typeof queryOps.renameCollection>[1]) {
    return this.mutateQueries(
      projectKey,
      (records) => queryOps.renameCollection(records, input),
      (v) => ({ collection: v })
    )
  }

  deleteCollection(projectKey: string, input: Parameters<typeof queryOps.deleteCollection>[1]) {
    return this.mutateQueries(
      projectKey,
      (records, ctx) => queryOps.deleteCollection(records, input, ctx),
      (v) => v
    )
  }

  private mutateQueries<V, R extends object>(
    projectKey: string,
    op: (records: queryOps.QueryRecords, ctx: queryOps.QueryOpContext) => QueryOpResult<V>,
    toResponse: (value: V) => R
  ): Promise<SqlClientResult<R>> {
    return this.serialized(projectKey, async (state) => {
      const outcome = op(state, this.ctx())
      if (!outcome.ok) {
        return outcome
      }
      return this.commit(
        state,
        { ...state, collections: outcome.collections, queries: outcome.queries },
        { connections: false, queries: true },
        outcome.changes,
        () => toResponse(outcome.value)
      )
    })
  }

  /** Writes first, then updates the cache, so a failed write never desyncs memory from disk. */
}
