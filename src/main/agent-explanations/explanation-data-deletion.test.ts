import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashWorktreeId } from '../terminal-history-id'
import { deleteWorkspaceExplanation, runExplanationDataGc } from './explanation-data-deletion'
import {
  cancelApiClientRemovalRetriesForTests,
  flushApiClientDeletionsForTests
} from '../api-client/api-client-data-deletion'

vi.mock('./explanation-store', () => ({
  getExplanationStore: () => evictorSpy
}))

const evictorSpy = { evict: vi.fn() }

let root: string
const MIN_AGE_MS = 1_000
const NOW = 10_000_000_000

function fileFor(workspaceId: string): string {
  return join(root, `${hashWorktreeId(workspaceId)}.json`)
}

function seed(workspaceId: string, ageMs: number): void {
  writeFileSync(fileFor(workspaceId), '{}')
  const mtime = new Date(NOW - ageMs)
  utimesSync(fileFor(workspaceId), mtime, mtime)
}

const liveNames = (): string[] => readdirSync(root).filter((name) => !name.startsWith('.'))

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'explanation-deletion-'))
  evictorSpy.evict.mockClear()
})

afterEach(() => {
  cancelApiClientRemovalRetriesForTests()
  rmSync(root, { recursive: true, force: true })
})

describe('deleteWorkspaceExplanation', () => {
  it('tombstones the workspace file and evicts the store cache', async () => {
    seed('wt-a', 0)

    deleteWorkspaceExplanation('wt-a', root)

    expect(liveNames()).toEqual([])
    expect(readdirSync(join(root, '.pending-delete'))).toHaveLength(1)
    expect(evictorSpy.evict).toHaveBeenCalledWith('wt-a')
    await flushApiClientDeletionsForTests(root)
    expect(readdirSync(join(root, '.pending-delete'))).toEqual([])
  })

  it('covers folder workspace ids the same way', async () => {
    seed('folder:abc123', 0)

    deleteWorkspaceExplanation('folder:abc123', root)

    expect(evictorSpy.evict).toHaveBeenCalledWith('folder:abc123')
    await flushApiClientDeletionsForTests(root)
    expect(liveNames()).toEqual([])
  })

  it('does nothing when no file exists', () => {
    expect(() => deleteWorkspaceExplanation('never-created', root)).not.toThrow()
    expect(evictorSpy.evict).toHaveBeenCalledWith('never-created')
  })
})

describe('runExplanationDataGc', () => {
  it('sweeps old non-live files and keeps live and young ones', async () => {
    seed('gone', MIN_AGE_MS + 1)
    seed('live', MIN_AGE_MS + 1)
    seed('young', 0)

    const result = await runExplanationDataGc(new Set(['live']), {
      root,
      now: () => NOW,
      minAgeMs: MIN_AGE_MS
    })

    expect(result).toEqual({ scanned: 3, pruned: 1 })
    expect(liveNames().sort()).toEqual(
      [`${hashWorktreeId('live')}.json`, `${hashWorktreeId('young')}.json`].sort()
    )
    await flushApiClientDeletionsForTests(root)
  })

  it('keeps the corrupt dir and ignores non-json entries', async () => {
    mkdirSync(join(root, 'corrupt'))
    writeFileSync(join(root, 'notes.txt'), 'x')
    seed('gone', MIN_AGE_MS + 1)

    const result = await runExplanationDataGc(new Set(['other']), {
      root,
      now: () => NOW,
      minAgeMs: MIN_AGE_MS
    })

    expect(result).toEqual({ scanned: 1, pruned: 1 })
    expect(liveNames().sort()).toEqual(['corrupt', 'notes.txt'])
    await flushApiClientDeletionsForTests(root)
  })

  it('refuses to collect anything when the live set is empty', async () => {
    seed('old', MIN_AGE_MS * 10)

    expect(
      await runExplanationDataGc(new Set(), { root, now: () => NOW, minAgeMs: MIN_AGE_MS })
    ).toEqual({ scanned: 0, pruned: 0 })
    expect(liveNames()).toEqual([`${hashWorktreeId('old')}.json`])
  })
})
