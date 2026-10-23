// Types for Agent Change Explanations, per specs/002-agent-change-explanations/data-model.md.
// Zod schemas for the wire/persisted shapes live in explanation-schemas.ts.

export type ExplanationChangeSetBaseKind = 'branch-and-uncommitted' | 'uncommitted-only'

export type ChangeSetBase = {
  kind: ExplanationChangeSetBaseKind
  baseRef: string | null
  mergeBase: string
  headOid: string | null
}

export type ChangeSetFileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied'

export type ChangeSetFile = {
  path: string
  oldPath?: string
  status: ChangeSetFileStatus
}

export type ExplanationProducer = {
  agentName: string
  paneKey?: string
  terminalHandle?: string
}

export type Change = {
  index: number
  title: string
  summary: string
  files: FileEntry[]
}

export type FileEntry = {
  path: string
  oldPath?: string
  status: ChangeSetFileStatus
  position: number
  items: ExplanationItem[]
}

export type LineAnchor = {
  side: 'new' | 'old'
  startLine: number
  endLine: number
  fingerprint: AnchorFingerprint
}

export type AnchorFingerprint = {
  lines: string[]
  before: string[]
  after: string[]
  diffIdentity?: string
}

export type FileLevelAnchor = { fileLevel: true }

export type ExplanationItem = {
  id: string
  clientId?: string
  position: number
  anchor: LineAnchor | FileLevelAnchor
  text: string
}

export type FollowUpQuestion = {
  id: string
  itemId: string
  body: string
  createdAt: number
  updatedAt?: number
  state: 'draft' | 'sent'
  sentAt?: number
  sentTo?: { paneKey?: string; label: string }
}

export type ExplanationSet = {
  id: string
  workspaceId: string
  revision: number
  producer: ExplanationProducer
  generatedAt: number
  changeSetBase: ChangeSetBase
  changes: Change[]
  questions: FollowUpQuestion[]
  publishWarnings: PublishIssue[]
}

export type ResolvedAnchorState = 'fresh' | 'outdated' | 'detached'

export type ResolvedAnchor = {
  state: ResolvedAnchorState
  line?: number
  endLine?: number
}

export type PublishIssueCode =
  | 'invalid_payload'
  | 'unsupported_version'
  | 'payload_too_large'
  | 'too_many_items'
  | 'no_changes'
  | 'file_not_in_change_set'
  | 'side_unavailable'
  | 'line_out_of_range'
  | 'line_anchor_unsupported'
  | 'text_empty'
  | 'text_too_long'
  | 'outside_changed_hunk'
  | 'duplicate_file_in_change'

export type PublishIssue = {
  code: PublishIssueCode
  message: string
  changeIndex?: number
  fileIndex?: number
  itemIndex?: number
  clientId?: string
  path?: string
}

export type PublishLabel = { id: string; label: string }

export type PublishResult = {
  ok: true
  published: boolean
  explanationId?: string
  replacedPrevious: boolean
  changeSetBase: ChangeSetBase
  counts: {
    changes: number
    files: number
    items: number
    rejected: number
    warnings: number
  }
  labels: PublishLabel[]
  rejected: PublishIssue[]
  warnings: PublishIssue[]
}
