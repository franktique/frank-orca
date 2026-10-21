// Entities shared by main, renderer and CLI. See specs/001-postman-clone-tab/data-model.md.

export type ApiNodeId = string

export const API_CLIENT_SCHEMA_VERSION = 1

export const API_CLIENT_LIMITS = {
  nameMaxLength: 200,
  iterationsMax: 1000,
  delayMsMax: 60_000,
  responseBodyMaxBytes: 10 * 1024 * 1024,
  consolePreviewMaxBytes: 256 * 1024,
  runFileMaxBytes: 50 * 1024 * 1024,
  consoleEntriesMax: 500
} as const

export const SECRET_MASK = '••••'

/** Unmodelled Postman fields, kept so an unmodified import exports unchanged. */
export type PostmanExtra = Record<string, unknown>

export type KeyValue = {
  key: string
  value: string
  enabled: boolean
  description?: string
  /** Postman form-data row kind; preserved for export. */
  type?: string
  postmanExtra?: PostmanExtra
}

export type AuthType =
  | 'noauth'
  | 'inherit'
  | 'bearer'
  | 'basic'
  | 'apikey'
  | 'oauth1'
  | 'oauth2'
  | 'digest'
  | 'awsv4'
  | 'hawk'
  | 'ntlm'
  | 'edgegrid'
  | 'jwt'
  | 'asap'

export const SUPPORTED_AUTH_TYPES: readonly AuthType[] = [
  'noauth',
  'inherit',
  'bearer',
  'basic',
  'apikey'
]

export type Auth = {
  type: AuthType
  /** Postman auth attributes (token, username, key…) as a flat map. */
  params: Record<string, string>
  postmanExtra?: PostmanExtra
}

export type VariableType = 'default' | 'secret'

export type Variable = {
  key: string
  value: string
  enabled: boolean
  description?: string
  postmanExtra?: PostmanExtra
}

export type EnvironmentVariable = {
  key: string
  /** `null` when a secret could not be decrypted (FR-009b). */
  value: string | null
  enabled: boolean
  type: VariableType
  /** Runtime-only; never persisted. */
  needsReentry?: boolean
  /** Runtime-only: a secret whose value exists but was withheld from this snapshot. */
  masked?: boolean
}

export type Script = {
  exec: string[]
  id?: string
  postmanExtra?: PostmanExtra
}

export type ScriptEvents = {
  prerequest?: Script
  test?: Script
}

export type BodyMode = 'none' | 'raw' | 'urlencoded' | 'formdata' | 'file' | 'graphql'

export type Body = {
  mode: BodyMode
  raw?: string
  language?: string
  urlencoded?: KeyValue[]
  formdata?: KeyValue[]
  graphql?: { query: string; variables?: string }
  postmanExtra?: PostmanExtra
}

export type RequestSettings = {
  sslVerification?: boolean
  followRedirects?: boolean
  timeoutMs?: number
}

export type RequestUrl = {
  raw: string
  query: KeyValue[]
}

export type ApiRequest = {
  id: ApiNodeId
  kind: 'request'
  name: string
  description?: string
  /** Upper-cased. */
  method: string
  url: RequestUrl
  pathVariables: KeyValue[]
  headers: KeyValue[]
  body?: Body
  auth?: Auth
  events: ScriptEvents
  settings: RequestSettings
  /** Bumped on every save; lets two tabs editing the same request detect a stale draft. */
  revision: number
  postmanExtra: PostmanExtra
}

export type ApiFolder = {
  id: ApiNodeId
  kind: 'folder'
  name: string
  description?: string
  variables: Variable[]
  auth?: Auth
  events: ScriptEvents
  items: ApiItem[]
  postmanExtra: PostmanExtra
}

export type ApiItem = ApiFolder | ApiRequest

export type Collection = {
  id: ApiNodeId
  name: string
  description?: string
  variables: Variable[]
  auth?: Auth
  events: ScriptEvents
  items: ApiItem[]
  revision: number
  postmanExtra: PostmanExtra
  importWarnings: string[]
}

export type Environment = {
  id: ApiNodeId
  name: string
  variables: EnvironmentVariable[]
  revision: number
  postmanExtra: PostmanExtra
}

export type CollectionSummary = { id: ApiNodeId; name: string; revision: number }
export type EnvironmentSummary = {
  id: ApiNodeId
  name: string
  revision: number
  variableCount: number
}

/** The snapshot the renderer reads: summaries plus the full trees it displays. */
export type WorktreeApiData = {
  worktreeId: string
  schemaVersion: typeof API_CLIENT_SCHEMA_VERSION
  collections: Collection[]
  environments: Environment[]
  activeEnvironmentId: ApiNodeId | null
  revision: number
  /** True when a newer build wrote the data; edits are refused (downgrade safety). */
  readOnly?: boolean
  /** Files that failed validation and were moved aside while the rest loaded. */
  corruptFiles?: string[]
}

// ─── Results ────────────────────────────────────────────────────────

export type ApiErrorCode =
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'certificate'
  | 'dns'
  | 'unsupported-auth'
  | 'script-error'
  | 'invalid-url'

export type ExecutionOrigin = 'manual' | 'run' | 'agent'

export type ResolvedRequest = {
  method: string
  url: string
  headers: [string, string][]
  body: string | null
}

export type ResponseSnapshot = {
  status: number
  statusText: string
  headers: [string, string][]
  sizeBytes: number
  contentType: string | null
  body: { encoding: 'utf8' | 'base64' | 'omitted'; text?: string; truncated: boolean }
  redirects: { url: string; status: number }[]
}

export type TestResult = { name: string; passed: boolean; error?: string }

export type LogLevel = 'log' | 'info' | 'warn' | 'error'
export type ScriptPhase = 'prerequest' | 'test'
export type LogLine = { level: LogLevel; phase: ScriptPhase; text: string }

export type ExecutionOutcome =
  | { kind: 'response'; response: ResponseSnapshot }
  | { kind: 'error'; code: ApiErrorCode; message: string }

export type LatestResult = {
  requestId: ApiNodeId
  origin: ExecutionOrigin
  startedAt: number
  durationMs: number
  ttfbMs: number | null
  resolvedRequest: ResolvedRequest
  outcome: ExecutionOutcome
  tests: TestResult[]
  scriptLogs: LogLine[]
  environmentId: ApiNodeId | null
}

export type ConsoleEntry = {
  id: string
  worktreeId: string
  at: number
  origin: ExecutionOrigin
  requestId?: ApiNodeId
  runId?: string
  method: string
  url: string
  status?: number
  durationMs?: number
  request: ResolvedRequest
  outcome: ExecutionOutcome
  scriptLogs: LogLine[]
  tests: TestResult[]
}

// ─── Runs ───────────────────────────────────────────────────────────

export type RunOrigin = 'manual' | 'agent'
export type RunState = 'running' | 'stopped' | 'completed' | 'failed-to-start'

export type RunScope = { collectionId: ApiNodeId; folderId?: ApiNodeId }

export type RunOptions = {
  iterations: number
  delayMs: number
  stopOnFailure: boolean
  includedRequestIds: ApiNodeId[]
}

export type RunResultDetail = {
  resolvedRequest: ResolvedRequest
  outcome: ExecutionOutcome
  scriptLogs: LogLine[]
}

export type RunRequestResult = {
  iteration: number
  requestId: ApiNodeId
  requestName: string
  folderPath: string[]
  status?: number
  durationMs: number
  tests: TestResult[]
  error?: string
  detail: RunResultDetail | null
}

export type RunTotals = {
  requests: number
  testsPassed: number
  testsFailed: number
  durationMs: number
}

export type Run = {
  id: string
  scope: RunScope
  environmentId: ApiNodeId | null
  options: RunOptions
  origin: RunOrigin
  state: RunState
  stoppedEarly: boolean
  startedAt: number
  endedAt: number | null
  results: RunRequestResult[]
  totals: RunTotals
  error?: string
}

// ─── Secrets ────────────────────────────────────────────────────────

export type SecretProtection = { level: 'memory-only' | 'weak'; message: string }

// ─── Tab session state ──────────────────────────────────────────────

export type ApiClientPersistedView =
  | { kind: 'empty' }
  | { kind: 'request'; requestId: ApiNodeId }
  | { kind: 'environment'; environmentId: ApiNodeId }
  | { kind: 'runner'; scope: RunScope }
  | { kind: 'test-run'; collectionId: ApiNodeId }

/** What an API Client tab keeps across restarts: what it shows and how it is laid out. */
export type ApiClientPersistedTab = {
  view: ApiClientPersistedView
  consoleCollapsed?: boolean
  consoleHeight?: number
  splitRatio?: number
}
