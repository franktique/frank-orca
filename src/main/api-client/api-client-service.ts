import type {
  ApiClientChangedEvent,
  ApiClientFailure
} from '../../shared/api-client/api-client-ipc-schemas'
import type {
  ApiNodeId,
  ApiRequest,
  Collection,
  ConsoleEntry,
  LatestResult,
  Run,
  RunRequestResult,
  RunTotals
} from '../../shared/api-client/api-client-types'
import { findNode } from '../../shared/api-client/collection-tree'
import type { GlobalSettings } from '../../shared/global-settings-types'
import { ApiClientConsoleBuffer } from './api-client-console-buffer'
import { assertLocalWorkspace, type WorkspaceHostGuardStore } from '../workspace-local-host-guard'
import { ApiClientStore } from './api-client-store'
import { electronFetchFor } from './api-client-electron-fetch'
import { HttpRequestSender, type FetchFunction } from './http-request-sender'
import { setApiClientCacheEvictor } from './api-client-data-deletion'
import { importPostmanContent, type ImportMode } from './api-client-import'
import { CollectionRunner } from './collection-runner'
import { executeRequest } from './request-execution'
import { ScriptSandboxClient, type ScriptRunner } from './script-sandbox/script-sandbox-client'

export type ApiClientServiceEvent =
  | { channel: 'changed'; payload: ApiClientChangedEvent }
  | {
      channel: 'executionFinished'
      payload: {
        worktreeId: string
        executionId: string
        requestId: ApiNodeId
        result: LatestResult
      }
    }
  | { channel: 'consoleAppended'; payload: { worktreeId: string; entry: ConsoleEntry } }
  | {
      channel: 'runProgress'
      payload: { worktreeId: string; runId: string; result: RunRequestResult; totals: RunTotals }
    }
  | { channel: 'runFinished'; payload: { worktreeId: string; run: Run } }

export type ApiClientServiceDeps = {
  orcaStore: WorkspaceHostGuardStore & {
    getSettings: () => Pick<GlobalSettings, 'apiClientSslVerification'>
  }
  store?: ApiClientStore
  sandbox?: ScriptRunner
  fetchFor?: (verifySsl: boolean) => FetchFunction
}

/**
 * Process-wide owner of API Client data and execution. The IPC handlers and the runtime RPC
 * methods both go through it, so UI, CLI and agent runs share one code path.
 */
export class ApiClientService {
  readonly store: ApiClientStore
  readonly console = new ApiClientConsoleBuffer()
  readonly sender: HttpRequestSender
  readonly sandbox: ScriptRunner
  readonly runner: CollectionRunner
  private readonly orcaStore: ApiClientServiceDeps['orcaStore']
  private collectionReplacedHandler:
    | ((worktreeId: string, collection: Collection) => Promise<string[]>)
    | null = null
  private readonly listeners = new Set<(event: ApiClientServiceEvent) => void>()
  private readonly executions = new Map<string, AbortController>()

  constructor(deps: ApiClientServiceDeps) {
    this.orcaStore = deps.orcaStore
    this.store = deps.store ?? new ApiClientStore()
    this.sender = new HttpRequestSender(deps.fetchFor ?? electronFetchFor)
    this.sandbox = deps.sandbox ?? new ScriptSandboxClient()
    this.runner = new CollectionRunner(this.executionDeps(), {
      onProgress: (payload) => this.emit({ channel: 'runProgress', payload }),
      onFinished: (payload) => this.emit({ channel: 'runFinished', payload })
    })
    setApiClientCacheEvictor((worktreeId) => this.store.evict(worktreeId))
    this.store.onChange((payload) => this.emit({ channel: 'changed', payload }))
    this.console.onAppend((entry) =>
      this.emit({ channel: 'consoleAppended', payload: { worktreeId: entry.worktreeId, entry } })
    )
  }

  onEvent(listener: (event: ApiClientServiceEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(event: ApiClientServiceEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  /** Every entry point rejects non-local workspaces (FR-001a). */
  assertLocal(worktreeId: string): { ok: true } | ApiClientFailure {
    return assertLocalWorkspace(this.orcaStore, worktreeId, 'The API Client')
  }

  executionDeps() {
    return {
      store: this.store,
      sender: this.sender,
      sandbox: this.sandbox,
      consoleBuffer: this.console,
      getSslVerification: () => this.orcaStore.getSettings().apiClientSslVerification !== false,
      onExecuted: ({ worktreeId, latest }: { worktreeId: string; latest: LatestResult }) => {
        // Manual sends emit their own event carrying the tab's executionId.
        if (latest.origin !== 'manual') {
          this.emit({
            channel: 'executionFinished',
            payload: {
              worktreeId,
              executionId: this.store.newId(),
              requestId: latest.requestId,
              result: latest
            }
          })
        }
      }
    }
  }

  /** The collection a request lives in, searched across the worktree's collections. */
  async locateRequest(
    worktreeId: string,
    requestId: ApiNodeId
  ): Promise<{ collectionId: ApiNodeId; request: ApiRequest } | null> {
    const data = await this.store.getState(worktreeId)
    for (const collection of data.collections.values()) {
      const found = findNode(collection, requestId)
      if (found && found.node.kind === 'request') {
        return { collectionId: collection.id, request: found.node }
      }
    }
    return null
  }

  /** Starts a send and returns at once; the outcome arrives as an `executionFinished` event. */
  async startSend(args: {
    worktreeId: string
    requestId: ApiNodeId
    draft?: ApiRequest
  }): Promise<{ ok: true; executionId: string } | ApiClientFailure> {
    const located = await this.locateRequest(args.worktreeId, args.requestId)
    if (!located) {
      return { ok: false, code: 'not-found', message: 'Request not found.' }
    }
    const data = await this.store.getState(args.worktreeId)
    const executionId = this.store.newId()
    const controller = new AbortController()
    this.executions.set(executionId, controller)
    void executeRequest(this.executionDeps(), {
      worktreeId: args.worktreeId,
      collectionId: located.collectionId,
      request: args.draft && args.draft.id === args.requestId ? args.draft : located.request,
      environmentId: data.state.activeEnvironmentId,
      origin: 'manual',
      signal: controller.signal
    })
      .then((result) => {
        if (result.ok) {
          this.emit({
            channel: 'executionFinished',
            payload: {
              worktreeId: args.worktreeId,
              executionId,
              requestId: args.requestId,
              result: result.latest
            }
          })
        }
      })
      .catch((error: unknown) => {
        console.warn('[api-client] execution failed', error)
      })
      .finally(() => this.executions.delete(executionId))
    return { ok: true, executionId }
  }

  private showHandler:
    | ((
        worktreeId: string,
        requestId: ApiNodeId
      ) => Promise<{ ok: true; tabId: string } | { ok: false; message: string }>)
    | null = null

  /** Installed by the Electron IPC layer, which is the only one that can reach a renderer. */
  setShowHandler(handler: NonNullable<ApiClientService['showHandler']>): void {
    this.showHandler = handler
  }

  showRequest(
    worktreeId: string,
    requestId: ApiNodeId
  ): Promise<{ ok: true; tabId: string } | { ok: false; message: string }> {
    return this.showHandler
      ? this.showHandler(worktreeId, requestId)
      : Promise.resolve({ ok: false, message: 'No Orca window is available to show the request.' })
  }

  /** Called after an import replaces a collection; returns extra warning lines for the result. */
  setCollectionReplacedHandler(
    handler: (worktreeId: string, collection: Collection) => Promise<string[]>
  ): void {
    this.collectionReplacedHandler = handler
  }

  async importPostman(worktreeId: string, json: unknown, mode?: ImportMode) {
    const result = await importPostmanContent(this.store, worktreeId, json, mode)
    if (!(result.ok && result.kind === 'collection' && mode === 'replace')) {
      return result
    }
    const collection = (await this.store.getState(worktreeId)).collections.get(result.id)
    if (!collection || !this.collectionReplacedHandler) {
      return result
    }
    try {
      const extra = await this.collectionReplacedHandler(worktreeId, collection)
      return { ...result, warnings: [...result.warnings, ...extra] }
    } catch {
      // Why: a test-map problem must not turn a completed import into a failure.
      return result
    }
  }

  cancel(executionId: string): boolean {
    const controller = this.executions.get(executionId)
    controller?.abort()
    return controller !== undefined
  }
}

let instance: ApiClientService | null = null

export function initApiClientService(deps: ApiClientServiceDeps): ApiClientService {
  instance ??= new ApiClientService(deps)
  return instance
}

export function getApiClientService(): ApiClientService {
  if (!instance) {
    throw new Error('ApiClientService is not initialized')
  }
  return instance
}

/** Test-only. */
export function resetApiClientServiceForTests(): void {
  instance = null
}
