import { z } from 'zod'
import type { LogLevel, TestResult } from '../../../shared/api-client/api-client-types'

export type SandboxVariable = { key: string; value: string | null; enabled?: boolean }

export type ScriptPhaseName = 'prerequest' | 'test'

/** Plain data only: it crosses a worker-thread boundary and then a JSON string into QuickJS. */
export type ScriptInput = {
  script: string
  phase: ScriptPhaseName
  request: {
    method: string
    url: string
    headers: [string, string][]
    body: { mode: string; raw?: string } | null
  }
  response: {
    code: number
    status: string
    headers: [string, string][]
    body: string | null
    bodyTooLarge: boolean
    responseTimeMs: number
    sizeBytes: number
  } | null
  variables: {
    local: SandboxVariable[]
    environment: SandboxVariable[]
    collection: SandboxVariable[]
    /** Folder variables of the request's chain, merged innermost-last. */
    folders: SandboxVariable[]
  }
  info: {
    requestName: string
    requestId: string
    iteration: number
    iterationCount: number
    eventName: ScriptPhaseName
  }
  timeoutMs?: number
  memoryLimitBytes?: number
}

export type VariableWrites = { set: Record<string, string>; unset: string[] }

export type RequestMutations = {
  method: string
  url: string
  headers: [string, string][]
  body: { mode: string; raw: string }
}

export type ScriptOutput = {
  tests: TestResult[]
  logs: { level: LogLevel; text: string }[]
  writes: {
    environment: VariableWrites
    collection: VariableWrites
    local: VariableWrites
  }
  request: RequestMutations | null
  error: { name: string; message: string } | null
}

export const SCRIPT_TIMEOUT_MS = 5000
export const SCRIPT_MEMORY_LIMIT_BYTES = 32 * 1024 * 1024
export const SCRIPT_BODY_LIMIT_CHARS = 4 * 1024 * 1024

export function emptyScriptOutput(error: ScriptOutput['error'] = null): ScriptOutput {
  const writes = (): VariableWrites => ({ set: {}, unset: [] })
  return {
    tests: [],
    logs: [],
    writes: { environment: writes(), collection: writes(), local: writes() },
    request: null,
    error
  }
}

const variableWritesSchema = z.object({
  set: z.record(z.string(), z.string()),
  unset: z.array(z.string())
})

/** The guest builds this as JSON, so it is parsed rather than trusted. */
export const scriptOutputSchema = z.object({
  tests: z.array(z.object({ name: z.string(), passed: z.boolean(), error: z.string().optional() })),
  logs: z.array(z.object({ level: z.enum(['log', 'info', 'warn', 'error']), text: z.string() })),
  writes: z.object({
    environment: variableWritesSchema,
    collection: variableWritesSchema,
    local: variableWritesSchema
  }),
  request: z
    .object({
      method: z.string(),
      url: z.string(),
      headers: z.array(z.tuple([z.string(), z.string()])),
      body: z.object({ mode: z.string(), raw: z.string() })
    })
    .nullable(),
  error: z.object({ name: z.string(), message: z.string() }).nullable()
})
