import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { metaFileSchema } from '../../shared/api-client/api-client-schemas'
import { readJsonFile } from './api-client-store-files'
import {
  drainApiClientPendingDeletes,
  scheduleApiClientTreeDeletion
} from './api-client-data-deletion'
import { API_CLIENT_PENDING_DELETE_DIR_NAME, getApiClientRoot } from './api-client-storage-paths'
import { runExplanationDataGc } from '../agent-explanations/explanation-data-deletion'

// Why 5 minutes: GC runs shortly after startup from a snapshot of live worktrees. A worktree created
// between that snapshot and the scan would otherwise look orphaned and lose its freshly written data.
export const API_CLIENT_GC_MIN_AGE_MS = 5 * 60 * 1000

let gcTimer: ReturnType<typeof setTimeout> | null = null
let activeGc: Promise<void> | null = null

/** Tombstones data directories whose worktree is gone. Resolves when the pass finishes. */
export async function runApiClientGc(
  liveWorktreeIds: ReadonlySet<string>,
  options: { root?: string; now?: () => number } = {}
): Promise<{ scanned: number; pruned: number }> {
  const root = options.root ?? getApiClientRoot()
  const now = options.now ?? Date.now
  // Finish tombstones left by a quit mid-removal before looking at live directories.
  drainApiClientPendingDeletes(root)
  // Why refuse: an empty live set looks like a store that fell back to defaults, and trusting it
  // would delete every worktree's data. A user with no worktrees has no data to collect either.
  if (liveWorktreeIds.size === 0) {
    return { scanned: 0, pruned: 0 }
  }
  let entries: string[]
  try {
    entries = await readdir(root)
  } catch {
    return { scanned: 0, pruned: 0 }
  }
  let scanned = 0
  let pruned = 0
  for (const name of entries) {
    if (name === API_CLIENT_PENDING_DELETE_DIR_NAME) {
      continue
    }
    const dir = join(root, name)
    const meta = await readJsonFile(join(dir, 'meta.json'), metaFileSchema, join(dir, 'corrupt'))
    // An entry whose owner cannot be established is kept.
    if (meta.kind !== 'ok') {
      continue
    }
    scanned++
    if (liveWorktreeIds.has(meta.value.worktreeId)) {
      continue
    }
    if (now() - meta.value.createdAt < API_CLIENT_GC_MIN_AGE_MS) {
      continue
    }
    if (scheduleApiClientTreeDeletion(dir, root)) {
      pruned++
    }
  }
  return { scanned, pruned }
}

/** Runs GC once, a while after startup so it never competes with startup-critical I/O. */
export function scheduleApiClientGc(
  getLiveWorktreeIds: () => Promise<Set<string>>,
  options: { apiClientRoot?: string; explanationRoot?: string; now?: () => number } = {}
): void {
  if (gcTimer !== null || activeGc !== null) {
    return
  }
  gcTimer = setTimeout(() => {
    gcTimer = null
    activeGc = getLiveWorktreeIds()
      .then(async (live) => {
        const nowOptions = options.now ? { now: options.now } : {}
        await runApiClientGc(live, {
          ...(options.apiClientRoot ? { root: options.apiClientRoot } : {}),
          ...nowOptions
        })
        // Why: the agent-explanations root shares the live-worktree snapshot so both
        // sweeps see the same generation; an empty set still refuses (see runApiClientGc).
        await runExplanationDataGc(live, {
          ...(options.explanationRoot ? { root: options.explanationRoot } : {}),
          ...nowOptions,
          minAgeMs: API_CLIENT_GC_MIN_AGE_MS
        })
      })
      .then(() => undefined)
      .catch((error: unknown) => {
        console.warn(
          `[api-client:gc] GC failed: ${error instanceof Error ? error.message : String(error)}`
        )
      })
      .finally(() => {
        activeGc = null
      })
  }, 10_000)
  gcTimer.unref?.()
}

export function cancelApiClientGc(): void {
  if (gcTimer !== null) {
    clearTimeout(gcTimer)
    gcTimer = null
  }
}

/** Awaits a scheduled GC run. Tests only. */
export async function flushApiClientGcForTests(): Promise<void> {
  while (activeGc !== null) {
    await activeGc
  }
}
