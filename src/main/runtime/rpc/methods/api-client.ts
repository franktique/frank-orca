import { defineMethod, type RpcContext } from '../core'
import {
  ApiClientEnvironmentsParams,
  ApiClientListParams,
  ApiClientResultParams,
  ApiClientRunParams,
  ApiClientShowParams
} from '../../../../shared/rpc-contract/api-client-params'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import type { ApiNodeId, Collection, Run } from '../../../../shared/api-client/api-client-types'
import {
  findNode,
  flattenFolderPath,
  flattenRequestsDepthFirst
} from '../../../../shared/api-client/collection-tree'
import {
  agentResultFromLatest,
  agentRunSummary,
  listCollectionsForAgent,
  listEnvironmentsForAgent
} from '../../../api-client/api-client-agent-results'
import { readLatestResult } from '../../../api-client/api-client-results'
import { getApiClientService, type ApiClientService } from '../../../api-client/api-client-service'
import { executeRequest } from '../../../api-client/request-execution'

const DEFAULT_RUN_TIMEOUT_MS = 10 * 60_000

type Failure = { ok: false; code: string; message: string }
const fail = (code: string, message: string): Failure => ({ ok: false, code, message })

type Resolved = { ok: true; service: ApiClientService; worktreeId: string } | Failure

/** Resolves the worktree selector and enforces the local-only rule for every method. */
async function resolveTarget(runtime: RpcContext['runtime'], worktree?: string): Promise<Resolved> {
  let service: ApiClientService
  try {
    service = getApiClientService()
  } catch {
    return fail('unavailable', 'The API Client is not available on this host.')
  }
  if (!worktree) {
    return fail('selector_not_found', 'No worktree was given and none could be inferred.')
  }
  const scope = await runtime.showTerminalWorkspaceLaunchScope(worktree)
  const worktreeId = scope.folderWorkspace ? folderWorkspaceKey(scope.folderWorkspace.id) : scope.id
  const guard = service.assertLocal(worktreeId)
  return guard.ok ? { ok: true, service, worktreeId } : fail(guard.code, guard.message)
}

function locateTarget(
  collections: readonly Collection[],
  targetId: ApiNodeId
): { collection: Collection; kind: 'collection' | 'folder' | 'request' } | null {
  for (const collection of collections) {
    if (collection.id === targetId) {
      return { collection, kind: 'collection' }
    }
    const found = findNode(collection, targetId)
    if (found) {
      return { collection, kind: found.node.kind }
    }
  }
  return null
}

function resolveEnvironmentId(
  requested: string | null | undefined,
  environments: readonly { id: string; name: string }[],
  activeId: string | null
): { ok: true; id: string | null } | Failure {
  if (requested === undefined) {
    return { ok: true, id: activeId }
  }
  if (requested === null || requested === 'none') {
    return { ok: true, id: null }
  }
  const match =
    environments.find((env) => env.id === requested) ??
    environments.find((env) => env.name === requested)
  return match
    ? { ok: true, id: match.id }
    : fail('not-found', `Environment "${requested}" was not found.`)
}

/** A single request is executed directly; it is not a stored run. */
async function runSingleRequest(
  service: ApiClientService,
  worktreeId: string,
  collection: Collection,
  requestId: string,
  environmentId: string | null,
  signal: AbortSignal
) {
  const found = findNode(collection, requestId)
  if (!found || found.node.kind !== 'request') {
    return fail('not-found', 'Request not found.')
  }
  const executed = await executeRequest(service.executionDeps(), {
    worktreeId,
    collectionId: collection.id,
    request: found.node,
    environmentId,
    origin: 'agent',
    signal
  })
  if (!executed.ok) {
    return fail(executed.code, executed.message)
  }
  const result = agentResultFromLatest(executed.latest, {
    name: found.node.name,
    folderPath: flattenFolderPath(collection, requestId)?.folderPath ?? []
  })
  const failed = result.error !== null || result.tests.some((test) => !test.passed)
  return {
    ok: true as const,
    runId: service.store.newId(),
    state: 'completed' as const,
    stoppedEarly: false,
    totals: {
      requests: 1,
      testsPassed: result.tests.filter((t) => t.passed).length,
      testsFailed:
        result.tests.filter((t) => !t.passed).length +
        (failed && result.tests.length === 0 ? 1 : 0),
      durationMs: executed.latest.durationMs
    },
    results: [result]
  }
}

export const API_CLIENT_METHODS = [
  defineMethod({
    name: 'apiClient.list',
    params: ApiClientListParams,
    handler: async (params, { runtime }) => {
      const target = await resolveTarget(runtime, params.worktree)
      if (!target.ok) {
        return target
      }
      const snapshot = await target.service.store.getSnapshot(target.worktreeId)
      return {
        ok: true as const,
        worktreeId: target.worktreeId,
        activeEnvironmentId: snapshot.activeEnvironmentId,
        collections: listCollectionsForAgent(snapshot.collections)
      }
    }
  }),
  defineMethod({
    name: 'apiClient.environments',
    params: ApiClientEnvironmentsParams,
    handler: async (params, { runtime }) => {
      const target = await resolveTarget(runtime, params.worktree)
      if (!target.ok) {
        return target
      }
      const snapshot = await target.service.store.getSnapshot(target.worktreeId)
      return {
        ok: true as const,
        environments: listEnvironmentsForAgent(snapshot.environments, snapshot.activeEnvironmentId)
      }
    }
  }),
  defineMethod({
    name: 'apiClient.run',
    params: ApiClientRunParams,
    handler: async (params, { runtime, signal }) => {
      const target = await resolveTarget(runtime, params.worktree)
      if (!target.ok) {
        return target
      }
      const { service, worktreeId } = target
      const snapshot = await service.store.getSnapshot(worktreeId)
      const located = locateTarget(snapshot.collections, params.targetId)
      if (!located) {
        return fail(
          'not-found',
          `No collection, folder or request has the id "${params.targetId}".`
        )
      }
      const environment = resolveEnvironmentId(
        params.environment,
        snapshot.environments,
        snapshot.activeEnvironmentId
      )
      if (!environment.ok) {
        return environment
      }
      const timeoutMs = params.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      signal?.addEventListener('abort', () => controller.abort(), { once: true })
      try {
        if (located.kind === 'request') {
          return await runSingleRequest(
            service,
            worktreeId,
            located.collection,
            params.targetId,
            environment.id,
            controller.signal
          )
        }
        const scope =
          located.kind === 'folder'
            ? { collectionId: located.collection.id, folderId: params.targetId }
            : { collectionId: located.collection.id }
        const folderNode =
          located.kind === 'folder'
            ? findNode(located.collection, params.targetId)?.node
            : undefined
        const container = folderNode?.kind === 'folder' ? folderNode : located.collection
        const started = await service.runner.start({
          worktreeId,
          scope,
          environmentId: environment.id,
          origin: 'agent',
          options: {
            iterations: params.iterations ?? 1,
            delayMs: params.delayMs ?? 0,
            stopOnFailure: params.stopOnFailure ?? false,
            includedRequestIds: flattenRequestsDepthFirst(container).map((request) => request.id)
          }
        })
        if (!started.ok) {
          return fail(started.code, started.message)
        }
        controller.signal.addEventListener('abort', () => service.runner.stop(started.runId), {
          once: true
        })
        const finished: Run = await started.done
        return { ok: true as const, ...agentRunSummary(finished) }
      } finally {
        clearTimeout(timer)
      }
    }
  }),
  defineMethod({
    name: 'apiClient.result',
    params: ApiClientResultParams,
    handler: async (params, { runtime }) => {
      const target = await resolveTarget(runtime, params.worktree)
      if (!target.ok) {
        return target
      }
      const located = await target.service.locateRequest(target.worktreeId, params.requestId)
      const latest = await readLatestResult(
        target.service.store,
        target.worktreeId,
        params.requestId
      )
      if (!located || !latest) {
        return fail('not-found', 'No result is stored for this request.')
      }
      const snapshot = await target.service.store.getSnapshot(target.worktreeId)
      const collection = snapshot.collections.find((c) => c.id === located.collectionId)
      return {
        ok: true as const,
        result: agentResultFromLatest(latest, {
          name: located.request.name,
          folderPath: collection
            ? (flattenFolderPath(collection, params.requestId)?.folderPath ?? [])
            : []
        }),
        origin: latest.origin,
        startedAt: latest.startedAt
      }
    }
  }),
  defineMethod({
    name: 'apiClient.show',
    params: ApiClientShowParams,
    handler: async (params, { runtime }) => {
      const target = await resolveTarget(runtime, params.worktree)
      if (!target.ok) {
        return target
      }
      const located = await target.service.locateRequest(target.worktreeId, params.requestId)
      if (!located) {
        return fail('not-found', 'Request not found.')
      }
      const shown = await target.service.showRequest(target.worktreeId, params.requestId)
      return shown.ok
        ? { ok: true as const, tabId: shown.tabId }
        : fail('unavailable', shown.message)
    }
  })
]
