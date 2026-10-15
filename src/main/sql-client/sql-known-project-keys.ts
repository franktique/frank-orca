import type { Store } from '../persistence'
import { parseWorkspaceKey } from '../../shared/workspace-scope'
import { getRepoIdFromWorktreeId } from '../../shared/worktree/id'
import { getKnownWorktreeIdsForHistoryGc } from '../window/history-gc-worktree-ids'
import { sqlProjectKeyForFolderWorkspace, sqlProjectKeyForRepo } from './sql-project-key'

/**
 * Every project key the catalog still owns, for the GC's live set. Built from the same workspace
 * ids as the other GCs (which include other profiles) plus every repo, so a repo whose worktrees
 * carry no metadata is never mistaken for removed.
 */
export function getKnownSqlProjectKeys(
  store: Pick<Store, 'getAllWorktreeMeta' | 'getFolderWorkspaces' | 'getRepos'>
): Set<string> {
  const workspaceIds = getKnownWorktreeIdsForHistoryGc(store)
  // An unreadable profile makes the set empty on purpose; GC then refuses to prune.
  if (workspaceIds.size === 0) {
    return new Set()
  }
  const keys = new Set<string>()
  for (const id of workspaceIds) {
    const scope = parseWorkspaceKey(id)
    if (scope?.type === 'folder') {
      keys.add(sqlProjectKeyForFolderWorkspace(scope.folderWorkspaceId))
    } else {
      keys.add(
        `repo:${getRepoIdFromWorktreeId(scope?.type === 'worktree' ? scope.worktreeId : id)}`
      )
    }
  }
  for (const repo of store.getRepos()) {
    keys.add(sqlProjectKeyForRepo(repo.id))
  }
  return keys
}
