import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  SqlColumnInfo,
  SqlRelation,
  SqlSchema
} from '../../../../../shared/sql-client/sql-client-types'

type Loadable<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: T[] }

export type SchemaTreeState = {
  schemas: Loadable<SqlSchema> | null
  relations: Record<string, Loadable<SqlRelation> | undefined>
  columns: Record<string, Loadable<SqlColumnInfo> | undefined>
}

const EMPTY_TREE: SchemaTreeState = { schemas: null, relations: {}, columns: {} }

const columnKey = (schema: string, relation: string): string => JSON.stringify([schema, relation])
export { columnKey }

/** Lazily loads schemas, then relations per schema, then columns per relation (FR-027). */
export function useSqlSchemaTree(worktreeId: string, connectionId: string, enabled: boolean) {
  const [state, setState] = useState<SchemaTreeState>({ schemas: null, relations: {}, columns: {} })
  const generation = useRef(0)

  const loadSchemas = useCallback(
    async (refresh: boolean) => {
      const current = ++generation.current
      setState({ schemas: { status: 'loading' }, relations: {}, columns: {} })
      const result = await window.api.sqlClient.listSchemas({ worktreeId, connectionId, refresh })
      if (current !== generation.current) {
        return
      }
      setState((previous) => ({
        ...previous,
        schemas: result.ok
          ? { status: 'ready', items: result.schemas }
          : { status: 'error', message: result.message }
      }))
    },
    [worktreeId, connectionId]
  )

  useEffect(() => {
    if (enabled) {
      void loadSchemas(false)
    } else {
      // Late answers for the old connection state must not land once it is gone.
      generation.current++
    }
  }, [enabled, loadSchemas])

  const loadRelations = useCallback(
    async (schema: string) => {
      const current = generation.current
      setState((previous) => ({
        ...previous,
        relations: { ...previous.relations, [schema]: { status: 'loading' } }
      }))
      const result = await window.api.sqlClient.listRelations({ worktreeId, connectionId, schema })
      if (current !== generation.current) {
        return
      }
      setState((previous) => ({
        ...previous,
        relations: {
          ...previous.relations,
          [schema]: result.ok
            ? { status: 'ready', items: result.relations }
            : { status: 'error', message: result.message }
        }
      }))
    },
    [worktreeId, connectionId]
  )

  const loadColumns = useCallback(
    async (schema: string, relation: string) => {
      const current = generation.current
      const key = columnKey(schema, relation)
      setState((previous) => ({
        ...previous,
        columns: { ...previous.columns, [key]: { status: 'loading' } }
      }))
      const result = await window.api.sqlClient.listColumns({
        worktreeId,
        connectionId,
        schema,
        relation
      })
      if (current !== generation.current) {
        return
      }
      setState((previous) => ({
        ...previous,
        columns: {
          ...previous.columns,
          [key]: result.ok
            ? { status: 'ready', items: result.columns }
            : { status: 'error', message: result.message }
        }
      }))
    },
    [worktreeId, connectionId]
  )

  return {
    // A disconnected connection shows nothing, whatever was loaded while it was up.
    state: enabled ? state : EMPTY_TREE,
    refresh: () => loadSchemas(true),
    loadRelations,
    loadColumns
  }
}
