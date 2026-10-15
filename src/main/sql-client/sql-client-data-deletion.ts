import { createTombstoneTreeDeleter } from '../tombstone-tree-deletion'
import { getProjectSqlDir, getSqlClientRoot, getSqlTombstoneDir } from './sql-client-storage-paths'

const deleter = createTombstoneTreeDeleter({
  label: 'sql-client',
  pendingRoot: getSqlTombstoneDir
})

export const scheduleSqlTreeDeletion = deleter.scheduleTreeDeletion

/** Queues every tombstone left by a quit mid-removal. */
export function drainSqlClientPendingDeletes(root: string = getSqlClientRoot()): void {
  deleter.drainPending(root)
}

let onProjectDeleted: (projectKey: string) => void = () => undefined

/** Wired by the service so deletion can drop caches and sessions without importing the service. */
export function setSqlProjectDeletionListener(listener: (projectKey: string) => void): void {
  onProjectDeleted = listener
}

/** Removes every SQL connection, query and collection of a removed project. Non-fatal; never blocks. */
export function deleteProjectSqlData(projectKey: string, root?: string): void {
  try {
    const dataRoot = root ?? getSqlClientRoot()
    scheduleSqlTreeDeletion(getProjectSqlDir(projectKey, dataRoot), dataRoot)
    // The cache must not resurrect the data on the next write, and its sessions must close.
    onProjectDeleted(projectKey)
  } catch (error) {
    console.warn(
      `[sql-client] Failed to schedule data delete: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/** Awaits in-flight removals. Tests only. */
export function flushSqlClientDeletionsForTests(root: string): Promise<void> {
  return deleter.flushForTests(root)
}

/** Drops armed retry timers so a fixture teardown cannot resurrect a removal. Tests only. */
export function cancelSqlClientRemovalRetriesForTests(): void {
  deleter.cancelRetriesForTests()
}
