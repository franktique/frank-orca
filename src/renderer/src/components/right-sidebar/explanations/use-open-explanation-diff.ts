import { useCallback } from 'react'
import { detectLanguage } from '@/lib/language-detect'
import { useAppStore } from '@/store'

/** Opens a file's explanation diff for the active workspace's current explanation. */
export function useOpenExplanationDiff(
  workspaceId: string | null
): (file: { path: string; oldPath?: string }, focusItemId?: string) => void {
  const openExplanationDiff = useAppStore((s) => s.openExplanationDiff)
  const worktreePath = useAppStore((s) =>
    workspaceId ? (s.getKnownWorktreeById(workspaceId)?.path ?? null) : null
  )
  const explanation = useAppStore((s) =>
    workspaceId ? s.explanationsByWorkspace[workspaceId]?.explanation : null
  )
  return useCallback(
    (file, focusItemId) => {
      if (!workspaceId || !worktreePath || !explanation) {
        return
      }
      openExplanationDiff(
        workspaceId,
        worktreePath,
        file,
        {
          explanationId: explanation.id,
          mergeBase: explanation.changeSetBase.mergeBase,
          focusItemId
        },
        detectLanguage(file.path),
        { preview: true }
      )
    },
    [explanation, openExplanationDiff, workspaceId, worktreePath]
  )
}
