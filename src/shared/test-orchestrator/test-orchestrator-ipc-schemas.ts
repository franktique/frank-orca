// Zod schemas for renderer-main IPC payloads. See contracts/ipc-renderer-main.md.
import { z } from 'zod'
import { apiNodeIdSchema } from '../api-client/api-client-schemas'
import { phaseSchema } from './test-map-schema'
import {
  databaseModeChoiceSchema,
  pauseAnswerSchema,
  pauseRequestSchema,
  testRunFields,
  verificationQuerySchema
} from './test-orchestrator-schemas'
import type { TestRunSummary } from './test-orchestrator-types'

// ─── IPC params ─────────────────────────────────────────────────────

export const TEST_RUN_ERROR_CODES = [
  'not-local',
  'not-found',
  'conflict',
  'invalid-test-map',
  'busy',
  'host-not-allowed',
  'host-unconfirmed',
  'missing-inputs',
  'connection-failed',
  'console-not-found',
  'no-pause',
  'pause-mismatch'
] as const

export type TestRunErrorCode = (typeof TEST_RUN_ERROR_CODES)[number]

const worktreeId = z.string().min(1)
const target = { worktreeId, collectionId: apiNodeIdSchema }

export const pickTestMapFileParamsSchema = z.object({})
export const loadTestMapParamsSchema = z.object({
  ...target,
  filePath: z.string().min(1),
  replace: z.boolean().optional()
})
export const getTestMapParamsSchema = z.object(target)
export const saveQueriesParamsSchema = z.object({
  ...target,
  requestId: apiNodeIdSchema,
  before: z.array(verificationQuerySchema),
  after: z.array(verificationQuerySchema),
  baseLoadedAt: z.number()
})
export const pickExportFileParamsSchema = z.object(target)
export const exportTestMapParamsSchema = z.object({ ...target, filePath: z.string().min(1) })
export const removeTestMapParamsSchema = z.object(target)

export const prepareParamsSchema = z.object({ ...target, environmentId: apiNodeIdSchema })
export const resolveTargetsParamsSchema = z.object({
  ...target,
  environmentId: apiNodeIdSchema,
  inputs: z.record(z.string(), z.string())
})
export const testDatabaseParamsSchema = z.object({
  worktreeId,
  mode: databaseModeChoiceSchema,
  browserPageId: z.string().optional()
})
export const listConsoleTabsParamsSchema = z.object({ worktreeId })
export const clearRememberedSecretsParamsSchema = z.object(target)

export const startRunParamsSchema = z.object({
  ...target,
  environmentId: apiNodeIdSchema,
  kind: z.enum(['full', 'cleanup-only']),
  inputs: z.record(z.string(), z.string()),
  remember: z.object({ inputs: z.boolean(), secrets: z.boolean() }),
  database: databaseModeChoiceSchema.nullable(),
  browserPageId: z.string().optional(),
  confirmedHosts: z.array(z.string()),
  approvedDataChanges: z.array(z.string())
})
export const stopRunParamsSchema = z.object({ worktreeId, runId: z.string().min(1) })
export const answerPauseParamsSchema = z.object({
  worktreeId,
  runId: z.string().min(1),
  pauseId: z.string().min(1),
  answer: pauseAnswerSchema
})
export const getRunParamsSchema = z.object(target)
export const getStepDetailParamsSchema = z.object({
  ...target,
  runId: z.string().min(1),
  stepIndex: z.number().int().min(0)
})
export const forgetCapturesParamsSchema = z.object(target)

// ─── IPC events (main to renderer) ──────────────────────────────────

const stepSummarySchema = z.object({
  stepId: z.string(),
  title: z.string(),
  phase: phaseSchema,
  result: z.enum(['pass', 'fail', 'skipped', 'blocked', 'running', 'pending']),
  reason: z.string().optional(),
  durationMs: z.number()
})

const testRunSummarySchema: z.ZodType<TestRunSummary> = z.object({
  ...testRunFields,
  steps: z.array(stepSummarySchema)
})

export const testRunChangedEventSchema = z.object({ ...target, run: testRunSummarySchema })
export const testRunPausedEventSchema = z.object({
  ...target,
  runId: z.string(),
  pause: z.intersection(
    z.union([pauseRequestSchema, z.object({ kind: z.literal('stopping') })]),
    z.object({ pauseId: z.string() })
  )
})
export const testRunFinishedEventSchema = z.object({
  ...target,
  run: testRunSummarySchema,
  evidence: z.object({ reportPath: z.string(), folder: z.string(), ignoredByGit: z.boolean() })
})
export const testMapChangedEventSchema = z.object(target)
