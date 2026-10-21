import {
  API_CLIENT_LIMITS,
  type ApiNodeId,
  type ApiRequest,
  type Collection,
  type ExecutionOutcome,
  type Run,
  type RunOptions,
  type RunOrigin,
  type RunRequestResult,
  type RunScope,
  type RunTotals
} from '../../shared/api-client/api-client-types'
import {
  findNode,
  flattenFolderPath,
  flattenRequestsDepthFirst
} from '../../shared/api-client/collection-tree'
import { clearLatestRun, writeLatestRun } from './api-client-results'
import {
  executeRequest,
  type ExecuteRequestInput,
  type RequestExecutionDeps
} from './request-execution'

export type StartRunInput = {
  worktreeId: string
  scope: RunScope
  environmentId: ApiNodeId | null
  options: RunOptions
  origin: RunOrigin
}

export type RunnerEvents = {
  onProgress: (args: {
    worktreeId: string
    runId: string
    result: RunRequestResult
    totals: RunTotals
  }) => void
  onFinished: (args: { worktreeId: string; run: Run }) => void
}

type RequestScope = NonNullable<ExecuteRequestInput['scope']>

/** Collection and ancestor-folder settings without their items. */
export function snapshotScope(collection: Collection, requestId: ApiNodeId): RequestScope {
  const folders = findNode(collection, requestId)?.ancestors ?? []
  return {
    collection: structuredClone({ ...collection, items: [] }),
    folders: folders.map((folder) => structuredClone({ ...folder, items: [] }))
  }
}

const scopeIdOf = (scope: RunScope): ApiNodeId => scope.folderId ?? scope.collectionId

function emptyTotals(): RunTotals {
  return { requests: 0, testsPassed: 0, testsFailed: 0, durationMs: 0 }
}

function addToTotals(totals: RunTotals, result: RunRequestResult): RunTotals {
  return {
    requests: totals.requests + 1,
    testsPassed: totals.testsPassed + result.tests.filter((t) => t.passed).length,
    testsFailed: totals.testsFailed + result.tests.filter((t) => !t.passed).length,
    durationMs: totals.durationMs + result.durationMs
  }
}

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true }
    )
  })

/** Body previews in a run are capped; the full body only ever lives in a request's latest result. */
export function capDetailBodies(outcome: ExecutionOutcome): ExecutionOutcome {
  const limit = API_CLIENT_LIMITS.consolePreviewMaxBytes
  if (outcome.kind !== 'response') {
    return outcome
  }
  const { body } = outcome.response
  return body.text !== undefined && body.text.length > limit
    ? {
        kind: 'response',
        response: {
          ...outcome.response,
          body: { ...body, text: body.text.slice(0, limit), truncated: true }
        }
      }
    : outcome
}

/** Drops the oldest details until the run file fits (data-model.md: 50 MB per run). */
export function enforceRunSizeCap(results: RunRequestResult[], maxBytes: number): void {
  let size = results.reduce((sum, r) => sum + (r.detail ? JSON.stringify(r.detail).length : 0), 0)
  for (const result of results) {
    if (size <= maxBytes) {
      return
    }
    if (result.detail) {
      size -= JSON.stringify(result.detail).length
      result.detail = null
    }
  }
}

export class CollectionRunner {
  private readonly active = new Map<string, { controller: AbortController; done: Promise<Run> }>()
  private readonly activeScopes = new Set<string>()

  constructor(
    private readonly deps: RequestExecutionDeps,
    private readonly events: RunnerEvents,
    private readonly now: () => number = Date.now
  ) {}

  /** `busy` when a run for the same scope is already going. */
  async start(
    input: StartRunInput
  ): Promise<
    | { ok: true; runId: string; done: Promise<Run> }
    | { ok: false; code: 'busy' | 'not-found'; message: string }
  > {
    const scopeKey = `${input.worktreeId}:${scopeIdOf(input.scope)}`
    if (this.activeScopes.has(scopeKey)) {
      return { ok: false, code: 'busy', message: 'A run is already in progress for this scope.' }
    }
    const data = await this.deps.store.getState(input.worktreeId)
    const collection = data.collections.get(input.scope.collectionId)
    const folderNode =
      input.scope.folderId && collection
        ? findNode(collection, input.scope.folderId)?.node
        : undefined
    const folder = folderNode?.kind === 'folder' ? folderNode : undefined
    if (!collection || (input.scope.folderId && !folder)) {
      return { ok: false, code: 'not-found', message: 'The run scope was not found.' }
    }
    const scopeNode = folder ?? collection
    // Copied now: edits made while the run is going must not change what it executes.
    const included = new Set(input.options.includedRequestIds)
    const snapshot = flattenRequestsDepthFirst(scopeNode)
      .filter((request) => included.has(request.id))
      .map((request) => ({
        request: structuredClone(request),
        folderPath: flattenFolderPath(collection, request.id)?.folderPath ?? [],
        scope: snapshotScope(collection, request.id)
      }))
    const run: Run = {
      id: this.deps.store.newId(),
      scope: input.scope,
      environmentId: input.environmentId,
      options: input.options,
      origin: input.origin,
      state: 'running',
      stoppedEarly: false,
      startedAt: this.now(),
      endedAt: null,
      results: [],
      totals: emptyTotals()
    }
    if (input.environmentId !== null && !data.environments.has(input.environmentId)) {
      const failed: Run = {
        ...run,
        state: 'failed-to-start',
        endedAt: this.now(),
        error: 'The selected environment no longer exists.'
      }
      const done = Promise.resolve(failed)
      queueMicrotask(() => this.events.onFinished({ worktreeId: input.worktreeId, run: failed }))
      return { ok: true, runId: run.id, done }
    }

    const controller = new AbortController()
    this.activeScopes.add(scopeKey)
    const done = this.execute(input, run, snapshot, controller).finally(() => {
      this.active.delete(run.id)
      this.activeScopes.delete(scopeKey)
    })
    this.active.set(run.id, { controller, done })
    return { ok: true, runId: run.id, done }
  }

  stop(runId: string): boolean {
    const entry = this.active.get(runId)
    entry?.controller.abort()
    return entry !== undefined
  }

  private async execute(
    input: StartRunInput,
    run: Run,
    snapshot: { request: ApiRequest; folderPath: string[]; scope: RequestScope }[],
    controller: AbortController
  ): Promise<Run> {
    const { signal } = controller
    const iterations = input.options.iterations
    let failureStop = false
    outer: for (let iteration = 1; iteration <= iterations; iteration++) {
      for (const [index, entry] of snapshot.entries()) {
        if (signal.aborted) {
          break outer
        }
        if (index > 0 || iteration > 1) {
          await sleep(input.options.delayMs, signal)
          if (signal.aborted) {
            break outer
          }
        }
        const executed = await executeRequest(this.deps, {
          worktreeId: input.worktreeId,
          collectionId: input.scope.collectionId,
          request: entry.request,
          scope: entry.scope,
          environmentId: input.environmentId,
          origin: input.origin === 'agent' ? 'agent' : 'run',
          runId: run.id,
          iteration,
          iterationCount: iterations,
          signal
        })
        // The request that was in flight when Stop was pressed never finished, so it is not recorded.
        if (!executed.ok || signal.aborted) {
          break outer
        }
        const { latest } = executed
        const failed = latest.outcome.kind === 'error' || latest.tests.some((test) => !test.passed)
        const result: RunRequestResult = {
          iteration,
          requestId: entry.request.id,
          requestName: entry.request.name,
          folderPath: entry.folderPath,
          ...(latest.outcome.kind === 'response' ? { status: latest.outcome.response.status } : {}),
          durationMs: latest.durationMs,
          tests: latest.tests,
          ...(latest.outcome.kind === 'error' ? { error: latest.outcome.message } : {}),
          detail: {
            resolvedRequest: latest.resolvedRequest,
            outcome: capDetailBodies(latest.outcome),
            scriptLogs: latest.scriptLogs
          }
        }
        run.results.push(result)
        run.totals = addToTotals(run.totals, result)
        enforceRunSizeCap(run.results, API_CLIENT_LIMITS.runFileMaxBytes)
        this.events.onProgress({
          worktreeId: input.worktreeId,
          runId: run.id,
          result,
          totals: run.totals
        })
        if (failed && input.options.stopOnFailure) {
          failureStop = true
          break outer
        }
      }
      await writeLatestRun(this.deps.store, input.worktreeId, scopeIdOf(input.scope), run)
    }
    run.state = signal.aborted ? 'stopped' : 'completed'
    run.stoppedEarly = failureStop
    run.endedAt = this.now()
    await writeLatestRun(this.deps.store, input.worktreeId, scopeIdOf(input.scope), run)
    this.events.onFinished({ worktreeId: input.worktreeId, run })
    return run
  }

  async clear(worktreeId: string, scopeId: ApiNodeId): Promise<void> {
    await clearLatestRun(this.deps.store, worktreeId, scopeId)
  }
}
