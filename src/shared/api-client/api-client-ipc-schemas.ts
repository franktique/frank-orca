import { z } from 'zod'
import {
  apiNodeIdSchema,
  apiRequestSchema,
  nameSchema,
  runOptionsSchema,
  runScopeSchema
} from './api-client-schemas'
import type { SecretProtection } from './api-client-types'

export const API_CLIENT_ERROR_CODES = [
  'not-local',
  'not-found',
  'conflict',
  'invalid-import',
  'busy',
  'duplicate-name',
  'read-only',
  'invalid-request'
] as const

export type ApiClientErrorCode = (typeof API_CLIENT_ERROR_CODES)[number]

export type ApiClientFailure = {
  ok: false
  code: ApiClientErrorCode
  message: string
  existingId?: string
}

export type ApiClientSuccess<T> = { ok: true; secretProtection?: SecretProtection } & T
export type ApiClientResult<T extends object = object> = ApiClientSuccess<T> | ApiClientFailure

const worktreeIdSchema = z.string().min(1)
const base = { worktreeId: worktreeIdSchema }

export const getSnapshotParamsSchema = z.object({
  ...base,
  revealSecrets: z.boolean().optional()
})

export const getLatestResultParamsSchema = z.object({ ...base, requestId: apiNodeIdSchema })
export const getLatestRunParamsSchema = z.object({ ...base, scopeId: apiNodeIdSchema })
export const worktreeOnlyParamsSchema = z.object(base)

export const importFileParamsSchema = z.object({
  ...base,
  filePath: z.string().min(1),
  onDuplicate: z.enum(['replace', 'keep-both']).optional()
})

export const exportParamsSchema = z.object({
  ...base,
  kind: z.enum(['collection', 'environment']),
  id: apiNodeIdSchema,
  filePath: z.string().min(1)
})

export const saveRequestParamsSchema = z.object({
  ...base,
  collectionId: apiNodeIdSchema,
  request: apiRequestSchema,
  baseRevision: z.number().int().nonnegative()
})

const draftEnvironmentVariableSchema = z.union([
  z.object({
    key: z.string(),
    value: z.string(),
    enabled: z.boolean(),
    type: z.enum(['default', 'secret'])
  }),
  // Why: an untouched secret keeps its stored cipher; its plain value never round-trips.
  z.object({
    key: z.string(),
    enabled: z.boolean(),
    type: z.literal('secret'),
    unchanged: z.literal(true)
  })
])

export type DraftEnvironmentVariable = z.infer<typeof draftEnvironmentVariableSchema>

export const draftEnvironmentSchema = z.object({
  id: apiNodeIdSchema,
  name: nameSchema,
  variables: z.array(draftEnvironmentVariableSchema),
  postmanExtra: z.record(z.string(), z.unknown()).optional()
})

export type DraftEnvironment = z.infer<typeof draftEnvironmentSchema>

export const saveEnvironmentParamsSchema = z.object({
  ...base,
  environment: draftEnvironmentSchema,
  baseRevision: z.number().int().nonnegative()
})

const treeTargetSchema = z.object({
  collectionId: apiNodeIdSchema,
  // Absent means the collection itself.
  nodeId: apiNodeIdSchema.optional()
})

export const treeOpParamsSchema = z.discriminatedUnion('op', [
  z.object({
    ...base,
    op: z.literal('create'),
    kind: z.enum(['collection', 'folder', 'request']),
    collectionId: apiNodeIdSchema.optional(),
    parentId: apiNodeIdSchema.nullable().optional(),
    name: z.string().max(200).optional()
  }),
  z.object({ ...base, op: z.literal('rename'), target: treeTargetSchema, name: nameSchema }),
  z.object({ ...base, op: z.literal('duplicate'), target: treeTargetSchema }),
  z.object({
    ...base,
    op: z.literal('move'),
    target: z.object({ collectionId: apiNodeIdSchema, nodeId: apiNodeIdSchema }),
    parentId: apiNodeIdSchema.nullable(),
    index: z.number().int().nonnegative().optional()
  }),
  z.object({ ...base, op: z.literal('delete'), target: treeTargetSchema })
])

export type TreeOpParams = z.infer<typeof treeOpParamsSchema>

export const envOpParamsSchema = z.discriminatedUnion('op', [
  z.object({ ...base, op: z.literal('create'), name: nameSchema.optional() }),
  z.object({ ...base, op: z.literal('rename'), id: apiNodeIdSchema, name: nameSchema }),
  z.object({ ...base, op: z.literal('duplicate'), id: apiNodeIdSchema }),
  z.object({ ...base, op: z.literal('delete'), id: apiNodeIdSchema })
])

export type EnvOpParams = z.infer<typeof envOpParamsSchema>

export const setActiveEnvironmentParamsSchema = z.object({
  ...base,
  environmentId: apiNodeIdSchema.nullable()
})

export const clearRunParamsSchema = z.object({ ...base, scopeId: apiNodeIdSchema })

export const sendParamsSchema = z.object({
  ...base,
  requestId: apiNodeIdSchema,
  draft: apiRequestSchema.optional()
})

export const cancelParamsSchema = z.object({ ...base, executionId: z.string().min(1) })

export const startRunParamsSchema = z.object({
  ...base,
  scope: runScopeSchema,
  environmentId: apiNodeIdSchema.nullable(),
  options: runOptionsSchema
})

export const stopRunParamsSchema = z.object({ ...base, runId: z.string().min(1) })

export const changedEventKindSchema = z.enum(['collection', 'environment', 'active-environment'])
export type ApiClientChangedEvent = {
  worktreeId: string
  revision: number
  kind: z.infer<typeof changedEventKindSchema>
  id?: string
}
