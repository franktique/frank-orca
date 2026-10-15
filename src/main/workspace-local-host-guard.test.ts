import { describe, expect, it } from 'vitest'
import type { FolderWorkspace } from '../shared/folder-workspace-types'
import type { Repo } from '../shared/repo-types'
import { assertLocalWorkspace, type WorkspaceHostGuardStore } from './workspace-local-host-guard'

const repo = (overrides: Partial<Repo> = {}): Repo => ({
  id: 'r1',
  path: '/work/r1',
  displayName: 'r1',
  badgeColor: '#000',
  addedAt: 0,
  ...overrides
})

const folderWorkspace = (overrides: Partial<FolderWorkspace> = {}): FolderWorkspace => ({
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
  updatedAt: 0,
  ...overrides
})

function makeStore(
  options: { repos?: Repo[]; folders?: FolderWorkspace[] } = {}
): WorkspaceHostGuardStore {
  const { repos = [], folders = [] } = options
  return {
    getRepo: (id) => repos.find((candidate) => candidate.id === id),
    getAllWorktreeMeta: () => ({}),
    getFolderWorkspace: (id) => folders.find((candidate) => candidate.id === id)
  }
}

describe('assertLocalWorkspace', () => {
  it('reports unknown repos as not-found', () => {
    expect(assertLocalWorkspace(makeStore(), 'missing::/tmp/x', 'The SQL tab')).toMatchObject({
      ok: false,
      code: 'not-found'
    })
  })

  it('reports unknown folder workspaces as not-found', () => {
    expect(assertLocalWorkspace(makeStore(), 'folder:nope', 'The SQL tab')).toMatchObject({
      ok: false,
      code: 'not-found'
    })
  })

  it('accepts a worktree of a local repo', () => {
    const store = makeStore({ repos: [repo()] })
    expect(assertLocalWorkspace(store, 'r1::/work/r1', 'The SQL tab')).toEqual({ ok: true })
  })

  it('rejects folder workspaces carrying an SSH connection and names the feature', () => {
    const store = makeStore({ folders: [folderWorkspace({ connectionId: 'ssh-1' })] })
    expect(assertLocalWorkspace(store, 'folder:f1', 'The SQL tab')).toEqual({
      ok: false,
      code: 'not-local',
      message: 'The SQL tab is only available for local workspaces.'
    })
  })

  it('accepts a plain folder workspace', () => {
    const store = makeStore({ folders: [folderWorkspace()] })
    expect(assertLocalWorkspace(store, 'folder:f1', 'The SQL tab')).toEqual({ ok: true })
  })
})
