import { z } from 'zod'
import type { ExplanationSet } from './explanation-types'

// Limits from contracts/publish-payload.md. Item text length is deliberately
// NOT checked here: empty/oversize text is a per-item rejection (text_empty /
// text_too_long), not a fatal parse failure.
export const EXPLANATION_MAX_CHANGES = 104
export const EXPLANATION_MAX_FILES_PER_CHANGE = 200
export const EXPLANATION_MAX_ITEMS_PER_FILE = 100
export const EXPLANATION_MAX_ITEMS_TOTAL = 500
export const EXPLANATION_ITEM_TEXT_MAX = 8192
export const EXPLANATION_QUESTION_BODY_MAX = 8192
export const EXPLANATION_AGENT_NAME_MAX = 40
export const EXPLANATION_CHANGE_TITLE_MAX = 120
export const EXPLANATION_CHANGE_SUMMARY_MAX = 4000
export const EXPLANATION_ITEM_ID_MAX = 64
export const EXPLANATION_PAYLOAD_MAX_BYTES = 900 * 1024
export const EXPLANATION_MAX_QUESTIONS_PER_SET = 200

export const ExplanationChangeStatusSchema = z.enum([
  'added',
  'modified',
  'deleted',
  'renamed',
  'copied'
])

export const ExplanationAnchorSideSchema = z.enum(['new', 'old'])

export const ExplanationPublishItemSchema = z.object({
  id: z.string().max(EXPLANATION_ITEM_ID_MAX).optional(),
  side: ExplanationAnchorSideSchema.optional().default('new'),
  startLine: z.number().int().min(1).optional(),
  endLine: z.number().int().min(1).optional(),
  text: z.string()
})

export const ExplanationPublishFileSchema = z.object({
  path: z.string().min(1),
  items: z.array(ExplanationPublishItemSchema).min(1).max(EXPLANATION_MAX_ITEMS_PER_FILE)
})

export const ExplanationPublishChangeSchema = z.object({
  title: z.string().min(1).max(EXPLANATION_CHANGE_TITLE_MAX),
  summary: z.string().max(EXPLANATION_CHANGE_SUMMARY_MAX).default(''),
  files: z.array(ExplanationPublishFileSchema).min(1).max(EXPLANATION_MAX_FILES_PER_CHANGE)
})

export const ExplanationPublishPayloadSchema = z.object({
  version: z.literal(1),
  agent: z.string().max(EXPLANATION_AGENT_NAME_MAX).optional(),
  changes: z.array(ExplanationPublishChangeSchema).min(1).max(EXPLANATION_MAX_CHANGES)
})

export type ExplanationPublishPayload = z.infer<typeof ExplanationPublishPayloadSchema>

// Why: version is checked before the full parse so a wrong version reports
// unsupported_version instead of a generic schema error.
export function extractPayloadVersion(payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return undefined
  }
  if (!('version' in payload)) {
    return undefined
  }
  return payload.version
}

export const ExplanationLineAnchorSchema = z.object({
  side: ExplanationAnchorSideSchema,
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  fingerprint: z.object({
    lines: z.array(z.string()),
    before: z.array(z.string()),
    after: z.array(z.string()),
    diffIdentity: z.string().optional()
  })
})

export const ExplanationItemSchema = z.object({
  id: z.string(),
  clientId: z.string().optional(),
  position: z.number().int().min(1),
  anchor: z.union([ExplanationLineAnchorSchema, z.object({ fileLevel: z.literal(true) })]),
  text: z.string()
})

export const ExplanationFileEntrySchema = z.object({
  path: z.string(),
  oldPath: z.string().optional(),
  status: ExplanationChangeStatusSchema,
  position: z.number().int().min(1),
  items: z.array(ExplanationItemSchema).min(1)
})

export const ExplanationChangeSchema = z.object({
  index: z.number().int().min(0),
  title: z.string(),
  summary: z.string(),
  files: z.array(ExplanationFileEntrySchema).min(1)
})

export const ExplanationChangeSetBaseSchema = z.object({
  kind: z.enum(['branch-and-uncommitted', 'uncommitted-only']),
  baseRef: z.string().nullable(),
  mergeBase: z.string(),
  headOid: z.string().nullable()
})

export const FollowUpQuestionSchema = z.object({
  id: z.string(),
  itemId: z.string(),
  body: z.string().min(1).max(EXPLANATION_QUESTION_BODY_MAX),
  createdAt: z.number(),
  updatedAt: z.number().optional(),
  state: z.enum(['draft', 'sent']),
  sentAt: z.number().optional(),
  sentTo: z
    .object({
      paneKey: z.string().optional(),
      label: z.string()
    })
    .optional()
})

export const PublishIssueSchema = z.object({
  code: z.enum([
    'invalid_payload',
    'unsupported_version',
    'payload_too_large',
    'too_many_items',
    'no_changes',
    'file_not_in_change_set',
    'side_unavailable',
    'line_out_of_range',
    'line_anchor_unsupported',
    'text_empty',
    'text_too_long',
    'outside_changed_hunk',
    'duplicate_file_in_change'
  ]),
  message: z.string(),
  changeIndex: z.number().int().optional(),
  fileIndex: z.number().int().optional(),
  itemIndex: z.number().int().optional(),
  clientId: z.string().optional(),
  path: z.string().optional()
})

export const ExplanationSetSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  revision: z.number().int().min(1),
  producer: z.object({
    agentName: z.string(),
    paneKey: z.string().optional(),
    terminalHandle: z.string().optional()
  }),
  generatedAt: z.number(),
  changeSetBase: ExplanationChangeSetBaseSchema,
  changes: z.array(ExplanationChangeSchema).min(1),
  questions: z.array(FollowUpQuestionSchema),
  publishWarnings: z.array(PublishIssueSchema)
})

export const StoredExplanationFileSchema = z.object({
  schemaVersion: z.literal(1),
  workspaceId: z.string(),
  explanation: ExplanationSetSchema
})

export type StoredExplanationFile = z.infer<typeof StoredExplanationFileSchema>

export type StoredExplanationRead =
  | { outcome: 'ok'; explanation: ExplanationSet }
  | { outcome: 'future-schema' }
  | { outcome: 'corrupt' }

/**
 * Discriminates the two unreadable cases: `future-schema` must be left on disk for a
 * newer Orca (contracts/storage-format.md); `corrupt` is safe to quarantine.
 */
export function readStoredExplanationFile(raw: string): StoredExplanationRead {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { outcome: 'corrupt' }
  }
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'schemaVersion' in parsed &&
    parsed.schemaVersion !== 1
  ) {
    return { outcome: 'future-schema' }
  }
  const result = StoredExplanationFileSchema.safeParse(parsed)
  return result.success
    ? { outcome: 'ok', explanation: result.data.explanation }
    : { outcome: 'corrupt' }
}

export const ExplanationQuestionUpsertSchema = z.object({
  id: z.string().optional(),
  itemId: z.string().min(1),
  body: z.string().min(1).max(EXPLANATION_QUESTION_BODY_MAX)
})

export type ExplanationQuestionUpsertInput = z.infer<typeof ExplanationQuestionUpsertSchema>

export function parseStoredExplanationFile(raw: string): ExplanationSet | null {
  const outcome = readStoredExplanationFile(raw)
  return outcome.outcome === 'ok' ? outcome.explanation : null
}

// For `orca explain schema` (contracts/publish-payload.md): the payload shape as
// JSON Schema, printed without a running runtime.
export function explanationPublishPayloadJsonSchema(): object {
  return z.toJSONSchema(ExplanationPublishPayloadSchema, { io: 'input' })
}
