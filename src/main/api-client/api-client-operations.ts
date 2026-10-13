import type {
  ApiClientResult,
  DraftEnvironment,
  EnvOpParams,
  TreeOpParams
} from '../../shared/api-client/api-client-ipc-schemas'
import type { ApiNodeId, ApiRequest } from '../../shared/api-client/api-client-types'
import type { ApiClientStore } from './api-client-store'
import { applyEnvOp, applySaveEnvironment } from './api-client-environment-ops'
import { applySaveRequest, applyTreeOp } from './api-client-tree-ops'

export function treeOp(
  store: ApiClientStore,
  params: TreeOpParams
): Promise<ApiClientResult<{ id?: ApiNodeId; collectionId?: ApiNodeId }>> {
  return store.transact(params.worktreeId, (data, tx) => applyTreeOp(store, data, tx, params))
}

export function saveRequest(
  store: ApiClientStore,
  args: {
    worktreeId: string
    collectionId: ApiNodeId
    request: ApiRequest
    baseRevision: number
  }
): Promise<ApiClientResult<{ revision: number }>> {
  return store.transact(args.worktreeId, (data, tx) =>
    applySaveRequest(data, tx, args.collectionId, args.request, args.baseRevision)
  )
}

export function envOp(
  store: ApiClientStore,
  params: EnvOpParams
): Promise<ApiClientResult<{ id?: ApiNodeId }>> {
  return store.transact(params.worktreeId, (data, tx) => applyEnvOp(store, data, tx, params))
}

export function saveEnvironment(
  store: ApiClientStore,
  args: { worktreeId: string; environment: DraftEnvironment; baseRevision: number }
): Promise<ApiClientResult<{ revision: number }>> {
  return store.transact(args.worktreeId, (data, tx) =>
    applySaveEnvironment(store, data, tx, args.environment, args.baseRevision)
  )
}
