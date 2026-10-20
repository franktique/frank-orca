import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cancelSqlClientRemovalRetriesForTests,
  deleteProjectSqlData,
  drainSqlClientPendingDeletes,
  flushSqlClientDeletionsForTests,
  setSqlProjectDeletionListener
} from './sql-client-data-deletion'
import { getProjectSqlDir, getSqlTombstoneDir } from './sql-client-storage-paths'

let root: string

async function seed(projectKey: string): Promise<string> {
  const dir = getProjectSqlDir(projectKey, root)
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'meta.json'),
    JSON.stringify({ schemaVersion: 1, projectKey, createdAt: new Date(0).toISOString() })
  )
  await writeFile(join(dir, 'connections.json'), '{}')
  return dir
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sql-client-delete-'))
})

afterEach(async () => {
  cancelSqlClientRemovalRetriesForTests()
  setSqlProjectDeletionListener(() => undefined)
  await rm(root, { recursive: true, force: true })
})

describe('deleteProjectSqlData', () => {
  it('tombstones the project synchronously and removes it afterwards', async () => {
    const dir = await seed('repo:a')
    deleteProjectSqlData('repo:a', root)

    // The live path is free before any recursive removal has run.
    expect(existsSync(dir)).toBe(false)
    expect(await readdir(getSqlTombstoneDir(root))).toHaveLength(1)

    await flushSqlClientDeletionsForTests(root)
    expect(await readdir(getSqlTombstoneDir(root))).toEqual([])
  })

  it('leaves other projects alone', async () => {
    await seed('repo:a')
    const other = await seed('repo:b')
    deleteProjectSqlData('repo:a', root)
    await flushSqlClientDeletionsForTests(root)
    expect(existsSync(other)).toBe(true)
  })

  it('tells the cache to evict the project so it is not resurrected', async () => {
    await seed('repo:a')
    const listener = vi.fn()
    setSqlProjectDeletionListener(listener)
    deleteProjectSqlData('repo:a', root)
    expect(listener).toHaveBeenCalledWith('repo:a')
    await flushSqlClientDeletionsForTests(root)
  })

  it('does nothing when the project never had SQL data', () => {
    expect(() => deleteProjectSqlData('repo:never', root)).not.toThrow()
  })

  it('drains tombstones left by an earlier run', async () => {
    const pending = join(getSqlTombstoneDir(root), 'abcd.1.2')
    await mkdir(pending, { recursive: true })
    await writeFile(join(pending, 'x.json'), '{}')
    drainSqlClientPendingDeletes(root)
    await flushSqlClientDeletionsForTests(root)
    expect(existsSync(pending)).toBe(false)
  })
})
