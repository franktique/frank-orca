import type { AppState } from '../types'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'

// Why: shared by diff-comment-persistence.ts and reviewed-files-persistence.ts — both need
// settings stamped with the worktree's own runtime environment before picking a persist target.
export function settingsForWorktreeOwner(
  state: AppState,
  worktreeId: string
): AppState['settings'] {
  const runtimeEnvironmentId = getRuntimeEnvironmentIdForWorktree(state, worktreeId)
  return state.settings
    ? { ...state.settings, activeRuntimeEnvironmentId: runtimeEnvironmentId }
    : // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: no settings loaded yet; getActiveRuntimeTarget only reads activeRuntimeEnvironmentId off this value, so a partial stand-in is safe here.
      ({
        activeRuntimeEnvironmentId: runtimeEnvironmentId
      } as AppState['settings'])
}
