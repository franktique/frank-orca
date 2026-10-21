import type { ApiNodeId, Environment, Variable } from '../../shared/api-client/api-client-types'
import type { TestRunErrorCode } from '../../shared/test-orchestrator/test-orchestrator-ipc-schemas'
import type {
  CapturedValue,
  RaisedPause,
  RunDatabaseMode,
  RunKind,
  TestMap,
  TestPlanStep,
  TestRun,
  TestRunSummary
} from '../../shared/test-orchestrator/test-orchestrator-types'
import type { RunInput } from './run-variable-scope'
import type { CleanupLedger } from './test-run-cleanup'
import type { TestRunPauses } from './test-run-pauses'
import type {
  StepEvidenceCapture,
  StepExecutorDeps,
  StepQueryHooks
} from './test-run-step-executor'

/** Expands a cleanup step into its runs; `forEach` (US7) returns one per recorded value. */
export type CleanupExpander = (
  step: TestPlanStep,
  context: { runId: string; worktreeId: string; collectionId: ApiNodeId }
) => Promise<{ step: TestPlanStep; iterationValue?: { variable: string; value: string } }[]>

export type EvidenceSink = {
  writeReport: (run: TestRun) => Promise<NonNullable<TestRun['evidence']>>
  capture?: StepEvidenceCapture
  /** Releases the run's snapshot window; called once at run end, also after an error. */
  close?: () => void
}

export type TestRunOrchestratorDeps = {
  sendRequest: StepExecutorDeps['sendRequest']
  store: {
    saveRun: (worktreeId: string, collectionId: string, run: TestRun) => Promise<void>
    ledger: CleanupLedger & {
      append: (w: string, c: string, value: CapturedValue) => Promise<void>
    }
  }
  emit: {
    changed: (event: { worktreeId: string; collectionId: string; run: TestRunSummary }) => void
    finished: (event: {
      worktreeId: string
      collectionId: string
      run: TestRunSummary
      evidence: NonNullable<TestRun['evidence']>
    }) => void
    paused?: (event: {
      worktreeId: string
      collectionId: string
      runId: string
      pause: RaisedPause & { pauseId: string }
    }) => void
  }
  hooks?: StepQueryHooks
  expandCleanup?: CleanupExpander
  /** Opens `report.md` and images for a run (T054); absent means no evidence is written. */
  openEvidence?: (run: TestRun, input: StartRunInput) => Promise<EvidenceSink>
  now?: () => number
  changedThrottleMs?: number
}

export type StartRunInput = {
  worktreeId: string
  collectionId: ApiNodeId
  environmentId: ApiNodeId | null
  kind?: RunKind
  steps: readonly TestPlanStep[]
  testMap: TestMap | null
  environment: Pick<Environment, 'variables'> | null
  collectionVariables: readonly Variable[]
  inputs: readonly RunInput[]
  targetHosts: string[]
  databaseMode: RunDatabaseMode
  /** Names the evidence folder. */
  planName?: string
  /** Per-run query hooks; they replace `deps.hooks` for this run only. */
  hooks?: StepQueryHooks
}

export type StartRunResult =
  | { ok: true; runId: string; finished: Promise<TestRun> }
  | { ok: false; code: Extract<TestRunErrorCode, 'busy'>; message: string }

export type ChangedEmitter = {
  /** Sends at once when `immediate`, otherwise at most once per throttle window. */
  notify: (immediate: boolean) => void
  cancel: () => void
}

export type ActiveRun = {
  run: TestRun
  pauses: TestRunPauses
  abort: AbortController
  /** Separate so cleanup still sends after Stop aborted the scenarios. */
  cleanupAbort: AbortController
  changed: ChangedEmitter
  /** True once the cleanup phase started; Stop then aborts only `cleanupAbort`. */
  inCleanup: boolean
}
