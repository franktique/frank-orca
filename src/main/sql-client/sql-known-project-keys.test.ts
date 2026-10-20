import { describe, expect, it, vi } from 'vitest'
import type { FolderWorkspace } from '../../shared/folder-workspace-types'
import type { Repo } from '../../shared/repo-types'
import type { WorktreeMeta } from '../../shared/worktree/meta-types'
import { getKnownSqlProjectKeys } from './sql-known-project-keys'

const otherProfiles = vi.hoisted(() => ({
  value: { ids: new Set(['other::/p']), unreadableProfiles: 0 }
}))

vi.mock('../window/history-gc-profile-worktree-ids', () => ({
  getOtherProfileWorktreeIdsForHistoryGc: () => otherProfiles.value
}))

const repo = (id: string): Repo => ({
  id,
  path: `/work/${id}`,
  displayName: id,
  badgeColor: '#000',
  addedAt: 0
})

const meta = (): WorktreeMeta => ({
  displayName: 'w',
  comment: '',
  linkedIssue: null,
  linkedPR: null,
  linkedLinearIssue: null,
  isArchived: false,
  isUnread: false,
  isPinned: false,
  sortOrder: 0,
  lastActivityAt: 0
})

const folder = (id: string): FolderWorkspace => ({
  id,
  projectGroupId: 'g',
  name: id,
  folderPath: `/f/${id}`,
  linkedTask: null,
  comment: '',
  isArchived: false,
  isUnread: false,
  isPinned: false,
  sortOrder: 0,
  lastActivityAt: 0,
  createdAt: 0,
  updatedAt: 0
})

describe('getKnownSqlProjectKeys', () => {
  it('maps worktrees, folder workspaces, repos without metadata and other profiles', () => {
    const keys = getKnownSqlProjectKeys({
      getAllWorktreeMeta: () => ({ 'r1::/w/a': meta(), 'r1::/w/b': meta() }),
      getFolderWorkspaces: () => [folder('f1')],
      getRepos: () => [repo('r1'), repo('r2')]
    })
    expect([...keys].sort()).toEqual(['folder-workspace:f1', 'repo:other', 'repo:r1', 'repo:r2'])
  })

  it('returns nothing when another profile cannot be read, so GC refuses to prune', () => {
    otherProfiles.value = { ids: new Set(), unreadableProfiles: 1 }
    const keys = getKnownSqlProjectKeys({
      getAllWorktreeMeta: () => ({ 'r1::/w/a': meta() }),
      getFolderWorkspaces: () => [],
      getRepos: () => [repo('r1')]
    })
    expect(keys.size).toBe(0)
    otherProfiles.value = { ids: new Set(['other::/p']), unreadableProfiles: 0 }
  })
})
