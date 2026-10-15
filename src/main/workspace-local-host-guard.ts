import type { Store } from './persistence'
import { LOCAL_EXECUTION_HOST_ID, getWorktreeExecutionHostId } from '../shared/execution-host'
import { parseWorkspaceKey } from '../shared/workspace-scope'
import { getRepoIdFromWorktreeId } from '../shared/worktree/id'

export type WorkspaceHostGuardStore = Pick<
  Store,
  'getRepo' | 'getAllWorktreeMeta' | 'getFolderWorkspace'
>

export type WorkspaceHostGuardFailure = {
  ok: false
  code: 'not-local' | 'not-found'
  message: string
}

/** Folder workspaces count as local unless they carry an SSH connection or a non-local host. */
export function assertLocalWorkspace(
  store: WorkspaceHostGuardStore,
  worktreeId: string,
  featureLabel: string
): { ok: true } | WorkspaceHostGuardFailure {
  const notLocal = (): WorkspaceHostGuardFailure => ({
    ok: false,
    code: 'not-local',
    message: `${featureLabel} is only available for local workspaces.`
  })
  const scope = parseWorkspaceKey(worktreeId)
  if (scope?.type === 'folder') {
    const workspace = store.getFolderWorkspace(scope.folderWorkspaceId)
    if (!workspace) {
      return { ok: false, code: 'not-found', message: 'Workspace not found.' }
    }
    const hostId = workspace.executionHostId ?? LOCAL_EXECUTION_HOST_ID
    return workspace.connectionId || hostId !== LOCAL_EXECUTION_HOST_ID ? notLocal() : { ok: true }
  }

  const worktreeIdForLookup = scope?.type === 'worktree' ? scope.worktreeId : worktreeId
  const repo = store.getRepo(getRepoIdFromWorktreeId(worktreeIdForLookup))
  if (!repo) {
    return { ok: false, code: 'not-found', message: 'Workspace not found.' }
  }
  const meta = store.getAllWorktreeMeta()[worktreeIdForLookup]
  const hostId = getWorktreeExecutionHostId({ hostId: meta?.hostId }, repo)
  return hostId === LOCAL_EXECUTION_HOST_ID ? { ok: true } : notLocal()
}
