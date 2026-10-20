import type { AppState } from '../types'
import { buildGlobalOrder } from '../../../../shared/agent-explanations/explanation-labels'
import { detectLanguage } from '@/lib/language-detect'

/** Steps through items in reading order, opening the next file when the item lives elsewhere. */
export function stepExplanationItem(
  get: () => AppState,
  workspaceId: string,
  direction: 1 | -1
): void {
  const state = get().explanationsByWorkspace[workspaceId]
  const explanation = state?.explanation
  if (!state || !explanation) {
    return
  }
  const order = buildGlobalOrder(explanation)
  const current = order.findIndex((entry) => entry.itemId === state.activeItemId)
  const nextIndex = current === -1 ? (direction === 1 ? 0 : order.length - 1) : current + direction
  const target = order[nextIndex]
  if (!target) {
    return
  }
  const activeFileId = get().activeFileIdByWorktree?.[workspaceId]
  const activeFile = get().openFiles.find((file) => file.id === activeFileId)
  const sameFile =
    activeFile?.diffSource === 'explanation' &&
    activeFile.relativePath === target.path &&
    activeFile.explanationRef?.explanationId === explanation.id
  get().setActiveExplanationItem(workspaceId, target.itemId)
  if (sameFile) {
    return
  }
  const worktreePath = get().getKnownWorktreeById(workspaceId)?.path
  if (!worktreePath) {
    return
  }
  const file = explanation.changes
    .flatMap((change) => change.files)
    .find((candidate) => candidate.path === target.path)
  get().openExplanationDiff(
    workspaceId,
    worktreePath,
    { path: target.path, oldPath: file?.oldPath },
    {
      explanationId: explanation.id,
      mergeBase: explanation.changeSetBase.mergeBase,
      focusItemId: target.itemId
    },
    detectLanguage(target.path),
    { preview: true }
  )
}
