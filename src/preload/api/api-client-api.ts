import type {
  ApiClientChangedEvent,
  ApiClientResult,
  DraftEnvironment,
  EnvOpParams,
  TreeOpParams
} from '../../shared/api-client/api-client-ipc-schemas'
import type {
  ApiNodeId,
  ApiRequest,
  ConsoleEntry,
  LatestResult,
  Run,
  RunOptions,
  RunRequestResult,
  RunScope,
  RunTotals,
  WorktreeApiData
} from '../../shared/api-client/api-client-types'

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export type ApiClientApi = {
  getSnapshot: (args: {
    worktreeId: string
    revealSecrets?: boolean
  }) => Promise<ApiClientResult<{ data: WorktreeApiData }>>
  setActiveEnvironment: (args: {
    worktreeId: string
    environmentId: string | null
  }) => Promise<ApiClientResult>
  pickImportFile: () => Promise<string | null>
  importFile: (args: {
    worktreeId: string
    filePath: string
    onDuplicate?: 'replace' | 'keep-both'
  }) => Promise<
    ApiClientResult<{ kind: 'collection' | 'environment'; id: ApiNodeId; warnings: string[] }>
  >
  /** Opens the save dialog; null when cancelled. */
  pickExportFile: (defaultName: string) => Promise<string | null>
  exportFile: (args: {
    worktreeId: string
    kind: 'collection' | 'environment'
    id: ApiNodeId
    filePath: string
  }) => Promise<ApiClientResult>
  treeOp: (
    args: DistributiveOmit<TreeOpParams, never>
  ) => Promise<ApiClientResult<{ id?: ApiNodeId; collectionId?: ApiNodeId }>>
  saveRequest: (args: {
    worktreeId: string
    collectionId: ApiNodeId
    request: ApiRequest
    baseRevision: number
  }) => Promise<ApiClientResult<{ revision: number }>>
  send: (args: {
    worktreeId: string
    requestId: ApiNodeId
    draft?: ApiRequest
  }) => Promise<ApiClientResult<{ executionId: string }>>
  envOp: (
    args: DistributiveOmit<EnvOpParams, never>
  ) => Promise<ApiClientResult<{ id?: ApiNodeId }>>
  saveEnvironment: (args: {
    worktreeId: string
    environment: DraftEnvironment
    baseRevision: number
  }) => Promise<ApiClientResult<{ revision: number }>>
  getLatestRun: (args: {
    worktreeId: string
    scopeId: ApiNodeId
  }) => Promise<ApiClientResult<{ run: Run | null }>>
  startRun: (args: {
    worktreeId: string
    scope: RunScope
    environmentId: ApiNodeId | null
    options: RunOptions
  }) => Promise<ApiClientResult<{ runId: string }>>
  stopRun: (args: {
    worktreeId: string
    runId: string
  }) => Promise<ApiClientResult<{ stopped: boolean }>>
  clearRun: (args: { worktreeId: string; scopeId: ApiNodeId }) => Promise<ApiClientResult>
  onRunProgress: (
    callback: (event: {
      worktreeId: string
      runId: string
      result: RunRequestResult
      totals: RunTotals
    }) => void
  ) => () => void
  onRunFinished: (callback: (event: { worktreeId: string; run: Run }) => void) => () => void
  onShow: (
    callback: (event: { replyId: string; worktreeId: string; requestId: ApiNodeId }) => void
  ) => () => void
  replyShow: (reply: { replyId: string; tabId?: string; error?: string }) => void
  cancel: (args: {
    worktreeId: string
    executionId: string
  }) => Promise<ApiClientResult<{ cancelled: boolean }>>
  getLatestResult: (args: {
    worktreeId: string
    requestId: ApiNodeId
  }) => Promise<ApiClientResult<{ result: LatestResult | null }>>
  getConsole: (args: {
    worktreeId: string
  }) => Promise<ApiClientResult<{ entries: ConsoleEntry[] }>>
  clearConsole: (args: { worktreeId: string }) => Promise<ApiClientResult>
  onExecutionFinished: (
    callback: (event: {
      worktreeId: string
      executionId: string
      requestId: ApiNodeId
      result: LatestResult
    }) => void
  ) => () => void
  onConsoleAppended: (
    callback: (event: { worktreeId: string; entry: ConsoleEntry }) => void
  ) => () => void
  onChanged: (callback: (event: ApiClientChangedEvent) => void) => () => void
}
