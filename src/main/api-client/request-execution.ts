import type {
  ApiFolder,
  ApiNodeId,
  ApiRequest,
  Collection,
  ConsoleEntry,
  EnvironmentVariable,
  ExecutionOrigin,
  LatestResult,
  ResolvedRequest,
  LogLine,
  TestResult,
  Variable
} from '../../shared/api-client/api-client-types'
import { findNode } from '../../shared/api-client/collection-tree'
import { isAuthSupported, resolveEffectiveAuth } from '../../shared/api-client/request-auth'
import { prepareRequest } from '../../shared/api-client/request-preparation'
import { collectSecretValues, maskSecrets } from '../../shared/api-client/secret-masking'
import { buildScopeChain } from '../../shared/api-client/variable-resolution'
import type { ApiClientConsoleBuffer } from './api-client-console-buffer'
import { writeLatestResult } from './api-client-results'
import type { ApiClientStore } from './api-client-store'
import type { HttpRequestSender } from './http-request-sender'
import {
  buildLatestResult,
  maskLogs,
  maskTests,
  toConsoleEntry,
  toMaskedOutcome,
  toResolvedRequest
} from './request-execution-result'
import {
  collectScriptSteps,
  runScriptPhase,
  type ScriptPhaseResult,
  type WorkingVariables
} from './request-execution-scripts'
import { commitVariableWrites, diffWorkingVariables } from './request-execution-variables'
import type { VariableWrites } from './script-sandbox/script-sandbox-types'
import type { ScriptRunner } from './script-sandbox/script-sandbox-client'

export type RequestExecutionDeps = {
  store: ApiClientStore
  sender: HttpRequestSender
  sandbox: ScriptRunner
  consoleBuffer: ApiClientConsoleBuffer
  /** App-wide SSL verification setting (FR-017a). */
  getSslVerification: () => boolean
  /** Called after every execution is saved, so open tabs can show runner and agent results. */
  onExecuted?: (event: { worktreeId: string; latest: LatestResult }) => void
}

export type ExecuteRequestInput = {
  worktreeId: string
  collectionId: ApiNodeId
  /** A saved request, or an unsaved draft of it. */
  request: ApiRequest
  environmentId: ApiNodeId | null
  origin: ExecutionOrigin
  runId?: string
  iteration?: number
  iterationCount?: number
  signal?: AbortSignal
  /** Collection and folder settings captured earlier; used instead of looking the request up. */
  scope?: { collection: Collection; folders: ApiFolder[] }
  /** Run-scoped variables used instead of the stored environment and collection variables. */
  variableOverlay?: { environment: EnvironmentVariable[]; collection: Variable[] }
  /** Receives the script's variable writes instead of them being saved to the store. */
  variableSink?: (writes: {
    environment: VariableWrites
    collection: VariableWrites
  }) => Promise<void>
}

export type ExecuteRequestResult =
  | { ok: true; latest: LatestResult; consoleEntry: ConsoleEntry }
  | { ok: false; code: 'not-found'; message: string }

const DEFAULT_TIMEOUT_MS = 300_000

type Resolved = {
  collection: Collection
  folders: ApiFolder[]
}

function locate(collection: Collection | undefined, request: ApiRequest): Resolved | null {
  const found = collection ? findNode(collection, request.id) : null
  if (!collection || !found) {
    return null
  }
  return { collection, folders: found.ancestors }
}

function scriptFailure(
  phase: ScriptPhaseResult,
  phaseLabel: string
): { code: 'script-error'; message: string } {
  return {
    code: 'script-error',
    message: `${phaseLabel} script "${phase.error?.owner ?? ''}" failed: ${phase.error?.message ?? ''}`
  }
}

export async function executeRequest(
  deps: RequestExecutionDeps,
  input: ExecuteRequestInput
): Promise<ExecuteRequestResult> {
  const data = await deps.store.getState(input.worktreeId)
  const live = data.collections.get(input.collectionId)
  // Collection variables stay live so a value one request sets reaches the next one in a run.
  const resolved = input.scope
    ? {
        collection: {
          ...input.scope.collection,
          variables: live?.variables ?? input.scope.collection.variables
        },
        folders: input.scope.folders
      }
    : locate(live, input.request)
  if (!resolved) {
    return { ok: false, code: 'not-found', message: 'Request not found.' }
  }
  const { collection, folders } = resolved
  const environment = input.environmentId ? data.environments.get(input.environmentId) : undefined
  const startedAt = Date.now()
  const iteration = input.iteration ?? 1
  const iterationCount = input.iterationCount ?? 1

  const initial: WorkingVariables = {
    environment: (input.variableOverlay?.environment ?? environment?.variables ?? []).map((v) => ({
      ...v
    })),
    collection: (input.variableOverlay?.collection ?? collection.variables).map((v) => ({ ...v })),
    local: []
  }
  const common = {
    sandbox: deps.sandbox,
    folders,
    iteration,
    iterationCount
  }

  // ── pre-request scripts ──────────────────────────────────────────
  const pre = await runScriptPhase({
    ...common,
    phase: 'prerequest',
    steps: collectScriptSteps('prerequest', collection, folders, input.request),
    request: input.request,
    response: null,
    responseTimeMs: 0,
    working: initial
  })

  const secretsOf = (working: WorkingVariables): string[] =>
    collectSecretValues({ variables: working.environment })

  let tests: TestResult[] = [...pre.tests]
  let logs: LogLine[] = [...pre.logs]
  let working = pre.working
  let request = pre.request
  let prepared: ReturnType<typeof prepareRequest> | null = null
  let resolvedRequest: ResolvedRequest = {
    method: request.method,
    url: request.url.raw,
    headers: [],
    body: null
  }
  let failure: {
    code: 'script-error' | 'unsupported-auth' | 'invalid-url'
    message: string
  } | null = pre.error ? scriptFailure(pre, 'Pre-request') : null

  if (!failure) {
    const effectiveAuth = resolveEffectiveAuth([collection, ...folders, request])
    if (effectiveAuth && !isAuthSupported(effectiveAuth)) {
      failure = {
        code: 'unsupported-auth',
        message: `${effectiveAuth.type} authentication is not supported yet.`
      }
    } else {
      const scopes = buildScopeChain({
        scriptVariables: working.local,
        environment: working.environment,
        folders: folders.map((folder) => ({ name: folder.name, variables: folder.variables })),
        collection: working.collection
      })
      prepared = prepareRequest(request, scopes, effectiveAuth)
      resolvedRequest = toResolvedRequest(prepared, secretsOf(working))
    }
  }

  // ── send ─────────────────────────────────────────────────────────
  let sent: Awaited<ReturnType<HttpRequestSender['send']>> | null = null
  if (prepared) {
    sent = await deps.sender.send({
      prepared,
      verifySsl: request.settings.sslVerification ?? deps.getSslVerification(),
      followRedirects: request.settings.followRedirects ?? true,
      timeoutMs: request.settings.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      signal: input.signal
    })
  }

  // ── test scripts ─────────────────────────────────────────────────
  if (sent?.ok) {
    const post = await runScriptPhase({
      ...common,
      phase: 'test',
      steps: collectScriptSteps('test', collection, folders, input.request),
      request,
      response: sent.response,
      responseTimeMs: sent.durationMs,
      working
    })
    tests = [...tests, ...post.tests]
    logs = [...logs, ...post.logs]
    working = post.working
    if (post.error) {
      tests.push({
        name: 'Test script error',
        passed: false,
        error: `"${post.error.owner}": ${post.error.message}`
      })
    }
  }

  // ── commit, mask, persist ────────────────────────────────────────
  const writes = diffWorkingVariables(initial, working)
  await (input.variableSink
    ? input.variableSink(writes)
    : commitVariableWrites(deps.store, {
        worktreeId: input.worktreeId,
        collectionId: collection.id,
        environmentId: environment?.id ?? null,
        writes
      }))

  const secrets = secretsOf(working)
  const outcomeSource = failure
    ? ({ ok: false, code: failure.code, message: failure.message } as const)
    : (sent ??
      ({ ok: false, code: 'invalid-url', message: 'The request could not be prepared.' } as const))
  const latest = buildLatestResult({
    requestId: input.request.id,
    origin: input.origin,
    startedAt,
    durationMs: sent?.durationMs ?? Date.now() - startedAt,
    ttfbMs: sent?.ttfbMs ?? null,
    resolvedRequest: {
      ...resolvedRequest,
      url: maskSecrets(resolvedRequest.url, secrets)
    },
    outcome: toMaskedOutcome(outcomeSource, secrets),
    tests: maskTests(tests, secrets),
    logs: maskLogs(logs, secrets),
    environmentId: environment?.id ?? null
  })
  await writeLatestResult(deps.store, input.worktreeId, latest)
  deps.onExecuted?.({ worktreeId: input.worktreeId, latest })
  const consoleEntry = deps.consoleBuffer.append(
    toConsoleEntry(latest, {
      id: deps.store.newId(),
      worktreeId: input.worktreeId,
      ...(input.runId ? { runId: input.runId } : {})
    })
  )
  return { ok: true, latest, consoleEntry }
}
