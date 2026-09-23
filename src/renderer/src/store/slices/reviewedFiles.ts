import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type { FileReviewRecord, FileReviewSignature } from '../../../../shared/file-review-types'
import { findWorktreeById } from './worktree-helpers'
import { findFolderWorkspaceOwner } from '@/lib/folder-workspace-runtime-owner'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'
import {
  enqueueReviewedFilesPersist,
  mutateReviewedFiles,
  type ReviewedFilesField
} from './reviewed-files-persistence'

export type ReviewedFilesSlice = {
  getReviewedFiles: (
    worktreeId: string | null | undefined,
    field: ReviewedFilesField
  ) => FileReviewRecord
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
}

// Why: a frozen shared sentinel avoids selector re-renders and mutation, same as diffComments.
const EMPTY_REVIEWED: FileReviewRecord = Object.freeze({})

async function setFileReviewed(
  set: Parameters<StateCreator<AppState>>[0],
  get: () => AppState,
  worktreeId: string,
  field: ReviewedFilesField,
  path: string,
  signature: FileReviewSignature | null
): Promise<boolean> {
  const result = mutateReviewedFiles(set, worktreeId, field, (existing) => {
    if (signature === null) {
      if (!(path in existing)) {
        return null
      }
      const next = { ...existing }
      delete next[path]
      return next
    }
    const current = existing[path]
    if (
      current &&
      current.status === signature.status &&
      current.added === signature.added &&
      current.removed === signature.removed
    ) {
      return null
    }
    return { ...existing, [path]: signature }
  })
  if (!result) {
    return true
  }
  try {
    await enqueueReviewedFilesPersist(set, worktreeId, field, get, result)
    return true
  } catch (err) {
    console.error(`Failed to persist ${field}:`, err)
    return false
  }
}

export const createReviewedFilesSlice: StateCreator<AppState, [], [], ReviewedFilesSlice> = (
  set,
  get
) => ({
  getReviewedFiles: (worktreeId, field) => {
    if (!worktreeId) {
      return EMPTY_REVIEWED
    }
    const scope = parseWorkspaceKey(worktreeId)
    const worktree =
      scope?.type === 'folder'
        ? findFolderWorkspaceOwner(get(), scope.folderWorkspaceId)
        : findWorktreeById(get().worktreesByRepo, worktreeId)
    return worktree?.[field] ?? EMPTY_REVIEWED
  },

  setChangedFileReviewed: (worktreeId, path, signature) =>
    setFileReviewed(set, get, worktreeId, 'reviewedChangedFiles', path, signature),

  setBranchFileReviewed: (worktreeId, path, signature) =>
    setFileReviewed(set, get, worktreeId, 'reviewedBranchFiles', path, signature)
})
