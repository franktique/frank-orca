// @vitest-environment happy-dom

import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { FolderWorkspace } from '../../../../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import type { Repo } from '../../../../../../shared/repo-types'
import { useSidebarHostVisibleScope } from './use-host-visible-scope'
import type { SidebarWorktreeFilters } from './use-filters'

function makeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-1',
    path: '/tmp/repo-1',
    displayName: 'Repo 1',
    badgeColor: 'gray',
    addedAt: 1,
    ...overrides
  }
}

function renderScope(
  repos: readonly Repo[],
  showHiddenProjects: boolean,
  folderWorkspaces: readonly FolderWorkspace[] = []
) {
  return renderHook(() =>
    useSidebarHostVisibleScope({
      filterState: {
        visibleWorkspaceHostIds: null,
        workspaceHostScope: 'all',
        hideWorkspacesFromOtherDevices: false
      } as SidebarWorktreeFilters['filterState'],
      defaultHostId: 'local',
      repos,
      projectGroups: [] as readonly ProjectGroup[],
      folderWorkspaces,
      pairedDeviceIdsByEnvironment: new Map<string, string>(),
      showHiddenProjects
    })
  )
}

function makeFolderWorkspace(overrides: Partial<FolderWorkspace> = {}): FolderWorkspace {
  return {
    id: 'folder-1',
    projectGroupId: 'group-1',
    name: 'Folder 1',
    folderPath: '/tmp/folder-1',
    linkedTask: null,
    comment: '',
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 1,
    lastActivityAt: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

describe('useSidebarHostVisibleScope hidden-project filtering', () => {
  it('excludes hidden projects by default', () => {
    const repos = [makeRepo(), makeRepo({ id: 'repo-2', path: '/tmp/r2', hidden: true })]
    const { result } = renderScope(repos, false)
    expect(result.current.visibleReposForRows.map((r) => r.id)).toEqual(['repo-1'])
  })

  it('keeps hidden projects when the global eye toggle is open', () => {
    const repos = [makeRepo(), makeRepo({ id: 'repo-2', path: '/tmp/r2', hidden: true })]
    const { result } = renderScope(repos, true)
    expect(result.current.visibleReposForRows.map((r) => r.id)).toEqual(['repo-1', 'repo-2'])
  })

  it('treats undefined hidden as visible', () => {
    const repos = [makeRepo({ hidden: undefined })]
    const { result } = renderScope(repos, false)
    expect(result.current.visibleReposForRows).toHaveLength(1)
  })

  it('excludes hidden folder workspaces by default and reveals them with the eye toggle', () => {
    const visible = makeFolderWorkspace()
    const hidden = makeFolderWorkspace({ id: 'folder-2', name: 'Folder 2', isHidden: true })
    const repos = [makeRepo()]

    const closed = renderScope(repos, false, [visible, hidden])
    expect(closed.result.current.visibleFolderWorkspacesForRows.map((w) => w.id)).toEqual([
      'folder-1'
    ])

    const open = renderScope(repos, true, [visible, hidden])
    expect(open.result.current.visibleFolderWorkspacesForRows.map((w) => w.id)).toEqual([
      'folder-1',
      'folder-2'
    ])
  })
})
