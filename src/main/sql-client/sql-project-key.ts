import type { Store } from '../persistence'
import { parseWorkspaceKey } from '../../shared/workspace-scope'
import { getRepoIdFromWorktreeId } from '../../shared/worktree/id'

export type SqlProjectKeyStore = Pick<Store, 'getRepo' | 'getFolderWorkspace'>

/** `repo:<repoId>` for git worktrees, `folder-workspace:<id>` for folder workspaces; null if unknown. */
export function resolveSqlProjectKey(store: SqlProjectKeyStore, worktreeId: string): string | null {
  const scope = parseWorkspaceKey(worktreeId)
  if (scope?.type === 'folder') {
    return store.getFolderWorkspace(scope.folderWorkspaceId)
      ? sqlProjectKeyForFolderWorkspace(scope.folderWorkspaceId)
      : null
  }
  const bareId = scope?.type === 'worktree' ? scope.worktreeId : worktreeId
  const repoId = getRepoIdFromWorktreeId(bareId)
  return store.getRepo(repoId) ? sqlProjectKeyForRepo(repoId) : null
}

export const sqlProjectKeyForRepo = (repoId: string): string => `repo:${repoId}`

export const sqlProjectKeyForFolderWorkspace = (folderWorkspaceId: string): string =>
  `folder-workspace:${folderWorkspaceId}`
