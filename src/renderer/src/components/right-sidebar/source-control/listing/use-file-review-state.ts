import { useCallback, useMemo } from 'react'
import { useAppStore } from '@/store'
import {
  isFileReviewSignatureCurrent,
  selectWorktreeReviewedFiles
} from '@/store/worktree-file-review-selector'
import type { FileReviewSignature } from '../../../../../../shared/file-review-types'
import type { GitStatusEntry } from '../../../../../../shared/git-status-types'
import type { GitBranchChangeEntry } from '../../../../../../shared/git-diff-compare-types'

// Why: added/removed are optional on both entry types (e.g. huge-repo capped rows), but a
// review signature needs concrete numbers to compare for equality on the next status refresh.
function toFileReviewSignature(entry: {
  status: string
  added?: number
  removed?: number
}): FileReviewSignature {
  return {
    status: entry.status,
    added: entry.added ?? 0,
    removed: entry.removed ?? 0
  }
}

/**
 * Backs the Source Control panel's per-file "reviewed" checkbox (local to Orca, never
 * committed to the repo). A path reads as reviewed only while the diff signature it was
 * marked at ({@link GitStatusEntry.status}/added/removed) still matches the live entry —
 * any further edit to the file falls it back to unreviewed with no extra reconciliation step.
 */
export function useSourceControlFileReviewState({
  activeWorktreeId,
  entries,
  branchEntries,
  setChangedFileReviewed,
  setBranchFileReviewed
}: {
  activeWorktreeId: string | null
  entries: readonly GitStatusEntry[]
  branchEntries: readonly GitBranchChangeEntry[]
  setChangedFileReviewed: (
    worktreeId: string,
    path: string,
    signature: FileReviewSignature | null
  ) => Promise<boolean>
  setBranchFileReviewed: (
    worktreeId: string,
    path: string,
    signature: FileReviewSignature | null
  ) => Promise<boolean>
}) {
  const reviewedChangedFiles = useAppStore((s) =>
    selectWorktreeReviewedFiles(s, activeWorktreeId, 'reviewedChangedFiles')
  )
  const reviewedBranchFiles = useAppStore((s) =>
    selectWorktreeReviewedFiles(s, activeWorktreeId, 'reviewedBranchFiles')
  )

  const reviewedChangedByPath = useMemo(() => {
    const map = new Map<string, boolean>()
    for (const entry of entries) {
      map.set(
        entry.path,
        isFileReviewSignatureCurrent(reviewedChangedFiles, entry.path, toFileReviewSignature(entry))
      )
    }
    return map
  }, [entries, reviewedChangedFiles])

  const reviewedBranchByPath = useMemo(() => {
    const map = new Map<string, boolean>()
    for (const entry of branchEntries) {
      map.set(
        entry.path,
        isFileReviewSignatureCurrent(reviewedBranchFiles, entry.path, toFileReviewSignature(entry))
      )
    }
    return map
  }, [branchEntries, reviewedBranchFiles])

  const toggleChangedFileReviewed = useCallback(
    (entry: GitStatusEntry) => {
      if (!activeWorktreeId) {
        return
      }
      const signature = toFileReviewSignature(entry)
      const alreadyReviewed = isFileReviewSignatureCurrent(
        reviewedChangedFiles,
        entry.path,
        signature
      )
      void setChangedFileReviewed(activeWorktreeId, entry.path, alreadyReviewed ? null : signature)
    },
    [activeWorktreeId, reviewedChangedFiles, setChangedFileReviewed]
  )

  const toggleBranchFileReviewed = useCallback(
    (entry: GitBranchChangeEntry) => {
      if (!activeWorktreeId) {
        return
      }
      const signature = toFileReviewSignature(entry)
      const alreadyReviewed = isFileReviewSignatureCurrent(
        reviewedBranchFiles,
        entry.path,
        signature
      )
      void setBranchFileReviewed(activeWorktreeId, entry.path, alreadyReviewed ? null : signature)
    },
    [activeWorktreeId, reviewedBranchFiles, setBranchFileReviewed]
  )

  return {
    reviewedChangedByPath,
    reviewedBranchByPath,
    toggleChangedFileReviewed,
    toggleBranchFileReviewed
  }
}

export type SourceControlFileReviewState = ReturnType<typeof useSourceControlFileReviewState>
