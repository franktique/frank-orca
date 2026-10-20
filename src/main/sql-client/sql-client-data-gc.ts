import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { sqlMetaFileSchema } from '../../shared/sql-client/sql-client-schemas'
import { readJsonFile } from '../api-client/api-client-store-files'
import { drainSqlClientPendingDeletes, scheduleSqlTreeDeletion } from './sql-client-data-deletion'
import { getSqlClientRoot, SQL_TOMBSTONE_DIR_NAME } from './sql-client-storage-paths'

// Why 5 minutes: GC runs shortly after startup from a snapshot of the catalog. A project added
// between that snapshot and the scan would otherwise look orphaned and lose its fresh data.
export const SQL_CLIENT_GC_MIN_AGE_MS = 5 * 60 * 1000

let gcTimer: ReturnType<typeof setTimeout> | null = null
let activeGc: Promise<void> | null = null

/** Tombstones data directories whose project left the catalog. Resolves when the pass finishes. */
export async function runSqlClientGc(
  liveProjectKeys: ReadonlySet<string>,
  options: { root?: string; now?: () => number } = {}
): Promise<{ scanned: number; pruned: number }> {
  const root = options.root ?? getSqlClientRoot()
  const now = options.now ?? Date.now
  drainSqlClientPendingDeletes(root)
  // Why refuse: an empty live set looks like a store that fell back to defaults, and trusting it
  // would delete every project's data.
  if (liveProjectKeys.size === 0) {
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
    if (name === SQL_TOMBSTONE_DIR_NAME) {
      continue
    }
    const dir = join(root, name)
    const meta = await readJsonFile(join(dir, 'meta.json'), sqlMetaFileSchema, join(dir, 'corrupt'))
    // An entry whose owner cannot be established is kept.
    if (meta.kind !== 'ok') {
      continue
    }
    scanned++
    if (liveProjectKeys.has(meta.value.projectKey)) {
      continue
    }
    const createdAt = Date.parse(meta.value.createdAt)
    if (Number.isNaN(createdAt) || now() - createdAt < SQL_CLIENT_GC_MIN_AGE_MS) {
      continue
    }
    if (scheduleSqlTreeDeletion(dir, root)) {
      pruned++
    }
  }
  return { scanned, pruned }
}

/** Runs GC once, a while after startup so it never competes with startup-critical I/O. */
export function scheduleSqlClientGc(getLiveProjectKeys: () => Promise<Set<string>>): void {
  if (gcTimer !== null || activeGc !== null) {
    return
  }
  gcTimer = setTimeout(() => {
    gcTimer = null
    activeGc = getLiveProjectKeys()
      .then((live) => runSqlClientGc(live))
      .then(() => undefined)
      .catch((error: unknown) => {
        console.warn(
          `[sql-client:gc] GC failed: ${error instanceof Error ? error.message : String(error)}`
        )
      })
      .finally(() => {
        activeGc = null
      })
  }, 10_000)
  gcTimer.unref?.()
}

export function cancelSqlClientGc(): void {
  if (gcTimer !== null) {
    clearTimeout(gcTimer)
    gcTimer = null
  }
}
