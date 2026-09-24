import { useCallback, useMemo } from 'react'
import { useAppStore } from '@/store'
import {
  getFileReviewDisplayState,
  selectWorktreeReviewedFiles
} from '@/store/worktree-file-review-selector'
import type {
  FileDiffSignature,
  FileReviewDisplayState,
  FileReviewSignature,
  FileReviewState
} from '../../../../../../shared/file-review-types'
import type { GitStatusEntry } from '../../../../../../shared/git-status-types'
import type { GitBranchChangeEntry } from '../../../../../../shared/git-diff-compare-types'

// Why: added/removed are optional on both entry types (e.g. huge-repo capped rows), but a
// review signature needs concrete numbers to compare for equality on the next status refresh.
function toFileDiffSignature(entry: {
  status: string
  added?: number
  removed?: number
}): FileDiffSignature {
  return {
    status: entry.status,
    added: entry.added ?? 0,
    removed: entry.removed ?? 0
  }
}

// Why: cycling past `markedForDeletion` clears the mark (back to unreviewed) instead of
// looping straight back to `reviewed`, so a stray extra click doesn't silently re-mark a file.
function nextFileReviewState(current: FileReviewDisplayState): FileReviewState | null {
  switch (current) {
    case 'unreviewed':
      return 'reviewed'
    case 'reviewed':
      return 'markedForDeletion'
    case 'markedForDeletion':
      return null
  }
}

/**
 * Backs the Source Control panel's per-file 3-state review checkbox (local to Orca, never
 * committed to the repo): unreviewed → reviewed → marked for deletion, cycled by click.
 * `reviewed` reads as current only while the diff signature it was marked at
 * ({@link GitStatusEntry.status}/added/removed) still matches the live entry — any further
 * edit falls it back to unreviewed with no extra reconciliation step. `markedForDeletion`
 * ignores that drift; see {@link FileReviewState}.
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
    const map = new Map<string, FileReviewDisplayState>()
    for (const entry of entries) {
      map.set(
        entry.path,
        getFileReviewDisplayState(reviewedChangedFiles, entry.path, toFileDiffSignature(entry))
      )
    }
    return map
  }, [entries, reviewedChangedFiles])

  const reviewedBranchByPath = useMemo(() => {
    const map = new Map<string, FileReviewDisplayState>()
    for (const entry of branchEntries) {
      map.set(
        entry.path,
        getFileReviewDisplayState(reviewedBranchFiles, entry.path, toFileDiffSignature(entry))
      )
    }
    return map
  }, [branchEntries, reviewedBranchFiles])

  const cycleChangedFileReviewed = useCallback(
    (entry: GitStatusEntry) => {
      if (!activeWorktreeId) {
        return
      }
      const diffSignature = toFileDiffSignature(entry)
      const current = getFileReviewDisplayState(reviewedChangedFiles, entry.path, diffSignature)
      const nextState = nextFileReviewState(current)
      void setChangedFileReviewed(
        activeWorktreeId,
        entry.path,
        nextState ? { ...diffSignature, state: nextState } : null
      )
    },
    [activeWorktreeId, reviewedChangedFiles, setChangedFileReviewed]
  )

  const cycleBranchFileReviewed = useCallback(
    (entry: GitBranchChangeEntry) => {
      if (!activeWorktreeId) {
        return
      }
      const diffSignature = toFileDiffSignature(entry)
      const current = getFileReviewDisplayState(reviewedBranchFiles, entry.path, diffSignature)
      const nextState = nextFileReviewState(current)
      void setBranchFileReviewed(
        activeWorktreeId,
        entry.path,
        nextState ? { ...diffSignature, state: nextState } : null
      )
    },
    [activeWorktreeId, reviewedBranchFiles, setBranchFileReviewed]
  )

  return {
    reviewedChangedByPath,
    reviewedBranchByPath,
    cycleChangedFileReviewed,
    cycleBranchFileReviewed
  }
}

export type SourceControlFileReviewState = ReturnType<typeof useSourceControlFileReviewState>
