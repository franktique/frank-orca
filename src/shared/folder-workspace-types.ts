import type { ExecutionHostId } from './execution-host'
import type { TaskSourceContext } from './task-source-context'
import type { TuiAgent } from './tui-agent'
import type { DiffComment } from './diff-comment-types'
import type { FileReviewRecord } from './file-review-types'
import type {
  WorkspaceCreatorProvenance,
  WorkspaceLinkedItem,
  WorkspaceStatus
} from './worktree/types'

export type WorkspaceScope =
  | { type: 'worktree'; worktreeId: string }
  | { type: 'folder'; folderWorkspaceId: string }

export type WorkspaceKey = `worktree:${string}` | `folder:${string}`

export type FolderWorkspace = {
  id: string
  projectGroupId: string
  name: string
  folderPath: string
  /** SSH target ID for folder workspaces whose folder path lives remotely. */
  connectionId?: string | null
  /** Renderer-owned host stamp for host-qualified folder catalogs. */
  executionHostId?: ExecutionHostId | null
  /** Authenticated client that created this workspace. Missing means unknown legacy origin. */
  creatorProvenance?: WorkspaceCreatorProvenance
  linkedTask: WorkspaceLinkedItem | null
  linkedTaskSourceContext?: TaskSourceContext | null
  comment: string
  isArchived: boolean
  isUnread: boolean
  isPinned: boolean
  /** See Worktree.isHidden. Optional so older persisted rows keep loading. */
  isHidden?: boolean
  sortOrder: number
  /** User-authored sidebar ordering. Higher values render earlier in Manual sort. */
  manualOrder?: number
  workspaceStatus?: WorkspaceStatus
  createdWithAgent?: TuiAgent
  pendingFirstAgentMessageRename?: boolean
  firstAgentMessageRenameError?: string | null
  lastActivityAt: number
  createdAt: number
  updatedAt: number
  diffComments?: DiffComment[]
  /** See {@link import('./worktree/types').Worktree.reviewedChangedFiles}. */
  reviewedChangedFiles?: FileReviewRecord
  /** See {@link import('./worktree/types').Worktree.reviewedBranchFiles}. */
  reviewedBranchFiles?: FileReviewRecord
}

export type FolderWorkspaceLinkedTask = WorkspaceLinkedItem
