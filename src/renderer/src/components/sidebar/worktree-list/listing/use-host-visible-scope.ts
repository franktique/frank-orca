import { useMemo } from 'react'
import type { FolderWorkspace } from '../../../../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import type { Repo } from '../../../../../../shared/repo-types'
import {
  getRepoExecutionHostId,
  type ExecutionHostId
} from '../../../../../../shared/execution-host'
import type { SidebarWorktreeFilters } from './use-filters'
import { filterFolderWorkspacesFromOtherDevices } from '../../workspace-creator-visibility'
import {
  filterFolderWorkspacesForVisibleHosts,
  filterProjectGroupsForVisibleHosts,
  getVisibleSidebarHostIdSet
} from './host-filtering'

// Narrows repos, project groups, and folder workspaces to the hosts (and devices) the
// current host filter admits, plus the user's hidden-project eye toggle.
export function useSidebarHostVisibleScope(args: {
  filterState: SidebarWorktreeFilters['filterState']
  defaultHostId: ExecutionHostId
  repos: readonly Repo[]
  projectGroups: readonly ProjectGroup[]
  folderWorkspaces: readonly FolderWorkspace[]
  pairedDeviceIdsByEnvironment: Parameters<typeof filterFolderWorkspacesFromOtherDevices>[1]
  showHiddenProjects: boolean
}) {
  const { filterState, defaultHostId, repos, projectGroups, folderWorkspaces, showHiddenProjects } =
    args
  const { visibleWorkspaceHostIds, workspaceHostScope, hideWorkspacesFromOtherDevices } =
    filterState
  const visibleHostIdSet = useMemo(
    () => getVisibleSidebarHostIdSet(visibleWorkspaceHostIds, workspaceHostScope),
    [visibleWorkspaceHostIds, workspaceHostScope]
  )
  const visibleReposForRows = useMemo(() => {
    if (!visibleHostIdSet) {
      return showHiddenProjects ? repos : repos.filter((repo) => !repo.hidden)
    }
    return repos.filter((repo) => {
      if (!showHiddenProjects && repo.hidden === true) {
        return false
      }
      const hostId =
        repo.connectionId || repo.executionHostId ? getRepoExecutionHostId(repo) : defaultHostId
      return visibleHostIdSet.has(hostId)
    })
  }, [defaultHostId, repos, showHiddenProjects, visibleHostIdSet])
  const visibleProjectGroupsForRows = useMemo(
    () => filterProjectGroupsForVisibleHosts(projectGroups, visibleHostIdSet, defaultHostId),
    [defaultHostId, projectGroups, visibleHostIdSet]
  )
  const visibleFolderWorkspacesForRows = useMemo(() => {
    const hostVisibleWorkspaces = filterFolderWorkspacesForVisibleHosts(
      folderWorkspaces,
      projectGroups,
      visibleHostIdSet,
      defaultHostId
    )
    if (!hideWorkspacesFromOtherDevices) {
      return hostVisibleWorkspaces
    }
    return filterFolderWorkspacesFromOtherDevices(
      hostVisibleWorkspaces,
      args.pairedDeviceIdsByEnvironment
    )
  }, [
    args.pairedDeviceIdsByEnvironment,
    defaultHostId,
    folderWorkspaces,
    hideWorkspacesFromOtherDevices,
    projectGroups,
    visibleHostIdSet
  ])

  return { visibleReposForRows, visibleProjectGroupsForRows, visibleFolderWorkspacesForRows }
}
