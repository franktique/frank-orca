/**
 * Deletion and orphan GC for agent change explanations (specs/002). Mirrors the
 * API-client data deletion: tombstone-then-delete so a path-derived workspace id
 * reuse can never resurrect or race a live directory.
 */
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { API_CLIENT_PENDING_DELETE_DIR_NAME } from '../api-client/api-client-storage-paths'
import {
  drainApiClientPendingDeletes,
  scheduleApiClientTreeDeletion
} from '../api-client/api-client-data-deletion'
import { hashWorktreeId } from '../terminal-history-id'
import { getExplanationRoot, getExplanationWorkspacePaths } from './explanation-storage-paths'
import { getExplanationStore } from './explanation-store'

/** Removes the stored explanation of a deleted worktree or folder workspace. Non-fatal. */
export function deleteWorkspaceExplanation(workspaceId: string, root?: string): void {
  try {
    const dataRoot = root ?? getExplanationRoot()
    scheduleApiClientTreeDeletion(
      getExplanationWorkspacePaths(workspaceId, dataRoot).file,
      dataRoot
    )
    // The in-memory cache must not resurrect the data on the next read.
    getExplanationStore().evict(workspaceId)
  } catch (error) {
    console.warn(
      `[agent-explanations] Failed to schedule explanation delete: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * Tombstones explanation files whose workspace is gone. Liveness is checked by
 * re-hashing the live ids — the hash cannot be inverted from the file name.
 * `minAgeMs` comes from the caller (`API_CLIENT_GC_MIN_AGE_MS`) so this module
 * does not need to import the GC scheduler.
 */
export async function runExplanationDataGc(
  liveWorkspaceIds: ReadonlySet<string>,
  options: { root?: string; now?: () => number; minAgeMs?: number } = {}
): Promise<{ scanned: number; pruned: number }> {
  const root = options.root ?? getExplanationRoot()
  const now = options.now ?? Date.now
  const minAgeMs = options.minAgeMs ?? 5 * 60 * 1000
  drainApiClientPendingDeletes(root)
  // Why refuse: an empty live set looks like a store that fell back to defaults.
  if (liveWorkspaceIds.size === 0) {
    return { scanned: 0, pruned: 0 }
  }
  const liveHashes = new Set([...liveWorkspaceIds].map(hashWorktreeId))
  let entries: string[]
  try {
    entries = await readdir(root)
  } catch {
    return { scanned: 0, pruned: 0 }
  }
  let scanned = 0
  let pruned = 0
  for (const name of entries) {
    if (!name.endsWith('.json') || name === API_CLIENT_PENDING_DELETE_DIR_NAME) {
      continue
    }
    const filePath = join(root, name)
    const info = await stat(filePath).catch(() => null)
    if (!info?.isFile()) {
      continue
    }
    scanned++
    if (liveHashes.has(name.slice(0, -'.json'.length))) {
      continue
    }
    if (now() - info.mtimeMs < minAgeMs) {
      continue
    }
    if (scheduleApiClientTreeDeletion(filePath, root)) {
      pruned++
    }
  }
  return { scanned, pruned }
}
