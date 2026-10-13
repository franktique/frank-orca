import { getApiClientAvailability } from '@/lib/api-client-availability'
import type { AppState } from '@/store/types'

/**
 * The worktree whose collections the right sidebar should show, or null when the focused
 * tab is not an API Client tab. A render-time override, not a persisted route, so leaving
 * the tab brings back whatever panel the user had open (R4).
 */
export function selectApiClientSidebarWorktreeId(state: AppState): string | null {
  const worktreeId = state.activeWorktreeId
  if (!worktreeId || getApiClientAvailability(state, worktreeId) !== 'available') {
    return null
  }
  return state.getActiveTab(worktreeId)?.contentType === 'api-client' ? worktreeId : null
}
