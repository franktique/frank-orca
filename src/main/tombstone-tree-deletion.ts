import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs'
import { basename, join } from 'node:path'
import { removeHostTree } from './host-tree-removal'

// Why the same shape as terminal-history-deletion: ids are path-derived, so a recreated worktree
// or project can reuse the hash. Renaming first (metadata only) frees the name at once, and the
// recursive removal can then run, fail and retry without ever touching a live directory.

const DEFAULT_RETRY_DELAYS_MS = [30_000, 120_000]

export type TombstoneTreeDeleter = {
  /** Renames `dir` into the tombstone folder; null when the rename failed (GC reclaims it later). */
  tombstoneTree: (dir: string, root: string) => string | null
  scheduleTreeDeletion: (dir: string, root: string) => boolean
  /** Queues every tombstone left by a quit mid-removal. */
  drainPending: (root: string) => void
  /** Awaits in-flight removals. Tests only. */
  flushForTests: (root: string) => Promise<void>
  /** Drops armed retry timers so a fixture teardown cannot resurrect a removal. Tests only. */
  cancelRetriesForTests: () => void
}

export function createTombstoneTreeDeleter(options: {
  label: string
  pendingRoot: (root: string) => string
  retryDelaysMs?: readonly number[]
}): TombstoneTreeDeleter {
  const { label, pendingRoot } = options
  const retryDelays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS
  const pendingRemovals = new Map<string, Promise<void>>()
  const retryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const attempts = new Map<string, number>()
  const describe = (error: unknown): string =>
    error instanceof Error ? error.message : String(error)

  function scheduleRetry(dir: string): void {
    const attempt = attempts.get(dir) ?? 0
    const delay = retryDelays[attempt]
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
        console.warn(`[${label}] Failed to delete data dir: ${describe(error)}`)
        scheduleRetry(dir)
      })
      .finally(() => {
        if (pendingRemovals.get(dir) === removal) {
          pendingRemovals.delete(dir)
        }
      })
    pendingRemovals.set(dir, removal)
  }

  function tombstoneTree(dir: string, root: string): string | null {
    if (!existsSync(dir)) {
      return null
    }
    try {
      const pending = pendingRoot(root)
      mkdirSync(pending, { recursive: true })
      const tombstone = join(
        pending,
        `${basename(dir)}.${Date.now()}.${Math.random().toString(16).slice(2)}`
      )
      renameSync(dir, tombstone)
      return tombstone
    } catch (error) {
      console.warn(`[${label}] Failed to tombstone data dir: ${describe(error)}`)
      // Never remove the live path: a recreated worktree may already own it again.
      return null
    }
  }

  function drainPending(root: string): void {
    const pending = pendingRoot(root)
    if (!existsSync(pending)) {
      return
    }
    try {
      for (const entry of readdirSync(pending)) {
        scheduleRemoval(join(pending, entry))
      }
    } catch {
      // Non-fatal.
    }
  }

  return {
    tombstoneTree,
    scheduleTreeDeletion: (dir, root) => {
      const tombstone = tombstoneTree(dir, root)
      if (!tombstone) {
        return false
      }
      scheduleRemoval(tombstone)
      return true
    },
    drainPending,
    flushForTests: async (root) => {
      drainPending(root)
      while (pendingRemovals.size > 0) {
        await Promise.all(pendingRemovals.values())
      }
    },
    cancelRetriesForTests: () => {
      for (const timer of retryTimers.values()) {
        clearTimeout(timer)
      }
      retryTimers.clear()
      attempts.clear()
    }
  }
}
