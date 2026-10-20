import { join } from 'node:path'
import { createTombstoneTreeDeleter } from '../tombstone-tree-deletion'
import { hashWorktreeId } from '../terminal-history-id'
import { getApiClientPendingDeleteRoot, getApiClientRoot } from './api-client-storage-paths'

const deleter = createTombstoneTreeDeleter({
  label: 'api-client',
  pendingRoot: getApiClientPendingDeleteRoot
})

/** Renames `dir` into the tombstone folder; null when the rename failed (GC reclaims it later). */
export const tombstoneApiClientTree = deleter.tombstoneTree

export const scheduleApiClientTreeDeletion = deleter.scheduleTreeDeletion

/** Queues every tombstone left by a quit mid-removal. */
export function drainApiClientPendingDeletes(root: string = getApiClientRoot()): void {
  deleter.drainPending(root)
}

/** Removes the API data of a deleted worktree or folder workspace. Non-fatal; never blocks on `rm`. */
export function deleteWorktreeApiClientData(worktreeId: string, root?: string): void {
  try {
    const dataRoot = root ?? getApiClientRoot()
    scheduleApiClientTreeDeletion(join(dataRoot, hashWorktreeId(worktreeId)), dataRoot)
    // The in-memory cache must not resurrect the data on the next write.
    evictCachedApiClientData(worktreeId)
  } catch (error) {
    console.warn(
      `[api-client] Failed to schedule data delete: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

let evictCachedApiClientData: (worktreeId: string) => void = () => undefined

/** Wired by the service so deletion can drop its cache without importing the service. */
export function setApiClientCacheEvictor(evictor: (worktreeId: string) => void): void {
  evictCachedApiClientData = evictor
}

/** Awaits in-flight removals. Tests only. */
export function flushApiClientDeletionsForTests(root: string): Promise<void> {
  return deleter.flushForTests(root)
}

/** Drops armed retry timers so a fixture teardown cannot resurrect a removal. Tests only. */
export function cancelApiClientRemovalRetriesForTests(): void {
  deleter.cancelRetriesForTests()
}
