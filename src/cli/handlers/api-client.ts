import type { CommandHandler } from '../dispatch'
import {
  getOptionalNonNegativeIntegerFlag,
  getOptionalPositiveIntegerFlag,
  getOptionalStringFlag,
  getRequiredStringFlag
} from '../flags'
import { printResult } from '../format'
import type { RuntimeClient } from '../runtime/client'
import { RuntimeClientError, type RuntimeRpcSuccess } from '../runtime/types'
import { getEmulatorWorktreeSelector } from '../selectors'

const BODY_LIMIT_BYTES = 64 * 1024

type Failure = { ok: false; code: string; message: string }
type TreeNode =
  | { id: string; kind: 'folder'; name: string; items: TreeNode[] }
  | { id: string; kind: 'request'; name: string; method: string }
type AgentResult = {
  requestId: string
  name: string
  folderPath: string[]
  iteration: number
  request: { method: string; url: string } | null
  response: {
    status: number
    statusText: string
    durationMs: number
    sizeBytes: number
    body: string | null
    bodyTruncated: boolean
  } | null
  error: string | null
  tests: { name: string; passed: boolean; error?: string }[]
}
type RunPayload = {
  state: string
  totals: { requests: number; testsPassed: number; testsFailed: number; durationMs: number }
  results: AgentResult[]
  error?: string
}

function isFailure(value: unknown): value is Failure {
  return typeof value === 'object' && value !== null && 'ok' in value && value.ok === false
}

/** Old hosts reject the method outright; say so instead of a raw RPC error. */
async function callApi<T>(
  client: RuntimeClient,
  method: string,
  params: unknown,
  options?: { timeoutMs?: number }
): Promise<RuntimeRpcSuccess<T | Failure>> {
  try {
    return await client.call<T | Failure>(method, params, options)
  } catch (error) {
    if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
      throw new RuntimeClientError(
        'method_not_found',
        'This Orca version does not support the API Client.'
      )
    }
    throw error
  }
}

function reportFailure(failure: Failure, json: boolean): void {
  process.exitCode = 1
  if (!json) {
    console.error(failure.message)
  }
}

function formatTree(nodes: TreeNode[], depth: number): string[] {
  return nodes.flatMap((node) => {
    const pad = '  '.repeat(depth)
    return node.kind === 'folder'
      ? [`${pad}${node.name}/  (${node.id})`, ...formatTree(node.items, depth + 1)]
      : [`${pad}${node.method.padEnd(7)} ${node.name}  (${node.id})`]
  })
}

function formatList(value: {
  collections: { id: string; name: string; items: TreeNode[] }[]
}): string {
  if (value.collections.length === 0) {
    return 'No collections.'
  }
  return value.collections
    .flatMap((c) => [`${c.name}  (${c.id})`, ...formatTree(c.items, 1)])
    .join('\n')
}

function formatEnvs(value: {
  environments: { id: string; name: string; active: boolean; variables: unknown[] }[]
}): string {
  if (value.environments.length === 0) {
    return 'No environments.'
  }
  return value.environments
    .map((e) => `${e.active ? '*' : ' '} ${e.name}  (${e.id})  ${e.variables.length} variables`)
    .join('\n')
}

function truncateBody(body: string, fullBody: boolean): string {
  if (fullBody || Buffer.byteLength(body) <= BODY_LIMIT_BYTES) {
    return body
  }
  return `${Buffer.from(body).subarray(0, BODY_LIMIT_BYTES).toString()}\n… truncated at 64 KB (use --full-body)`
}

function formatResult(result: AgentResult, fullBody: boolean): string {
  const where = [...result.folderPath, result.name].join(' / ')
  const lines = [`${where}  (${result.requestId})`]
  if (result.request) {
    lines.push(`  ${result.request.method} ${result.request.url}`)
  }
  if (result.response) {
    const r = result.response
    lines.push(`  ${r.status} ${r.statusText}  ${r.durationMs} ms  ${r.sizeBytes} bytes`)
  }
  if (result.error) {
    lines.push(`  Error: ${result.error}`)
  }
  for (const test of result.tests) {
    lines.push(
      `  ${test.passed ? 'PASS' : 'FAIL'} ${test.name}${test.error ? ` — ${test.error}` : ''}`
    )
  }
  if (result.response?.body) {
    lines.push('', truncateBody(result.response.body, fullBody))
  }
  return lines.join('\n')
}

function formatRun(run: RunPayload, fullBody: boolean): string {
  const t = run.totals
  return [
    ...run.results.map((r) => formatResult(r, fullBody)),
    '',
    `Run ${run.state}: ${t.requests} requests, ${t.testsPassed} passed, ${t.testsFailed} failed, ${t.durationMs} ms`,
    ...(run.error ? [`Error: ${run.error}`] : [])
  ].join('\n')
}

function runSucceeded(run: RunPayload): boolean {
  return run.totals.testsFailed === 0 && run.results.every((r) => !r.error)
}

type ListPayload = { collections: { id: string; name: string; items: TreeNode[] }[] }
type EnvsPayload = {
  environments: { id: string; name: string; active: boolean; variables: unknown[] }[]
}
type ResultPayload = { result: AgentResult }

function render<T>(
  res: RuntimeRpcSuccess<T | Failure>,
  json: boolean,
  format: (value: T) => string
): void {
  if (isFailure(res.result)) {
    reportFailure(res.result, json)
  }
  printResult(res, json, (value) => (isFailure(value) ? '' : format(value)))
}

export const API_CLIENT_HANDLERS: Record<string, CommandHandler> = {
  'api list': async ({ flags, client, cwd, json }) => {
    const worktree = await getEmulatorWorktreeSelector(flags, cwd, client)
    render(await callApi<ListPayload>(client, 'apiClient.list', { worktree }), json, formatList)
  },
  'api envs': async ({ flags, client, cwd, json }) => {
    const worktree = await getEmulatorWorktreeSelector(flags, cwd, client)
    render(
      await callApi<EnvsPayload>(client, 'apiClient.environments', { worktree }),
      json,
      formatEnvs
    )
  },
  'api run': async ({ flags, client, cwd, json }) => {
    const worktree = await getEmulatorWorktreeSelector(flags, cwd, client)
    const timeoutMs = getOptionalPositiveIntegerFlag(flags, 'timeout')
    const params = {
      worktree,
      targetId: getRequiredStringFlag(flags, 'id'),
      environment: getOptionalStringFlag(flags, 'env'),
      iterations: getOptionalPositiveIntegerFlag(flags, 'iterations'),
      delayMs: getOptionalNonNegativeIntegerFlag(flags, 'delay'),
      stopOnFailure: flags.get('stop-on-failure') === true ? true : undefined,
      timeoutMs
    }
    // Why: the host stops the run at --timeout, so the client waits slightly longer for the reply.
    const res = await callApi<RunPayload>(client, 'apiClient.run', params, {
      timeoutMs: (timeoutMs ?? 600_000) + 30_000
    })
    const fullBody = flags.get('full-body') === true
    if (!isFailure(res.result) && !runSucceeded(res.result)) {
      process.exitCode = 1
    }
    render(res, json, (run) => formatRun(run, fullBody))
  },
  'api result': async ({ flags, client, cwd, json }) => {
    const worktree = await getEmulatorWorktreeSelector(flags, cwd, client)
    const fullBody = flags.get('full-body') === true
    const res = await callApi<ResultPayload>(client, 'apiClient.result', {
      worktree,
      requestId: getRequiredStringFlag(flags, 'requestId')
    })
    render(res, json, (value) => formatResult(value.result, fullBody))
  },
  'api show': async ({ flags, client, cwd, json }) => {
    const worktree = await getEmulatorWorktreeSelector(flags, cwd, client)
    const res = await callApi<{ tabId: string }>(client, 'apiClient.show', {
      worktree,
      requestId: getRequiredStringFlag(flags, 'requestId')
    })
    render(res, json, () => 'Opened in the API Client tab.')
  }
}
