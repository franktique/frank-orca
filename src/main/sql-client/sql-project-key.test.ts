import { describe, expect, it } from 'vitest'
import type { FolderWorkspace } from '../../shared/folder-workspace-types'
import type { Repo } from '../../shared/repo-types'
import { resolveSqlProjectKey, type SqlProjectKeyStore } from './sql-project-key'

const repo = (id: string): Repo => ({
  id,
  path: `/work/${id}`,
  displayName: id,
  badgeColor: '#000',
  addedAt: 0
})

const folder: FolderWorkspace = {
  id: 'f1',
  projectGroupId: 'g1',
  name: 'f1',
  folderPath: '/work/f1',
  linkedTask: null,
  comment: '',
  isArchived: false,
  isUnread: false,
  isPinned: false,
  sortOrder: 0,
  lastActivityAt: 0,
  createdAt: 0,
  updatedAt: 0
}

const store: SqlProjectKeyStore = {
  getRepo: (id) => (id === 'r1' || id === 'r2' ? repo(id) : undefined),
  getFolderWorkspace: (id) => (id === 'f1' ? folder : undefined)
}

describe('resolveSqlProjectKey', () => {
  it('maps two worktrees of one repo to the same key', () => {
    expect(resolveSqlProjectKey(store, 'r1::/work/a')).toBe('repo:r1')
    expect(resolveSqlProjectKey(store, 'r1::/work/b')).toBe('repo:r1')
    expect(resolveSqlProjectKey(store, 'worktree:r1::/work/a')).toBe('repo:r1')
  })

  it('keeps other repos separate', () => {
    expect(resolveSqlProjectKey(store, 'r2::/work/a')).toBe('repo:r2')
  })

  it('gives a folder workspace its own key', () => {
    expect(resolveSqlProjectKey(store, 'folder:f1')).toBe('folder-workspace:f1')
  })

  it('returns null for unknown ids', () => {
    expect(resolveSqlProjectKey(store, 'nope::/work/a')).toBeNull()
    expect(resolveSqlProjectKey(store, 'folder:missing')).toBeNull()
  })
})
