import type { FileReviewRecord, FileReviewSignature } from '../../../shared/file-review-types'
import type { AppState } from './types'
import type { ReviewedFilesField } from './slices/reviewed-files-persistence'
import { getIndexedWorktreeById } from './worktree-repo-index'
import { findFolderWorkspaceOwner } from '@/lib/folder-workspace-runtime-owner'
import { parseWorkspaceKey } from '../../../shared/workspace-scope'

const EMPTY_REVIEWED: FileReviewRecord = Object.freeze({})

type ReviewedFilesSelectorState = Pick<AppState, 'worktreesByRepo'> &
  Partial<Pick<AppState, 'folderWorkspaces'>>

export function selectWorktreeReviewedFiles(
  state: ReviewedFilesSelectorState,
  worktreeId: string | null | undefined,
  field: ReviewedFilesField
): FileReviewRecord {
  if (!worktreeId) {
    return EMPTY_REVIEWED
  }
  const scope = parseWorkspaceKey(worktreeId)
  if (scope?.type === 'folder') {
    return findFolderWorkspaceOwner(state, scope.folderWorkspaceId)?.[field] ?? EMPTY_REVIEWED
  }
  return getIndexedWorktreeById(state.worktreesByRepo, worktreeId)?.[field] ?? EMPTY_REVIEWED
}

// Why: a row reads as reviewed only while the signature it was reviewed at still
// matches the live entry — any further edit to the file changes added/removed/status
// and the row falls back to unreviewed with no separate reconciliation step needed.
export function isFileReviewSignatureCurrent(
  reviewed: FileReviewRecord,
  path: string,
  liveSignature: FileReviewSignature
): boolean {
  const recorded = reviewed[path]
  return (
    recorded !== undefined &&
    recorded.status === liveSignature.status &&
    recorded.added === liveSignature.added &&
    recorded.removed === liveSignature.removed
  )
}
