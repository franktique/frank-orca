// File-format schema for user-authored test maps. See contracts/test-map-format.md.
import { z } from 'zod'
import type { TestMapIssue } from './test-orchestrator-types'

export const SUPPORTED_TEST_MAP_VERSION = 1
export const VARIABLE_NAME_PATTERN = /^[A-Za-z_][\w.-]*$/

export const phaseSchema = z.enum(['preflight', 'setup', 'scenario', 'cleanup'])

const statusCodeSchema = z.number().int().min(100).max(599)

export const expectationSchema = z.object({
  status: z.union([statusCodeSchema, z.array(statusCodeSchema).min(1)], {
    error: 'expected a status number or an array of numbers within 100-599'
  }),
  errorCode: z.string().optional(),
  errorCodePath: z.string().optional()
})

const variableNameSchema = z
  .string()
  .regex(VARIABLE_NAME_PATTERN, { message: 'invalid variable name' })

const fileQuerySchema = z
  .object({
    id: z.string().min(1).optional(),
    sql: z.string().refine((sql) => sql.trim().length > 0, { message: 'must not be blank' }),
    description: z.string().optional(),
    precondition: z.boolean().default(false),
    changesData: z.boolean().default(false)
  })
  .transform((query) => ({
    ...query,
    id: query.id ?? globalThis.crypto.randomUUID()
  }))

const requestRefSchema = z.union(
  [z.object({ path: z.array(z.string().min(1)).min(1) }), z.object({ id: z.string().min(1) })],
  { error: 'expected { "path": string[] } or { "id": string }' }
)

const fileEntrySchema = z.object({
  request: requestRefSchema,
  before: z.array(fileQuerySchema).default([]),
  after: z.array(fileQuerySchema).default([]),
  stepId: z.string().min(1).optional(),
  title: z.string().optional(),
  phase: phaseSchema.optional(),
  expect: expectationSchema.optional(),
  expectAll: z.array(expectationSchema).optional(),
  captures: z.array(z.object({ variable: variableNameSchema, from: z.string().min(1) })).optional(),
  dependsOn: z.array(z.string()).optional(),
  concurrentGroup: z.string().min(1).optional(),
  forEach: variableNameSchema.optional()
})

const databaseConsoleSchema = z.object({
  editorSelector: z.string().optional(),
  runSelector: z.string().optional(),
  resultSelector: z.string().optional()
})

const testMapFileShape = z.object({
  orcaTestMap: z.literal(SUPPORTED_TEST_MAP_VERSION, {
    error: `unsupported test map version; this Orca supports orcaTestMap: ${SUPPORTED_TEST_MAP_VERSION}`
  }),
  entries: z.array(fileEntrySchema),
  guide: z.string().optional(),
  allowedHosts: z.array(z.string().min(1)).optional(),
  databaseConsole: databaseConsoleSchema.optional()
})

export const TestMapFileSchema = testMapFileShape.superRefine((file, ctx) => {
  const stepIds = new Set<string>()
  for (const [index, entry] of file.entries.entries()) {
    if (entry.stepId === undefined) {
      continue
    }
    if (stepIds.has(entry.stepId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['entries', index, 'stepId'],
        message: 'A `stepId` must be unique within the map'
      })
    }
    stepIds.add(entry.stepId)
  }
  for (const [index, entry] of file.entries.entries()) {
    if (entry.forEach !== undefined && entry.phase !== 'cleanup') {
      ctx.addIssue({
        code: 'custom',
        path: ['entries', index, 'forEach'],
        message: '`forEach` is allowed only when the phase is `cleanup`'
      })
    }
    if (entry.expectAll !== undefined && entry.concurrentGroup === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['entries', index, 'expectAll'],
        message: '`expectAll` is allowed only with `concurrentGroup`'
      })
    }
    for (const [depIndex, dep] of (entry.dependsOn ?? []).entries()) {
      if (!stepIds.has(dep)) {
        ctx.addIssue({
          code: 'custom',
          path: ['entries', index, 'dependsOn', depIndex],
          message: `Every \`dependsOn\` value must name a \`stepId\` in the map (unknown: ${dep})`
        })
      }
    }
  }
})

export type TestMapFile = z.output<typeof TestMapFileSchema>

export type TestMapFileParseResult =
  | { ok: true; file: TestMapFile; unknownFields: string[] }
  | { ok: false; issues: TestMapIssue[] }

const KNOWN_TOP_LEVEL_FIELDS = new Set(Object.keys(testMapFileShape.shape))
const KNOWN_ENTRY_FIELDS = new Set(Object.keys(fileEntrySchema.shape))

function formatIssuePath(path: readonly PropertyKey[]): string {
  let out = ''
  for (const segment of path) {
    if (typeof segment === 'number') {
      out += `[${segment}]`
    } else {
      out += out === '' ? String(segment) : `.${String(segment)}`
    }
  }
  return out
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function collectUnknownFields(raw: unknown): string[] {
  if (!isPlainObject(raw)) {
    return []
  }
  const unknown = Object.keys(raw).filter((key) => !KNOWN_TOP_LEVEL_FIELDS.has(key))
  const entries = Array.isArray(raw.entries) ? raw.entries : []
  for (const [index, entry] of entries.entries()) {
    if (isPlainObject(entry)) {
      for (const key of Object.keys(entry)) {
        if (!KNOWN_ENTRY_FIELDS.has(key)) {
          unknown.push(`entries[${index}].${key}`)
        }
      }
    }
  }
  return unknown
}

export function parseTestMapFile(raw: unknown): TestMapFileParseResult {
  const parsed = TestMapFileSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: formatIssuePath(issue.path),
        message: issue.message
      }))
    }
  }
  return {
    ok: true,
    file: parsed.data,
    unknownFields: collectUnknownFields(raw)
  }
}
