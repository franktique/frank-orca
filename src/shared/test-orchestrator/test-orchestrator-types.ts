// Entities for the E2E test orchestrator. See specs/003-e2e-test-orchestrator/data-model.md.
import type {
  ApiFolder,
  ApiNodeId,
  ApiRequest,
  Collection,
  EnvironmentVariable,
  ExecutionOutcome,
  ResolvedRequest,
  TestResult,
  Variable
} from '../api-client/api-client-types'

export type Phase = 'preflight' | 'setup' | 'scenario' | 'cleanup'

export type TestMapRef = { id: ApiNodeId } | { path: string[] }

export type TestMapLink =
  | { state: 'linked'; requestId: ApiNodeId }
  | { state: 'unmatched' }
  | { state: 'ambiguous'; candidates: ApiNodeId[] }
  | { state: 'broken'; lastRequestId: ApiNodeId }

export type Expectation = {
  status: number | number[]
  errorCode?: string
  errorCodePath?: string
}

export type VerificationQuery = {
  id: string
  sql: string
  description?: string
  precondition: boolean
  changesData: boolean
}

export type TestMapCapture = { variable: string; from: string }

export type TestMapEntry = {
  ref: TestMapRef
  link: TestMapLink
  title?: string
  stepId?: string
  phase?: Phase
  expect?: Expectation
  expectAll?: Expectation[]
  captures?: TestMapCapture[]
  dependsOn?: string[]
  concurrentGroup?: string
  forEach?: string
  before: VerificationQuery[]
  after: VerificationQuery[]
}

export type DatabaseConsoleHints = {
  editorSelector?: string
  runSelector?: string
  resultSelector?: string
}

export type TestMap = {
  orcaTestMap: 1
  collectionId: ApiNodeId
  guidePath?: string
  allowedHosts?: string[]
  databaseConsole?: DatabaseConsoleHints
  entries: TestMapEntry[]
  loadedAt: number
  sourceFileName?: string
}

export type DatabaseModeChoice =
  | { mode: 'automatic'; connectionId: string; projectKey: string }
  | { mode: 'browser'; origin: string }
  | { mode: 'manual' }

export type PlanSettings = {
  collectionId: ApiNodeId
  environmentId: ApiNodeId | null
  databaseMode?: DatabaseModeChoice
  inputs: Record<string, string>
  secretInputs: Record<string, string>
}

export type RunInput = {
  name: string
  secret: boolean
  required: boolean
  value: string
}

export type RequestScopeSnapshot = {
  collection: Collection
  folders: ApiFolder[]
}

export type TestPlanStep = {
  index: number
  stepId: string
  title: string
  phase: Phase
  requests: {
    requestId: ApiNodeId
    snapshot: ApiRequest
    scope: RequestScopeSnapshot
  }[]
  entry: TestMapEntry | null
  requiredVariables: string[]
  approvedDataChange: boolean
}

export type RunVariableScope = {
  environment: EnvironmentVariable[]
  collection: Variable[]
  sensitive: Set<string>
}

export type CapturedValue = {
  variable: string
  value: string
  capturedAt: number
  runId: string
  stepId: string
  source: 'script' | 'test-map'
  // Why: sensitive values are never persisted without encryption (FR-017b).
  unavailable?: boolean
  cleaned: { runId: string; stepId: string; at: number } | null
}

export type CaptureLedger = {
  collectionId: ApiNodeId
  values: CapturedValue[]
}

export type RunState = 'setup' | 'running' | 'paused' | 'stopping' | 'cleaning-up' | 'finished'

export type RunEnding = 'passed' | 'failed' | 'stopped-by-user' | 'preflight-failed' | 'error'

export type StepResultKind = 'pass' | 'fail' | 'skipped' | 'blocked' | 'running' | 'pending'

export type QueryHow =
  | 'automatic'
  | 'browser'
  | 'manual'
  | 'skipped-by-user'
  | 'skipped-not-approved'
  | 'failed'

export type QueryResultTable = {
  columns: string[]
  rows: string[][]
  totalRows: number
  truncated: boolean
}

export type QueryEvidence = {
  queryId: string
  sqlResolved: string
  description?: string
  how: QueryHow
  result: QueryResultTable | null
  pastedText?: string
  /** Manual mode: how long the user took to run the query. */
  waitedMs?: number
  partial: boolean
  blurredCount?: number
  screenshotWithheld?: 'residual' | 'uninspectable'
  error?: string
  screenshot: string | null
}

export type RequestEvidence = {
  requestId: ApiNodeId
  resolvedRequest: ResolvedRequest
  outcome: ExecutionOutcome
  tests: TestResult[]
  sentOffsetMs?: number
  screenshot: string | null
}

export type StepResult = {
  stepId: string
  title: string
  phase: Phase
  iterationValue?: { variable: string; valueMasked: string }
  result: StepResultKind
  reason?: string
  dependencyFailed: string[]
  expectedText: string
  actualText: string
  before: QueryEvidence[]
  after: QueryEvidence[]
  exchanges: RequestEvidence[]
  durationMs: number
}

export type PauseQuery = {
  queryId: string
  sqlResolved: string
  // Unmasked text for the copy action only; never written to evidence.
  sqlRaw?: string
  description?: string
}

export type BrowserRecoveryProblem = 'not-found' | 'error' | 'sign-in' | 'timeout' | 'tab-closed'

export type PauseRequest =
  | {
      kind: 'manual-queries'
      stepId: string
      when: 'before' | 'after'
      queries: PauseQuery[]
    }
  | {
      kind: 'browser-recovery'
      stepId: string
      queryId: string
      problem: BrowserRecoveryProblem
      screenshot: string
    }
  | {
      kind: 'credentials'
      stepId: string
      inputs: { name: string; secret: boolean }[]
    }

/** What a paused event carries: a stored pause, or the transient Stop prompt. */
export type RaisedPause = PauseRequest | { kind: 'stopping' }

export type PauseAnswer =
  | {
      kind: 'manual-queries'
      action: 'continue'
      pasted?: Record<string, string>
    }
  | { kind: 'manual-queries'; action: 'skip'; queryIds: string[] }
  | { kind: 'browser-recovery'; action: 'retry' }
  | { kind: 'browser-recovery'; action: 'do-manually' }
  | { kind: 'browser-recovery'; action: 'skip' }
  | { kind: 'browser-recovery'; action: 'pick-tab'; browserPageId: string }
  | { kind: 'browser-recovery'; action: 'switch-rest-to-manual' }
  | { kind: 'browser-recovery'; action: 'skip-remaining-queries' }
  | { kind: 'credentials'; action: 'resume'; values: Record<string, string> }
  | { kind: 'credentials'; action: 'stop' }
  | { kind: 'stopping'; choice: 'run-cleanup' | 'keep-data' }

export type RunKind = 'full' | 'cleanup-only'

export type RunDatabaseMode =
  | { mode: 'automatic'; connectionName: string }
  | { mode: 'browser'; site: string }
  | { mode: 'manual' }
  | { mode: 'none' }

export type NotCleanedValue = {
  variable: string
  valueMasked: string
  unavailable?: boolean
}

export type TestRun = {
  id: string
  collectionId: ApiNodeId
  kind: RunKind
  environmentId: ApiNodeId | null
  targetHosts: string[]
  databaseMode: RunDatabaseMode
  state: RunState
  ending: RunEnding | null
  startedAt: number
  endedAt: number | null
  pausedMs: number
  currentStepIndex: number | null
  steps: StepResult[]
  pause: PauseRequest | null
  evidence: {
    folder: string
    reportPath: string
    ignoredByGit: boolean
  } | null
  cleanup: {
    cleaned: number
    notCleaned: NotCleanedValue[]
    keptByUser: boolean
  }
}

export type TestRunSummary = Omit<TestRun, 'steps'> & {
  steps: Pick<StepResult, 'stepId' | 'title' | 'phase' | 'result' | 'reason' | 'durationMs'>[]
}

export type TestMapIssue = { path: string; message: string }
