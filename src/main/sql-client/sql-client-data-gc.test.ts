import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  cancelSqlClientRemovalRetriesForTests,
  flushSqlClientDeletionsForTests
} from './sql-client-data-deletion'
import { runSqlClientGc, SQL_CLIENT_GC_MIN_AGE_MS } from './sql-client-data-gc'
import { getProjectSqlDir, getSqlTombstoneDir } from './sql-client-storage-paths'

let root: string
const NOW = Date.parse('2026-10-14T12:00:00.000Z')
const OLD = new Date(NOW - SQL_CLIENT_GC_MIN_AGE_MS - 1).toISOString()

async function seed(projectKey: string, createdAt: string): Promise<void> {
  const dir = getProjectSqlDir(projectKey, root)
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'meta.json'),
    JSON.stringify({ schemaVersion: 1, projectKey, createdAt })
  )
}

const liveDirs = async (): Promise<string[]> =>
  (await readdir(root)).filter((name) => !name.startsWith('.'))

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sql-client-gc-'))
})

afterEach(async () => {
  cancelSqlClientRemovalRetriesForTests()
  await rm(root, { recursive: true, force: true })
})

describe('runSqlClientGc', () => {
  it('tombstones projects that left the catalog once old enough', async () => {
    await seed('repo:gone', OLD)
    await seed('folder-workspace:gone', OLD)
    await seed('repo:live', OLD)
    const result = await runSqlClientGc(new Set(['repo:live']), { root, now: () => NOW })
    expect(result).toEqual({ scanned: 3, pruned: 2 })
    expect(await liveDirs()).toEqual([getProjectSqlDir('repo:live', root).split('/').pop()])
    await flushSqlClientDeletionsForTests(root)
  })

  it('keeps young directories so a just-added project is never collected', async () => {
    await seed('repo:young', new Date(NOW - 1000).toISOString())
    expect((await runSqlClientGc(new Set(['repo:other']), { root, now: () => NOW })).pruned).toBe(0)
  })

  it('keeps a project that is still in the catalog even if its folder is gone from disk', async () => {
    await seed('repo:moved', OLD)
    const result = await runSqlClientGc(new Set(['repo:moved']), { root, now: () => NOW })
    expect(result.pruned).toBe(0)
    expect(await liveDirs()).toHaveLength(1)
  })

  it('refuses to collect anything when the live set is empty', async () => {
    await seed('repo:old', OLD)
    expect(await runSqlClientGc(new Set(), { root, now: () => NOW })).toEqual({
      scanned: 0,
      pruned: 0
    })
    expect(await liveDirs()).toHaveLength(1)
  })

  it('keeps directories whose owner cannot be established', async () => {
    const broken = join(root, 'mystery')
    await mkdir(broken, { recursive: true })
    await writeFile(join(broken, 'meta.json'), '{broken')
    await mkdir(join(root, 'no-meta'), { recursive: true })
    await runSqlClientGc(new Set(['repo:other']), { root, now: () => NOW })
    expect((await liveDirs()).sort()).toEqual(['mystery', 'no-meta'])
  })

  it('drains tombstones from an earlier run first', async () => {
    await mkdir(join(getSqlTombstoneDir(root), 'abcd.1.2'), { recursive: true })
    await runSqlClientGc(new Set(['repo:other']), { root, now: () => NOW })
    await flushSqlClientDeletionsForTests(root)
    expect(await readdir(getSqlTombstoneDir(root))).toEqual([])
  })
})
