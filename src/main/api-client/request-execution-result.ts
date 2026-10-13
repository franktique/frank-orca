import type {
  ApiErrorCode,
  ConsoleEntry,
  ExecutionOrigin,
  ExecutionOutcome,
  LatestResult,
  LogLine,
  ResolvedRequest,
  TestResult
} from '../../shared/api-client/api-client-types'
import type { PreparedBody, PreparedRequest } from '../../shared/api-client/request-preparation'
import { maskHeaders, maskSecrets } from '../../shared/api-client/secret-masking'
import type { HttpSendResult } from './http-request-sender'

function describeBody(body: PreparedBody): string | null {
  if (body.kind === 'none') {
    return null
  }
  return body.kind === 'text'
    ? body.text
    : body.fields.map((field) => `${field.name}=${field.value}`).join('\n')
}

export function toResolvedRequest(
  prepared: PreparedRequest,
  secrets: readonly string[]
): ResolvedRequest {
  const body = describeBody(prepared.body)
  return {
    method: prepared.method,
    url: maskSecrets(prepared.url, secrets),
    headers: maskHeaders(prepared.headers, secrets),
    body: body === null ? null : maskSecrets(body, secrets)
  }
}

/** Nothing leaves request-execution unmasked: results, console entries and RPC all use this. */
export function toMaskedOutcome(
  sent: HttpSendResult | { ok: false; code: ApiErrorCode; message: string },
  secrets: readonly string[]
): ExecutionOutcome {
  if (!sent.ok) {
    return { kind: 'error', code: sent.code, message: maskSecrets(sent.message, secrets) }
  }
  const { response } = sent
  const text = response.body.text
  return {
    kind: 'response',
    response: {
      ...response,
      headers: maskHeaders(response.headers, secrets),
      redirects: response.redirects.map((hop) => ({ ...hop, url: maskSecrets(hop.url, secrets) })),
      body: {
        ...response.body,
        // Base64 bodies are opaque bytes; only text can be searched for a secret.
        ...(text !== undefined && response.body.encoding === 'utf8'
          ? { text: maskSecrets(text, secrets) }
          : {})
      }
    }
  }
}

export function maskLogs(logs: readonly LogLine[], secrets: readonly string[]): LogLine[] {
  return logs.map((log) => ({ ...log, text: maskSecrets(log.text, secrets) }))
}

export function maskTests(tests: readonly TestResult[], secrets: readonly string[]): TestResult[] {
  return tests.map((test) => ({
    ...test,
    name: maskSecrets(test.name, secrets),
    ...(test.error !== undefined ? { error: maskSecrets(test.error, secrets) } : {})
  }))
}

export function buildLatestResult(args: {
  requestId: string
  origin: ExecutionOrigin
  startedAt: number
  durationMs: number
  ttfbMs: number | null
  resolvedRequest: ResolvedRequest
  outcome: ExecutionOutcome
  tests: TestResult[]
  logs: LogLine[]
  environmentId: string | null
}): LatestResult {
  return {
    requestId: args.requestId,
    origin: args.origin,
    startedAt: args.startedAt,
    durationMs: args.durationMs,
    ttfbMs: args.ttfbMs,
    resolvedRequest: args.resolvedRequest,
    outcome: args.outcome,
    tests: args.tests,
    scriptLogs: args.logs,
    environmentId: args.environmentId
  }
}

export function toConsoleEntry(
  result: LatestResult,
  meta: { id: string; worktreeId: string; runId?: string }
): ConsoleEntry {
  return {
    id: meta.id,
    worktreeId: meta.worktreeId,
    at: result.startedAt,
    origin: result.origin,
    requestId: result.requestId,
    ...(meta.runId ? { runId: meta.runId } : {}),
    method: result.resolvedRequest.method,
    url: result.resolvedRequest.url,
    ...(result.outcome.kind === 'response' ? { status: result.outcome.response.status } : {}),
    durationMs: result.durationMs,
    request: result.resolvedRequest,
    outcome: result.outcome,
    scriptLogs: result.scriptLogs,
    tests: result.tests
  }
}
