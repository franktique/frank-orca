import type {
  ApiFolder,
  ApiRequest,
  Collection,
  EnvironmentVariable,
  LogLine,
  ResponseSnapshot,
  TestResult,
  Variable
} from '../../shared/api-client/api-client-types'
import { parseQueryFromRaw } from '../../shared/api-client/postman-field-mapping'
import type { ScriptRunner } from './script-sandbox/script-sandbox-client'
import {
  SCRIPT_BODY_LIMIT_CHARS,
  type RequestMutations,
  type SandboxVariable,
  type ScriptInput,
  type ScriptOutput,
  type ScriptPhaseName,
  type VariableWrites
} from './script-sandbox/script-sandbox-types'

export type WorkingVariables = {
  environment: EnvironmentVariable[]
  collection: Variable[]
  /** Request-local `pm.variables`; lives for one request only. */
  local: SandboxVariable[]
}

export type ScriptStep = { owner: string; source: string }

/** Postman order: collection → folders (outer → inner) → request. */
export function collectScriptSteps(
  phase: ScriptPhaseName,
  collection: Collection,
  folders: readonly ApiFolder[],
  request: ApiRequest
): ScriptStep[] {
  const owners: [
    string,
    { events: { prerequest?: { exec: string[] }; test?: { exec: string[] } } }
  ][] = [
    [collection.name, collection],
    ...folders.map((folder): [string, ApiFolder] => [folder.name, folder]),
    [request.name, request]
  ]
  return owners.flatMap(([owner, source]) => {
    const script = phase === 'prerequest' ? source.events.prerequest : source.events.test
    const text = script?.exec.join('\n') ?? ''
    return text.trim() ? [{ owner, source: text }] : []
  })
}

function toSandbox(
  list: readonly { key: string; value: string | null; enabled: boolean }[]
): SandboxVariable[] {
  return list.map((entry) => ({ key: entry.key, value: entry.value, enabled: entry.enabled }))
}

export function buildScriptInput(args: {
  source: string
  phase: ScriptPhaseName
  request: ApiRequest
  response: ResponseSnapshot | null
  responseTimeMs: number
  working: WorkingVariables
  folders: readonly ApiFolder[]
  iteration: number
  iterationCount: number
}): ScriptInput {
  const { request, response } = args
  const bodyText = response && response.body.encoding === 'utf8' ? (response.body.text ?? '') : null
  return {
    script: args.source,
    phase: args.phase,
    request: {
      method: request.method,
      url: request.url.raw,
      headers: request.headers.filter((h) => h.enabled).map((h) => [h.key, h.value]),
      body: request.body ? { mode: request.body.mode, raw: request.body.raw ?? '' } : null
    },
    response: response
      ? {
          code: response.status,
          status: response.statusText,
          headers: response.headers,
          body: bodyText !== null && bodyText.length <= SCRIPT_BODY_LIMIT_CHARS ? bodyText : null,
          bodyTooLarge: bodyText !== null && bodyText.length > SCRIPT_BODY_LIMIT_CHARS,
          responseTimeMs: args.responseTimeMs,
          sizeBytes: response.sizeBytes
        }
      : null,
    variables: {
      local: args.working.local,
      environment: toSandbox(args.working.environment),
      collection: toSandbox(args.working.collection),
      folders: toSandbox(args.folders.flatMap((folder) => folder.variables))
    },
    info: {
      requestName: request.name,
      requestId: request.id,
      iteration: args.iteration,
      iterationCount: args.iterationCount,
      eventName: args.phase
    }
  }
}

function applyWritesToList<T extends { key: string; value: string | null; enabled: boolean }>(
  list: T[],
  writes: VariableWrites,
  create: (key: string, value: string) => T
): T[] {
  let next = list.filter((entry) => !writes.unset.includes(entry.key))
  for (const [key, value] of Object.entries(writes.set)) {
    const index = next.findLastIndex((entry) => entry.key === key && entry.enabled)
    next =
      index !== -1
        ? next.map((entry, position) => (position === index ? { ...entry, value } : entry))
        : [...next, create(key, value)]
  }
  return next
}

/** Folds a script's variable writes into the in-flight copy used by the rest of the request. */
export function applyScriptWrites(
  working: WorkingVariables,
  output: ScriptOutput
): WorkingVariables {
  return {
    environment: applyWritesToList(
      working.environment,
      output.writes.environment,
      (key, value) => ({
        key,
        value,
        enabled: true,
        type: 'default'
      })
    ),
    collection: applyWritesToList(working.collection, output.writes.collection, (key, value) => ({
      key,
      value,
      enabled: true
    })),
    local: applyWritesToList(
      working.local.map((v) => ({ key: v.key, value: v.value, enabled: v.enabled !== false })),
      output.writes.local,
      (key, value) => ({ key, value, enabled: true })
    )
  }
}

export function applyRequestMutations(
  request: ApiRequest,
  mutations: RequestMutations
): ApiRequest {
  const disabled = request.headers.filter((header) => !header.enabled)
  const body =
    mutations.body.mode === 'raw'
      ? {
          ...(request.body ?? { mode: 'raw' as const }),
          mode: 'raw' as const,
          raw: mutations.body.raw
        }
      : request.body
  return {
    ...request,
    method: mutations.method,
    url: { raw: mutations.url, query: parseQueryFromRaw(mutations.url) },
    headers: [
      ...mutations.headers.map(([key, value]) => ({ key, value, enabled: true })),
      ...disabled
    ],
    ...(body ? { body } : {})
  }
}

export type ScriptPhaseResult = {
  request: ApiRequest
  working: WorkingVariables
  tests: TestResult[]
  logs: LogLine[]
  /** The first script error, which ends the phase. */
  error: { owner: string; message: string } | null
}

/** Runs the phase's scripts in order, threading request mutations and variable writes through. */
export async function runScriptPhase(args: {
  sandbox: ScriptRunner
  phase: ScriptPhaseName
  steps: readonly ScriptStep[]
  request: ApiRequest
  response: ResponseSnapshot | null
  responseTimeMs: number
  working: WorkingVariables
  folders: readonly ApiFolder[]
  iteration: number
  iterationCount: number
}): Promise<ScriptPhaseResult> {
  let { request, working } = args
  const tests: TestResult[] = []
  const logs: LogLine[] = []
  for (const step of args.steps) {
    const output = await args.sandbox.run(
      buildScriptInput({ ...args, request, working, source: step.source })
    )
    tests.push(...output.tests)
    logs.push(...output.logs.map((log) => ({ ...log, phase: args.phase })))
    working = applyScriptWrites(working, output)
    if (args.phase === 'prerequest' && output.request) {
      request = applyRequestMutations(request, output.request)
    }
    if (output.error) {
      return {
        request,
        working,
        tests,
        logs,
        error: { owner: step.owner, message: `${output.error.name}: ${output.error.message}` }
      }
    }
  }
  return { request, working, tests, logs, error: null }
}
