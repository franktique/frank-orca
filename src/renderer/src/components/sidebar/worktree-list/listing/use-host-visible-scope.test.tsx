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

function renderScope(repos: readonly Repo[], showHiddenProjects: boolean) {
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
      folderWorkspaces: [] as readonly FolderWorkspace[],
      pairedDeviceIdsByEnvironment: new Map<string, string>(),
      showHiddenProjects
    })
  )
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
})
