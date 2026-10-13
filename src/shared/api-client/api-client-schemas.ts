import { z } from 'zod'
import {
  API_CLIENT_LIMITS,
  type ApiItem,
  type ApiRequest,
  type Collection,
  type LatestResult,
  type Run
} from './api-client-types'

// Why: Postman-derived nodes carry fields we do not model; they must survive a round trip.
const postmanExtraSchema = z.record(z.string(), z.unknown())

export const apiNodeIdSchema = z.string().min(1)
export const nameSchema = z.string().min(1).max(API_CLIENT_LIMITS.nameMaxLength)

export const keyValueSchema = z.object({
  key: z.string(),
  value: z.string(),
  enabled: z.boolean(),
  description: z.string().optional(),
  type: z.string().optional(),
  postmanExtra: postmanExtraSchema.optional()
})

export const authSchema = z.object({
  type: z.enum([
    'noauth',
    'inherit',
    'bearer',
    'basic',
    'apikey',
    'oauth1',
    'oauth2',
    'digest',
    'awsv4',
    'hawk',
    'ntlm',
    'edgegrid',
    'jwt',
    'asap'
  ]),
  params: z.record(z.string(), z.string()),
  postmanExtra: postmanExtraSchema.optional()
})

export const variableSchema = z.object({
  key: z.string(),
  value: z.string(),
  enabled: z.boolean(),
  description: z.string().optional(),
  postmanExtra: postmanExtraSchema.optional()
})

export const scriptSchema = z.object({
  exec: z.array(z.string()),
  id: z.string().optional(),
  postmanExtra: postmanExtraSchema.optional()
})

export const scriptEventsSchema = z.object({
  prerequest: scriptSchema.optional(),
  test: scriptSchema.optional()
})

export const bodySchema = z.object({
  mode: z.enum(['none', 'raw', 'urlencoded', 'formdata', 'file', 'graphql']),
  raw: z.string().optional(),
  language: z.string().optional(),
  urlencoded: z.array(keyValueSchema).optional(),
  formdata: z.array(keyValueSchema).optional(),
  graphql: z.object({ query: z.string(), variables: z.string().optional() }).optional(),
  postmanExtra: postmanExtraSchema.optional()
})

export const requestSettingsSchema = z.object({
  sslVerification: z.boolean().optional(),
  followRedirects: z.boolean().optional(),
  timeoutMs: z.number().int().positive().optional()
})

export const apiRequestSchema: z.ZodType<ApiRequest> = z.object({
  id: apiNodeIdSchema,
  kind: z.literal('request'),
  name: z.string(),
  description: z.string().optional(),
  method: z.string().min(1),
  url: z.object({ raw: z.string(), query: z.array(keyValueSchema) }),
  pathVariables: z.array(keyValueSchema),
  headers: z.array(keyValueSchema),
  body: bodySchema.optional(),
  auth: authSchema.optional(),
  events: scriptEventsSchema,
  settings: requestSettingsSchema,
  revision: z.number().int().nonnegative(),
  postmanExtra: postmanExtraSchema
})

export const apiItemSchema: z.ZodType<ApiItem> = z.lazy(() =>
  z.union([apiRequestSchema, apiFolderSchema])
)

export const apiFolderSchema = z.object({
  id: apiNodeIdSchema,
  kind: z.literal('folder'),
  name: z.string(),
  description: z.string().optional(),
  variables: z.array(variableSchema),
  auth: authSchema.optional(),
  events: scriptEventsSchema,
  items: z.array(apiItemSchema),
  postmanExtra: postmanExtraSchema
})

export const collectionSchema: z.ZodType<Collection> = z.object({
  id: apiNodeIdSchema,
  name: nameSchema,
  description: z.string().optional(),
  variables: z.array(variableSchema),
  auth: authSchema.optional(),
  events: scriptEventsSchema,
  items: z.array(apiItemSchema),
  revision: z.number().int().nonnegative(),
  postmanExtra: postmanExtraSchema,
  importWarnings: z.array(z.string())
})

// ─── Environments ───────────────────────────────────────────────────

const persistedPlainVariableSchema = z.object({
  key: z.string(),
  value: z.string(),
  enabled: z.boolean(),
  type: z.literal('default')
})

// Why: the plain value of a secret is never written to disk (FR-009a).
const persistedSecretVariableSchema = z.object({
  key: z.string(),
  enabled: z.boolean(),
  type: z.literal('secret'),
  cipher: z.string()
})

export const persistedEnvironmentVariableSchema = z.union([
  persistedPlainVariableSchema,
  persistedSecretVariableSchema
])

export const persistedEnvironmentSchema = z.object({
  id: apiNodeIdSchema,
  name: nameSchema,
  variables: z.array(persistedEnvironmentVariableSchema),
  revision: z.number().int().nonnegative(),
  postmanExtra: postmanExtraSchema
})

export type PersistedEnvironmentVariable = z.infer<typeof persistedEnvironmentVariableSchema>
export type PersistedEnvironment = z.infer<typeof persistedEnvironmentSchema>

// ─── Results and runs ───────────────────────────────────────────────

const resolvedRequestSchema = z.object({
  method: z.string(),
  url: z.string(),
  headers: z.array(z.tuple([z.string(), z.string()])),
  body: z.string().nullable()
})

const responseSnapshotSchema = z.object({
  status: z.number(),
  statusText: z.string(),
  headers: z.array(z.tuple([z.string(), z.string()])),
  sizeBytes: z.number(),
  contentType: z.string().nullable(),
  body: z.object({
    encoding: z.enum(['utf8', 'base64', 'omitted']),
    text: z.string().optional(),
    truncated: z.boolean()
  }),
  redirects: z.array(z.object({ url: z.string(), status: z.number() }))
})

export const apiErrorCodeSchema = z.enum([
  'network',
  'timeout',
  'cancelled',
  'certificate',
  'dns',
  'unsupported-auth',
  'script-error',
  'invalid-url'
])

const executionOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('response'), response: responseSnapshotSchema }),
  z.object({ kind: z.literal('error'), code: apiErrorCodeSchema, message: z.string() })
])

const testResultSchema = z.object({
  name: z.string(),
  passed: z.boolean(),
  error: z.string().optional()
})

const logLineSchema = z.object({
  level: z.enum(['log', 'info', 'warn', 'error']),
  phase: z.enum(['prerequest', 'test']),
  text: z.string()
})

export const executionOriginSchema = z.enum(['manual', 'run', 'agent'])

export const latestResultSchema: z.ZodType<LatestResult> = z.object({
  requestId: apiNodeIdSchema,
  origin: executionOriginSchema,
  startedAt: z.number(),
  durationMs: z.number(),
  ttfbMs: z.number().nullable(),
  resolvedRequest: resolvedRequestSchema,
  outcome: executionOutcomeSchema,
  tests: z.array(testResultSchema),
  scriptLogs: z.array(logLineSchema),
  environmentId: apiNodeIdSchema.nullable()
})

export const consoleEntrySchema = z.object({
  id: z.string(),
  worktreeId: z.string(),
  at: z.number(),
  origin: executionOriginSchema,
  requestId: apiNodeIdSchema.optional(),
  runId: z.string().optional(),
  method: z.string(),
  url: z.string(),
  status: z.number().optional(),
  durationMs: z.number().optional(),
  request: resolvedRequestSchema,
  outcome: executionOutcomeSchema,
  scriptLogs: z.array(logLineSchema),
  tests: z.array(testResultSchema)
})

export const runScopeSchema = z.object({
  collectionId: apiNodeIdSchema,
  folderId: apiNodeIdSchema.optional()
})

export const runOptionsSchema = z.object({
  iterations: z.number().int().min(1).max(API_CLIENT_LIMITS.iterationsMax),
  delayMs: z.number().int().min(0).max(API_CLIENT_LIMITS.delayMsMax),
  stopOnFailure: z.boolean(),
  includedRequestIds: z.array(apiNodeIdSchema)
})

const runRequestResultSchema = z.object({
  iteration: z.number().int().positive(),
  requestId: apiNodeIdSchema,
  requestName: z.string(),
  folderPath: z.array(z.string()),
  status: z.number().optional(),
  durationMs: z.number(),
  tests: z.array(testResultSchema),
  error: z.string().optional(),
  detail: z
    .object({
      resolvedRequest: resolvedRequestSchema,
      outcome: executionOutcomeSchema,
      scriptLogs: z.array(logLineSchema)
    })
    .nullable()
})

export const runSchema: z.ZodType<Run> = z.object({
  id: z.string(),
  scope: runScopeSchema,
  environmentId: apiNodeIdSchema.nullable(),
  options: runOptionsSchema,
  origin: z.enum(['manual', 'agent']),
  state: z.enum(['running', 'stopped', 'completed', 'failed-to-start']),
  stoppedEarly: z.boolean(),
  startedAt: z.number(),
  endedAt: z.number().nullable(),
  results: z.array(runRequestResultSchema),
  totals: z.object({
    requests: z.number(),
    testsPassed: z.number(),
    testsFailed: z.number(),
    durationMs: z.number()
  }),
  error: z.string().optional()
})

// ─── Worktree-level files ───────────────────────────────────────────

export const metaFileSchema = z.object({
  // Why: an unknown higher version must still parse so the store can open read-only.
  schemaVersion: z.number().int().positive(),
  worktreeId: z.string(),
  createdAt: z.number()
})

export const stateFileSchema = z.object({
  activeEnvironmentId: apiNodeIdSchema.nullable(),
  collectionOrder: z.array(apiNodeIdSchema),
  environmentOrder: z.array(apiNodeIdSchema),
  revision: z.number().int().nonnegative()
})

export type MetaFile = z.infer<typeof metaFileSchema>
export type StateFile = z.infer<typeof stateFileSchema>

// ─── Tab session state ──────────────────────────────────────────────

export const apiClientPersistedTabSchema = z.object({
  view: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('empty') }),
    z.object({ kind: z.literal('request'), requestId: apiNodeIdSchema }),
    z.object({ kind: z.literal('environment'), environmentId: apiNodeIdSchema }),
    z.object({ kind: z.literal('runner'), scope: runScopeSchema })
  ]),
  consoleCollapsed: z.boolean().optional(),
  consoleHeight: z.number().finite().positive().optional(),
  splitRatio: z.number().finite().min(0).max(1).optional()
})
