import type { ApiClientChangedEvent } from '../../shared/api-client/api-client-ipc-schemas'
import type { ApiNodeId } from '../../shared/api-client/api-client-types'
import { encryptEnvironmentSecrets } from './api-client-secret-codec'
import { writeJsonFile } from './api-client-store-files'
import type { ApiClientStore, WorktreeApiState } from './api-client-store'

type ChangedKind = ApiClientChangedEvent['kind']

/** Records what a store task touched so the commit step writes each file once. */
export type StoreTransaction = {
  touchCollection: (id: ApiNodeId) => void
  touchEnvironment: (id: ApiNodeId) => void
  touchState: (kind?: 'active-environment') => void
  removeCollection: (id: ApiNodeId) => void
  removeEnvironment: (id: ApiNodeId) => void
  removeResults: (requestIds: readonly ApiNodeId[]) => void
  removeRuns: (scopeIds: readonly ApiNodeId[]) => void
  isDirty: () => boolean
  /** @internal read by commitTransaction */
  readonly pending: PendingChanges
}

type PendingChanges = {
  collections: Set<ApiNodeId>
  environments: Set<ApiNodeId>
  removedCollections: Set<ApiNodeId>
  removedEnvironments: Set<ApiNodeId>
  removedResults: Set<ApiNodeId>
  removedRuns: Set<ApiNodeId>
  activeEnvironmentChanged: boolean
  state: boolean
}

export function createTransaction(data: WorktreeApiState): StoreTransaction {
  const pending: PendingChanges = {
    collections: new Set(),
    environments: new Set(),
    removedCollections: new Set(),
    removedEnvironments: new Set(),
    removedResults: new Set(),
    removedRuns: new Set(),
    activeEnvironmentChanged: false,
    state: false
  }
  return {
    pending,
    touchCollection: (id) => {
      const collection = data.collections.get(id)
      if (!collection || pending.collections.has(id)) {
        return
      }
      pending.collections.add(id)
      collection.revision += 1
      if (!data.state.collectionOrder.includes(id)) {
        data.state.collectionOrder.push(id)
      }
    },
    touchEnvironment: (id) => {
      const environment = data.environments.get(id)
      if (!environment || pending.environments.has(id)) {
        return
      }
      pending.environments.add(id)
      environment.revision += 1
      if (!data.state.environmentOrder.includes(id)) {
        data.state.environmentOrder.push(id)
      }
    },
    touchState: (kind) => {
      pending.state = true
      pending.activeEnvironmentChanged ||= kind === 'active-environment'
    },
    removeCollection: (id) => {
      pending.removedCollections.add(id)
      data.state.collectionOrder = data.state.collectionOrder.filter((entry) => entry !== id)
    },
    removeEnvironment: (id) => {
      pending.removedEnvironments.add(id)
      data.state.environmentOrder = data.state.environmentOrder.filter((entry) => entry !== id)
      data.persistedEnvironments.delete(id)
    },
    removeResults: (ids) => ids.forEach((id) => pending.removedResults.add(id)),
    removeRuns: (ids) => ids.forEach((id) => pending.removedRuns.add(id)),
    isDirty: () =>
      pending.state ||
      pending.collections.size > 0 ||
      pending.environments.size > 0 ||
      pending.removedCollections.size > 0 ||
      pending.removedEnvironments.size > 0 ||
      pending.removedResults.size > 0 ||
      pending.removedRuns.size > 0
  }
}

/** Writes every touched file, then returns the change events to broadcast. */
export async function commitTransaction(
  store: ApiClientStore,
  data: WorktreeApiState,
  tx: StoreTransaction
): Promise<ApiClientChangedEvent[]> {
  if (!tx.isDirty()) {
    return []
  }
  const { pending } = tx
  await store.writeMetaIfMissing(data)

  for (const id of pending.collections) {
    const collection = data.collections.get(id)
    if (collection) {
      await writeJsonFile(data.paths.collectionFile(id), collection)
    }
  }
  for (const id of pending.environments) {
    const environment = data.environments.get(id)
    if (!environment) {
      continue
    }
    let persisted = data.persistedEnvironments.get(id)
    if (!persisted || persisted.revision !== environment.revision) {
      persisted = encryptEnvironmentSecrets(environment, store.secretStore)
      data.persistedEnvironments.set(id, persisted)
    }
    await writeJsonFile(data.paths.environmentFile(id), persisted)
  }

  data.state.revision += 1
  await writeJsonFile(data.paths.stateFile, data.state)

  for (const id of pending.removedCollections) {
    await store.removeFile(data.paths.collectionFile(id))
  }
  for (const id of pending.removedEnvironments) {
    await store.removeFile(data.paths.environmentFile(id))
  }
  for (const id of pending.removedResults) {
    await store.removeFile(data.paths.resultFile(id))
  }
  for (const id of pending.removedRuns) {
    await store.removeFile(data.paths.runFile(id))
  }

  const revision = data.state.revision
  const event = (kind: ChangedKind, id?: string): ApiClientChangedEvent => ({
    worktreeId: data.worktreeId,
    revision,
    kind,
    ...(id ? { id } : {})
  })
  return [
    ...[...pending.collections, ...pending.removedCollections].map((id) => event('collection', id)),
    ...[...pending.environments, ...pending.removedEnvironments].map((id) =>
      event('environment', id)
    ),
    ...(pending.activeEnvironmentChanged ? [event('active-environment')] : [])
  ]
}
