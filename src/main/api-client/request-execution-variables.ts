import type { ApiNodeId } from '../../shared/api-client/api-client-types'
import type { ApiClientStore } from './api-client-store'
import type { VariableWrites } from './script-sandbox/script-sandbox-types'
import type { WorkingVariables } from './request-execution-scripts'

type Entry = { key: string; value: string | null; enabled: boolean }

function diff(before: readonly Entry[], after: readonly Entry[]): VariableWrites {
  const lastValue = (list: readonly Entry[], key: string): string | null | undefined =>
    list.findLast((entry) => entry.key === key && entry.enabled)?.value
  const set: Record<string, string> = {}
  for (const entry of after) {
    const next = lastValue(after, entry.key)
    if (
      entry.enabled &&
      next !== null &&
      next !== undefined &&
      next !== lastValue(before, entry.key)
    ) {
      set[entry.key] = next
    }
  }
  const unset = [...new Set(before.map((entry) => entry.key))].filter(
    (key) => !after.some((entry) => entry.key === key)
  )
  return { set, unset }
}

export function diffWorkingVariables(
  before: WorkingVariables,
  after: WorkingVariables
): { environment: VariableWrites; collection: VariableWrites } {
  return {
    environment: diff(before.environment, after.environment),
    collection: diff(before.collection, after.collection)
  }
}

const isEmpty = (writes: VariableWrites): boolean =>
  Object.keys(writes.set).length === 0 && writes.unset.length === 0

/**
 * Persists a request's script-side variable changes to the stored environment/collection, which
 * is how a token set by one test reaches the next request (and the next run).
 */
export async function commitVariableWrites(
  store: ApiClientStore,
  args: {
    worktreeId: string
    collectionId: ApiNodeId
    environmentId: ApiNodeId | null
    writes: { environment: VariableWrites; collection: VariableWrites }
  }
): Promise<void> {
  const { writes } = args
  if (isEmpty(writes.environment) && isEmpty(writes.collection)) {
    return
  }
  await store.transact(args.worktreeId, (data, tx) => {
    const environment = args.environmentId ? data.environments.get(args.environmentId) : undefined
    if (environment && !isEmpty(writes.environment)) {
      environment.variables = environment.variables.filter(
        (variable) => !writes.environment.unset.includes(variable.key)
      )
      for (const [key, value] of Object.entries(writes.environment.set)) {
        const index = environment.variables.findLastIndex((v) => v.key === key && v.enabled)
        if (index !== -1) {
          environment.variables[index] = {
            ...environment.variables[index],
            value,
            needsReentry: undefined
          }
        } else {
          environment.variables.push({ key, value, enabled: true, type: 'default' })
        }
      }
      tx.touchEnvironment(environment.id)
    }
    const collection = data.collections.get(args.collectionId)
    if (collection && !isEmpty(writes.collection)) {
      collection.variables = collection.variables.filter(
        (variable) => !writes.collection.unset.includes(variable.key)
      )
      for (const [key, value] of Object.entries(writes.collection.set)) {
        const index = collection.variables.findLastIndex((v) => v.key === key && v.enabled)
        if (index !== -1) {
          collection.variables[index] = { ...collection.variables[index], value }
        } else {
          collection.variables.push({ key, value, enabled: true })
        }
      }
      tx.touchCollection(collection.id)
    }
    return { ok: true as const }
  })
}
