import type { GitDiffResult } from '../../shared/git-diff-compare-types'
import type {
  ChangeSetBase,
  ChangeSetFile,
  ExplanationSet,
  FollowUpQuestion
} from '../../shared/agent-explanations/explanation-types'

export type ExplanationsResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; code: string; message: string }

export type ExplanationsChangedEvent = { workspaceId: string; revision: number }

export type ExplanationsApi = {
  get: (args: {
    workspaceId: string
  }) => Promise<ExplanationsResult<{ explanation: ExplanationSet | null }>>
  changeSet: (args: {
    workspaceId: string
    connectionId?: string
  }) => Promise<ExplanationsResult<{ base: ChangeSetBase; files: ChangeSetFile[] }>>
  fileDiff: (args: {
    workspaceId: string
    path: string
    oldPath?: string
    mergeBase: string
    connectionId?: string
  }) => Promise<GitDiffResult | { ok: false; code: string; message: string }>
  clear: (args: {
    workspaceId: string
    explanationId?: string
  }) => Promise<ExplanationsResult<{ cleared: boolean }>>
  upsertQuestion: (args: {
    workspaceId: string
    explanationId: string
    question: { id?: string; itemId: string; body: string }
  }) => Promise<ExplanationsResult<{ question: FollowUpQuestion }>>
  markQuestionsSent: (args: {
    workspaceId: string
    explanationId: string
    questionIds: string[]
    sentTo: { paneKey?: string; label: string }
  }) => Promise<ExplanationsResult>
  deleteQuestion: (args: {
    workspaceId: string
    explanationId: string
    questionId: string
  }) => Promise<ExplanationsResult>
  /** Returns the unsubscribe function. */
  onChanged: (listener: (event: ExplanationsChangedEvent) => void) => () => void
}
