import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as HostTreeRemoval from '../host-tree-removal'
import { hashWorktreeId } from '../terminal-history-id'
import { getApiClientPendingDeleteRoot } from './api-client-storage-paths'
import {
  cancelApiClientRemovalRetriesForTests,
  deleteWorktreeApiClientData,
  drainApiClientPendingDeletes,
  flushApiClientDeletionsForTests
} from './api-client-data-deletion'

vi.mock('../host-tree-removal', async () => {
  const actual = await vi.importActual<typeof HostTreeRemoval>('../host-tree-removal')
  return { removeHostTree: vi.fn(actual.removeHostTree) }
})

import { removeHostTree } from '../host-tree-removal'

let root: string

async function seed(worktreeId: string): Promise<string> {
  const dir = join(root, hashWorktreeId(worktreeId))
  await mkdir(join(dir, 'collections'), { recursive: true })
  await writeFile(
    join(dir, 'meta.json'),
    JSON.stringify({ schemaVersion: 1, worktreeId, createdAt: 1 })
  )
  await writeFile(join(dir, 'collections', 'c.json'), '{}')
  return dir
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'api-client-delete-'))
  vi.mocked(removeHostTree).mockClear()
})

afterEach(async () => {
  cancelApiClientRemovalRetriesForTests()
  await rm(root, { recursive: true, force: true })
})

describe('deleteWorktreeApiClientData', () => {
  it('renames the data into .pending-delete synchronously and removes it afterwards', async () => {
    const dir = await seed('wt-a')
    deleteWorktreeApiClientData('wt-a', root)

    // The live path is free before any recursive removal has run.
    expect(existsSync(dir)).toBe(false)
    const tombstones = await readdir(getApiClientPendingDeleteRoot(root))
    expect(tombstones).toHaveLength(1)
    expect(tombstones[0]).toContain(hashWorktreeId('wt-a'))

    await flushApiClientDeletionsForTests(root)
    expect(await readdir(getApiClientPendingDeleteRoot(root))).toEqual([])
  })

  it('lets a recreated worktree with the same id start empty', async () => {
    await seed('wt-a')
    deleteWorktreeApiClientData('wt-a', root)
    const reborn = join(root, hashWorktreeId('wt-a'))
    expect(existsSync(reborn)).toBe(false)
    await mkdir(join(reborn, 'collections'), { recursive: true })
    await flushApiClientDeletionsForTests(root)
    expect(existsSync(join(reborn, 'collections'))).toBe(true)
  })

  it('does nothing when the worktree never had API data', () => {
    expect(() => deleteWorktreeApiClientData('never-used', root)).not.toThrow()
  })

  it('drains tombstones left by an earlier run', async () => {
    const pending = join(getApiClientPendingDeleteRoot(root), 'abcd.1.2')
    await mkdir(pending, { recursive: true })
    await writeFile(join(pending, 'x.json'), '{}')
    drainApiClientPendingDeletes(root)
    await flushApiClientDeletionsForTests(root)
    expect(existsSync(pending)).toBe(false)
  })

  it('keeps a tombstone and retries when removal fails', async () => {
    vi.mocked(removeHostTree).mockRejectedValueOnce(new Error('EBUSY'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await seed('wt-b')
    deleteWorktreeApiClientData('wt-b', root)
    await flushApiClientDeletionsForTests(root)
    // The first attempt failed, so the tombstone is still on disk for the retry or next startup.
    expect(await readdir(getApiClientPendingDeleteRoot(root))).toHaveLength(1)
    warn.mockRestore()
  })
})
