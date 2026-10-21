import { z } from 'zod'
import { executionOutcomeSchema, resolvedRequestSchema } from '../api-client/api-client-schemas'
import type { ExecutionOutcome, ResolvedRequest } from '../api-client/api-client-types'
import type { QueryResultTable } from './test-orchestrator-types'

export const EVIDENCE_SNAPSHOT_RENDER_CHANNEL = 'evidenceSnapshot:render'
export const EVIDENCE_SNAPSHOT_PAINTED_CHANNEL = 'evidenceSnapshot:painted'

// Why: fixed width keeps screenshots comparable; only the height follows the card.
export const EVIDENCE_SNAPSHOT_WIDTH = 900

export type RequestEvidenceCardData = {
  kind: 'request'
  title: string
  resolvedRequest: ResolvedRequest
  outcome: ExecutionOutcome
  durationMs: number
}

export type QueryEvidenceCardData = {
  kind: 'query'
  title: string
  description?: string
  sql: string
  result: QueryResultTable | null
  error?: string
}

export type EvidenceSnapshotCard = RequestEvidenceCardData | QueryEvidenceCardData

export type EvidenceSnapshotRenderMessage = { token: number; card: EvidenceSnapshotCard }

export type EvidenceSnapshotPaintedMessage = { token: number; width: number; height: number }

export const evidenceSnapshotRenderMessageSchema: z.ZodType<EvidenceSnapshotRenderMessage> =
  z.object({
    token: z.number(),
    card: z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('request'),
        title: z.string(),
        resolvedRequest: resolvedRequestSchema,
        outcome: executionOutcomeSchema,
        durationMs: z.number()
      }),
      z.object({
        kind: z.literal('query'),
        title: z.string(),
        description: z.string().optional(),
        sql: z.string(),
        result: z
          .object({
            columns: z.array(z.string()),
            rows: z.array(z.array(z.string())),
            totalRows: z.number(),
            truncated: z.boolean()
          })
          .nullable(),
        error: z.string().optional()
      })
    ])
  })
