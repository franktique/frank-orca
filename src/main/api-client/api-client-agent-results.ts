import type {
  ApiItem,
  Collection,
  Environment,
  LatestResult,
  Run,
  RunRequestResult
} from '../../shared/api-client/api-client-types'
import { SECRET_MASK } from '../../shared/api-client/api-client-types'

export type AgentTreeNode =
  | { id: string; kind: 'folder'; name: string; items: AgentTreeNode[] }
  | { id: string; kind: 'request'; name: string; method: string }

function toNode(item: ApiItem): AgentTreeNode {
  return item.kind === 'folder'
    ? { id: item.id, kind: 'folder', name: item.name, items: item.items.map(toNode) }
    : { id: item.id, kind: 'request', name: item.name, method: item.method }
}

export function listCollectionsForAgent(collections: readonly Collection[]) {
  return collections.map((collection) => ({
    id: collection.id,
    name: collection.name,
    items: collection.items.map(toNode)
  }))
}

/** Secret values never leave the app (FR-032): they are replaced, never decrypted for this. */
export function listEnvironmentsForAgent(
  environments: readonly Environment[],
  activeEnvironmentId: string | null
) {
  return environments.map((environment) => ({
    id: environment.id,
    name: environment.name,
    active: environment.id === activeEnvironmentId,
    variables: environment.variables.map((variable) => ({
      key: variable.key,
      enabled: variable.enabled,
      type: variable.type,
      value: variable.type === 'secret' ? SECRET_MASK : (variable.value ?? '')
    }))
  }))
}

export type AgentResult = {
  requestId: string
  name: string
  folderPath: string[]
  iteration: number
  request: { method: string; url: string; headers: [string, string][]; body: string | null } | null
  response: {
    status: number
    statusText: string
    durationMs: number
    sizeBytes: number
    headers: [string, string][]
    body: string | null
    bodyTruncated: boolean
  } | null
  error: string | null
  tests: { name: string; passed: boolean; error?: string }[]
}

function responseOf(
  detail: RunRequestResult['detail'],
  durationMs: number
): AgentResult['response'] {
  if (detail?.outcome.kind !== 'response') {
    return null
  }
  const { response } = detail.outcome
  return {
    status: response.status,
    statusText: response.statusText,
    durationMs,
    sizeBytes: response.sizeBytes,
    headers: response.headers,
    body: response.body.encoding === 'utf8' ? (response.body.text ?? '') : null,
    bodyTruncated: response.body.truncated
  }
}

export function agentResultFromRun(result: RunRequestResult): AgentResult {
  return {
    requestId: result.requestId,
    name: result.requestName,
    folderPath: result.folderPath,
    iteration: result.iteration,
    request: result.detail?.resolvedRequest ?? null,
    response: responseOf(result.detail, result.durationMs),
    error: result.error ?? null,
    tests: result.tests
  }
}

export function agentResultFromLatest(
  latest: LatestResult,
  meta: { name: string; folderPath: string[] }
): AgentResult {
  return agentResultFromRun({
    iteration: 1,
    requestId: latest.requestId,
    requestName: meta.name,
    folderPath: meta.folderPath,
    ...(latest.outcome.kind === 'response' ? { status: latest.outcome.response.status } : {}),
    durationMs: latest.durationMs,
    tests: latest.tests,
    ...(latest.outcome.kind === 'error' ? { error: latest.outcome.message } : {}),
    detail: {
      resolvedRequest: latest.resolvedRequest,
      outcome: latest.outcome,
      scriptLogs: latest.scriptLogs
    }
  })
}

export function agentRunSummary(run: Run) {
  return {
    runId: run.id,
    state: run.state,
    stoppedEarly: run.stoppedEarly,
    totals: run.totals,
    results: run.results.map(agentResultFromRun),
    ...(run.error ? { error: run.error } : {})
  }
}
