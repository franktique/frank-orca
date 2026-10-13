import type { ApiClientResult, TreeOpParams } from '../../shared/api-client/api-client-ipc-schemas'
import type {
  ApiFolder,
  ApiItem,
  ApiNodeId,
  ApiRequest,
  Collection
} from '../../shared/api-client/api-client-types'
import {
  cloneWithFreshIds,
  collectFolderIds,
  duplicateNode,
  findNode,
  flattenRequestsDepthFirst,
  insertNode,
  moveNode,
  removeNode,
  renameNode
} from '../../shared/api-client/collection-tree'
import { failure, type ApiClientStore, type WorktreeApiState } from './api-client-store'
import type { StoreTransaction } from './api-client-store-transaction'

const COPY_SUFFIX = ' copy'

export function newCollection(id: string, name: string): Collection {
  return {
    id,
    name,
    variables: [],
    events: {},
    items: [],
    revision: 0,
    postmanExtra: {},
    importWarnings: []
  }
}

export function newRequest(id: string, name: string): ApiRequest {
  return {
    id,
    kind: 'request',
    name,
    method: 'GET',
    url: { raw: '', query: [] },
    pathVariables: [],
    headers: [],
    events: {},
    settings: {},
    revision: 0,
    postmanExtra: {}
  }
}

function newFolder(id: string, name: string): ApiFolder {
  return { id, kind: 'folder', name, variables: [], events: {}, items: [], postmanExtra: {} }
}

const notFound = (what: string): ReturnType<typeof failure> =>
  failure('not-found', `${what} not found.`)

/** Drops the stored results/runs of everything under `scope`. */
function forgetSubtree(tx: StoreTransaction, scope: Collection | ApiItem): void {
  tx.removeResults(flattenRequestsDepthFirst(scope).map((request) => request.id))
  // A run is stored per collection or folder scope id.
  tx.removeRuns([...collectFolderIds(scope), ...('kind' in scope ? [] : [scope.id])])
}

function createInCollection(
  store: ApiClientStore,
  data: WorktreeApiState,
  tx: StoreTransaction,
  params: Extract<TreeOpParams, { op: 'create' }>
): ApiClientResult<{ id: ApiNodeId; collectionId: ApiNodeId }> {
  const name = params.name?.trim()
  if (params.kind === 'collection') {
    const id = store.newId()
    data.collections.set(id, newCollection(id, name || 'New Collection'))
    tx.touchCollection(id)
    return { ok: true, id, collectionId: id }
  }
  const collection = params.collectionId ? data.collections.get(params.collectionId) : undefined
  if (!collection) {
    return notFound('Collection')
  }
  const id = store.newId()
  const node =
    params.kind === 'folder'
      ? newFolder(id, name || 'New Folder')
      : newRequest(id, name || 'New Request')
  if (!insertNode(collection, params.parentId ?? null, node)) {
    return notFound('Folder')
  }
  tx.touchCollection(collection.id)
  return { ok: true, id, collectionId: collection.id }
}

export function applyTreeOp(
  store: ApiClientStore,
  data: WorktreeApiState,
  tx: StoreTransaction,
  params: TreeOpParams
): ApiClientResult<{ id?: ApiNodeId; collectionId?: ApiNodeId }> {
  if (params.op === 'create') {
    return createInCollection(store, data, tx, params)
  }
  const collectionId = params.target.collectionId
  const collection = data.collections.get(collectionId)
  if (!collection) {
    return notFound('Collection')
  }
  const nodeId = params.target.nodeId

  switch (params.op) {
    case 'rename': {
      if (!nodeId) {
        collection.name = params.name
      } else if (!renameNode(collection, nodeId, params.name)) {
        return notFound('Item')
      }
      tx.touchCollection(collectionId)
      return { ok: true, collectionId }
    }
    case 'duplicate': {
      if (!nodeId) {
        const copy = structuredClone(collection)
        copy.id = store.newId()
        copy.name = `${collection.name}${COPY_SUFFIX}`.slice(0, 200)
        copy.revision = 0
        copy.items = copy.items.map((item) => cloneWithFreshIds(item, store.newId))
        data.collections.set(copy.id, copy)
        tx.touchCollection(copy.id)
        return { ok: true, id: copy.id, collectionId: copy.id }
      }
      const copy = duplicateNode(collection, nodeId, store.newId)
      if (!copy) {
        return notFound('Item')
      }
      tx.touchCollection(collectionId)
      return { ok: true, id: copy.id, collectionId }
    }
    case 'move': {
      if (!moveNode(collection, params.target.nodeId, params.parentId, params.index)) {
        return failure('invalid-request', 'Cannot move the item there.')
      }
      tx.touchCollection(collectionId)
      return { ok: true, id: params.target.nodeId, collectionId }
    }
    case 'delete': {
      if (!nodeId) {
        forgetSubtree(tx, collection)
        data.collections.delete(collectionId)
        tx.removeCollection(collectionId)
        return { ok: true, collectionId }
      }
      const found = findNode(collection, nodeId)
      if (!found) {
        return notFound('Item')
      }
      forgetSubtree(tx, found.node)
      removeNode(collection, nodeId)
      tx.touchCollection(collectionId)
      return { ok: true, collectionId }
    }
  }
}

export function applySaveRequest(
  data: WorktreeApiState,
  tx: StoreTransaction,
  collectionId: ApiNodeId,
  request: ApiRequest,
  baseRevision: number
): ApiClientResult<{ revision: number }> {
  const collection = data.collections.get(collectionId)
  const found = collection ? findNode(collection, request.id) : null
  if (!collection || !found || found.node.kind !== 'request') {
    return notFound('Request')
  }
  if (found.node.revision !== baseRevision) {
    return failure('conflict', 'This request was changed elsewhere.')
  }
  const saved: ApiRequest = { ...request, kind: 'request', revision: baseRevision + 1 }
  found.parent.items[found.index] = saved
  tx.touchCollection(collectionId)
  return { ok: true, revision: saved.revision }
}
