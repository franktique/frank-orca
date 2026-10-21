import { useAppStore } from '@/store'
import { testRunKey } from '@/store/slices/api-client-test-run'
import { findNode } from '../../../../../shared/api-client/collection-tree'

/** The collection owning a request and whether it has a test map; null where the API is absent (SSH). */
export function useRequestTestMapState(
  worktreeId: string,
  requestId: string
): { collectionId: string; hasTestMap: boolean } | null {
  const collectionId = useAppStore(
    (state) =>
      state.apiClientSnapshotsByWorktree[worktreeId]?.collections.find((collection) =>
        findNode(collection, requestId)
      )?.id ?? null
  )
  const hasTestMap = useAppStore((state) =>
    collectionId
      ? Boolean(state.apiClientTestRunByTarget[testRunKey(worktreeId, collectionId)]?.testMap)
      : false
  )
  const available = Boolean(window.api.testRun)
  return available && collectionId ? { collectionId, hasTestMap } : null
}
