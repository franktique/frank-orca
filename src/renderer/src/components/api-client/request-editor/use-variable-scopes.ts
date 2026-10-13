import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { SECRET_MASK } from '../../../../../shared/api-client/api-client-types'
import { findNode } from '../../../../../shared/api-client/collection-tree'
import {
  buildScopeChain,
  type VariableScope
} from '../../../../../shared/api-client/variable-resolution'

/**
 * Scopes for highlighting `{{variables}}` while editing. The same precedence as sending, minus the
 * request-time script scope, which only exists at send time.
 */
export function useRequestVariableScopes(
  worktreeId: string,
  requestId: string | null
): VariableScope[] {
  const snapshot = useAppStore((state) => state.apiClientSnapshotsByWorktree[worktreeId])
  return useMemo(() => {
    if (!snapshot || !requestId) {
      return []
    }
    const collection = snapshot.collections.find((candidate) => findNode(candidate, requestId))
    const folders = collection ? (findNode(collection, requestId)?.ancestors ?? []) : []
    const environment = snapshot.environments.find((env) => env.id === snapshot.activeEnvironmentId)
    return buildScopeChain({
      environment: environment?.variables.map((variable) => ({
        key: variable.key,
        enabled: variable.enabled,
        // Why: a secret withheld from this snapshot still exists; only a lost one is unresolved.
        value: variable.masked ? SECRET_MASK : variable.value
      })),
      folders: folders.map((folder) => ({ name: folder.name, variables: folder.variables })),
      collection: collection?.variables
    })
  }, [snapshot, requestId])
}
