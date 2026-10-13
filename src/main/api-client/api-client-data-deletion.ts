import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs'
import { basename, join } from 'node:path'
import { removeHostTree } from '../host-tree-removal'
import { hashWorktreeId } from '../terminal-history-id'
import { getApiClientPendingDeleteRoot, getApiClientRoot } from './api-client-storage-paths'

// Why the same shape as terminal-history-deletion: worktree ids are path-derived, so a recreated
// worktree can reuse the hash. Renaming first (metadata only) frees the name at once, and the
// recursive removal can then run, fail and retry without ever touching a live directory.

const pendingRemovals = new Map<string, Promise<void>>()
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>()
const attempts = new Map<string, number>()
export const API_CLIENT_REMOVAL_RETRY_DELAYS_MS = [30_000, 120_000]

function scheduleRetry(dir: string): void {
  const attempt = attempts.get(dir) ?? 0
  const delay = API_CLIENT_REMOVAL_RETRY_DELAYS_MS[attempt]
  if (delay === undefined) {
    // Out of in-process attempts: the tombstone stays and the next startup drain re-queues it.
    attempts.delete(dir)
    return
  }
  attempts.set(dir, attempt + 1)
  const timer = setTimeout(() => {
    retryTimers.delete(dir)
    scheduleRemoval(dir)
  }, delay)
  timer.unref?.()
  retryTimers.set(dir, timer)
}

function scheduleRemoval(dir: string): void {
  if (pendingRemovals.has(dir) || retryTimers.has(dir)) {
    return
  }
  const removal = removeHostTree(dir)
    .then(() => {
      attempts.delete(dir)
    })
    .catch((error: unknown) => {
      console.warn(
        `[api-client] Failed to delete data dir: ${error instanceof Error ? error.message : String(error)}`
      )
      scheduleRetry(dir)
    })
    .finally(() => {
      if (pendingRemovals.get(dir) === removal) {
        pendingRemovals.delete(dir)
      }
    })
  pendingRemovals.set(dir, removal)
}

/** Renames `dir` into the tombstone folder; null when the rename failed (GC reclaims it later). */
export function tombstoneApiClientTree(dir: string, root: string): string | null {
  if (!existsSync(dir)) {
    return null
  }
  try {
    const pendingRoot = getApiClientPendingDeleteRoot(root)
    mkdirSync(pendingRoot, { recursive: true })
    const tombstone = join(
      pendingRoot,
      `${basename(dir)}.${Date.now()}.${Math.random().toString(16).slice(2)}`
    )
    renameSync(dir, tombstone)
    return tombstone
  } catch (error) {
    console.warn(
      `[api-client] Failed to tombstone data dir: ${error instanceof Error ? error.message : String(error)}`
    )
    // Never remove the live path: a recreated worktree may already own it again.
    return null
  }
}

export function scheduleApiClientTreeDeletion(dir: string, root: string): boolean {
  const tombstone = tombstoneApiClientTree(dir, root)
  if (!tombstone) {
    return false
  }
  scheduleRemoval(tombstone)
  return true
}

/** Queues every tombstone left by a quit mid-removal. */
export function drainApiClientPendingDeletes(root: string = getApiClientRoot()): void {
  const pendingRoot = getApiClientPendingDeleteRoot(root)
  if (!existsSync(pendingRoot)) {
    return
  }
  try {
    for (const entry of readdirSync(pendingRoot)) {
      scheduleRemoval(join(pendingRoot, entry))
    }
  } catch {
    // Non-fatal.
  }
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
export async function flushApiClientDeletionsForTests(root: string): Promise<void> {
  drainApiClientPendingDeletes(root)
  while (pendingRemovals.size > 0) {
    await Promise.all(pendingRemovals.values())
  }
}

/** Drops armed retry timers so a fixture teardown cannot resurrect a removal. Tests only. */
export function cancelApiClientRemovalRetriesForTests(): void {
  for (const timer of retryTimers.values()) {
    clearTimeout(timer)
  }
  retryTimers.clear()
  attempts.clear()
}
