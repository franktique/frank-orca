import { useCallback } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type { ApiClientResult } from '../../../../../shared/api-client/api-client-ipc-schemas'

type TreeResult = ApiClientResult<{ id?: string; collectionId?: string }>
type TreeSuccess = Extract<TreeResult, { ok: true }>

/** Message for a failed store call; the error codes themselves are never shown raw. */
export function describeApiClientFailure(result: { code: string; message: string }): string {
  switch (result.code) {
    case 'not-local':
      return translate(
        'apiClient.errors.notLocal',
        'The API Client is only available for local workspaces.'
      )
    case 'conflict':
      return translate(
        'apiClient.errors.conflict',
        'This item was changed elsewhere. Reload and try again.'
      )
    case 'read-only':
      return translate(
        'apiClient.errors.readOnly',
        'This data was saved by a newer version of Orca and cannot be edited here.'
      )
    default:
      return result.message
  }
}

export type ApiClientTreeActions = {
  createCollection: () => Promise<string | null>
  createFolder: (collectionId: string, parentId: string | null) => Promise<string | null>
  createRequest: (collectionId: string, parentId: string | null) => Promise<string | null>
  rename: (collectionId: string, nodeId: string | undefined, name: string) => Promise<boolean>
  duplicate: (collectionId: string, nodeId: string | undefined) => Promise<string | null>
  move: (collectionId: string, nodeId: string, parentId: string | null) => Promise<boolean>
  remove: (collectionId: string, nodeId: string | undefined) => Promise<boolean>
}

export function useApiClientTreeActions(worktreeId: string): ApiClientTreeActions {
  const run = useCallback(async (call: () => Promise<TreeResult>): Promise<TreeSuccess | null> => {
    const result = await call()
    if (!result.ok) {
      toast.error(describeApiClientFailure(result))
      return null
    }
    return result
  }, [])
  const api = window.api.apiClient

  return {
    createCollection: async () =>
      (await run(() => api.treeOp({ worktreeId, op: 'create', kind: 'collection' })))?.id ?? null,
    createFolder: async (collectionId, parentId) =>
      (
        await run(() =>
          api.treeOp({ worktreeId, op: 'create', kind: 'folder', collectionId, parentId })
        )
      )?.id ?? null,
    createRequest: async (collectionId, parentId) =>
      (
        await run(() =>
          api.treeOp({ worktreeId, op: 'create', kind: 'request', collectionId, parentId })
        )
      )?.id ?? null,
    rename: async (collectionId, nodeId, name) =>
      (await run(() =>
        api.treeOp({ worktreeId, op: 'rename', target: { collectionId, nodeId }, name })
      )) !== null,
    duplicate: async (collectionId, nodeId) =>
      (
        await run(() =>
          api.treeOp({ worktreeId, op: 'duplicate', target: { collectionId, nodeId } })
        )
      )?.id ?? null,
    move: async (collectionId, nodeId, parentId) =>
      (await run(() =>
        api.treeOp({ worktreeId, op: 'move', target: { collectionId, nodeId }, parentId })
      )) !== null,
    remove: async (collectionId, nodeId) =>
      (await run(() =>
        api.treeOp({ worktreeId, op: 'delete', target: { collectionId, nodeId } })
      )) !== null
  }
}
