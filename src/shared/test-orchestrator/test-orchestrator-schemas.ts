// Zod schemas for stored test-orchestrator files and renderer-main IPC. See contracts/.
import { z } from 'zod'
import {
  apiNodeIdSchema,
  executionOutcomeSchema,
  resolvedRequestSchema,
  testResultSchema
} from '../api-client/api-client-schemas'
import { expectationSchema, phaseSchema, VARIABLE_NAME_PATTERN } from './test-map-schema'
import type {
  CaptureLedger,
  DatabaseModeChoice,
  PauseAnswer,
  PauseRequest,
  PlanSettings,
  QueryEvidence,
  RequestEvidence,
  StepResult,
  TestMap,
  TestRun,
  VerificationQuery
} from './test-orchestrator-types'

const SCHEMA_VERSION = 1 as const

// ─── Test map ───────────────────────────────────────────────────────

export const verificationQuerySchema: z.ZodType<VerificationQuery> = z.object({
  id: z.string().min(1),
  sql: z.string(),
  description: z.string().optional(),
  precondition: z.boolean(),
  changesData: z.boolean()
})

const testMapRefSchema = z.union([
  z.object({ id: apiNodeIdSchema }),
  z.object({ path: z.array(z.string()) })
])

const testMapLinkSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('linked'), requestId: apiNodeIdSchema }),
  z.object({ state: z.literal('unmatched') }),
  z.object({ state: z.literal('ambiguous'), candidates: z.array(apiNodeIdSchema) }),
  z.object({ state: z.literal('broken'), lastRequestId: apiNodeIdSchema })
])

const variableNameSchema = z.string().regex(VARIABLE_NAME_PATTERN)

export const testMapSchema: z.ZodType<TestMap> = z.object({
  orcaTestMap: z.literal(1),
  collectionId: apiNodeIdSchema,
  guidePath: z.string().optional(),
  allowedHosts: z.array(z.string()).optional(),
  databaseConsole: z
    .object({
      editorSelector: z.string().optional(),
      runSelector: z.string().optional(),
      resultSelector: z.string().optional()
    })
    .optional(),
  entries: z.array(
    z.object({
      ref: testMapRefSchema,
      link: testMapLinkSchema,
      title: z.string().optional(),
      stepId: z.string().optional(),
      phase: phaseSchema.optional(),
      expect: expectationSchema.optional(),
      expectAll: z.array(expectationSchema).optional(),
      captures: z.array(z.object({ variable: variableNameSchema, from: z.string() })).optional(),
      dependsOn: z.array(z.string()).optional(),
      concurrentGroup: z.string().optional(),
      forEach: variableNameSchema.optional(),
      before: z.array(verificationQuerySchema),
      after: z.array(verificationQuerySchema)
    })
  ),
  loadedAt: z.number(),
  sourceFileName: z.string().optional()
})

// ─── Plan settings and database mode ────────────────────────────────

export const databaseModeChoiceSchema: z.ZodType<DatabaseModeChoice> = z.discriminatedUnion(
  'mode',
  [
    z.object({
      mode: z.literal('automatic'),
      connectionId: z.string().min(1),
      projectKey: z.string()
    }),
    z.object({ mode: z.literal('browser'), origin: z.string().min(1) }),
    z.object({ mode: z.literal('manual') })
  ]
)

export const planSettingsSchema: z.ZodType<PlanSettings> = z.object({
  collectionId: apiNodeIdSchema,
  environmentId: apiNodeIdSchema.nullable(),
  databaseMode: databaseModeChoiceSchema.optional(),
  inputs: z.record(z.string(), z.string()),
  secretInputs: z.record(z.string(), z.string())
})

// ─── Capture ledger ─────────────────────────────────────────────────

export const captureLedgerSchema: z.ZodType<CaptureLedger> = z.object({
  collectionId: apiNodeIdSchema,
  values: z.array(
    z.object({
      variable: z.string(),
      value: z.string(),
      capturedAt: z.number(),
      runId: z.string(),
      stepId: z.string(),
      source: z.enum(['script', 'test-map']),
      unavailable: z.boolean().optional(),
      cleaned: z.object({ runId: z.string(), stepId: z.string(), at: z.number() }).nullable()
    })
  )
})

// ─── Pauses ─────────────────────────────────────────────────────────

export const pauseRequestSchema: z.ZodType<PauseRequest> = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('manual-queries'),
    stepId: z.string(),
    when: z.enum(['before', 'after']),
    queries: z.array(
      z.object({
        queryId: z.string(),
        sqlResolved: z.string(),
        sqlRaw: z.string().optional(),
        description: z.string().optional()
      })
    )
  }),
  z.object({
    kind: z.literal('browser-recovery'),
    stepId: z.string(),
    queryId: z.string(),
    problem: z.enum(['not-found', 'error', 'sign-in', 'timeout', 'tab-closed']),
    screenshot: z.string()
  }),
  z.object({
    kind: z.literal('credentials'),
    stepId: z.string(),
    inputs: z.array(z.object({ name: z.string(), secret: z.boolean() }))
  })
])

// Why: the discriminator is `kind`, but each kind has several actions, so nest the action union.
export const pauseAnswerSchema: z.ZodType<PauseAnswer> = z.union([
  z.object({
    kind: z.literal('manual-queries'),
    action: z.literal('continue'),
    pasted: z.record(z.string(), z.string()).optional()
  }),
  z.object({
    kind: z.literal('manual-queries'),
    action: z.literal('skip'),
    queryIds: z.array(z.string())
  }),
  z.object({ kind: z.literal('browser-recovery'), action: z.literal('retry') }),
  z.object({ kind: z.literal('browser-recovery'), action: z.literal('do-manually') }),
  z.object({ kind: z.literal('browser-recovery'), action: z.literal('skip') }),
  z.object({
    kind: z.literal('browser-recovery'),
    action: z.literal('pick-tab'),
    browserPageId: z.string().min(1)
  }),
  z.object({ kind: z.literal('browser-recovery'), action: z.literal('switch-rest-to-manual') }),
  z.object({ kind: z.literal('browser-recovery'), action: z.literal('skip-remaining-queries') }),
  z.object({
    kind: z.literal('credentials'),
    action: z.literal('resume'),
    values: z.record(z.string(), z.string())
  }),
  z.object({ kind: z.literal('credentials'), action: z.literal('stop') }),
  z.object({ kind: z.literal('stopping'), choice: z.enum(['run-cleanup', 'keep-data']) })
])

// ─── Run ────────────────────────────────────────────────────────────

const queryEvidenceSchema: z.ZodType<QueryEvidence> = z.object({
  queryId: z.string(),
  sqlResolved: z.string(),
  description: z.string().optional(),
  how: z.enum([
    'automatic',
    'browser',
    'manual',
    'skipped-by-user',
    'skipped-not-approved',
    'failed'
  ]),
  result: z
    .object({
      columns: z.array(z.string()),
      rows: z.array(z.array(z.string())),
      totalRows: z.number(),
      truncated: z.boolean()
    })
    .nullable(),
  pastedText: z.string().optional(),
  waitedMs: z.number().optional(),
  partial: z.boolean(),
  blurredCount: z.number().optional(),
  screenshotWithheld: z.enum(['residual', 'uninspectable']).optional(),
  error: z.string().optional(),
  screenshot: z.string().nullable()
})

const requestEvidenceSchema: z.ZodType<RequestEvidence> = z.object({
  requestId: apiNodeIdSchema,
  resolvedRequest: resolvedRequestSchema,
  outcome: executionOutcomeSchema,
  tests: z.array(testResultSchema),
  sentOffsetMs: z.number().optional(),
  screenshot: z.string().nullable()
})

export const stepResultSchema: z.ZodType<StepResult> = z.object({
  stepId: z.string(),
  title: z.string(),
  phase: phaseSchema,
  iterationValue: z.object({ variable: z.string(), valueMasked: z.string() }).optional(),
  result: z.enum(['pass', 'fail', 'skipped', 'blocked', 'running', 'pending']),
  reason: z.string().optional(),
  dependencyFailed: z.array(z.string()),
  expectedText: z.string(),
  actualText: z.string(),
  before: z.array(queryEvidenceSchema),
  after: z.array(queryEvidenceSchema),
  exchanges: z.array(requestEvidenceSchema),
  durationMs: z.number()
})

export const testRunFields = {
  id: z.string(),
  collectionId: apiNodeIdSchema,
  kind: z.enum(['full', 'cleanup-only']),
  environmentId: apiNodeIdSchema.nullable(),
  targetHosts: z.array(z.string()),
  databaseMode: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('automatic'), connectionName: z.string() }),
    z.object({ mode: z.literal('browser'), site: z.string() }),
    z.object({ mode: z.literal('manual') }),
    z.object({ mode: z.literal('none') })
  ]),
  state: z.enum(['setup', 'running', 'paused', 'stopping', 'cleaning-up', 'finished']),
  ending: z.enum(['passed', 'failed', 'stopped-by-user', 'preflight-failed', 'error']).nullable(),
  startedAt: z.number(),
  endedAt: z.number().nullable(),
  pausedMs: z.number(),
  currentStepIndex: z.number().nullable(),
  pause: pauseRequestSchema.nullable(),
  evidence: z
    .object({ folder: z.string(), reportPath: z.string(), ignoredByGit: z.boolean() })
    .nullable(),
  cleanup: z.object({
    cleaned: z.number(),
    notCleaned: z.array(
      z.object({
        variable: z.string(),
        valueMasked: z.string(),
        unavailable: z.boolean().optional()
      })
    ),
    keptByUser: z.boolean()
  })
}

export const testRunSchema: z.ZodType<TestRun> = z.object({
  ...testRunFields,
  steps: z.array(stepResultSchema)
})

// ─── Stored files ───────────────────────────────────────────────────

export const StoredTestMapSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  map: testMapSchema
})
export const StoredPlanSettingsSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  settings: planSettingsSchema
})
export const StoredCaptureLedgerSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  ledger: captureLedgerSchema
})
export const StoredTestRunSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  run: testRunSchema
})
