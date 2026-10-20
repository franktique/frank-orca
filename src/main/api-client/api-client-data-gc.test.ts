import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashWorktreeId } from '../terminal-history-id'
import {
  API_CLIENT_GC_MIN_AGE_MS,
  cancelApiClientGc,
  flushApiClientGcForTests,
  runApiClientGc,
  scheduleApiClientGc
} from './api-client-data-gc'
import {
  cancelApiClientRemovalRetriesForTests,
  flushApiClientDeletionsForTests
} from './api-client-data-deletion'
import { getApiClientPendingDeleteRoot } from './api-client-storage-paths'

let root: string
const NOW = 10_000_000

async function seed(worktreeId: string, createdAt: number): Promise<void> {
  const dir = join(root, hashWorktreeId(worktreeId))
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'meta.json'),
    JSON.stringify({ schemaVersion: 1, worktreeId, createdAt })
  )
}

const liveDirs = async (): Promise<string[]> =>
  (await readdir(root)).filter((name) => !name.startsWith('.'))

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'api-client-gc-'))
})

afterEach(async () => {
  cancelApiClientRemovalRetriesForTests()
  await rm(root, { recursive: true, force: true })
})

describe('runApiClientGc', () => {
  it('tombstones directories whose worktree is gone and old enough', async () => {
    await seed('gone', NOW - API_CLIENT_GC_MIN_AGE_MS - 1)
    await seed('live', NOW - API_CLIENT_GC_MIN_AGE_MS - 1)
    const result = await runApiClientGc(new Set(['live']), { root, now: () => NOW })
    expect(result).toEqual({ scanned: 2, pruned: 1 })
    expect(await liveDirs()).toEqual([hashWorktreeId('live')])
    expect(await readdir(getApiClientPendingDeleteRoot(root))).toHaveLength(1)
    await flushApiClientDeletionsForTests(root)
  })

  it('keeps young directories so a just-created worktree is never collected', async () => {
    await seed('young', NOW - 1000)
    const result = await runApiClientGc(new Set(['other']), { root, now: () => NOW })
    expect(result.pruned).toBe(0)
    expect(await liveDirs()).toEqual([hashWorktreeId('young')])
  })

  it('refuses to collect anything when the live set is empty', async () => {
    await seed('old', NOW - API_CLIENT_GC_MIN_AGE_MS * 10)
    expect(await runApiClientGc(new Set(), { root, now: () => NOW })).toEqual({
      scanned: 0,
      pruned: 0
    })
    expect(await liveDirs()).toEqual([hashWorktreeId('old')])
  })

  it('keeps directories whose owner cannot be established', async () => {
    const dir = join(root, 'mystery')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'meta.json'), '{broken')
    await mkdir(join(root, 'no-meta'), { recursive: true })
    await runApiClientGc(new Set(['other']), { root, now: () => NOW })
    expect((await liveDirs()).sort()).toEqual(['mystery', 'no-meta'])
  })

  it('drains tombstones from an earlier run first', async () => {
    const pending = join(getApiClientPendingDeleteRoot(root), 'abcd.1.2')
    await mkdir(pending, { recursive: true })
    await runApiClientGc(new Set(['other']), { root, now: () => NOW })
    await flushApiClientDeletionsForTests(root)
    expect(await readdir(getApiClientPendingDeleteRoot(root))).toEqual([])
  })
})

describe('scheduleApiClientGc', () => {
  it('sweeps the agent-explanations root with the same live set', async () => {
    vi.useFakeTimers()
    let explanationRoot = ''
    try {
      explanationRoot = await mkdtemp(join(tmpdir(), 'api-client-gc-expl-'))
      const gone = join(explanationRoot, `${hashWorktreeId('gone')}.json`)
      await writeFile(gone, '{}')
      const old = new Date(NOW - API_CLIENT_GC_MIN_AGE_MS - 1)
      await utimes(gone, old, old)

      scheduleApiClientGc(async () => new Set(['live']), {
        apiClientRoot: root,
        explanationRoot,
        now: () => NOW
      })
      await vi.advanceTimersByTimeAsync(10_000)
      await flushApiClientGcForTests()
      // Why: the GC chain only tombstones; the tombstone removal itself is async.
      await flushApiClientDeletionsForTests(explanationRoot)

      // The tombstone dir stays behind, empty, like the api-client root's own.
      expect(await readdir(explanationRoot)).toEqual(['.pending-delete'])
      expect(await readdir(join(explanationRoot, '.pending-delete'))).toEqual([])
    } finally {
      cancelApiClientGc()
      vi.useRealTimers()
      if (explanationRoot) {
        await rm(explanationRoot, { recursive: true, force: true })
      }
    }
  })
})
