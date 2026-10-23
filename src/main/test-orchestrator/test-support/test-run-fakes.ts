import type {
  ApiRequest,
  ConsoleEntry,
  LatestResult
} from '../../../shared/api-client/api-client-types'
import type {
  CapturedValue,
  Phase,
  TestMapEntry,
  TestPlanStep
} from '../../../shared/test-orchestrator/test-orchestrator-types'
import type { CaptureIdentity, CleanedMark } from '../capture-ledger-store'
import type { ExecuteRequestInput, ExecuteRequestResult } from '../../api-client/request-execution'

export type FakeReply = {
  status?: number
  body?: string
  /** Environment variables the fake "script" assigns through the sink. */
  scriptSets?: Record<string, string>
  headers?: [string, string][]
  tests?: LatestResult['tests']
  error?: string
}

export function fakeRequest(id: string, url = '{{baseUrl}}/x'): ApiRequest {
  return {
    id,
    kind: 'request',
    name: id,
    method: 'GET',
    url: { raw: url, query: [] },
    pathVariables: [],
    headers: [],
    events: {},
    settings: {},
    revision: 0,
    postmanExtra: {}
  }
}

export function fakePlanStep(
  stepId: string,
  phase: Phase,
  index: number,
  extra: { entry?: Partial<TestMapEntry>; requiredVariables?: string[]; requestIds?: string[] } = {}
): TestPlanStep {
  const requestIds = extra.requestIds ?? [`req-${stepId}`]
  const entry: TestMapEntry | null = extra.entry
    ? {
        ref: { id: requestIds[0] },
        link: { state: 'linked', requestId: requestIds[0] },
        before: [],
        after: [],
        ...extra.entry
      }
    : null
  return {
    index,
    stepId,
    title: `Title ${stepId}`,
    phase,
    requests: requestIds.map((requestId) => ({
      requestId,
      snapshot: fakeRequest(requestId),
      scope: {
        collection: {
          id: 'col',
          name: 'col',
          variables: [],
          events: {},
          items: [],
          revision: 0,
          postmanExtra: {},
          importWarnings: []
        },
        folders: []
      }
    })),
    entry,
    requiredVariables: extra.requiredVariables ?? [],
    approvedDataChange: false
  }
}

/** Replies per request id; records every call so tests can assert what was (not) sent. */
export function createFakeSender(replies: Record<string, FakeReply>) {
  const calls: ExecuteRequestInput[] = []
  const sendRequest = async (input: ExecuteRequestInput): Promise<ExecuteRequestResult> => {
    calls.push(input)
    const reply = replies[input.request.id] ?? {}
    if (reply.scriptSets) {
      await input.variableSink?.({
        environment: { set: reply.scriptSets, unset: [] },
        collection: { set: {}, unset: [] }
      })
    }
    const resolvedRequest = { method: 'GET', url: 'http://h/x', headers: [], body: null }
    const outcome: LatestResult['outcome'] = reply.error
      ? { kind: 'error', code: 'network', message: reply.error }
      : {
          kind: 'response',
          response: {
            status: reply.status ?? 200,
            statusText: '',
            headers: reply.headers ?? [],
            sizeBytes: reply.body?.length ?? 0,
            contentType: 'application/json',
            body: { encoding: 'utf8', text: reply.body ?? '{}', truncated: false },
            redirects: []
          }
        }
    const latest: LatestResult = {
      requestId: input.request.id,
      origin: 'run',
      startedAt: 0,
      durationMs: 1,
      ttfbMs: 1,
      resolvedRequest,
      outcome,
      tests: reply.tests ?? [],
      scriptLogs: [],
      environmentId: null
    }
    const consoleEntry: ConsoleEntry = {
      id: 'c',
      worktreeId: input.worktreeId,
      at: 0,
      origin: 'run',
      method: 'GET',
      url: resolvedRequest.url,
      request: resolvedRequest,
      outcome,
      scriptLogs: [],
      tests: latest.tests
    }
    return { ok: true, latest, consoleEntry }
  }
  return { sendRequest, calls }
}

/** A ledger that records nothing and reports nothing left to clean. */
export const emptyLedger = {
  append: async (): Promise<void> => {},
  listUncleaned: async (): Promise<never[]> => [],
  markCleaned: async (): Promise<void> => {}
}

/** In-memory ledger that keeps appended values until a cleanup step marks them cleaned. */
export function createMemoryLedger() {
  const values: CapturedValue[] = []
  return {
    append: async (_w: string, _c: string, value: CapturedValue): Promise<void> => {
      values.push(value)
    },
    listUncleaned: async (): Promise<CapturedValue[]> => values.filter((v) => !v.cleaned),
    markCleaned: async (
      _w: string,
      _c: string,
      match: CaptureIdentity,
      cleaned: CleanedMark
    ): Promise<void> => {
      for (const v of values) {
        if (v.variable === match.variable && v.runId === match.runId && v.stepId === match.stepId) {
          v.cleaned = cleaned
        }
      }
    }
  }
}
