import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../shared/constants'
import { LOCAL_EXECUTION_HOST_ID } from '../../../shared/execution-host'
import type { AppState } from '@/store/types'
import { isPairedWebClientWindow } from './desktop-window-chrome'
import { getConnectionIdFromState } from './connection-context'
import { getRuntimeEnvironmentIdForWorktree } from './worktree-runtime-owner'
import { getActiveExecutionHostIdForWorktree } from './unified-tab-host-ownership'

/**
 * `remote` stays visible but disabled (FR-001a): the data and the requests live on this
 * machine, so SSH and remote-runtime workspaces cannot use it. `hidden` is a surface that
 * has no main process to talk to.
 */
export type ApiClientAvailability = 'available' | 'remote' | 'hidden'

export function getApiClientAvailability(
  state: AppState,
  worktreeId: string | null
): ApiClientAvailability {
  if (!worktreeId || worktreeId === FLOATING_TERMINAL_WORKTREE_ID || isPairedWebClientWindow()) {
    return 'hidden'
  }
  const hostId = getActiveExecutionHostIdForWorktree(state, worktreeId)
  const isRemote =
    Boolean(getConnectionIdFromState(state, worktreeId)) ||
    Boolean(getRuntimeEnvironmentIdForWorktree(state, worktreeId)) ||
    (hostId !== undefined && hostId !== LOCAL_EXECUTION_HOST_ID)
  return isRemote ? 'remote' : 'available'
}
